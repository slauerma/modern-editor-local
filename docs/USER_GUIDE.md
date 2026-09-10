# Writing and reviewing a paper

[Installation](SETUP.md) · [FAQ and recovery](FAQ.md) · [Repository overview](../README.md)

## First session

1. Choose **Try the working sample** for synthetic source and prepared comments, or **Open a LaTeX paper** for your paper's root `.tex` file. Keep the paper with its bibliography, figures, and local style files.
2. Press **Compile** to show the PDF. This uses the current editor text, including unsaved edits. Choose the paper's LaTeX engine in **Actions → Compile & layout** when necessary.
3. Read a comment's **Original**, **Proposed replacement**, and **Show changes**. You can edit the proposed replacement before accepting it.
4. Choose **Accept and next** for a compilation check followed by application, or **Skip** to read the next comment. Press **Save** when you want to write the changed `.tex` file.

Open a UTF-8 `.tex` file of at most 2,000,000 bytes. Convert older encodings in a separate copy before opening.

Prepared comments need no Codex account. Generating reviews, asking questions, and creating a preamble use your configured Codex connection.

## Ask for the review you need

Click **Review with Codex**. The heading tells you whether you are reviewing **this source file** or **the selected passage**. To review the whole opened file, first click in the source to clear any selection. Included files such as `\input{chapter}` can compile, but their contents are not expanded into this review.

For a language pass, try:

> Check spelling, grammar, and awkward phrasing throughout this source file. Suggest concise replacements where they improve the text. Preserve mathematical claims, notation, citations, and LaTeX commands. Avoid unnecessary stylistic changes.

For a separate mathematics pass:

> Check the stated assumptions, quantifiers, definitions, and proof steps for consistency. Identify possible gaps and explain your uncertainty. Ask a question when a correction depends on the intended claim; do not invent missing assumptions.

Choose **Start review**. Treat mathematical comments as suggestions to assess; a review is not proof verification. The service asks for a small set of useful comments, so one pass need not catch every issue. A single review accepts at most 120,000 characters; select a shorter passage or use section review for longer files.

**Saved paper instructions** can hold notation and style preferences. Press **Save paper instructions** before starting a request. **Preview context sent to Codex** shows what the editor will supply; **Actions → Latest Codex context…** shows the latest preview or request. See [privacy details](../PRIVACY.md).

## Work through comments

