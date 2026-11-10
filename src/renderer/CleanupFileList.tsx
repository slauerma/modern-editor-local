import { useState } from 'react';
import type { CleanupPreview } from '../shared/project-cleanup.ts';
export const cleanupSize = (bytes: number) => bytes < 1024 ? `${bytes} B` : bytes < 1024 ** 2 ? `${(bytes / 1024).toFixed(1)} KB` : `${(bytes / 1024 ** 2).toFixed(1)} MB`;
export function CleanupFileList({ plan }: { plan: CleanupPreview }) {
  const [query, setQuery] = useState('');
  const files = plan.files.filter(f => `${f.path} ${f.purpose}`.toLowerCase().includes(query.toLowerCase()));
  return <>
    <p><strong>{plan.files.length} files · {cleanupSize(plan.bytes)}</strong></p>
    <div className="cleanup-archive">Recovery archive <code className="cleanup-path">{plan.archivePath}</code></div>
    <label>Find a file<input type="search" value={query} onChange={e => setQuery(e.target.value)} placeholder="Filename, folder or purpose" /></label>
    <p className="cleanup-count">Showing {files.length} of {plan.files.length} files · Dates include local time zone</p>
    <div className="cleanup-files" tabIndex={0} aria-label="Files to clear"><table><thead><tr><th>Full location / contents</th><th>Last modified</th><th>Size</th><th>Action</th></tr></thead><tbody>{files.map(file => <tr key={file.path}><td><code>{file.path}</code><span>{file.purpose}</span></td><td><time dateTime={file.modifiedAt} title={file.modifiedAt}>{new Date(file.modifiedAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'long' })}</time></td><td>{cleanupSize(file.bytes)}</td><td>{file.action === 'reset' ? 'Reset identity' : 'Remove'}</td></tr>)}</tbody></table></div>
    <details><summary>Kept outside this cleanup</summary><ul>{plan.kept.map((item, i) => <li key={i}><code className="cleanup-path">{item.path}</code><span>{item.reason}</span></li>)}</ul></details>
  </>;
}
