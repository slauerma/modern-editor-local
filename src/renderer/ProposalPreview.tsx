import type { Comment } from '../shared/contracts.ts';
import { proposalContext, tokenDiff } from '../shared/proposal-diff.ts';
import { useMemo, useState, type ReactNode } from 'react';
import { proposalChanges } from '../shared/review.ts';
import { ReadableArea } from './ReadableArea.tsx';

export function ProposalPreview({ text, comment: c, open, onOpenChange, onEdit, onUseOriginal, children }: {
  text: string; comment: Comment; open: boolean; onOpenChange(open: boolean): void;
  onEdit(value: string): void; onUseOriginal(): void; children?: ReactNode;
}) {
  const replacement = c.draft ?? c.replacement;
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const expanded = expandedId === c.id;
  const parts = useMemo(() => tokenDiff(c.original, replacement ?? ''), [c.original, replacement]);
  const context = useMemo(() => proposalContext(text, c, expanded), [text, c.original, c.from, c.to, c.validity, c.decision, expanded]);
  const [editId, setEditId] = useState<string | null>(null);
  const editing = editId === c.id;
  if (replacement === null) return null;
  let preamble = '', preambleNotice = '';
  if (c.packages.length && c.decision === 'open') {
    try { preamble = proposalChanges(text, c).filter(change => change.from === change.to && change.insert.startsWith('\\usepackage{')).map(change => change.insert).join(''); }
    catch { preambleNotice = 'Confirm the source passage and complete root document before checking package insertion.'; }
  }
  return <div className="contextual-proposal" id="proposal-preview">
    <div className="proposal-views" role="group" aria-label="Suggestion view">
      <button className="text-button" aria-pressed={!editing && open} onClick={() => { setEditId(null); onOpenChange(true); }}>Changes</button>
      <button className="text-button" aria-pressed={!editing && !open} title="Read the passage with the proposed wording" onClick={() => { setEditId(null); onOpenChange(false); }}>Clean</button>
      {c.decision === 'open' && <button className="text-button" aria-pressed={editing} title="Edit only the proposed replacement, leaving the surrounding context unchanged" onClick={() => setEditId(c.id)}>Edit</button>}
      {editing && <button className="text-button use-original" title="Copy the original words into the replacement; Undo restores your edit" onClick={onUseOriginal}>Use original</button>}
      {children}
    </div>
    {editing ? <ReadableArea label="replacement" resetKey={c.id}><textarea id="replacement" aria-label="Proposed replacement" className="sized-replacement" rows={2} maxLength={100000} spellCheck={false} value={replacement} onChange={e => onEdit(e.target.value)} /></ReadableArea>
      : <div className="proposal-reading" aria-label={open ? 'Changes in context' : 'Clean proposed text'} tabIndex={0}>
        {context.omittedBefore && <span className="context-ellipsis" title="Earlier context is outside this excerpt">… </span>}<span>{context.before}</span>{open ? parts.map((part, i) => part.kind === 'removed' ? <del key={i}>{part.text}</del> : part.kind === 'added' ? <ins key={i}>{part.text}</ins> : <span key={i}>{part.text}</span>) : replacement}<span>{context.after}</span>{context.omittedAfter && <span className="context-ellipsis" title="Later context is outside this excerpt"> …</span>}
        {!open && !replacement && !context.before && !context.after && <span className="diff-deletion">Delete this passage</span>}
      </div>}
    {!editing && context.hasMore && <button className="text-button context-toggle" aria-expanded={expanded} onClick={() => setExpandedId(expanded ? null : c.id)}>{expanded ? 'Less context' : 'More context'}</button>}
    {!!c.packages.length && c.decision === 'open' && <div className="preamble-note"><strong>Preamble changes</strong>{preambleNotice ? <p>{preambleNotice}</p> : preamble ? <pre>{preamble}</pre> : <p>No package insertion needed; the listed packages are already present.</p>}</div>}
  </div>;
}
