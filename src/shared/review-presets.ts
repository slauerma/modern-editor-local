// Style presets abridged and adapted from Kevin Bryan's ModernEditor styles.js
// (ba8839833de51fc1d2d99847fc390e0faebd8936, MIT).
// See THIRD_PARTY_NOTICES.md and licenses/modern-editor-predecessor-MIT.txt.
export const reviewPresets = [
  {
    id: 'general', name: 'General review',
    instructions: 'Improve clarity and technical precision. Preserve notation. Flag mathematical concerns with an explanation.'
  },
  {
    id: 'language', name: 'Language',
    instructions: 'Improve idiom, grammar and sentence flow in plain American academic English. Preserve wording that is already natural, technical terminology, degree of certainty and evaluative judgment. Avoid generic praise and unnecessary qualifications. If an improvement would change a claim, assumption, criticism or praise, raise a Meaning question with no replacement instead of silently rewriting the substance. Read references only when needed to resolve an ambiguity.'
  },
  {
    id: 'technical', name: 'Technical consistency',
    instructions: 'Check claims, assumptions, definitions, notation and references for consistency. Read the relevant argument before judging it. Distinguish an established correction from an unresolved concern or optional improvement. Explain substantive changes explicitly; ask a question with no replacement when uncertain. Earlier AI notes are provisional, not independent evidence. Preserve the intended result and do not invent assumptions or citations.'
  },
  {
    id: 'slides', name: 'Slides',
    instructions: 'Review these teaching slides for clear language, consistent notation and correctness at the intended teaching level. Respect deliberate brevity, fragments, overlays, speaker notes and the division of material between frames. Avoid adding detail or qualifications already supplied by nearby slides. Keep edits local. Explain genuine meaning changes; uncertain substantive concerns should be questions with no replacement. Do not create comments merely to report that a topic is outside the selected scope.'
  },
  {
    id: 'academic', name: 'Academic style',
    instructions: 'Review academic prose for argumentative clarity, precise claims, consistent terminology and logical connections. Remove empty scaffolding and needless repetition. Protect technical language, notation and genuine uncertainty. Flag unsupported claims or missing definitions as questions; do not invent evidence, citations or assumptions. Preserve meaning and the author’s voice. Focus on style rather than routine spelling corrections.'
  },
  {
    id: 'literary', name: 'Literary nonfiction',
    instructions: 'Review nonfiction for clear, direct prose, concrete wording and readable rhythm. Cut redundant phrases, empty intensifiers and throat-clearing. Prefer strong verbs and natural sentence flow where they improve the text. Protect technical language and factual precision; do not invent details or strengthen claims beyond their evidence. Preserve the author’s voice. Focus on style rather than routine spelling corrections.'
  },
  {
    id: 'creative', name: 'Creative fiction',
    instructions: 'Review creative prose at the sentence and phrase level. Look for weak or repetitive wording, awkward rhythm, clichés, distant narration and unnatural dialogue. Preserve the narrator’s voice, point of view, technical terms and intended meaning. Ask where a concrete detail would help rather than inventing events or facts. Do not change the plot, characters or overall structure. Focus on style rather than routine spelling corrections.'
  }
] as const;

export const incrementalEditPolicy = 'Prefer the smallest local edits unless the author explicitly requests a broader rewrite in the current request. That current request takes precedence over this minimal-edit preference. Propose one independent correction per comment, using the shortest safe exact source quotation and replacement: usually a word, phrase or clause, not an unchanged surrounding sentence or paragraph. Keep LaTeX commands and balanced groups intact. Use before/after context to disambiguate repeated quotations; include only the minimal unchanged anchor needed for an insertion. Split independent concerns into separate, non-overlapping suggestions that can each be accepted or rejected on their own. Keep coupled edits together only when they cannot work separately. For an explicitly requested paragraph or broader rewrite, provide the complete replacement within that scope; otherwise raise a consequential concern requiring a broad rewrite as a discussion-only comment (null replacement). Preserve meaning, notation, structure and the author’s voice. Do not bundle cosmetic rewrites with a correction. Explain unresolved mathematical or structural concerns as discussion-only comments. Never omit a consequential concern merely to keep edits small.';
