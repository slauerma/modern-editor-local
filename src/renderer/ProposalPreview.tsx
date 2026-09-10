import type { Comment } from '../shared/contracts.ts';
import { tokenDiff } from '../shared/proposal-diff.ts';
import { proposalChanges } from '../shared/review.ts';

export function ProposalPreview({ text, comment: c }: { text: string; comment: Comment }) {
  const replacement = c.draft ?? c.replacement;
  if (replacement === null) return null;
  let preamble = '', preambleNotice = '';
  if (c.packages.length && c.decision === 'open') {
    try { preamble = proposalChanges(text, c).filter(change => change.from === change.to && change.insert.startsWith('\\usepackage{')).map(change => change.insert).join(''); }
    catch { preambleNotice = 'Confirm the source passage and complete root document before checking package insertion.'; }
  }
  return <>
    <details key={c.id} open className="proposal-diff" aria-label="Proposed change"><summary>Show changes</summary><p>{tokenDiff(c.original, replacement).map((part, i) => part.kind === 'removed' ? <del key={i}>{part.text}</del> : part.kind === 'added' ? <ins key={i}>{part.text}</ins> : <span key={i}>{part.text}</span>)}</p></details>
    {!!c.packages.length && c.decision === 'open' && <div className="preamble-note"><strong>Preamble changes</strong>{preambleNotice ? <p>{preambleNotice}</p> : preamble ? <pre>{preamble}</pre> : <p>No package insertion needed; the listed packages are already present.</p>}<p>Included with the replacement. Accept and next checks both.</p></div>}
  </>;
}
