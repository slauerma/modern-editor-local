import { useRef, useState } from 'react';
import type { BuildInputLimits, BuildInputPreparation } from '../shared/contracts.ts';
import type { BuildInputHelpPreview, BuildInputHelpResult } from '../shared/build-input-help.ts';
import './build-preparation.css';

type Props = { preparation: BuildInputPreparation; stale: boolean; disabled: boolean; dismiss(): void; prepare(): Promise<BuildInputHelpPreview>; ask(preview: BuildInputHelpPreview): Promise<BuildInputHelpResult>; compile(paths: string[], limits?: BuildInputLimits): void };
export function BuildPreparationPanel({ preparation, stale, disabled, dismiss, prepare, ask, compile }: Props) {
  const [preview, setPreview] = useState<BuildInputHelpPreview | null>(null), [answer, setAnswer] = useState<BuildInputHelpResult | null>(null), [error, setError] = useState(''), [working, setWorking] = useState(false);
  const lock = useRef(false), canAsk = preparation.canAskCodex !== false;
  const busy = working || disabled || stale;
  async function act(action: () => Promise<void>) {
    if (busy || lock.current) return;
    lock.current = true; setWorking(true); setError('');
    try { await action(); } catch (e) { setError((e as Error).message); } finally { lock.current = false; setWorking(false); }
  }
  return <section className="build-preparation" aria-label="Compilation inputs">
    <div className="build-preparation-heading">
      <span>{canAsk ? 'Choose compilation files' : 'Compilation needs an input fixed'}</span>
      <button aria-label="Dismiss compilation inputs" disabled={working} onClick={dismiss}>×</button>
    </div>
    <p role="status">{stale ? 'The draft or suggestion changed. Compile again to check its inputs.' : preparation.issues[0] || preparation.reason}</p>
    <details><summary>Details · {preparation.requiredPaths.length} identified files</summary>
      {preparation.issues.length > 1 && <ul>{preparation.issues.slice(1).map((issue, i) => <li key={i}>{issue}</li>)}</ul>}
      <pre tabIndex={0}>{preparation.requiredPaths.join('\n') || 'No complete file list established.'}</pre>
      <p>Selected inputs may use up to {preparation.limits.maxBytes / 1_000_000} MB / {preparation.limits.maxFiles.toLocaleString()} files. This check is local.</p>
    </details>
    {canAsk && <>
      {!preview && !answer && <button disabled={busy} title="Prepare source excerpts and relative filenames for a Codex file-list request. You can inspect them before sending." onClick={() => void act(async () => { setPreview(await prepare()); })}>Prepare file-list request…</button>}
      {preview && !answer && <>
        <details><summary>Review what will be sent</summary>{preview.notices.map((notice, i) => <p key={i}>{notice}</p>)}<pre tabIndex={0}>{preview.prompt}</pre></details>
        <button disabled={busy} title="Send the prepared excerpts and filenames to your configured Codex service." onClick={() => void act(async () => { const prepared = preview; setPreview(null); setAnswer(await ask(prepared)); })}>Ask Codex for a file list</button>
      </>}
      {answer && <div className="build-input-answer"><p>{answer.explanation}</p>
        {answer.needsInput && <p role="status">More information needed: {answer.needsInput}</p>}
        <details><summary>Proposed files · {answer.selectedPaths.length} · {(answer.validation.bytes / 1_000_000).toFixed(1)} MB</summary><pre tabIndex={0}>{answer.selectedPaths.join('\n')}</pre></details>
        {answer.validation.issues.map((issue, i) => <p key={i}>{issue}</p>)}
        {answer.validation.ready && <button disabled={busy} onClick={() => compile(answer.selectedPaths)}>Compile selected files</button>}
        <button disabled={busy} onClick={() => { setAnswer(null); setPreview(null); }}>Prepare another request</button>
      </div>}
    </>}
    {working && <p role="status">Preparing inputs…</p>}{error && <p role="alert" className="error">{error}</p>}
  </section>;
}
