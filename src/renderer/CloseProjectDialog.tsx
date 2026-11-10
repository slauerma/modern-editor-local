import { useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { CleanupPreview, CleanupResult } from '../shared/project-cleanup.ts';
import { useDialogFocus } from './use-dialog-focus.ts';
import './project-cleanup.css';
import { CleanupFileList } from './CleanupFileList.tsx';

export function CloseProjectDialog(props: {
  name: string; dirty: boolean; save(): Promise<void>; close(): Promise<void>;
  preview(): Promise<CleanupPreview>; confirm(id: string): Promise<CleanupResult>;
  cancel(): Promise<void>; done(): Promise<void>;
}) {
  const panel = useRef<HTMLDivElement>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [plan, setPlan] = useState<CleanupPreview | null>(null), [result, setResult] = useState<CleanupResult | null>(null);
  const [checked, setChecked] = useState(false);
  const [inspected, setInspected] = useState(false);
  const run = async (fn: () => Promise<unknown>) => { if (busy) return; setBusy(true); setError(''); try { await fn(); } catch (e) { setError(String(e)); } finally { setBusy(false); } };
  useDialogFocus(panel, () => { void run(result ? props.done : props.cancel); }, { canClose: !busy });
  const preview = () => run(async () => { setChecked(false); setPlan(null); setInspected(true); setPlan(await props.preview()); });
  return createPortal(<div className="cleanup-backdrop"><div className="cleanup-dialog" ref={panel} role="dialog" aria-modal="true" aria-label="Close project" tabIndex={-1}>
    <header><h2>{result ? 'Project closed' : plan || inspected ? 'Review editing data to clear' : `Close ${props.name}?`}</h2><button aria-label="Cancel close" disabled={busy} onClick={() => void run(result ? props.done : props.cancel)}>×</button></header>
    {result ? <>
      <p>{result.warning ?? `Cleared ${result.removed} files and reset the paper’s editing identity.`}</p>
      <p>Recovery archive</p><code className="cleanup-path">{result.archivePath}</code>
      <p>The source, figures and exported PDFs were kept.</p>
      {error && <p className="error" role="alert">{error}</p>}
      <footer><button disabled={busy} onClick={() => void run(() => window.editor.openCleanupArchive())}>Show recovery archive</button><button disabled={busy} onClick={() => void run(props.done)}>Done</button></footer>
    </> : <>
      {!inspected && <>
        <p>Closing normally keeps comments, chats, history and recovery so you can continue later.</p>
        <p>To clear this paper’s editing data, review the exact files first. A dated recovery archive is created before removal.</p>
        {props.dirty && <p>Save your draft before clearing editing data. Normal closing keeps unsaved writing in recovery.</p>}
      </>}
      {plan && <>
        <p>Paper <code className="cleanup-path">{plan.paperPath}</code></p>
        <p>The identity record is reset so legacy comments and history do not return.</p>
        <CleanupFileList plan={plan} />
        <label className="cleanup-confirm"><input type="checkbox" checked={checked} disabled={busy} onChange={e => setChecked(e.target.checked)} />I reviewed this file list and want to clear all {plan.files.length} listed editing records after archiving them.</label>
      </>}
      {busy && <p role="status">{plan ? 'Verifying and archiving files…' : 'Preparing…'}</p>}
      {error && <p className="error" role="alert">{error}</p>}
      <footer>
        <button disabled={busy} onClick={() => void run(props.cancel)}>Cancel</button>
        {!inspected && <button disabled={busy} className="primary" onClick={() => void run(props.close)}>Close and keep data</button>}
        {!inspected && props.dirty && <button disabled={busy} onClick={() => void run(props.save)}>Save draft</button>}
        <button disabled={busy || props.dirty} onClick={() => void preview()}>{inspected ? 'Refresh file list' : 'Review files to clear…'}</button>
        {plan && <button disabled={busy || !checked} onClick={() => void run(async () => { setChecked(false); try { setResult(await props.confirm(plan.id)); } catch (e) { setPlan(null); throw e; } })}>Archive, clear and close</button>}
      </footer>
    </>}
  </div></div>, document.body);
}
