import { useEffect, useState } from 'react';
import type { VersionHistory } from '../shared/contracts.ts';

export function VersionHistoryPanel({ projectId, onCompare }: { projectId:string; onCompare(id:string):Promise<void> }) {
  const [history,setHistory]=useState<VersionHistory|null>(null),[selected,setSelected]=useState(''),[budget,setBudget]=useState('50');
  const [busy,setBusy]=useState(false),[error,setError]=useState(''),[confirm,setConfirm]=useState(false);
  const install=(value:VersionHistory)=>{setHistory(value);setBudget(String(value.budgetBytes/1000000));setSelected(id=>value.versions.some(v=>v.id===id)?id:value.versions[0]?.id??'');};
  useEffect(()=>{let live=true;void window.editor.versionHistory(projectId).then(v=>{if(live)install(v);},e=>{if(live)setError(String(e));});return()=>{live=false;};},[projectId]);
  async function action(run:()=>Promise<void>){if(busy)return;setBusy(true);setError('');try{await run();}catch(e){setError(String(e));}finally{setBusy(false);setConfirm(false);}}
  const version=history?.versions.find(v=>v.id===selected);
  const mb=(bytes:number)=>bytes<1000?bytes+' B':bytes<1000000?(bytes/1000).toFixed(1)+' kB':(bytes/1000000).toFixed(2)+' MB';
  return <section className="version-history" aria-label="Saved source versions">
    <div className="version-picker"><label>Retained version <select aria-label="Saved source version" value={selected} disabled={busy||!history?.versions.length} onChange={e=>{setSelected(e.target.value);setConfirm(false);}}>{history?.versions.map(v=><option key={v.id} value={v.id}>{new Date(v.createdAt).toLocaleString()} · {mb(v.bytes)}{v.protectedReason?' · protected':''}</option>)}</select></label><button disabled={busy||!version} onClick={()=>void action(async()=>{await onCompare(selected);install(await window.editor.versionHistory(projectId));})}>Compare this version</button><button disabled={busy||!version||!!version.protectedReason} onClick={()=>setConfirm(true)}>Delete version…</button><button disabled={busy} onClick={()=>void action(async()=>install(await window.editor.versionHistory(projectId)))}>Refresh</button></div>
    {version?.protectedReason&&<p>{version.protectedReason} · kept automatically.</p>}
    {history&&!history.versions.length&&<p>Press Save to retain source versions. Repeated saves of unchanged text reuse the same file.</p>}
    {confirm&&<div className="version-confirm"><span>Delete this retained source copy? Your paper and pinned comparison remain intact.</span><button disabled={busy} onClick={()=>void action(async()=>install(await window.editor.deleteSavedVersion(projectId,selected)))}>Delete this version</button><button disabled={busy} onClick={()=>setConfirm(false)}>Cancel</button></div>}
    {history&&<details><summary>Storage for this folder · {mb(history.folderBytes)} / {mb(history.budgetBytes)} target</summary><p>Only automatic source-version backups count toward this target. Source, pinned baselines, comments and recovery are separate. Protected versions ({mb(history.protectedBytes)}) may exceed a small target. Unprotected older copies are removed after successful Save or when applying a lower target.</p><div className="version-budget"><label>Target (MB) <input type="number" min="1" max="1000" step="1" aria-label="Version history budget in MB" value={budget} onChange={e=>setBudget(e.target.value)} /></label><button disabled={busy||!Number.isInteger(Number(budget))||Number(budget)<1||Number(budget)>1000} onClick={()=>void action(async()=>install(await window.editor.setHistoryBudget(projectId,Number(budget)*1000000)))}>Apply storage target</button></div></details>}
    {history?.notices.map((n,i)=><p key={i} className="error">{n}</p>)}{error&&<p className="error" role="alert">{error}</p>}
  </section>;
}
