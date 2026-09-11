import { useRef, useState } from 'react';
import type { BuildInputLimits, BuildInputPreparation } from '../shared/contracts.ts';
import type { BuildInputHelpPreview, BuildInputHelpResult } from '../shared/build-input-help.ts';
import './build-preparation.css';

type Props = { preparation: BuildInputPreparation; stale: boolean; disabled: boolean; prepare(): Promise<BuildInputHelpPreview>; ask(preview: BuildInputHelpPreview): Promise<BuildInputHelpResult>; compile(paths: string[], limits?: BuildInputLimits): void };
export function BuildPreparationPanel({ preparation, stale, disabled, prepare, ask, compile }: Props) {
  const [preview, setPreview] = useState<BuildInputHelpPreview | null>(null), [answer, setAnswer] = useState<BuildInputHelpResult | null>(null), [error, setError] = useState(''), [working, setWorking] = useState(false);
  const lock = useRef(false);
  const busy = working || disabled || stale;
  async function act(action: () => Promise<void>) {
    if (busy || lock.current) return;
    lock.current = true; setWorking(true); setError('');
    try { await action(); } catch (e) { setError((e as Error).message); } finally { lock.current = false; setWorking(false); }
  }
  return <section className="build-preparation" aria-label="Prepare compilation inputs">
    <strong>Prepare compilation inputs</strong><p>{preparation.reason}</p>
    {stale && <p role="status">The draft or suggestion changed. Compile again to check its current inputs.</p>}
    <details><summary>Local check details · {preparation.requiredPaths.length} identified files</summary>
      <ul>{preparation.issues.map((issue, i) => <li key={i}>{issue}</li>)}</ul>
      <pre tabIndex={0}>{preparation.requiredPaths.join('\n') || 'No complete file list established.'}</pre>
      <p>Dependency discovery starts above 50 MB / 500 files. Required inputs may use up to 200 MB / 2,000 files. Folder inspection is local and makes no Codex request.</p>
    </details>
    <p>Ask Codex to propose a file list using source excerpts and relative filenames from this folder. Those excerpts and filenames go to your configured Codex service. The manuscript stays unchanged.</p>
    {!preview && !answer && <button disabled={busy} onClick={() => void act(async () => { setPreview(await prepare()); })}>Prepare Codex request…</button>}
    {preview && !answer && <>
      <details><summary>Preview what will be sent</summary>{preview.notices.map((notice, i) => <p key={i}>{notice}</p>)}<pre tabIndex={0}>{preview.prompt}</pre></details>
      <button disabled={busy} onClick={() => void act(async () => { const prepared = preview; setPreview(null); setAnswer(await ask(prepared)); })}>Ask Codex to help</button>
    </>}
    {answer && <div className="build-input-answer"><p>{answer.explanation}</p>
      <p>Selected inputs: {(answer.validation.bytes / 1_000_000).toFixed(1)} MB / {answer.validation.files} files. Build budget: 200 MB / 2,000 files.</p>
      {answer.needsInput && <p role="status">More information needed: {answer.needsInput}</p>}
      <details open><summary>Proposed files · {answer.selectedPaths.length}</summary><pre tabIndex={0}>{answer.selectedPaths.join('\n')}</pre></details>
      {answer.validation.issues.map((issue, i) => <p key={i}>{issue}</p>)}
      {answer.validation.ready && <button className="primary" disabled={busy} onClick={() => compile(answer.selectedPaths)}>Compile selected files</button>}
      <button disabled={busy} onClick={() => { setAnswer(null); setPreview(null); }}>Prepare another request</button>
    </div>}
    {working && <p role="status">Preparing inputs…</p>}{error && <p role="alert" className="error">{error}</p>}
  </section>;
}
