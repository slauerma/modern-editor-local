import type { Comment } from '../shared/contracts.ts';
import { preferDiffBlocks, tokenDiff } from '../shared/proposal-diff.ts';
import { useMemo, useState } from 'react';
import { proposalChanges } from '../shared/review.ts';
import { ReadableArea } from './ReadableArea.tsx';

export function ProposalPreview({ text, comment: c, open, onOpenChange }: { text: string; comment: Comment; open: boolean; onOpenChange(open: boolean): void }) {
  const replacement = c.draft ?? c.replacement;
  const parts = useMemo(() => tokenDiff(c.original, replacement ?? ''), [c.original, replacement]);
  const [chosen, setChosen] = useState<{ id: string; blocks: boolean } | null>(null);
  const blocks = chosen?.id === c.id ? chosen.blocks : preferDiffBlocks(parts);
  if (replacement === null) return null;
  let preamble = '', preambleNotice = '';
  if (c.packages.length && c.decision === 'open') {
    try { preamble = proposalChanges(text, c).filter(change => change.from === change.to && change.insert.startsWith('\\usepackage{')).map(change => change.insert).join(''); }
    catch { preambleNotice = 'Confirm the source passage and complete root document before checking package insertion.'; }
  }
  return <>
    <details open={open} onToggle={e => { if (e.currentTarget.open !== open) onOpenChange(e.currentTarget.open); }} className="proposal-diff" aria-label="Proposed change"><summary>Changes</summary>
      <button className="text-button diff-mode" onClick={() => setChosen({ id: c.id, blocks: !blocks })}>{blocks ? 'Show inline diff' : 'Show before / after'}</button>
      {blocks ? <div className="diff-blocks"><label>Before</label><pre className="diff-before">{c.original}</pre><label>After</label>{replacement ? <pre className="diff-after">{replacement}</pre> : <p className="diff-deletion">Delete this passage</p>}</div> : <ReadableArea label="changes" resetKey={c.id}><p>{parts.map((part, i) => part.kind === 'removed' ? <del key={i}>{part.text}</del> : part.kind === 'added' ? <ins key={i}>{part.text}</ins> : <span key={i}>{part.text}</span>)}</p></ReadableArea>}
    </details>
    {!!c.packages.length && c.decision === 'open' && <div className="preamble-note"><strong>Preamble changes</strong>{preambleNotice ? <p>{preambleNotice}</p> : preamble ? <pre>{preamble}</pre> : <p>No package insertion needed; the listed packages are already present.</p>}<p>Included with the replacement. Accept &amp; compile checks both first.</p></div>}
  </>;
}