To start a note without Codex, select source text and choose **Actions → Add comment to selection**. Write in **Your reply or note** and choose **Save note** to keep it locally, or **Ask Codex** to request a response. **Actions → Import JSON…** also loads comments prepared elsewhere; see the [import format](FAQ.md#can-i-import-comments-from-elsewhere).

| Action | Result |
| --- | --- |
| **Accept and next** | Checks a candidate compilation, applies a passing proposal to the editor, then advances. Save is still separate. |
| **Accept without compiling** | Applies the proposal and any listed packages, then advances. The PDF may now be older. |
| **Skip** / **Next** | Advances without making a decision or setting a persistent skipped status. |
| **Later** | Sets an open comment aside, retaining its proposal and discussion across reopening. Use **Later (n)** and **Return to pending** to revisit it. |
| **Dismiss** | Closes an unwanted suggestion without changing the source. |
| **Mark addressed manually** / **Resolve** | Closes a comment you handled yourself or an author question. |

**Overview** lists comments; **History** shows completed decisions. Dismissed and resolved comments can be reopened. Undo can reverse recent edits and review decisions during the current session; the Undo stack does not survive quitting.

If the original passage has changed or its location is uncertain, acceptance stays disabled. Select its exact original words at the intended source location and choose **Attach to selected text**. If those words no longer exist, revise manually or request a new review.

Long original, replacement, and change previews may have their own scroll areas. Scroll inside each box or resize the replacement field to inspect the whole text before accepting; an explicit overflow indicator is not implemented yet.

## Discuss an alternative

Choose **Discuss**, write a question in **Your reply or note**, and choose **Ask Codex**. For example:

> Make the suggested change more compact while preserving the qualification in the second sentence.

Each reply separates the explanation from **Suggested wording**, which shows the actual LaTeX. **Use this wording** updates the proposal only and can be undone. Inspect it, then use an acceptance button to change the draft; Save writes the source. A deletion is explicitly labelled **Remove this passage**. A reply can also be an explanation without a replacement.

**Save note** records your note locally without calling Codex. A later explicit discussion request can include that saved note as context. **Think more** requests high effort, retaining Max if that is selected, and leaves the current proposal available until you choose another answer. **Context…** previews the discussion context.

If you keep typing while a response is generated, an answer based on the earlier draft may wait under **Actions → Waiting Codex results…**. Inspect it there; new results do not automatically replace your newer wording or decisions.

## Review section by section

**Review section by section** processes complete sections of a frozen copy of the opened root file. Finished batches become available while the next section runs. **Pause after section** finishes the active section; **Continue review** resumes the remaining sections of the same frozen copy. **Stop review** cancels unfinished work and keeps completed answers. To review a newer draft, stop and start a new pass.

You can discuss a comment during the pass. **Ask after this section** queues one question: the current section completes, Codex answers the question, and the remaining review stays paused until **Continue review**. Only one model request runs at a time. Completed answers are retained, but the unfinished queue does not resume after quitting. A section must fit the 120,000-character request limit; a pass supports up to 40 sections. Use a narrower selection for an oversized section.

## Read the corresponding PDF passage

The comment's **Source · PDF** controls refer to that comment's passage. **Show in PDF** above the source uses the source selection or cursor instead. Navigation runs locally without a Codex request.

**PDF follows comments** is enabled by default in **Actions → Compile & layout**. Deliberately moving through comments marks the matching PDF region when its location can be established, preserving zoom and keyboard focus. A closed PDF stays closed, and following pauses during a candidate preview. Background answers do not move your view.

Changing the PDF page, scrolling, changing zoom, or opening Compare cancels a pending jump. Moving to another comment starts following again.

An **Older PDF** can still show unchanged, uniquely matched passages. A changed or ambiguous passage offers **Compile and show**; following never recompiles automatically. This compiles the current buffer without Save or acceptance. A failed build keeps the previous PDF. The marker locates a nearby typeset line or region, not necessarily each selected symbol. Preamble definitions and LaTeX comments may have no visible counterpart.

Reopening a paper restores reading position, layout, and comment-list state. If the saved PDF preview is unavailable, compile again. Malformed reading-position settings are preserved separately before fresh settings are saved; manuscript and review recovery stay separate. This does not restore the Undo stack or unfinished model work.

## Compare with an original or saved version

Open **Actions → Compare versions…**. Click **Baseline…** to show the choices if they are collapsed. Choose an older `.tex` file, or name and **Keep current draft as baseline** before revising. The baseline stays fixed through Save and reopening. Comparison includes unsaved edits and is read-only; **Side by side**, **Inline**, and Previous/Next change help you inspect it. **Go to source** returns to the selected change.

**Save history…** opens the retained source-version picker. Select a version and **Compare this version** to use it as the baseline; this does not restore or overwrite the current draft. Identical saves reuse one source copy. The first Save establishes an original comparison baseline if none was pinned.

**Storage for this folder** controls a 50 MB default target for managed source backups, adjustable from 1 to 1,000 MB. Older unprotected versions can be pruned; protected recovery and original versions may exceed the target. **Delete version…** is available only for unprotected copies. See the [storage FAQ](FAQ.md#how-do-i-control-storage).

## Paste a fragment and create a preamble

Choose **Actions → New draft**, paste the paragraph, then **Add preamble and compile**. Codex proposes the additions and the editor checks compilation before applying them. Passing additions remain visible and editable; Undo removes them in one step. The same action can add missing packages or standard environments to an existing preamble.

Supply the original definitions of custom mathematical commands. This action preserves the body and makes additions only, so conflicting packages or errors in the paragraph may need manual correction. It accepts up to 120,000 characters and has no unchecked acceptance option. **Cancel preamble** stops the attempt. See [where new drafts are saved](FAQ.md#where-is-my-new-draft).

## Keyboard shortcuts on Mac

The review shortcuts work while focus is in the comments controls, outside typing fields. Click a comment control such as **Next** to return focus there. They do not intercept uppercase letters in the source, replacement, note, or Find field.

| Shortcut | Action |
| --- | --- |
| **Shift+A** or **Option+Enter** | Accept with compilation check and advance |
| **Shift+S** or **Option+Right** | Skip / next comment |
| **Option+Left** | Previous comment |
| **Option+Backspace** | Dismiss suggestion / resolve author question |
| **Command+O**, **Command+S**, **Command+B** | Open, Save, Compile |
| **Command+Z**, **Command+Shift+Z** | Undo, Redo |
| **Command+F** | Find in source |
| **Command+Shift+P** | Show/hide PDF |
| **Command+Shift+M** | Show/hide toolbar |

While typing in a text field, Undo follows that field's text history. The native menus also list application shortcuts. If the toolbar is hidden, **Show controls ▾** brings it back. Shift+N and Shift+P are not assigned.
