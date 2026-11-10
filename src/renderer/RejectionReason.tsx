import { useRef, useState } from 'react';
import type { Comment } from '../shared/contracts.ts';
import { InfoHint } from './CommentDetails.tsx';
import { useDialogFocus } from './use-dialog-focus.ts';

export const rejectionReasons = ['Keep my wording', 'Changes the meaning', 'Too broad', 'Already addressed', 'Not relevant'];

export function RejectionReason({ comment, disabled, close, save, remember }: { comment: Comment; disabled: boolean; close(): void; save(reason: string): void; remember(reason: string): void }) {
  const [reason, setReason] = useState(comment.rejectionReason ?? '');
  const panel = useRef<HTMLElement>(null);
  useDialogFocus(panel, close);
  return <div className="workspace-panel-backdrop"><section className="workspace-panel guidance-panel rejection-reason-panel" ref={panel} tabIndex={-1} role="dialog" aria-modal="true" aria-label="Rejection reason">
    <div className="recovery-heading"><h2>Rejection reason</h2><button aria-label="Close rejection reason" onClick={close}>×</button></div>
    <p>{comment.title}</p>
    <div className="rejection-presets" aria-label="Common rejection reasons">{rejectionReasons.map(value => <button key={value} disabled={disabled} onClick={() => setReason(value)}>{value}</button>)}</div>
    <label>Your reason (optional)<textarea aria-label="Your rejection reason" maxLength={2000} value={reason} onChange={e => setReason(e.target.value)} placeholder="Why you do not want this suggestion…" /></label>
    <div className="rejection-reason-actions"><button disabled={disabled} onClick={() => save(reason.trim())}>{comment.decision === 'open' ? 'Reject with reason' : 'Save reason'}</button><button className="text-button" disabled={disabled || !reason.trim()} onClick={() => remember(reason.trim())}>Remember for this paper…</button><InfoHint label="rejection reasons">The reason belongs to this suggestion and accompanies future reviews. Remember for this paper copies it into your editable paper instructions; inspect and save those instructions to make it standing guidance. Reject without a reason remains one click.</InfoHint></div>
  </section></div>;
}
