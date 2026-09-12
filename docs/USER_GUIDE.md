# Writing and reviewing a paper

[Installation](SETUP.md) · [FAQ and recovery](FAQ.md) · [Repository overview](../README.md)

## First session

1. Choose **Try the working sample** for synthetic source and prepared comments, or **Open a LaTeX paper** for your paper's root `.tex` file. Keep the paper with its bibliography, figures, and local style files.
2. Press **Compile**, **Command+T** or **Command+B** to show the PDF. This uses the current editor text, including unsaved edits. Choose the paper's LaTeX engine in **Actions → Compile & layout** when necessary.
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
| **Accept and next** | Checks a candidate compilation, applies a passing proposal to the editor, then advances. Warnings can pause acceptance for inspection. Save is still separate. |
| **More → Accept all applicable suggestions (N)** | Compiles one combined candidate for the eligible pending replacements, then applies them together as one undoable change. |
| **Accept without compiling** | Applies the proposal and any listed packages, then advances. The PDF may now be older. |
| **Skip** / **Next** | Advances without making a decision or setting a persistent skipped status. |
| **Later** | Sets an open comment aside, retaining its proposal and discussion across reopening. Use **Later (n)** and **Return to pending** to revisit it. |
| **Reject** / **Shift+R** | Moves the current comment into History without changing the source. Undo restores it. |
| **More → Dismiss pending comments** | Closes the current pending batch in one undoable action, retaining Later comments, history and discussions. |
| **Mark addressed manually** / **Resolve** | Closes a comment you handled yourself or an author question. |

**Overview** lists comments; **History** shows completed decisions. Rejected, dismissed and resolved comments can be reopened. **Reject** closes an unwanted comment; **Skip** leaves it pending. **Resolve** remains a separate action for an author question you have addressed. Undo can reverse recent edits and review decisions during the current session; the Undo stack does not survive quitting.

**More → Accept all applicable suggestions (N)** shows how many pending replacements can be applied together. It includes only current suggestions whose original text still matches exactly and whose changes do not overlap. Questions, stale or ambiguous suggestions, overlapping proposals and Later comments remain for individual review. The editor compiles the combined draft once; after acceptance, one **Undo** restores the batch's source changes and decisions. Save is still separate.

If the candidate produces a PDF with verified inputs but acceptance warnings, the editor explains the issue, such as undefined citations or references, duplicate labels, or missing characters (glyphs). Inspect **View candidate PDF** and **Build details**, then choose **Apply despite warnings** to proceed deliberately. Before applying, the editor rechecks the source, suggestions and compilation inputs; changed inputs require a new compile. Failed compilation or unverified inputs never offer this override. **Accept without compiling** remains available for individual suggestions with valid source placement.

The Comments pane's **More → Dismiss pending comments** affects the pending comments present when clicked. One **Undo** restores that batch. Comments that arrive afterward retain their own status when you Undo or Redo the dismissal.

For a replacement suggestion, acceptance stays disabled if the original passage has changed or its location is uncertain. Select its exact original words at the intended source location and choose **Attach to selected text**. If those words no longer exist, revise manually or request a new review.

For a question without a replacement that refers to earlier wording, select the current passage and choose **Link question to current selection**. The card keeps **Earlier wording** beside the **Linked current passage**, and retains the discussion. Linking changes no source text and is undoable. Earlier suggested alternatives remain readable; ask for a fresh proposal before applying wording to the newly linked passage. You can also discuss or resolve the question without relinking it.

Long original, replacement, and change previews show **More below ↓** or **More above ↑** when part of the text is outside the box. Scroll inside it or choose **Show full text** before accepting. Expanding preserves the complete proposal and your edits.

## Turn outside feedback into comments

Choose **Actions → Import outside feedback…**, add a source label, and paste referee notes, email feedback, or another AI's comments. **Preview request** shows the source and feedback that will be sent. **Turn into comments with Codex** saves the raw feedback locally before requesting a conversion.

Inspect the returned advice, select the useful items, and choose **Add selected comments**. This adds comments for ordinary review; it does not accept replacements or save changes to the paper. Undo removes the import. General or unmatched advice remains visible as a question. If the draft has changed, quoted passages need confirmation before a replacement can be applied.

The original feedback and completed conversions remain under **Saved feedback**, including failed attempts you can retry. One conversion accepts up to 60,000 feedback characters and 120,000 source characters and returns at most 30 comments.

## Attach local reference material

Choose **Attach context…** in a review or discussion, or **Actions → Reference folders and files…**. Use **Add reference folder…** or **Add reference files…** for PDF, LaTeX, Markdown, or UTF-8 text. These locations are remembered for this paper. Codex can find and read relevant material during subsequent reviews and discussions without repeated file selection.

For example: “Use the revision comments and compare this proof with the earlier draft.” The current unsaved editor text remains the draft; other files are references. **Sources used…** shows the excerpts and search coverage actually returned to Codex. Disable a reference temporarily with its checkbox, or remove it without deleting any files. Reattach missing or moved locations.

