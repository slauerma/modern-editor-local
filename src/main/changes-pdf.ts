import { randomUUID } from 'node:crypto';
import { documentBody } from '../shared/document-mode.ts';
import { applyArrangement, comparisonPlan, inlineEdits, type ChangesInput, type ChangesArtifact, type ChangesPresentation, type ComparisonChange, type ComparisonPlan, type ArrangementPreview } from '../shared/changes-pdf.ts';
import { digest } from './files.ts';
import type { ProjectService } from './project-service.ts';
import type { CompileService } from './compile-service.ts';
import type { CodexService } from './codex-service.ts';
import { changesAgentSchema, visualCheckSchema, arrangementInstructions, visualInstructions, type ChangesScreenshot, type ChangesVisual } from '../shared/changes-agent.ts';
import { readComparisonMarkers, type ComparisonMarkerReader, type ComparisonMarker } from './comparison-markers.ts';

const texText = (s: string) => s.replace(/[\\{}$%&#_^~]/g, c => ({ '\\': '\\textbackslash{}', '{': '\\{', '}': '\\}', '$': '\\$', '%': '\\%', '&': '\\&', '#': '\\#', '_': '\\_', '^': '\\textasciicircum{}', '~': '\\textasciitilde{}' }[c]!));
const commonPreamble = String.raw`
% Generated comparison markup. This source is never the manuscript.
\setlength{\marginparpush}{8pt}
\usepackage{hyperref}
% Keep destinations and link rectangles without printing labels. The viewer
% draws the numbered buttons only while the author opens Why?.
\newcommand{\MECompareMark}[1]{\marginpar{\raggedright\footnotesize\hypertarget{MECompare-#1}{\href{https://modern-editor.invalid/changes/#1}{\phantom{\textbf{[#1]}}}}}}
`;
const markupPreamble = String.raw`
\usepackage{xcolor}
% Do not reload ulem with conflicting options or change existing emphasis.
\makeatletter
\@ifpackageloaded{ulem}{}{\usepackage[normalem]{ulem}}
\makeatother
\newcommand{\MECompareAdd}[1]{{\color{teal!70!black}\uline{#1}}}
\newcommand{\MECompareDel}[1]{{\color{red!65!black}\sout{#1}}}
% A visual gap between adjacent old/new runs, never manuscript whitespace.
\newcommand{\MECompareSep}{\allowbreak\hspace{0.25em}}
\newcommand{\MECompareMathAdd}[1]{\mbox{\color{teal!70!black}\uline{\(\displaystyle #1\)}}}
\newcommand{\MECompareMathDel}[1]{\mbox{\color{red!65!black}\sout{\(\displaystyle #1\)}}}
`;

// Only ordinary single display formulas receive whole-formula markup. Never
// splice a strike-through into alignment rows, numbering or command arguments.
function displayFormula(text: string) {
  const match = /^(?:\\\[([\s\S]*?)\\\]|\$\$([\s\S]*?)\$\$|\\begin\{equation\*\}([\s\S]*?)\\end\{equation\*\})$/.exec(text.trim());
  const inner = match && (match[1] ?? match[2] ?? match[3]);
  return inner && !/\\(?:begin|end|tag)\b|\\\\/.test(inner) ? inner : null;
}
function formulaChange(c: ComparisonChange) {
  return (!c.oldText.trim() || displayFormula(c.oldText) !== null) && (!c.newText.trim() || displayFormula(c.newText) !== null);
}
function presentationPlan(plan: ComparisonPlan, presentation: ChangesPresentation): ComparisonPlan {
  const result = structuredClone(plan);
  if (presentation === 'markup') for (const c of result.changes) {
    if (c.layout !== 'omitted' && !inlineEdits(c.oldText, c.newText) && !formulaChange(c)) {
      c.layout = 'omitted';
      c.omission = 'This change cannot safely use strike-through or underline markup. Clean paper shows the revised passage with a marker; Text diff shows the exact change.';
    }
  }
  return result;
}
function mark(text: string, kind: 'Add' | 'Del') {
  if (!text.trim()) return text;
  // ulem cannot enclose paragraph boundaries. Keep boundary whitespace outside.
  const leading = text.match(/^\s*/)?.[0] ?? '', trailing = text.match(/\s*$/)?.[0] ?? '';
  return leading + '\\MECompare' + kind + '{' + text.trim() + '}' + trailing;
}

/** Insert only exact source owned by the app; Codex never supplies TeX. */
export function renderComparison(before: string, after: string, sourcePlan: ComparisonPlan, name: string, proposal = false, presentation: ChangesPresentation = 'markup') {
  const plan = presentationPlan(sourcePlan, presentation);
  const body = documentBody(after);
  if (!body || /MECompare/.test(before + after)) throw new Error('Preview not possible: unsupported document wrapper or comparison macro conflict.');
  const ranges: Record<string, { from: number; to: number }> = {};
  const preamble = commonPreamble + (presentation === 'markup' ? markupPreamble : '');
  let text = after.slice(0, body.from), at = body.from;
  text = text.replace(/\\begin\s*\{document\}\s*$/, match => preamble + '\n' + match);
  // documentBody's position comes from the structural scanner, not a regex
  // match. Refuse unusual wrapper spelling instead of missing our definitions.
  if (!text.includes(preamble)) throw new Error('Preview not possible: the document wrapper needs an ordinary literal form.');
  // Comparison identity belongs in the viewer. Body text before \maketitle
  // forces an otherwise unnecessary first page in an ordinary article.
  for (const c of plan.changes) {
    if (c.layout === 'omitted') continue;
    if (c.fromB < at || c.toB > body.to) throw new Error('Preview not possible: overlapping comparison blocks.');
    text += after.slice(at, c.fromB);
    const number = c.id.replace('change-', '');
    let start = text.length;
    const edits = inlineEdits(c.oldText, c.newText);
    if (presentation === 'clean') {
      // Keep the revised wording exactly once. An entirely deleted block still
      // has a marker at its boundary; the earlier text remains in the details.
      const anchor = edits?.[0]?.fromB ?? 0;
      text += c.newText.slice(0, anchor) + '\\MECompareMark{' + number + '}';
      start = text.length;
      text += c.newText.slice(anchor);
      if (!c.newText.trim()) text += '\\mbox{}';
    } else if (edits && c.layout === 'paired' && !/[\\{}$%&#_^~]/.test(c.oldText + c.newText)) {
      // Substantial prose rewrites read better as two marked paragraphs than
      // as a dense interleaving of unrelated words. Keep their exact wording.
      text += '\n\\par\\noindent\\MECompareMark{' + number + '}\n'; start = text.length;
      text += mark(c.oldText, 'Del') + '\n\\par\\smallskip\\noindent\n' + mark(c.newText, 'Add') + '\n\\par\n';
    } else if (edits) {
      let cursor = 0;
      for (const [index, e] of edits.entries()) {
        text += c.newText.slice(cursor, e.fromB);
        if (index === 0) { text += '\\MECompareMark{' + number + '}'; start = text.length; }
        if (e.toA > e.fromA) text += mark(c.oldText.slice(e.fromA, e.toA), 'Del');
        if (c.oldText.slice(e.fromA, e.toA).trim() && c.newText.slice(e.fromB, e.toB).trim()) text += '\\MECompareSep{}';
        if (e.toB > e.fromB) text += mark(c.newText.slice(e.fromB, e.toB), 'Add');
        cursor = e.toB;
      }
      text += c.newText.slice(cursor);
    } else {
      text += '\n\\par\\MECompareMark{' + number + '}\n'; start = text.length;
      if (c.oldText.trim()) text += '\\[\\MECompareMathDel{' + displayFormula(c.oldText) + '}\\]\n';
      if (c.newText.trim()) text += '\\[\\MECompareMathAdd{' + displayFormula(c.newText) + '}\\]\n';
    }
    ranges[c.id] = { from: start, to: text.length };
    at = c.toB;
  }
  text += after.slice(at, body.to);
  const omitted = plan.changes.filter(c => c.layout === 'omitted');
  if (omitted.length) {
    text += '\n\\par\\bigskip\\noindent\\textbf{Changes not shown}\\par\n';
    text += '{\\small The following differences are not marked in the paper above. See Text diff for the exact source changes.}\\par\n';
    for (const c of omitted) {
      const start = text.length, number = c.id.replace('change-', '');
      const lineA = before.slice(0, c.fromA).split('\n').length, lineB = after.slice(0, c.fromB).split('\n').length;
      text += '\\noindent\\MECompareMark{' + number + '}\\textbf{Change ' + number + ' not shown.} Old source line ' + lineA + ', new source line ' + lineB + '. ' + texText(c.omission ?? 'Unsupported block.') + '\\par\n';
      ranges[c.id] = { from: start, to: text.length };
    }
  }
  text += after.slice(body.to);
  if (text.length > 2_000_000) throw new Error('Preview not possible: the marked document exceeds the build limit.');
  return { text, ranges, changes: plan.changes };
}

type ComparisonRecord = { projectId: string; text: string; ranges: Record<string, { from: number; to: number }>; artifact: ChangesArtifact; input: ChangesInput; plan: ComparisonPlan;
  inspectionIds?: string[]; markers?: Promise<Record<string, ComparisonMarker>> };
export class ChangesPdfService {
  private records = new Map<string, ComparisonRecord>();
  private generation = 0;
  private pending = new Set<Promise<unknown>>();
  private prepared: { key: string; plan: ComparisonPlan; value: ArrangementPreview } | null = null;
  private arranged: { key: string; plan: ComparisonPlan; id: string; inspect?: string[] } | null = null;
  private building = false;
  private markerReaders = new Set<AbortController>();
  private readMarkers: ComparisonMarkerReader;
  private projects: ProjectService; private compiler: CompileService; private codex?: CodexService;
  constructor(projects: ProjectService, compiler: CompileService, codex?: CodexService, readMarkers: ComparisonMarkerReader = readComparisonMarkers) { this.projects = projects; this.compiler = compiler; this.codex = codex; this.readMarkers = readMarkers; }
  cancel() { this.generation++; this.prepared = null; this.arranged = null; for (const reader of this.markerReaders) reader.abort(); }
  async settle() { await Promise.allSettled([...this.pending]); }
  private track<T>(task: Promise<T>) { this.pending.add(task); void task.then(() => this.pending.delete(task), () => this.pending.delete(task)); return task; }
  private key(input: ChangesInput) { return digest(JSON.stringify([input.projectId, input.before, input.after, input.name, input.engine, input.proposalId, input.selectedPaths])); }
  private check(projectId: string, generation: number) {
    this.projects.get(projectId);
    if (generation !== this.generation) throw new Error('Changes PDF cancelled.');
  }
  private plan(input: ChangesInput) {
    this.projects.get(input.projectId);
    let plan = this.projects.changeJournal.explain(input.before, input.after, comparisonPlan(input.before, input.after));
    if (input.proposalId) {
      const reason = this.projects.changeJournal.proposal(input.before, input.after, input.proposalId);
      if (!reason) throw new Error('The proposal changed. Refresh its preview before making a Changes PDF.');
      for (const c of plan.changes) c.reasons = [reason];
    }
    if (input.arrangementId) {
      if (this.arranged?.id !== input.arrangementId || this.arranged.key !== this.key(input)) throw new Error('The comparison changed. Prepare a new arrangement.');
      plan = structuredClone(this.arranged.plan);
    }
    for (const [id, layout] of Object.entries(input.layouts ?? {})) {
      const c = plan.changes.find(c => c.id === id);
      if (!c || !['inline', 'paired'].includes(c.layout) || layout === 'inline' && !c.inline || layout === 'paired' && !c.paired) throw new Error('This change does not support that layout.');
      c.layout = layout;
    }
    return plan;
  }
  build(input: ChangesInput) { return this.track(this.buildOperation(input)); }
  present(projectId: string, artifactId: string, presentation: ChangesPresentation) {
    return this.track((async () => {
      const generation = this.generation, record = this.records.get(artifactId);
      this.projects.get(projectId);
      if (!record || record.projectId !== projectId) throw new Error('This comparison is no longer available. Refresh Changes PDF.');
      if (record.artifact.build && (await this.inspect(projectId, artifactId)).status !== 'valid') throw new Error('Comparison inputs changed. Refresh Changes PDF before switching views.');
      this.check(projectId, generation);
      // Reuse only the captured, validated source plan. A presentation switch
      // never consumes another Codex turn or borrows a previous visual verdict.
      return this.buildOperation({ ...record.input, presentation, arrangementId: undefined }, record.plan);
    })());
  }
  private remember(record: ComparisonRecord) {
    this.records.set(record.artifact.id, record);
    while (this.records.size > 6) this.records.delete(this.records.keys().next().value!);
  }
  private async buildOperation(input: ChangesInput, capturedPlan?: ComparisonPlan): Promise<ChangesArtifact> {
    if (this.building) throw new Error('A Changes PDF is already being prepared.');
    this.building = true; const generation = this.generation;
    try {
      const plan = capturedPlan ? structuredClone(capturedPlan) : this.plan(input), presentation = input.presentation ?? 'markup';
      // Do not compile an unmarked paper and present it as a successful preview.
      const shown = presentationPlan(plan, presentation);
      if (!shown.changes.some(c => c.layout !== 'omitted')) {
        const artifact: ChangesArtifact = { id: randomUUID(), presentation, build: null, changes: shown.changes, notice: plan.notice };
        this.remember({ projectId: input.projectId, text: '', ranges: {}, artifact, input: structuredClone(input), plan });
        return artifact;
      }
      const generated = renderComparison(input.before, input.after, plan, input.name, !!input.proposalId, presentation);
      const inspectionIds = input.arrangementId && this.arranged?.id === input.arrangementId ? this.arranged.inspect?.slice() : undefined;
      this.check(input.projectId, generation);
      const build = await this.compiler.compile(input.projectId, generated.text, input.engine, input.selectedPaths, undefined, 'comparison');
      this.check(input.projectId, generation);
      if (!build.success || build.dependenciesVerified !== true) throw new Error('Preview not possible. ' + (build.inputPreparation?.reason ?? (build.diagnostics.slice(0, 3).map(d => d.message).join(' ') || 'The marked document did not produce a PDF with verified inputs.')) + ' Use Text diff; the ordinary PDF is preserved.');
      if ((await this.compiler.inspect(input.projectId, build.id, generated.text)).status !== 'valid') throw new Error('Preview not possible: comparison inputs changed during compilation. Refresh when they are stable.');
      this.check(input.projectId, generation);
      const artifact: ChangesArtifact = { id: randomUUID(), presentation, build, changes: generated.changes, notice: plan.notice };
      // Keep a bounded set of immutable comparisons; PDFs retain normal cache policy.
      this.remember({ projectId: input.projectId, text: generated.text, ranges: generated.ranges, artifact, input: structuredClone(input), plan, inspectionIds });
      if (inspectionIds) {
        const pages: number[] = [], missing: string[] = [];
        for (const id of inspectionIds) {
          if (artifact.changes.find(c => c.id === id)?.layout === 'omitted') { missing.push(id); continue; }
          const location = await this.locate(input.projectId, artifact.id, id);
          if (location.kind === 'mapped') { if (!pages.includes(location.page)) pages.push(location.page); }
          else missing.push(id);
        }
        this.check(input.projectId, generation);
        artifact.visual = { pages, status: missing.length ? 'unavailable' : pages.length ? 'requested' : 'not-requested', issues: missing.length ? ['A requested visual check could not be located safely. Use Text diff for that change.'] : [] };
      }
      return artifact;
    } finally { this.building = false; }
  }
  async inspect(projectId: string, id: string) {
    this.projects.get(projectId);
    const record = this.records.get(id);
    return record?.projectId === projectId && record.artifact.build ? this.compiler.inspect(projectId, record.artifact.build.id, record.text) : { status: 'unavailable' as const };
  }
  async locate(projectId: string, id: string, changeId: string) {
    const generation = this.generation;
    this.projects.get(projectId);
    const record = this.records.get(id), range = record?.ranges[changeId];
    if (!record || record.projectId !== projectId || !range || !record.artifact.build) return { kind: 'unavailable' as const, reason: 'This comparison location is unavailable. Refresh Changes PDF.' };
    if ((await this.compiler.inspect(projectId, record.artifact.build.id, record.text)).status !== 'valid') return { kind: 'unavailable' as const, reason: 'Comparison inputs changed. Refresh Changes PDF.' };
    try {
      this.check(projectId, generation);
      if (!record.markers) {
        const controller = new AbortController(); this.markerReaders.add(controller);
        const markers = this.track((async () => {
          const bytes = await this.compiler.pdf(record.artifact.build!.id);
          this.check(projectId, generation);
          return this.readMarkers(new Uint8Array(bytes), record.artifact.changes.map(c => c.id), controller.signal);
        })());
        record.markers = markers;
        void markers.finally(() => this.markerReaders.delete(controller)).catch(() => { if (record.markers === markers) record.markers = undefined; });
      }
      const marker = (await record.markers)[changeId];
      this.check(projectId, generation);
      if ((await this.inspect(projectId, id)).status !== 'valid') return { kind: 'unavailable' as const, reason: 'Comparison inputs changed. Refresh Changes PDF.' };
      this.check(projectId, generation);
      return marker ? { kind: 'mapped' as const, buildId: record.artifact.build.id, ...marker }
        : { kind: 'unavailable' as const, reason: 'This exact comparison marker is unavailable. See its explanation or Text diff.' };
    } catch {
      return { kind: 'unavailable' as const, reason: 'The comparison marker could not be verified. Refresh Changes PDF or use Text diff.' };
    }
  }
  prepare(input: ChangesInput): ArrangementPreview {
    const plan = this.plan({ ...input, arrangementId: undefined });
    const prompt = JSON.stringify({
      task: arrangementInstructions + '\nThis request only arranges groups; do not return an inspect field.',
      presentation: input.presentation ?? 'markup',
      changes: plan.changes
    });
    if (prompt.length > 100000) throw new Error('This comparison is too large for an arrangement request. Use the local layouts or choose a closer baseline.');
    const value = { id: randomUUID(), prompt }; this.prepared = { key: this.key(input), plan, value }; return value;
  }
  smartPlan(input: ChangesInput, progress: (message: string) => void) {
    return this.track((async () => {
      const generation = this.generation, key = this.key(input), plan = this.plan({ ...input, arrangementId: undefined });
      // Nothing to typeset: never spend a model turn inventing a preview.
      const presentation = input.presentation ?? 'markup', shown = presentationPlan(plan, presentation);
      if (!shown.changes.some(c => c.layout !== 'omitted')) return { id: undefined };
      const markup = presentationPlan(plan, 'markup'), clean = presentationPlan(plan, 'clean');
      const prompt = JSON.stringify({ task: arrangementInstructions, presentation, changes: plan.changes.map((c, i) => ({ ...c,
        shownIn: { markup: markup.changes[i].layout !== 'omitted', clean: clean.changes[i].layout !== 'omitted' },
        presentationOmission: shown.changes[i].omission })) });
      if (prompt.length > 100000) throw new Error('Preview not possible: the changes exceed the Sol request limit. Choose a closer baseline or Text diff.');
      if (!this.codex) throw new Error('The Changes PDF agent is unavailable.');
      const response = changesAgentSchema.parse(await this.codex.planChanges(input.projectId, prompt, progress));
      this.check(input.projectId, generation);
      const arranged = applyArrangement(plan, { groups: response.groups });
      const rendered = presentationPlan(arranged, presentation);
      for (const id of response.inspect) if (!rendered.changes.some(c => c.id === id && c.layout !== 'omitted')) throw new Error('Sol requested an unsupported visual check. Use Text diff or Refresh.');
      const id = randomUUID(); this.arranged = { id, key, plan: arranged, inspect: [...new Set(response.inspect)] };
      return { id };
    })());
  }
  checkVisual(projectId: string, id: string, screenshots: ChangesScreenshot[], progress: (message: string) => void): Promise<ChangesVisual> {
    return this.track((async () => {
      const generation = this.generation, record = this.records.get(id), visual = record?.artifact.visual;
      if (!this.codex || !record || record.projectId !== projectId || visual?.status !== 'requested') throw new Error('This visual check is no longer available.');
      if (screenshots.length !== visual.pages.length || screenshots.some((s, i) => s.page !== visual.pages[i])) throw new Error('The screenshots do not match the requested comparison pages.');
      if ((await this.inspect(projectId, id)).status !== 'valid') throw new Error('Comparison inputs changed. Refresh before visual inspection.');
      this.check(projectId, generation);
      // Consume once; a cancelled or failed check is never reported as checked.
      visual.status = 'unavailable'; visual.issues = ['Visual inspection did not complete.'];
      const result = visualCheckSchema.parse(await this.codex.checkChanges(projectId, JSON.stringify({ task: visualInstructions,
        presentation: record.artifact.presentation, pages: visual.pages,
        changes: record.artifact.changes.filter(c => record.inspectionIds?.includes(c.id))
          .map(c => ({ id: c.id, layout: c.layout, oldText: c.oldText, newText: c.newText })) }), screenshots.map(s => s.dataUrl), progress));
      this.check(projectId, generation);
      if ((await this.inspect(projectId, id)).status !== 'valid') throw new Error('Comparison inputs changed during visual inspection. Refresh.');
      this.check(projectId, generation);
      visual.status = result.readable ? 'checked' : 'problem'; visual.issues = result.issues;
      return { ...visual, pages: [...visual.pages], issues: [...visual.issues] };
    })());
  }
  arrange(input: ChangesInput, previewId: string, progress: (message: string) => void) {
    return this.track(this.arrangeOperation(input, previewId, progress));
  }
  private async arrangeOperation(input: ChangesInput, previewId: string, progress: (message: string) => void) {
    const generation = this.generation, prepared = this.prepared;
    if (!this.codex || !prepared || prepared.value.id !== previewId || prepared.key !== this.key(input)) throw new Error('Prepare and inspect a current arrangement request first.');
    this.prepared = null;
    const response = await this.codex.arrangeChanges(input.projectId, prepared.value.prompt, progress);
    this.check(input.projectId, generation);
    const plan = applyArrangement(prepared.plan, response), id = randomUUID();
    this.arranged = { key: prepared.key, plan, id };
    return { id, changes: plan.changes };
  }
}
