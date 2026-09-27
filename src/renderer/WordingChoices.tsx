import type { Comment } from '../shared/contracts.ts';
import { wordingChoices } from '../shared/alternatives.ts';

export function WordingChoices({ comment, busy, quickBusy, onChoose, onQuick }: {
  comment: Comment; busy: boolean; quickBusy: boolean; onChoose(id: string): void; onQuick(): void;
}) {
  const { alternatives, selectedAlternativeId } = wordingChoices(comment);
  const selected = alternatives.find(a => a.id === selectedAlternativeId);
  return <div className="wording-choices">
    <div className="wording-choice-row">
      {alternatives.length > 1 || comment.replacement === null && alternatives.length ? <label>Wording
        <select aria-label="Alternative wording" value={selectedAlternativeId ?? ''} disabled={comment.decision !== 'open' || busy} onChange={e => onChoose(e.target.value)}>
          {!selectedAlternativeId && <option value="">Choose a wording…</option>}
          {alternatives.map((a, i) => <option key={a.id} value={a.id} disabled={a.original !== comment.original}>{i + 1}. {a.label}{a.draft === undefined ? '' : ' · edited'}{a.original !== comment.original ? ' · earlier passage' : ''}</option>)}
        </select>
      </label> : null}
      {comment.decision === 'open' && <button className="text-button" disabled={quickBusy || busy || !comment.original || alternatives.length >= 30} title="Sol · low effort · nearby passage only. Adds one saved choice; keeps your current wording." onClick={onQuick}>{quickBusy ? 'Codex working…' : 'Quick alternative'}</button>}
    </div>
    {alternatives.length > 1 && selected?.reason && <p className="wording-reason">{selected.reason}</p>}
  </div>;
}
