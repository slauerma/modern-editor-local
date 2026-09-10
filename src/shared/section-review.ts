import type { ReviewRequest } from './contracts.ts';

export type Section = { from: number; to: number; label: string };
export function reviewSections(text: string): Section[] {
  // Preserve offsets while excluding common quoted/commented section commands.
  const masked = text.replace(/(?<!\\)%[^\n]*/g, value => ' '.repeat(value.length)).replace(/\\begin\{(verbatim\*?|lstlisting)\}[\s\S]*?\\end\{\1\}/g, value => value.replace(/[^\n]/g, ' '));
  const opening = /\\begin\s*\{document\}/.exec(masked), closing = /\\end\s*\{document\}/.exec(masked);
  const from = opening ? opening.index + opening[0].length : 0, end = closing?.index ?? text.length;
  const starts: { from: number; label: string }[] = [{ from, label: 'Opening' }];
  for (const match of masked.matchAll(/\\(?:section|chapter)\*?(?:\[[^\]\n]*\])?\s*\{([^}\n]*)\}/g)) if (match.index! >= from && match.index! < end) starts.push({ from: match.index!, label: match[1].trim() || 'Untitled section' });
  const sections = starts.map((start, i) => ({ ...start, to: starts[i + 1]?.from ?? end })).filter(s => text.slice(s.from, s.to).trim());
  if (!sections.length) throw new Error('There is no body text to review.');
  if (sections.length > 40 || sections.some(s => s.to - s.from > 120000)) throw new Error('Section review supports up to 40 sections of 120,000 characters each. Select a shorter passage for a single review. Sections are not cut through a proof automatically.');
  return sections;
}
export type SectionProgress = { phase: 'running' | 'pausing' | 'paused' | 'discussion_queued' | 'discussing' | 'stopping' | 'stopped' | 'complete' | 'failed'; completed: number; total: number; label: string };
type Ports = { request(request: ReviewRequest): Promise<unknown>; delivered(): Promise<void>; cancel(): Promise<unknown>; changed(progress: SectionProgress): void };
export class SectionReview {
  private ports: Ports;
  private paused = false;
  private stopped = false;
  private wake?: () => void;
  private progress: SectionProgress = { phase: 'running', completed: 0, total: 0, label: '' };
  private running = false;
  private priority?: { task(): Promise<void>; resolve(value: boolean): void; reject(error: unknown): void };
  private discussing = false;
  constructor(ports: Ports) { this.ports = ports; }
  private update(phase: SectionProgress['phase']) { this.progress = { ...this.progress, phase }; this.ports.changed(this.progress); }
  get canDiscuss() { return this.running && !this.stopped && !this.priority && !this.discussing; }
  pause() { if (!this.running || this.stopped || this.priority || this.discussing) return; this.paused = true; if (this.progress.phase !== 'paused') this.update('pausing'); }
  resume() { if (!this.running || this.stopped || this.priority || this.discussing) return; this.paused = false; this.wake?.(); this.update('running'); }
  interrupt(task: () => Promise<void>): Promise<boolean> {
    if (!this.canDiscuss) return Promise.resolve(false);
    this.paused = true;
    const result = new Promise<boolean>((resolve, reject) => { this.priority = { task, resolve, reject }; });
    this.update('discussion_queued'); this.wake?.();
    return result;
  }
  private dropQuestion() { const pending = this.priority; this.priority = undefined; pending?.resolve(false); }
  async stop() { if (!this.running) return; this.stopped = true; this.paused = false; this.dropQuestion(); this.wake?.(); this.update('stopping'); await this.ports.cancel(); }
  private async boundary(last = false) {
    while (!this.stopped) {
      const question = this.priority;
      if (question) {
        this.priority = undefined; this.discussing = true; this.update('discussing');
        try { await question.task(); question.resolve(true); } catch (error) { question.reject(error); }
        finally { this.discussing = false; }
        // A question never silently resumes the remaining section requests.
        this.paused = true;
      }
      if (last || !this.paused || this.stopped) return;
      this.update('paused'); await new Promise<void>(resolve => { this.wake = resolve; }); this.wake = undefined;
    }
  }
  async run(request: Omit<ReviewRequest, 'from' | 'to'>) {
    if (this.running) throw new Error('A section review is already running.');
    const sections = reviewSections(request.text); this.running = true; this.stopped = false; this.paused = false;
    this.progress = { phase: 'running', completed: 0, total: sections.length, label: '' };
    try {
      for (const section of sections) {
        await this.boundary();
        if (this.stopped) break;
        this.progress = { ...this.progress, label: section.label }; this.update('running');
        await this.ports.request({ ...request, from: section.from, to: section.to, requestId: crypto.randomUUID() });
        this.progress = { ...this.progress, completed: this.progress.completed + 1 };
        await this.ports.delivered();
      }
      await this.boundary(true);
      this.update(this.stopped ? 'stopped' : 'complete');
    } catch (error) { this.update(this.stopped ? 'stopped' : 'failed'); if (!this.stopped) throw error; }
    finally { this.dropQuestion(); this.running = false; this.wake = undefined; }
  }
}
