import { useEffect, useRef, useState } from 'react';
import type { Build } from '../shared/contracts.ts';
import type { ChangesArtifact, ChangesInput } from '../shared/changes-pdf.ts';
import { comparisonScreenshots } from './comparison-screenshots.ts';

export type PdfReviewBuilds = { key: string; original: Build; proposed: Build; changes: ChangesArtifact | null; problem: string };
export type PdfReviewWork = <T>(kind: 'build' | 'arrange', action: () => Promise<T>) => Promise<T>;
const message = (error: unknown) => String(error instanceof Error ? error.message : error).replace(/^Error invoking remote method '[^']+': Error: /, '');

// The three artifacts belong to one exact source pair. Publish them together;
// keep the preceding pair readable while a replacement is being prepared.
export function usePdfReviewBuild(input: ChangesInput, visible: boolean, editing: boolean, work: PdfReviewWork) {
  const key = JSON.stringify([input.projectId, input.before, input.after, input.engine, input.presentation, input.selectedPaths, input.interactive]);
  const [value, setValue] = useState<PdfReviewBuilds | null>(null);
  const [status, setStatus] = useState(''), [error, setError] = useState('');
  const [busy, setBusy] = useState(false), [refresh, setRefresh] = useState(0), [invalid, setInvalid] = useState('');
  const current = useRef({ key, visible }); current.current = { key, visible };
  const latest = useRef({ input, work, value }); latest.current = { input, work, value };
  const job = useRef<{ cancelled: boolean; kind: 'build' | 'arrange' | null } | null>(null);
  const attempted = useRef(''), smart = useRef(false), mounted = useRef(true);
  const cache = useRef(new Map<string, Build>());
  const token = key + ':' + refresh;
  function stop() {
    const running = job.current; if (!running || running.cancelled) return;
    running.cancelled = true;
    if (running.kind) void (running.kind === 'build' ? window.editor.cancelBuild() : window.editor.cancelCodex()).catch(() => {});
  }
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; stop(); }; }, []);
  useEffect(() => { stop(); }, [key, visible]);
  useEffect(() => {
    if (!visible || editing || job.current || attempted.current === token) return;
    const timer = setTimeout(() => { void generate(); }, 350);
    return () => clearTimeout(timer);
  }, [visible, editing, key, refresh, busy]);
  async function generate() {
    if (job.current || !current.current.visible) return;
    const expected = key, captured = latest.current.input, askSol = smart.current;
    smart.current = false; attempted.current = token;
    const running = { cancelled: false, kind: null as 'build' | 'arrange' | null }; job.current = running;
    const alive = () => mounted.current && !running.cancelled && current.current.visible && current.current.key === expected;
    const run = <T,>(kind: 'build' | 'arrange', action: () => Promise<T>) => latest.current.work(kind, async () => {
      if (!alive()) throw new Error('PDF review cancelled.');
      running.kind = kind;
      try { return await action(); } finally { running.kind = null; }
    });
    setBusy(true); setError(''); setStatus('Preparing the whole proposed revision…');
    try {
      const result = await run('build', async () => {
        async function compile(text: string, label: string) {
          if (!alive()) throw new Error('PDF review cancelled.');
          const id = JSON.stringify([captured.projectId, text, captured.engine, captured.selectedPaths]);
          const kept = cache.current.get(id);
          if (kept && await window.editor.validateBuild({ projectId: captured.projectId, buildId: kept.id, text })) return kept;
          setStatus('Compiling ' + label + '…');
          const build = await window.editor.compile({ projectId: captured.projectId, text, engine: captured.engine, purpose: 'proposal', selectedPaths: captured.selectedPaths });
          if (!build.success || build.dependenciesVerified !== true || build.inputPreparation) throw new Error(label + ': ' + (build.inputPreparation ? 'Choose compilation inputs in the workspace first.' : build.diagnostics.map(d => d.message).slice(0, 3).join(' ') || 'Preview not possible.'));
          cache.current.set(id, build); while (cache.current.size > 4) cache.current.delete(cache.current.keys().next().value!);
          return build;
        }
        const original = await compile(captured.before, 'original');
        const proposed = captured.after === captured.before ? original : await compile(captured.after, 'proposed revision');
        if (!alive()) throw new Error('PDF review cancelled.');
        setStatus('Marking changes…');
        let changes: ChangesArtifact | null = null, problem = '';
        try { changes = await window.editor.buildChanges(captured); }
        catch (error) { if (!alive()) throw error; problem = message(error); }
        for (const [build, text] of [[original, captured.before], [proposed, captured.after]] as const) {
          if (!alive() || !await window.editor.validateBuild({ projectId: captured.projectId, buildId: build.id, text })) throw new Error('Compilation inputs changed. Refresh the PDF review.');
        }
        return { key: expected, original, proposed, changes, problem };
      });
      if (!alive()) return;
      setValue(result); setInvalid('');
      if (!askSol || !result.changes?.build) return;
      setStatus('PDFs ready · Sol is reviewing the comparison…');
      const arrangement = await run('arrange', () => window.editor.planChanges(captured));
      if (!alive() || !arrangement.id) return;
      const changes = await run('build', () => window.editor.buildChanges({ ...captured, arrangementId: arrangement.id }));
      if (!alive()) return;
      setValue({ ...result, changes });
      if (changes.build && changes.visual?.status === 'requested') {
        setStatus('Sol requested a visual check…');
        const images = await comparisonScreenshots(changes.build.id, changes.visual.pages, alive);
        if (!alive()) return;
        const visual = await run('arrange', () => window.editor.checkChangesVisual(captured.projectId, changes.id, images));
        if (alive()) setValue({ ...result, changes: { ...changes, visual } });
      }
    } catch (error) { if (alive()) setError((askSol && latest.current.value?.key === expected ? 'Sol review unavailable. ' : 'Preview not possible. ') + message(error)); }
    finally {
      running.kind = null; if (job.current === running) job.current = null;
      if (mounted.current) { setBusy(false); setStatus(running.cancelled ? 'Update stopped · Refresh to retry' : ''); }
    }
  }
  // External resource edits must not leave a preview labelled current.
  useEffect(() => {
    if (!visible || !value || busy) return;
    let disposed = false, checking = false;
    const inspect = async () => {
      if (checking) return; checking = true;
      try {
        const valid = await window.editor.validateBuild({ projectId: input.projectId, buildId: value.original.id, text: input.before }) &&
          await window.editor.validateBuild({ projectId: input.projectId, buildId: value.proposed.id, text: input.after }) &&
          (!value.changes?.build || (await window.editor.inspectChanges(input.projectId, value.changes.id)).status === 'valid');
        if (!disposed && !valid) setInvalid(value.key);
      } catch { if (!disposed) setInvalid(value.key); }
      finally { checking = false; }
    };
    void inspect(); const timer = setInterval(() => void inspect(), 10000);
    window.addEventListener('focus', inspect);
    return () => { disposed = true; clearInterval(timer); window.removeEventListener('focus', inspect); };
  }, [visible, value, busy, input.projectId, input.before, input.after]);
  return { value, status, error, busy, fresh: !!value && value.key === key && value.key !== invalid,
    refresh: (withSol = false) => { smart.current = withSol; setRefresh(n => n + 1); }, stop };
}
