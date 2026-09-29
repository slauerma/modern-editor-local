import { useEffect, useRef, useState } from 'react';
import type { ProjectFiles } from '../shared/project-files.ts';
import { useDialogFocus } from './use-dialog-focus.ts';

export function FilesPanel({ projectId, close, history, context, savePdf, compilePdf, pdfLabel, pdfExports }: {
  projectId: string; close(): void; history(): void; context(): void; savePdf(id: string): void; compilePdf?: () => void; pdfLabel: string;
  pdfExports: { label: string; id?: string }[];
}) {
  const [files, setFiles] = useState<ProjectFiles>({ items: [], notices: [] }), [error, setError] = useState(''), [loading, setLoading] = useState(true);
  const live = useRef(true), dialog = useRef<HTMLDivElement>(null); useDialogFocus(dialog, close);
  async function refresh() {
    setLoading(true); setError('');
    try { const value = await window.editor.projectFiles(projectId); if (live.current) setFiles(value); }
    catch (e) { if (live.current) setError(String(e)); }
    finally { if (live.current) setLoading(false); }
  }
  useEffect(() => { live.current = true; void refresh(); return () => { live.current = false; }; }, [projectId]);
  async function act(id: string, action: 'reveal' | 'copy') {
    try { await window.editor.fileAction(projectId, id, action); }
    catch (e) { if (live.current) setError(String(e)); }
  }
  return <div className="workspace-panel-backdrop"><div ref={dialog} tabIndex={-1} className="workspace-panel files-panel" role="dialog" aria-modal="true" aria-label="Files & history">
    <div className="recovery-heading"><h2>Files &amp; history</h2><button aria-label="Close files" onClick={close}>×</button></div>
    <div className="files-actions"><button onClick={history}>Saved versions…</button><button onClick={context}>Context…</button><button disabled={loading} onClick={() => void refresh()}>Refresh</button></div>
    <div className="files-pdf"><strong>PDF export</strong><p>{pdfLabel}. Export saves the exact PDF snapshot; it does not save or change your source.</p>{pdfExports.map(option => <button key={option.label} disabled={!option.id} onClick={() => option.id && savePdf(option.id)}>{option.label}</button>)}{compilePdf && <button onClick={compilePdf}>Compile current draft &amp; save PDF…</button>}</div>
    {loading && <p role="status">Reading file locations…</p>}{error && <p className="error" role="alert">{error}</p>}
    {files.notices.map((n,i) => <p key={i}>{n}</p>)}
    {(['Paper','Saved state','Context & chat','PDFs'] as const).map(group => <section key={group}><h3>{group}</h3>{files.items.filter(f => f.group === group).map(f => <div className="file-inventory-item" key={f.id}>
      <div><strong>{f.name}</strong><small>{f.directory ? 'Folder' : f.bytes.toLocaleString() + ' bytes'} · {new Date(f.modified).toLocaleString()}</small><code>{f.path}</code></div>
      <button onClick={() => void act(f.id, 'reveal')}>Reveal</button><button onClick={() => void act(f.id, 'copy')}>Copy path</button>
    </div>)}</section>)}
    <p>PDFs lists this session’s available builds and the restored paper PDF. Saved versions and recovery belong to this paper. Debugging files are separate and are never paper context.</p>
  </div></div>;
}
