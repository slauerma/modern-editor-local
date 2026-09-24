import type { Comment } from './contracts.ts';
import { documentBody } from './document-mode.ts';
import { changedText, proposalChanges } from './review.ts';

export type ProposalPreview = { text: string; from: number; to: number; signature: string };

export function proposalSignature(c: Comment): string {
  return JSON.stringify([c.id, c.decision, c.validity, c.from, c.to, c.original, c.draft ?? c.replacement, c.packages]);
}

// Use exactly the same edit planner as acceptance, without a review transaction.
export function proposalPreview(text: string, c: Comment): ProposalPreview {
  const changes = proposalChanges(text, c), replacement = c.draft ?? c.replacement!;
  const offset = changes.filter(edit => edit.from < c.from).reduce((n, edit) => n + edit.insert.length - (edit.to - edit.from), 0);
  const from = c.from + offset;
  return { text: changedText(text, changes), from, to: from + replacement.length, signature: proposalSignature(c) };
}

export function pdfPreviewProblem(source: string, c: Comment, candidate: ProposalPreview): string | null {
  const body = documentBody(source), next = documentBody(candidate.text);
  if (!body || !next) return 'A complete, ordinary LaTeX document is required.';
  if (c.from < body.from || c.to > body.to) return 'This change is outside the document body.';
  if (!candidate.text.slice(candidate.from, candidate.to).trim()) return 'A deletion has no typeset replacement to highlight. Use the text diff.';
  if (candidate.from < next.from || candidate.to > next.to) return 'This change alters the document wrapper.';
  return null;
}