To focus a request, expand **Choose exact excerpts (optional)**. Select files and PDF pages such as `1-3, 7` or text lines such as `20-80`, then **Preview selected context**. These optional selections last for the current session and changed files require another preview. Folder and file reading is bounded; notices identify incomplete coverage. PDF extraction reads text only, with no OCR or interpretation of figures. Attaching is local; asking Codex sends relevant text to its service.

## Compile a paper in a larger folder

Press **Compile** normally. Above **50 MB or 500 files**, the editor starts deterministic dependency discovery: it follows recognizable source, figure, bibliography and local-style references and prepares a smaller snapshot automatically. This is the discovery threshold; the cap on actual required inputs is **200 MB / 2,000 files**. Standard installed packages remain in the TeX installation. Local figure alternatives (such as both PDF and PNG) are kept together so TeX chooses normally. An unchanged copy of the bundled `tcilatex.tex` is recognized as support code. Windows drive fallbacks in `\graphicspath` do not block macOS discovery when the figures are also available locally; the source is not rewritten.

If the local check cannot establish the inputs, inspect **Local check details**. **Prepare Codex request…** creates a local preview; **Ask Codex to help** sends it only when clicked. Inspect the returned file list, then choose **Compile selected files**. Codex does not change the manuscript. A specific unresolved question may require correcting a path or making a self-contained paper copy manually.

The explicit file choice is reused while this paper remains open and revalidated for each build. It uses the same **200 MB / 2,000-file** cap. If the required inputs exceed it, reduce those resources or use another compilation route. Successful compilation with unresolved computed references remains unverified: inspect the output and build details. The previous successful PDF stays available after a failed preparation or compile.

Planning and request preparation run locally. Only **Ask Codex to help** sends the previewed excerpts, relative filenames and dependency-check results through your configured Codex service. There is no separate file-upload workflow. See [privacy details](../PRIVACY.md).

## Discuss an alternative

Choose **Discuss**, write a question in **Your reply or note**, and choose **Ask Codex**. For example:

> Make the suggested change more compact while preserving the qualification in the second sentence.

Each reply separates the explanation from **Suggested wording**, which shows the actual LaTeX. **Use this wording** updates the proposal only and can be undone. Inspect it, then use an acceptance button to change the draft; Save writes the source. A deletion is explicitly labelled **Remove this passage**. A reply can also be an explanation without a replacement.

**Save note** records your note locally without calling Codex. A later explicit discussion request can include that saved note as context. **Think more** requests high effort, retaining Max if that is selected, and leaves the current proposal available until you choose another answer. **Preview request** previews the discussion context, including selected references.

If you keep typing while a response is generated, an answer based on the earlier draft may wait under **Actions → Waiting Codex results…**. Inspect it there; new results do not automatically replace your newer wording or decisions.

## Review section by section

**Review section by section** processes complete sections of a frozen copy of the opened root file. Finished batches become available while the next section runs. **Pause after section** finishes the active section; **Continue review** resumes the remaining sections of the same frozen copy. **Stop review** cancels unfinished work and keeps completed answers. To review a newer draft, stop and start a new pass.

You can discuss a comment during the pass. **Ask after this section** queues one question: the current section completes, Codex answers the question, and the remaining review stays paused until **Continue review**. Only one model request runs at a time. Completed answers are retained, but the unfinished queue does not resume after quitting. A section must fit the 120,000-character request limit; a pass supports up to 40 sections. Use a narrower selection for an oversized section.

## Read the corresponding PDF passage

The PDF scrolls continuously across pages. The page field and arrows still let you jump directly, and reopening restores your reading position and zoom.

Choose **Find** above the PDF to search its text. **Enter** or the down arrow advances to a highlighted match; **Shift+Enter** or the up arrow goes back. **Escape** closes search. Matches become available as indexing proceeds; the status shows incomplete or limited searches. Search uses the PDF currently displayed, including an older or candidate preview, and does not search images or change the source.

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

Choose **Actions → New draft**, select a new `.tex` filename in your paper folder, paste the paragraph, then **Add preamble and compile**. Codex proposes the additions and the editor checks compilation before applying them. Passing additions remain visible and editable; Undo removes them in one step. The same action can add missing packages or standard environments to an existing preamble.

