import type { Comment } from '../shared/contracts.ts';
import { ReadableArea } from './ReadableArea.tsx';

export function QuestionPassage({ text, comment, disabled, onLink }: { text: string; comment: Comment; disabled: boolean; onLink(): void }) {
  const current = comment.from < comment.to && comment.to <= text.length ? text.slice(comment.from, comment.to) : '';
  const stale = comment.validity !== 'current';
  return <div className="question-passage">
    {stale && <div className="stale-notice"><p>This question refers to earlier wording.</p><p>Select the current passage to link it explicitly, or discuss or resolve the question as it stands. Linking leaves the source unchanged and can be undone.</p><button disabled={disabled || comment.decision !== 'open'} onClick={onLink}>Link question to current selection</button></div>}
    {(comment.questionOriginal || comment.original) && <><div>Earlier wording</div><ReadableArea label="earlier question wording" resetKey={comment.id}><pre tabIndex={0}>{comment.questionOriginal ?? comment.original}</pre></ReadableArea></>}
    <div>{stale ? 'Current text at the earlier location' : 'Linked current passage'}</div>
    {current ? <ReadableArea label="current question passage" resetKey={comment.id}><pre tabIndex={0}>{current}</pre></ReadableArea> : <p className="muted">The current passage is not established. Select it in the source before linking.</p>}
  </div>;
}
