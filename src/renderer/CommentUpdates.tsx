export function CommentUpdates({ enabled, onChange }: { enabled: boolean; onChange(value: boolean): void }) {
  return <button className="comment-updates" aria-pressed={enabled} onClick={() => onChange(!enabled)}
    title="Add saved batches while Codex keeps reviewing, without changing your selection or applying edits. When off, comments wait in Waiting Codex results.">
    <span aria-hidden="true">{enabled ? '✓ ' : ''}</span>Add suggestions as they arrive
  </button>;
}