Supply the original definitions of custom mathematical commands. This action preserves the body and makes additions only, so conflicting packages or errors in the paragraph may need manual correction. It accepts up to 120,000 characters and has no unchecked acceptance option. **Cancel preamble** stops the attempt. See [where new drafts are saved](FAQ.md#where-is-my-new-draft).

## Ask Codex Side Chat about the editor or paper

Open **Codex Side Chat** in the top bar, or press **Command+Shift+H**. The drawer leaves your workspace in place. Closing it keeps the conversation and unsent question in this window. Select **Editor help** for program questions, even without an open paper, or **This paper** for its own conversation.

Ask, for example, “Why did compilation fail?”, “Explain this lemma”, or “Make this suggestion more compact.” The installed editor version and bundled guides accompany every question. Expand **Context** to choose the current draft, selected passage, current comment, latest error/build details, or enabled reference folders. **Preview what is sent** shows the request; sent messages retain that context for inspection. The current draft can include unsaved changes. Long drafts include only their first 120,000 characters, with an explicit notice; select a later passage when needed.

Paste a screenshot with **Command+V**, drop it into the question area, or choose **Attach screenshot…**. Click a thumbnail to enlarge it or × to remove it before sending. Up to three PNG/JPEG screenshots are accepted, each at most 2 MB and 4096 × 4096 pixels. The editor removes image metadata; inspect the visible image itself before sending. Screenshots are sent as images. Older screenshots remain in the saved chat but are not resent automatically—reattach one to ask about its pixels again.

**Ask Codex** or **Command+Enter** sends the question. **Stop** cancels it. Only one Codex request runs at a time. Replies advise; they cannot execute repairs, compile, or change the manuscript. A proposed revision shows its original and replacement. **Turn into comment** adds it to the normal review queue with Undo; it does not accept or save source changes. If the source has changed since the answer, placement needs confirmation. For a general answer, select a passage first to turn it into a question. **Go to passage** and **Show in PDF** use a verified attached passage.

Chats are saved in application storage, separately from source and review sidecars. Paper chats are keyed by the document's full path, so moving or renaming it starts a separate chat. **Clear chat…** deletes that conversation after confirmation. The chat is limited to 100 exchanges and 16 MB; reaching a limit stops new sends without deleting earlier exchanges. Copy anything you need before clearing. Up to 12 recent exchanges (48,000 characters) accompany follow-ups; the context preview shows omissions. Unsent questions are not saved across app restarts.

## Keyboard shortcuts on Mac

To write with more room, click **×** in the Comments heading or turn off **Actions → Show comments**. The source and PDF expand into the available space. **Show comments** above the source, **Command+2**, or **View → Show/hide comments** brings the pane back. The choice is remembered for this paper; comments, discussions and pane widths are retained. A new review deliberately opens the pane, but background comments arriving after you hide it leave it hidden.

During a review, a prominent progress card appears in the Comments pane. Section reviews show the current section and completed-section count, with Pause/Continue and Stop. Existing comments remain usable while later sections are prepared. **Accept without compiling** is the smaller text action beneath Accept/Reject/Skip; it keeps the same placement guards and Undo behavior.

The buttons visibly show **Shift+A** for checked acceptance, **Shift+R** for rejection and **Shift+S** for skipping. These review shortcuts work while focus is in the comments controls, outside typing fields. Click a comment control such as **Next** to return focus there. They do not intercept uppercase letters in the source, replacement, note, or Find field.

| Shortcut | Action |
| --- | --- |
| **Shift+A** or **Option+Enter** | Accept with compilation check and advance |
| **Shift+R** | Reject the current comment into History; Undo restores it |
| **Shift+N**, **Shift+S**, or **Option+Right** | Skip / next comment |
| **Shift+P** or **Option+Left** | Previous comment |
| **Shift+L** | Set aside for Later / return to pending |
| **Shift+D** | Open the current comment's discussion |
| **Option+Backspace** | Reject suggestion / resolve author question |
| **Command+O**, **Command+S** | Open, Save |
| **Command+T** or **Command+B** | Compile the current draft |
| **Command+Z**, **Command+Shift+Z** | Undo, Redo |
| **Command+F** | Find in the focused source or PDF pane |
| **Command+1**, **Command+2** | Focus source / comments |
| **Command+Shift+P** | Show/hide PDF |
| **Command+Shift+M** | Show/hide toolbar |
| **Command+Shift+H** | Open Codex Side Chat |
| **Command+Enter** in Codex Side Chat | Send the question |
| **Command+,** | Settings |

While typing in a text field, Undo follows that field's text history. The native menus also list application shortcuts. If the toolbar is hidden, **Show controls ▾** brings it back.

## Settings and Help

Open **Actions → Settings and Check setup…** or press **Command+,** to choose the installed Codex and latexmk executables. **Check setup** reads their local versions; **Save settings** applies your chosen paths to future work. Finish active review or compilation first. The storage detail shows where application data and managed samples live outside the source checkout.

**Copy setup details** checks the selected executables and copies editor, operating system, Codex and TeX versions with check status. It excludes manuscript text, file paths and account details. Expand **Copied setup details** to inspect the copied summary.

**Actions → Help and shortcuts…** opens searchable copies of this guide, Setup, the FAQ and the **Changelog** inside the editor. **Shortcuts** shows the current shortcut table. Help, Settings and **Modern Codex Editor → About** identify this release as **0.3.1**. Tab stays in an open Help or Settings panel; Escape closes it when no settings operation is running and returns keyboard focus.
