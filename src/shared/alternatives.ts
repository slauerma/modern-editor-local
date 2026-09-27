import { commentSchema, type Comment, type CodexReply } from './contracts.ts';

export type Wording = NonNullable<Comment['alternatives']>[number];
export type WordingFields = Pick<Comment, 'alternatives' | 'selectedAlternativeId' | 'replacement' | 'draft' | 'packages'>;
const samePackages = (a: string[], b: string[]) => JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());

/** Keep the original option and each hand-edited draft when moving between choices. */
export function wordingChoices(c: Comment): { alternatives: Wording[]; selectedAlternativeId?: string } {
  const alternatives = (c.alternatives ?? []).map(a => ({ ...a, original: a.original ?? c.original }));
  let selectedAlternativeId = c.selectedAlternativeId;
  if (!selectedAlternativeId && c.replacement !== null) {
    let selected = alternatives.find(a => a.original === c.original && a.replacement === c.replacement && samePackages(a.packages, c.packages));
    if (!selected) {
      let id = 'original-proposal';
      while (alternatives.some(a => a.id === id)) id += '-1';
      selected = { id, label: 'Original suggestion', reason: c.explanation.slice(0, 2000), original: c.original, replacement: c.replacement, packages: c.packages };
      alternatives.unshift(selected);
    }
    selectedAlternativeId = selected.id;
  }
  return { alternatives: alternatives.map(a => a.id === selectedAlternativeId ? { ...a, draft: c.draft } : a), selectedAlternativeId };
}

export function selectWording(c: Comment, id: string): WordingFields {
  if (c.decision !== 'open') throw new Error('Reopen this comment before choosing another wording.');
  const { alternatives } = wordingChoices(c), selected = alternatives.find(a => a.id === id);
  if (!selected || selected.original !== c.original) throw new Error('This wording belongs to an earlier passage. Ask for a new alternative.');
  const fields = { alternatives, selectedAlternativeId: id, replacement: selected.replacement, draft: selected.draft, packages: selected.packages };
  commentSchema.parse({ ...c, ...fields });
  return fields;
}

export function addWordings(c: Comment, incoming: CodexReply['alternatives']): Pick<Comment, 'alternatives' | 'selectedAlternativeId'> {
  const fields = wordingChoices(c);
  for (const a of incoming ?? []) {
    if (fields.alternatives.some(old => old.original === c.original && old.replacement === a.replacement && samePackages(old.packages, a.packages))) continue;
    fields.alternatives.push({ ...a, id: crypto.randomUUID(), original: c.original });
  }
  commentSchema.parse({ ...c, ...fields });
  return fields;
}

export function useDiscussionWording(c: Comment, replacement: string, packages: string[]): WordingFields {
  const reason = [...c.messages].reverse().find(m => m.proposal?.replacement === replacement && samePackages(m.proposal.packages, packages))?.text ?? c.explanation;
  const fields = addWordings(c, [{ label: 'From discussion', reason: reason.slice(0, 2000), replacement, packages }]);
  const option = fields.alternatives!.find(a => a.original === c.original && a.replacement === replacement && samePackages(a.packages, packages))!;
  return selectWording({ ...c, ...fields }, option.id);
}

export function wordingReason(c: Comment): string {
  const selected = c.alternatives?.find(a => a.id === c.selectedAlternativeId);
  return selected?.reason || [...c.messages].reverse().find(m => m.role === 'assistant' && m.proposal?.replacement === (c.draft ?? c.replacement))?.text || c.explanation;
}
