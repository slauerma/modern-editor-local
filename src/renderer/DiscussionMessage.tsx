import type { Comment } from '../shared/contracts.ts';

type Message = Comment['messages'][number];
type Proposal = NonNullable<Message['proposal']>;

export function DiscussionMessage({ message, comment, onUse }: {
  message: Message;
  comment: Comment;
  onUse: (proposal: Proposal) => void;
}) {
  const proposal = message.proposal;
  const earlierPassage = message.proposalOriginal !== undefined && message.proposalOriginal !== comment.original;
  const current = proposal && comment.decision === 'open'
    && proposal.replacement === (comment.draft ?? comment.replacement)
    && proposal.packages.length === comment.packages.length
    && proposal.packages.every((name, i) => name === comment.packages[i]);
  return <div className="message">
    <strong>{message.role === 'user' ? 'You' : 'Codex'}</strong>
    <div>{message.text}</div>
    {proposal && proposal.replacement !== null && <div className="reply-proposal">
      <div className="reply-proposal-label">Suggested wording</div>
      {proposal.replacement === ''
        ? <p className="reply-deletion">Remove this passage.</p>
        : <pre tabIndex={0} aria-label="Suggested wording">{proposal.replacement}</pre>}
      {proposal.packages.length > 0 && <div className="reply-packages">
        <div>Requested packages (added if missing when accepted)</div>
        <pre tabIndex={0} aria-label="Suggested packages">{proposal.packages.map(name => `\\usepackage{${name}}`).join('\n')}</pre>
      </div>}
      <button disabled={comment.decision !== 'open' || !!current || earlierPassage} onClick={() => { if (!earlierPassage) onUse(proposal); }}>Use this wording</button>
      {earlierPassage && <p>This alternative refers to the earlier passage. Ask Codex for wording for the newly linked text.</p>}
      {current && <span className="reply-current">Matches the current proposal</span>}
    </div>}
  </div>;
}
