import { useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { encodingLabels, type TextEncoding, type TextImportPreview } from '../shared/text-import.ts';
import { useDialogFocus } from './use-dialog-focus.ts';
import './text-import.css';

export function TextImportDialog(props: { preview: TextImportPreview; save(encoding: TextEncoding): Promise<void>; cancel(): Promise<void> }) {
  const panel = useRef<HTMLDivElement>(null);
  const [encoding, setEncoding] = useState(props.preview.choices[0].encoding);
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const choice = props.preview.choices.find(c => c.encoding === encoding)!;
  const run = async (action: () => Promise<void>) => {
    if (busy) return; setBusy(true); setError('');
    try { await action(); } catch (e) { setError((e instanceof Error ? e.message : String(e)).replace(/^Error invoking remote method '[^']+': Error: /, '')); }
    finally { setBusy(false); }
  };
  useDialogFocus(panel, () => { void run(props.cancel); }, { canClose: !busy });
  return createPortal(<div className="text-import-backdrop"><div className="text-import-dialog" ref={panel} role="dialog" aria-modal="true" aria-labelledby="text-import-title" tabIndex={-1}>
    <header><h2 id="text-import-title">Open a UTF-8 copy</h2><button disabled={busy} aria-label="Cancel text import" onClick={() => void run(props.cancel)}>×</button></header>
    <p className="text-import-path" title={props.preview.sourcePath}>{props.preview.sourcePath}</p>
    <p className="text-import-warning" role="note">This file is not UTF-8. Some characters may be interpreted differently. Check accents, quotation marks and symbols in the preview.</p>
    <label className="text-import-encoding">Original encoding <select aria-label="Original encoding" disabled={busy || props.preview.identified} value={encoding} onChange={e => setEncoding(e.target.value as TextEncoding)}>{props.preview.choices.map(c => <option key={c.encoding} value={c.encoding}>{encodingLabels[c.encoding]}</option>)}</select><span>{props.preview.identified ? 'Identified by its byte-order mark' : 'Not certain — choose the encoding that displays correctly'}</span></label>
    <textarea className="text-import-preview" aria-label="Decoded text preview" readOnly spellCheck={false} value={choice.text} />
    {choice.limitation && <p role="alert">{choice.limitation}</p>}
    <p>The new copy uses UTF-8. The original stays unchanged. No AI is used.</p>
    {error && <p className="error" role="alert">{error}</p>}
    <footer><button disabled={busy} onClick={() => void run(props.cancel)}>Cancel</button><button disabled={busy || !!choice.limitation} onClick={() => void run(() => props.save(encoding))}>{busy ? 'Please wait…' : 'Save UTF-8 copy and open…'}</button></footer>
  </div></div>, document.body);
}
