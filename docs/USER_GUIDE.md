# Writing and reviewing a paper

[Installation](SETUP.md) · [FAQ and recovery](FAQ.md) · [Repository overview](../README.md)

## First session

1. Choose **Try the working sample** for synthetic source and prepared comments, or **Open a LaTeX or text file** for your paper's root `.tex` file. Keep the paper with its bibliography, figures, and local style files.
2. Press **Compile**, **Command+T** or **Command+B** to show the PDF. This uses the current editor text, including unsaved edits. Choose the paper's LaTeX engine in **Actions → Compile & layout** when necessary.
3. Read the explanation and **Changes** in the surrounding paragraph. **Clean** shows the proposed paragraph without markup; **Edit** opens just the replacement words.
4. Choose **Accept** to apply without compiling and advance, or **Skip** to read the next comment. Use the arrow beside **Accept → Accept & compile** when you want a compilation check before applying. Press **Save** when you want to write the changed source file.

Open a `.tex` or `.txt` file of at most 2,000,000 bytes. UTF-8 opens directly. For common older encodings, ME shows **Open a UTF-8 copy**, a warning and a full text preview. It supports UTF-16 LE/BE, Windows-1252, Latin-1 and Mac Roman. A byte-order mark identifies UTF-16; otherwise the choice is explicitly uncertain. Check accents, quotation marks and symbols, choose the correct encoding, then **Save UTF-8 copy and open…**. The destination must be a new file, and both the original and converted source must fit the size limit.

Conversion uses strict local decoders and checks that the decoded text can reproduce the original bytes. It never substitutes unreadable characters or uses AI. This check cannot establish which ambiguous encoding was intended or repair already-corrupted text. Word/RTF, UTF-32 and other unsupported formats require a separate plain-text export. LaTeX files declaring a legacy input encoding need their preamble and included files migrated together; ME explains that limitation and does not rewrite them automatically.

## Continue a project

Choose **Continue a project…** on Home, click the filename and its arrow in the toolbar, or use **Actions → Recent projects…**. Search by filename or folder; the list shows full locations and dates for up to 30 recent files. Reopening uses the same paper's comments, chat, comparisons and unsaved recovery, subject to the ordinary changed-source checks. Switching first records the current draft's recovery; **Save** still controls writing the source file.

The list is local. It starts with the previously recorded resume file and records later openings; ME does not search your disk for old projects. Open an older file once to add it. Moved or unavailable files stay labelled; use **Open another file…** to locate them. **Close and keep data** leaves a project available here.

Prepared comments need no Codex account. Generating reviews, asking questions, and creating a preamble use your configured Codex connection.

## Text mode and the right-hand viewer

A file without a complete ordinary `\begin{document}` / `\end{document}` wrapper opens in **Text mode**. Write ordinary text or a LaTeX fragment on the left, review comments in the middle, and read **Text diff** on the right. Paragraphs and literal commands are preserved; this is not a Markdown renderer. Text editing, comparison, acceptance and Undo do not require TeX or Codex. **Find** (Command+F with focus in Text diff) searches the revised text; it does not search deleted text or modify the draft.

Click the reference name in the comparison toolbar to choose **Original pasted text**, a version from before a review, a named draft, an older file, or a saved version. Dates and short excerpts help identify each version. The picker stays inside the comparison column; choosing a reference leaves the current source and Undo unchanged.

The first paste into an empty draft is preserved verbatim. A full draft is also preserved before each review request, including unsaved edits. The first automatic checkpoint becomes the comparison reference if none has already been chosen; later reviews keep that choice fixed. Save and reopening preserve it. **When opened** remains available for the current session's opening draft, including recovered text. See [comparison versions](#compare-with-an-original-or-saved-version) for details.

Use the right pane's **View** selector to switch a complete LaTeX paper between PDF and exact text changes. The toolbar's **View** menu controls the arrangement of panes. Hiding the viewer preserves that arrangement.

**Add preamble…** deliberately asks Codex for a wrapper and performs one compilation check. If supported and successful, the additions become one undoable edit and the PDF opens; the original body is preserved. Save remains separate. A failed or unsupported attempt stops without a repair loop. For a `.txt` draft, **Actions → Export LaTeX copy…** writes a separate `.tex` file; it never renames or overwrites the original automatically. Save still writes the currently opened filename. If you complete a wrapper manually, choose **Switch to PDF**. Ordinary typing does not continually change modes.

## Changes PDF

Choose **Changes PDF** in the right-hand viewer. The editor prepares a local comparison PDF first, then asks GPT-6.1 Sol for explanations and supported layout choices. Keep reading and navigating while Sol works; its response can take a few minutes. A compact bottom status shows the current stage and elapsed time. While the view is open, it updates after **five accepted changes** by default, after **Save**, and when you press **Refresh**. Typing alone does not start another request. The comparison reference is selectable directly in the viewer toolbar; **Comparison options (⋯)** holds the update interval and pause control. **Stop** cancels a running update and retains an already prepared local PDF; leaving the view stops its current work. Sol-assisted updates use your Codex account and include unsaved edits. Unchanged Save and reopen reuse the current comparison after checking its inputs; Refresh requests new analysis. Use the arrows or change menu to navigate; explanations stay collapsed until needed.

**Build locally without Sol** in Comparison options creates the comparison without a model request. If Sol is unavailable or returns an unusable arrangement, the already prepared local PDF stays available with a notice; recorded acceptance reasons remain available. The next scheduled update can use Sol again. Refresh preserves the open explanation, reading position and any uniquely matching selected change. Explanations that do not change the generated PDF reuse the existing PDF without reloading it. Cached comparison PDFs are reused only after checking their source, selected inputs, presentation, engine and current resource contents.

The comparison uses the opened root source and current project resources; it does not reconstruct historical figures, bibliography or included files. Ordinary prose corrections can be marked beside unchanged headings, labels, theorem structure and inline math. Those unchanged commands execute only once. Unsupported changes remain explicitly listed; if no change can be marked safely, **Preview not possible** offers the exact text diff without compiling an unmarked paper. Identical versions show **No source changes**.

Ordinary `%` source notes do not hide nearby prose corrections. Their exact text and line endings stay in the generated source; if a note itself changes, that difference is counted separately as a **source note**, with its exact wording in **Text diff**. If only these notes changed, **Source notes only** appears without compilation or a model request. Comments inside command arguments or formulas remain part of that syntax and are not split into prose.

The single viewer menu offers **PDF**, **Text diff**, **Revision markup** and **Clean paper**. Page navigation, zoom and Find share the top viewer toolbar. These controls also stay visible in Changes PDF. Opening menus, search or explanations leaves the PDF in place.

Use **Comparison options (⋯) → Save Changes PDF…** to save the displayed comparison through the native Save dialog. **Save comparison LaTeX…** saves its exact generated source to a new `.tex` file. Both save the displayed presentation, including an older snapshot, without compiling, contacting Sol, accepting suggestions or saving the manuscript. The PDF retains printed revision markup; numbered buttons, explanations and tentative gray cues are editor-only overlays. The LaTeX copy still needs the paper's figures, bibliography and other project resources; it is not a self-contained project archive.

**Revision markup** strikes through deleted wording and underlines additions. Small edits stay inline; substantial ordinary prose rewrites use labelled **Before** and **After** paragraphs. Ordinary single display formulas can be marked as complete old/new formulas. **Clean paper** shows the revised text once, with optional numbered change markers. Both views use the same captured comparison; switching presentation compiles locally when needed and makes no additional Codex request. It does not include newer typing until the next scheduled update or **Refresh**.

Use **Previous change**, **Next change** or the change selector to navigate. **Why?** reveals the numbered margin buttons and opens a bottom panel with the recorded reason first, followed by the labelled Sol summary. Closing the explanation hides the buttons again, without recompiling, moving or resizing the PDF. **Compare LaTeX source** expands the exact before/after wording. A deleted passage retains its exact navigation location in the clean view and its old wording in this comparison. **N not shown** explains omissions from the selected presentation; some changes can still be marked in **Clean paper**, and **Text diff** retains every exact source change.

**Recorded acceptance reason** preserves the explanation associated with an accepted suggestion, including whether its replacement was edited. Later source edits can mark it as edited again. Manual edits and older history may have **No reason recorded**. The comparison shows net changes: Undo removes differences when it restores the baseline. The supplemental local journal is bounded to 500 events / 8 MB; if unavailable or full, recording pauses with a notice in the comparison, including when Why is closed and existing records are preserved. Source recovery and Save remain separate.

Unsupported changes—such as preamble edits, labels, numbered environments, whitespace-only edits or unfamiliar commands—appear in a **Changes not shown** summary, with their old/new source lines and a margin marker. Source-only notes are labelled separately in that summary. Its location is the summary, not a guessed manuscript location. **Text diff** always supplies the exact source comparison. If the marked document fails to compile, the editor stops with **Preview not possible** and retains the ordinary paper PDF. There is no automatic repair attempt. This first version supports up to 100 changed blocks and uses `hyperref`; Revision markup also uses `xcolor` and `ulem`. Existing `ulem` options are respected. Unbraced command arguments and paragraphs inside command arguments or groups remain explicit limitations.

Sol receives the changed source blocks and recorded reasons. It groups adjacent changes, selects supported layouts and supplies labelled summaries; the editor inserts the exact old/new source and checks every change is accounted for. Sol decides whether to inspect up to three comparison pages as images. **Options** reports which pages of the current presentation were checked, or that it has not been checked. Switching presentation does not reuse the other view’s visual verdict. A visual check concerns presentation, not the correctness of the paper. Failed or incomplete checks are labelled; they do not start repair loops. Unsupported comparisons stop with **Preview not possible**, with **Text diff** available. The agent always uses **GPT-6.1 Sol**, independently of the model chosen for reviews and Side Chat.

Changes PDF has its own pagination, zoom, search and position. Its artifacts cannot become the restored paper PDF or satisfy an acceptance compilation check. Source edits make the comparison visibly out of date; changed resources are checked when the pane is shown, periodically while visible, and before locating changes.

## Beamer slides

Open and compile a Beamer root file as usual. **Changes PDF** marks ordinary wording edits inside literal frames, bullets, blocks and columns. Existing frame options, overlay specifications, titles and unchanged mathematics stay in place. Changes use inline strike-through and underlining; slides never expand into paired Before/After paragraphs. The comparison uses anchors inside the frame, with the same **Why?** and clickable inspection controls.

Fixed-size slides have less room for revision markup. A **Slide layout warning** reports TeX overflow; Sol may additionally identify crowding in the pages it checks. Neither compilation nor a visual check certifies the whole deck. Switch to **Clean paper** to read the revised slide without deleted wording, or inspect **Original** and **Proposed revision** in PDF mode. The editor does not shrink fonts, alter slide layout or try automatic repairs.

Comparisons with added or removed frames use the original/proposed PDFs and Text diff; they do not guess which surviving frame should carry a deleted slide. Frame-title/structure changes, changed literal code, tables, overlay-command arguments and other unsupported edits remain explicit. Some mathematical edits are available only in the clean comparison. When a comparison also contains supported edits, separate, unnumbered comparison-notes slides list the omissions and exact source lines; these notes are not guessed locations in the lecture. **Text diff** contains every source difference. An entirely unsupported comparison offers Text diff instead of an unmarked Changes PDF. Macro-generated frames are not interpreted.

**Outline** searches literal frame titles as well as sections and labels. **Fit page** in the PDF zoom menu fits both dimensions, useful for slides or a short window; **Fit width** remains the default. Source/PDF jumps use SyncTeX and may reach the slide header or frame boundary rather than an exact sentence.

## PDF review mode

Choose **View → PDF mode** for a complete LaTeX document with imported or generated comments. It captures the current draft as the session's **Original**. The left pane shows **Changes**; the right switches between **Proposed revision** and **Original**. Proposed includes all applicable remaining suggestions, using their selected wording and edits. Preparing the PDFs takes local compilation time.

Suggestions have three review states:

- **Tentative:** included in Proposed, but not applied to the working draft. Inline edits have a faint gray background in Changes.
- **Accepted:** still visible in Changes; applied to the draft. Accepting unchanged wording removes the gray cue without rebuilding or reloading the same proposed PDF.
- **Rejected:** removed from Proposed and Changes, retained in comment History. Undo restores the decision.

Click changed text or a numbered marker to open a small inspector. The reason comes first, followed by the contextual text diff. **Clean**, **Edit**, saved wordings, **Quick alternative**, and **Discuss** use the same comments as the ordinary workspace. Move the popup by its title bar, **Expand** it, or choose **Back to PDFs**. None of these actions resizes or moves the PDFs. Multiple suggestions in one comparison block remain individually selectable.

Inline gray shading and marker status are live viewer cues; they are not baked into exported PDFs. Gray means tentative; **Accepted** and **Mixed** identify edits that exactly match recorded suggestion wording. **Related suggestion** means the comparison overlaps a comment but its precise edit cannot be attributed to that decision, for example after manual rewriting. **Manual/unlinked change** has no matched suggestion. Hover for the status and inspect individual decisions. The comparison preserves exact revision markup regardless of decision.

**Accept** applies one exact suggestion without compiling, just as in the workspace. **Accept all applicable (N)** and **Reject all remaining (N)** use the selected **Whole paper**, section or subsection scope. A section includes its subsections; headings and scope membership are fixed from the captured original. Bulk acceptance always checks compilation, even when only one suggestion remains, and forms one Undo action. A failed check leaves the source and decisions unchanged. Questions are not bulk accepted/rejected; inspect them and use **Resolve** or **Reject** individually. Suggestions spanning a scope boundary stay for a wider scope or individual review.

The suggestion picker, count, previous/next arrows and **Inspect** follow the same section scope. Clicking a marked edit outside that scope switches to Whole paper so its comment stays reachable. Page, zoom and Find controls remain visible on each PDF reader; the marked-passage list is in **PDF review options (⋯)**.

Comments already in Later stay outside the PDF session. Within the session, overlapping, stale, incomplete or newly deferred suggestions are explicitly listed as not included in the combined preview. You can inspect them individually or return to **Source** to confirm placement. The editor does not guess an order for conflicting proposals. If a comparison cannot be typeset, it says **Preview not possible** while keeping exact comment wording and any valid PDFs available.

Rejecting or changing proposed wording refreshes the local preview; typing in its edit field waits until you leave that field. The last matching set of PDFs stays readable during generation and is labelled out of date. **Refresh** also rechecks project resources. Leaving PDF mode cancels unfinished work; returning retries an interrupted preview. An explicit **Stop** waits for Refresh before retrying. **PDF review options (⋯) → Refine comparison with Sol** optionally uses the existing Sol arrangement and visual-check pipeline. The original, proposed and comparison inputs are rechecked before a refined result replaces the displayed set. Routine PDF-mode updates do not call a model.

**Workspace** returns to ordinary editing. Commands that explicitly show the current draft or a checked candidate also open the workspace reader, preserving this PDF session. This is an isolated preview session using the same source, comment records, discussion, rejection history, recovery and Undo—not a separate copy of the editor's database. **Save** writes the working draft, containing accepted and manual edits, rather than the whole tentative proposal. Choose **PDF review options (⋯) → Save Changes PDF…** or **Save comparison LaTeX…** for the left comparison. Export the Proposed or Original PDF from that reader’s **⋯** menu. Exports include the displayed tentative preview; they do not accept it.

The original snapshot and membership remain fixed while this paper stays open. New background comments appear in the workspace; **Restart from current draft** explicitly includes the current pending set and captures a new original. Closing/reopening the paper starts a new PDF session; accepted/rejected decisions and proposal drafts are still saved through ordinary recovery. PDFs use the opened root source and current figures, bibliography and included files, not historical copies of those resources. Both readers scroll independently because comparison pagination can differ.

## Preview a suggestion

Choose **Preview** beside the comment's acceptance controls. It uses the actual replacement field, including your edits and any required packages, without accepting the suggestion, saving the source or adding an Undo step.

With **Changes PDF** selected, **Preview** automatically typesets the exact tentative edit in the selected presentation, including deletion markers and explicit unshown-change notices. It is labelled **not applied**.

In Text mode (or with Text diff selected), the right pane compares the current draft with the proposed draft immediately. For a supported LaTeX body change, PDF Preview compiles an isolated candidate and highlights its nearby typeset region. A neutral bottom bar says **Preview · not applied**; **Details** opens its explanation, **Refresh preview** and **Show text diff** without shifting the PDF. **Return to draft** restores the ordinary view and reading position. A repeated unchanged PDF preview reuses its cached build only after checking its inputs again.

Edits to the source or proposal make an existing preview **out of date**; use **Refresh preview**. Switching comments leaves the preview without compiling the next comment. In the ordinary PDF preview, preamble-only edits, full deletions and unavailable PDF locations show **Preview not possible**; **Show text diff** remains available. A failed build leaves the paper PDF intact. No automatic repair or acceptance follows a preview. **Accept** still applies without compiling; **Accept & compile** retains its separate check. In Text mode, **Accept all** applies eligible suggestions together without TeX.

## Close a project and return home

Choose **Actions → Close project** or use the **File** menu. **Close and keep data** stops pending work, records the current draft and comments in recovery, and returns home. **Save** writes the source file. If recovery cannot be recorded, the project stays open.

To finish a paper and clear its ME records, save the draft first, then choose **Review files to clear…**. The preview lists every proposed file with its full location, contents, size and last-modified date. It shows the dated recovery archive location and a separate list of files and locations being kept. Review the list, tick the confirmation, then choose **Archive, clear and close**. Cancel leaves the editing data intact. If the files change, refresh the list and confirm again.

Cleanup archives and verifies this paper’s comments, chats, reference copies, history and verified temporary builds before removing them. It keeps the source, figures, bibliography, attached originals, exported PDFs, other papers, global settings and sign-in. Unrecognized files, old builds without a verified owner, shared diagnostics and usage, legacy shared records, and Codex CLI conversation storage are kept. A small reset identity prevents legacy comments/history from returning on reopen. The recovery archive includes a manifest mapping every saved copy to its original path and date; **Show recovery archive** opens it. The archive still contains the old editing data until you deliberately remove it.

The next launch also starts at Home. After **Close and keep data**, use **Open a LaTeX or text file** to reopen the document and restore its recoverable unsaved text, comments, saved versions and reading position. After clearing editing data, reopening starts a new editing history. Unsent Side Chat drafts and unsaved review instructions are session-only; keep those before closing. Undo history is also session-only.

## Data & cleanup

Open **Actions → Settings and Check setup → Data & cleanup…**. Choose:

- **Clean temporary data:** clear complete compilation copies, cached PDFs and build logs older than 7, 30 or 90 days. Keep editing history, comments and chats.
- **Forget selected papers:** clear their ME comments, chats, copied context, rejection memory and recovery records. Keep source documents, figures, exported PDFs, global settings and sign-in.

The list shows known papers, last activity and storage eligible for the chosen action. Nothing starts selected; the open paper is protected. **Choose paper…** adds a source file whose ME records are not already listed. This inspects known ME locations, not your whole disk. A paper with unsaved recovery must be reopened and saved before it can be forgotten.

**Review files** shows every proposed file's full location, purpose, size and modification date, plus kept locations. Tick the confirmation and choose **Archive and clear**. One dated archive is written and verified before any selected files are removed; changed or unverifiable files stop cleanup. Cancel preserves everything. The archive retains the cleared data and its original path mapping for manual recovery. Shared diagnostics, usage, recent-file shortcuts, unowned builds and Codex CLI storage remain intact; this is not a complete privacy erasure. Cleanup previews support up to 100 papers, 10,000 files and 2 GB at a time.

## Ask for the review you need

Click **Review**. **Reviewing** shows **Whole document**, or **Selected text** when you have selected a passage. Choose Whole document directly to review the opened file without clearing your selection. Included files such as `\input{chapter}` can compile, but their contents are not expanded into this review.

The compact dialog keeps your instructions, scope, model and folder access visible. **More options** contains small-edit and delivery preferences, saved paper instructions, review history and **Inspect request**. Small **i** controls explain settings on hover or click; keyboard users can focus them and press Enter. Escape closes the explanation.

**Review type** offers **Language**, **Technical consistency** and **Slides**, alongside General review and the adapted **Academic style**, **Literary nonfiction** and **Creative fiction** presets. Choosing one replaces the instructions below; edit them before sending. Language protects technical meaning, certainty and evaluative judgment, asking a question when a rewrite could change substance. Slides respects intentional brevity, fragments and overlays. These are review instructions, not a guarantee that every suggestion preserves meaning.

For a follow-up, choose **Reviewing → Changes since…** and select an original paste, pre-review draft, named version or older file in the picker. Codex reads the exact revisions, including deletions, with nearby context; it can read the rest of the current draft for understanding. Replacement suggestions are limited to those context ranges. Wider consequences or missing material should become questions. This does not replace a whole-paper consistency review: select **Whole document** for that. A changed-passage review supports 200 change regions and 120,000 characters of changed passages and context; choose a closer baseline if it is too large. The selected reference is shared with the comparison column.

**More options → Keep edits small** starts checked. It asks Codex for one independent correction per suggestion, using the shortest safe source passage, with broader concerns left as discussion comments. It preserves complete LaTeX commands and enough context to locate repeated wording. An explicit request for a paragraph or broader rewrite takes precedence; you can also uncheck it to permit larger rewrites. Save this preference for the paper with **Save paper guidance**. It applies to reviews, section reviews, comment discussions, outside-feedback conversion and paper Side Chat. Codex reads it in `paper-instructions.md`; it does not rewrite existing suggestions. Codex's adherence still needs your review.

For a language pass, try:

> Check spelling, grammar, and awkward phrasing throughout this source file. Suggest concise replacements where they improve the text. Preserve mathematical claims, notation, citations, and LaTeX commands. Avoid unnecessary stylistic changes.

For a separate mathematics pass:

> Check the stated assumptions, quantifiers, definitions, and proof steps for consistency. Identify possible gaps and explain your uncertainty. Ask a question when a correction depends on the intended claim; do not invent missing assumptions.

Choose **Start review**. Treat mathematical comments as suggestions to assess; a review is not proof verification. There is no fixed comment quota, but one pass need not catch every issue. A full or selected-passage review accepts at most 120,000 characters; select a shorter passage or use section review for longer files. Codex is asked to publish the first useful suggestion or small batch immediately, without waiting for five comments or finishing the paper. With **More options → Show suggestions while reviewing** on, you can start deciding while it continues. **Usage & speed** records first-batch and completion times; lower effort is not automatically faster.

**Actions → Paper instructions…** lets you inspect and edit the paper’s standing instructions, **Smallest local edits only**, and **Keep changes minimal and preserve my voice**. These are saved per paper and shared by paper reviews and discussions. Editor-only Side Chat does not receive them. Save guidance before requesting a review; saving alone makes no model request. A prepared but unsent Side Chat preview is refreshed after guidance changes. **Review → More options → Inspect request** shows the short request, scope and context identifiers; **Actions → Latest Codex context…** shows the latest preview or request for the open paper. Switching papers clears it. See [privacy details](../PRIVACY.md).

## Import prepared comments

Comments prepared in **Astra Pro, another model or by hand** can go straight into the review queue. In **Review**, open the arrow beside **Paste material** and choose **Import comment JSON…**, or use **Actions → Import JSON…**. Import is local: it does not call Codex, apply edits or save the manuscript. Existing comments stay available; each imported suggestion still needs your decision. Cancelling the file picker leaves the review dialog and its instructions in place.

Use the exact source version you gave the reviewer. A PDF is useful for reading, but cannot supply reliable LaTeX source quotations. If the editor has unsaved changes, export a source copy or copy the current source for the reviewer. Open that same paper in ME before importing. Read the reason and contextual diff, choose a wording if alternatives were supplied, then Accept, Reject or Discuss normally.

**Review → More options → Comment JSON format & prompt** opens the instructions below. In Help, **Copy review prompt** copies the generation prompt, JSON example and format notes together. It copies instructions only; add your source and review goals yourself. The format accepts a JSON object with a `comments` array or a bare array. There is no 30-comment limit: a file may contain more than 30 useful comments, up to the current 2,000-comment review limit, with a 10 MB import-file limit. Do not import the same file repeatedly; direct imports can duplicate comments.

For an existing prose report or JSON that does not follow this format, use **Actions → Import outside feedback…**. That separate route uses Codex to turn advice into source-linked comments. **Context and reference files…** makes material available to future requests; attaching a report as context alone does not populate the comment queue.

## Generate comment JSON

Give Astra Pro or another reviewer the current `.tex`/`.txt` source and your review instructions. Include relevant context or prior rejections if needed. The editor does not send anything to an outside reviewer on your behalf. Use the following prompt with the format below:

```text
Review the attached source under my accompanying instructions. Prepare the
comments directly for Modern Editor import as one UTF-8 JSON file.

Use an object with schemaVersion: 2 and a comments array. Each comment has
id, title, explanation, original, replacement and packages. Category is optional.
Explain why the change is useful, not just what words changed. Complete the
requested review; there is no arbitrary 30-comment cap.

Copy original verbatim from the supplied source, including LaTeX commands,
spaces and line breaks. Prefer the smallest independent edit that makes sense.
Use a complete replacement for that quoted span. Keep unrelated wording,
mathematics, labels and citations unchanged. For a question or concern without
an exact safe replacement, use replacement: null. Use an empty string only
for an intentional deletion. Do not invent a source quotation.

If the same quotation occurs more than once, include before and after with
verbatim neighboring source, outside original, to identify the occurrence.
For two or three wordings of the same span, optionally add alternatives with
label, reason, replacement and packages. Every option must replace the entire
common original. Use separate comments for edits at different locations.

Use distinct short IDs. Usually packages is an empty array; list only genuinely
needed LaTeX package names. Omit offsets, sourceHash, validity, decision and other
editor state. Escape backslashes and line breaks correctly for JSON. Return
valid JSON without markdown fences, ellipses, placeholders or prose outside it.
```

This complete, synthetic example has one correction and one author question. It illustrates the format; its quotations must be replaced with exact passages from your own source:

```json
{
  "schemaVersion": 2,
  "comments": [
    {
      "id": "grammar-1",
      "title": "Use a singular verb",
      "explanation": "The subject 'proof' is singular.",
      "original": "The proof are short.",
      "replacement": "The proof is short.",
      "packages": []
    },
    {
      "id": "boundary-1",
      "title": "Clarify the boundary case",
      "explanation": "Does the conclusion also hold at zero? Keep the current claim until this is established.",
      "original": "The result holds for $\\theta>0$.",
      "replacement": null,
      "packages": []
    }
  ]
}
```

Save the raw JSON as a UTF-8 `.json` file. If the answer appears inside a code block, copy its contents without the opening/closing fences. JSON has no comments or trailing commas. In the file, `\\theta` represents the source command `\theta`; `\n` represents an actual source line break. Preserve source typography: straight and curly quotes, hyphens and dashes are different characters.

Use `before` and `after` only as placement context; they are not replaced. A missing or ambiguous quotation cannot be accepted until you confirm its location. For new text, quote an existing nearby span and include it in the replacement with the addition. List only required package names in `packages`; describe other preamble concerns in the explanation. The editor can preview ordinary edits but does not certify mathematical correctness.

Optional `rootFile` must equal the open filename, so omit it when unsure. Do not ask the model to guess a source hash or character offsets. If you supply a real `sourceHash`, a different revision requires placement confirmation. Avoid overlapping edits; accepting one can make another stale. Separate independent changes, and keep mutually exclusive wordings in one comment's `alternatives`. See the [multiple-wordings example](FAQ.md#can-one-imported-comment-contain-several-wordings).

Each quotation or replacement supports up to 100,000 characters; `before` and `after` support 2,000 each. A comment can retain up to 30 wordings including its initial proposal. These are import limits, not suggested targets: small, independent suggestions are easier to inspect. If input is malformed or exceeds a limit, ME reports the problem and preserves the imported file and source.

## Work through comments

To start a note without Codex, select source text and choose **Actions → Add comment to selection**. Write in **Your reply or note** and choose **Save note** to keep it locally, or **Ask Codex** to request a response. **Review → Paste material ▾ → Import comment JSON…** loads prepared JSON directly; see [Import prepared comments](#import-prepared-comments) and the [generation prompt](#generate-comment-json).

| Action | Result |
| --- | --- |
| **Accept** / **Shift+A** | Applies the proposal and any listed packages without compiling, then advances. The PDF may now be older. Save is still separate. |
| **Preview** | Shows the exact tentative draft without applying it; text diff or a supported candidate PDF. |
| **Accept & compile** | Checks a candidate compilation, applies a passing proposal, and stays on that comment so you can inspect its PDF highlight. **Next comment →** advances when you are ready. Warnings can pause acceptance for inspection. |
| **Details → Accept all applicable (N)** | In LaTeX mode, compiles one combined candidate for the eligible pending replacements, then applies them together as one undoable change. Text mode applies them together without compilation. |
| **Skip** / **Next** | Advances without making a decision or setting a persistent skipped status. |
| **Details → Later** | Sets an open comment aside, retaining its proposal and discussion across reopening. Use **Later (n)** and **Return to pending** to revisit it. |
| **Reject** / **Shift+R** | Moves the current comment into History without changing the source. Undo restores it. |
| **Details → Reject all remaining (N)** | Rejects the current pending batch in one undoable action, retaining every comment and discussion in History; Later comments are unchanged. |
| **Details → Mark addressed manually** / **Resolve** | Closes a comment you handled yourself or an author question. |

In **Edit**, **Use original** copies the original passage into the editable proposal, so you can start from the author’s wording. It changes no source; **Undo** restores the previous proposal.

Hover over or click **Details** in the compact comment header for additional controls. The small **ⓘ** controls in Review work the same way. Tab to either control and press Enter or Space; Escape closes it. These overlays leave the source and PDF in place. **Overview** searches titles, original and proposed wording, discussion and rejection reasons. Status/category filters remain in place; **Show all matches** reveals matches hidden by them. Selecting a historical match only inspects it; **Reopen** is a separate decision. **History** shows completed decisions. Rejected and resolved comments can be reopened. **Reject** closes an unwanted comment; **Skip** leaves it pending. **Resolve** remains a separate action for an author question you have addressed. Undo can reverse recent edits and review decisions during the current session; the Undo stack does not survive quitting.

**Details → Accept all applicable (N)** shows how many pending replacements can be applied together. It includes only current suggestions whose original text still matches exactly and whose changes do not overlap. Questions, stale or ambiguous suggestions, overlapping proposals and Later comments remain for individual review. In LaTeX mode, the editor compiles the combined draft once; Text mode applies it without compilation. After acceptance, one **Undo** restores the batch's source changes and decisions. Save is still separate.

In LaTeX mode, with **Accept & compile** or **Accept all**, if the candidate produces a PDF with verified inputs but acceptance warnings, the editor explains the issue, such as undefined citations or references, duplicate labels, or missing characters (glyphs). Inspect **View candidate PDF** and **Build details**, then choose **Apply despite warnings** to proceed deliberately. Before applying, the editor rechecks the source, suggestions and compilation inputs; changed inputs require a new compile. Failed compilation or unverified inputs never offer this override. Ordinary **Accept** skips compilation for an individual suggestion while retaining source-placement guards.

The Comments pane's **Details → Reject all remaining (N)** rejects the pending comments present when clicked, including comments whose passages are missing or changed. They remain in **History** with their discussions; Later comments are unchanged. One **Undo** restores that batch. Comments that arrive afterward retain their own status when you Undo or Redo the rejection. **Accept all applicable (0)** stays disabled when no suggestions can be applied safely; this does not prevent rejection.

For a replacement suggestion, acceptance stays disabled if the original passage has changed or its location is uncertain. Select its exact original words at the intended source location and choose **Attach to selected text**. If those words no longer exist, revise manually or request a new review.

For a question without a replacement that refers to earlier wording, select the current passage and choose **Link question to current selection**. The card keeps **Earlier wording** beside the **Linked current passage**, and retains the discussion. Linking changes no source text and is undoable. Earlier suggested alternatives remain readable; ask for a fresh proposal before applying wording to the newly linked passage. You can also discuss or resolve the question without relinking it.

The comment body scrolls while the compact navigation row and decision buttons stay in place. **Changes** shows word-level deletions and bold, underlined additions in a short excerpt: the changed sentence and nearby sentences. **More context** expands toward the surrounding paragraph (up to 4,000 context characters on either side); **Less context** restores the compact view. Every edited span remains visible. **Clean** shows the same excerpt with the replacement applied for reading only. The choice is remembered across comments. **Edit** edits only the proposed replacement, not its context; **Use original** and Undo remain available. Very long source blocks show nearby context, and stale or historical quotations are not attached to a guessed location. Required package additions remain visible. Accept still changes only the exact matched span and listed packages.

**Discuss** opens the conversation only when requested. Moving to another comment closes it; saved messages and unfinished replies remain with their comment. Routine instructions are in tooltips or this guide. An outdated-passage warning appears as a dismissible overlay inside the PDF pane, without resizing the workspace or moving the PDF. **Compile and show** updates the PDF deliberately.

## Turn outside feedback into comments

Choose **Actions → Import outside feedback…** and paste a numbered Markdown review or a JSON array of comments (an object with a `comments` array also works). Alternatively, choose **Turn into comments…** beside a saved pasted context. **Prepare items** saves the original feedback verbatim and captures the current draft and paper guidance locally; it sends nothing to Codex. Check the item count and **Preview next request**, then choose **Next batch** or **Convert remaining with Codex**.

**Add suggestions as they arrive** appends each completed batch to the queue while preserving your current comment and edits. It does not accept suggestions or save the manuscript, and it does not interrupt Undo for your own edits. Turn it off to inspect the returned advice and use **Add selected comments** instead; that manual import is undoable. Repeatedly adding the same saved items does not duplicate them. General or unmatched advice remains visible as a question. If the draft changes during conversion, quoted passages need confirmation before a replacement can be applied.

Conversions run in batches of up to ten review items, retaining the original item numbers. There is no 30-comment limit for a whole review. Each completed batch is saved before the next starts. Pause, reopen the paper or retry a failed request to continue the remaining items; the original feedback and previous results remain under **Saved outside feedback**. A prepared conversion always uses its captured draft and guidance. Prepare a new conversion to use a newer draft.

Outside feedback shows separate counts for converted review items and saved comments, followed by **in Comments**, **matched a prior rejection** and **available to add**. Open **Review items and coverage** to inspect each outcome, including a withheld proposal and its matching rejection. Use **Open in Comments** or **Open in History** beside an item’s comment to inspect its current wording and decision. Navigation does not reopen a rejection or apply anything. One numbered item can have several comments; accepting one does not resolve the whole item automatically. A comment added and later rejected still belongs to Comments. Counts update after reopening or Undo. Questions without replacement text are valid comments.

The current limits are 2 MB of UTF-8 feedback, 1,000 review items, 60,000 characters per item, 12,000 introductory characters and 120,000 source characters. Oversized or malformed input is rejected explicitly; it is not silently truncated. Keep nested numbered lists indented so they remain part of the containing issue.

The **Add suggestions as they arrive** toggle is available in Review, Comments → Details, the running review’s controls and outside-feedback conversion. This preference is saved per paper and can be changed while Codex is working. Enabling it also integrates waiting review results. You can continue through existing comments while the review runs. Reviews can deliver complete batches while Codex keeps working: Codex is asked to publish useful comments as they become ready, with no total-comment quota. Each batch is validated and saved before it appears. Stop keeps saved batches; repeated comments in the final answer are not added twice. Older saved conversations created before batch delivery may still return everything at the end; use **Fresh review** to start a conversation with the publishing tool. Early delivery depends on the model and is not a guaranteed latency improvement. Completed suggestions are matched against the current draft; uncertain or changed passages cannot be accepted until their location is confirmed. Turn the option off to leave the result waiting for inspection. Completed outside-feedback batches remain available in Outside feedback. The current switch controls subsequent batch arrivals, even if the request started with a different setting.

Rejected suggestions remain in the paper’s saved review and **History**, including across sessions. New reviews can search and read `review-decisions.md`, including saved author reasons, without embedding a rejection summary in every prompt. Incoming review and feedback batches also filter exact repeated proposals against the latest rejections. The original returned result stays on disk. This does not guarantee detection of paraphrased repeats. Reopen a comment in History when you want to revisit it.

## Stopped or failed reviews

A compact bottom summary distinguishes **Review stopped** from **Review failed** and reports retained suggestions, confirmed entries in Comments, and results still waiting. Expand it for saved wording and **Show waiting results**. That opens results for this review only; **Show all requests** returns to the complete waiting list. **Add** or **Add all comments** retries local delivery without calling Codex again or accepting edits. Earlier accepted edits, rejection decisions and edited proposals are preserved.

“Saved” means retained suggestions, not a saved manuscript. A visible comment whose recovery or receipt failed remains counted as waiting until retry succeeds. Dismissed results, withheld repeats and comments removed by Undo may be retained outside Comments. Unreadable records or truncated summaries are explicitly flagged. New review-history entries link to their saved batches; older records without request identifiers cannot provide these counts. “No final outcome recorded” means the saved exchange has no confirmed completion, rather than proving that it is still running.

## Repair comment anchors

Ordinary typing and pasting a lightly revised large selection keep anchors on unchanged spans. Changed quotations remain stale; the editor does not silently move them to another occurrence. Undo restores both text and anchors. If an edit leaves comments marked stale, missing or unconfirmed, choose **Repair anchors** beside the passage warning or **Comments → Details → Repair anchors (N)**. One request checks affected open comments, including Later comments, using **Sol · High effort · Fast**, independently of your paper settings. It compares exact occurrences of each original quote with the comment’s old and current context. Only confirmed locations are restored; the manuscript, suggested wording and decisions stay unchanged. **Undo** restores the previous anchors, and repaired placements are saved with the review. Repair can run while a review or Side Chat continues. **Stop anchor repair** cancels only the repair. New comments and your decisions are preserved; if the source changes during repair, run it again against the new text.

Changed or missing original words and uncertain matches remain for manual checking or a new review. **Attach to selected text** remains available for an exact manual placement. Very repetitive quotes and batches exceeding the quick request size limit are left flagged explicitly.

## Codex access to the current paper and its folder

ME sends a short request with your instructions, scope and essential rules. The paper itself is read as `current-draft`, including unsaved changes. Saved guidance and decisions appear as `paper-instructions.md` and `review-decisions.md`. Review history has a searchable index and individually readable exchanges; Side Chat has `chat-history.md`. These Markdown views reuse existing records: no extra context folders, memory files or model-maintained logs. Tool reads still transmit the returned text to the configured service and do not guarantee lower latency or usage.

**Codex can read this folder** is on by default in **Review**. The same choice appears as **Codex can read this folder and subfolders** in **Context and reference files** and Side Chat’s **Context**. The choice is saved separately for each opened paper. It gives ordinary reviews and discussions read-only access to supported documents under the opened file’s folder; no repeated folder selection is needed. Codex starts with your request and scope, reads `current-draft`, and consults other files when relevant. Merely opening a paper or changing the checkbox sends nothing to a model.

The current editor draft, including unsaved edits, is always available to the ordinary review/discussion reader, even with folder access off and no attached references. The saved disk copy is excluded from the reader inventory so an old version cannot replace the current draft. Quick explanation and Quick alternative can read the draft and saved context, without access to other folders or the active review conversation. Side Chat enables file reading by default for paper chats; its separate **Read full draft and enabled folders/references as needed** checkbox can turn off additional file reading for that conversation in the current window. The chosen source scope remains readable; with extra reading off, a selected-passage request exposes only that passage as `current-draft`. Editor help does not get automatic paper access.

Supported material includes `.tex`, `.bib`, `.sty`, `.cls`, `.bst`, text/Markdown, JSON, CSV, YAML, TOML and extracted PDF text. Hidden/private-name files, generated build/cache/history directories and symbolic links are excluded. Images and other binary formats are not interpreted by the file reader. The recursive inventory supports up to 2,000 eligible files, 10,000 inspected entries and 64 nested levels; files are limited to 2 MB for text or 20 MB for PDF. Incomplete inventories and bounded excerpts are disclosed. **Sources used…** records actual reads/search coverage, not a claim that every available file was read. Separately attached reference locations retain their own enable switches.

## Continue or start a fresh review

The main button in **Review** says **Start review** for the first request and **Continue review** when this paper has an active conversation, including after reopening the editor. “More comments” can build on the earlier discussion. Each request makes the current draft snapshot, saved instructions and current decisions readable through tools; earlier quoted source is historical. The ordinary **Ask Codex** discussion also uses the active review conversation. Quick explanation and Quick alternative keep their small, independent requests.

For another assessment, open the arrow beside **Continue review**, choose **Use a fresh conversation**, then **Start fresh review**. This keeps your saved paper instructions, current author decisions and earlier exchanges. There is one active conversation per paper, identified by the file’s full path; moving or renaming the file starts separately. If the runtime can no longer resume a conversation, choose Fresh; ME does not silently discard continuity.

**More options → Review history** shows full authored instructions, dates, recorded outcomes, and expandable returned suggestions, including previous Fresh-review conversations. Raw request data stays under **Technical details**.

**Use these instructions again** copies only the full instruction into the current Review form. Check the current scope, model and Continue/Fresh choice, edit if needed, then press **Start review**. Reuse does not send a request, restore an old draft, or change your current settings.

**Reject** remains one click. The arrow beside **Reject** offers common reasons and **Reject with reason…** for your own explanation. Choosing a common reason rejects and records it immediately. You can also use **Comments → Details → Rejection reason…**, either before rejection or after selecting the rejected item in **History**. Your reason is saved separately from the model’s explanation and included with later rejected-suggestion context. Exact rejected proposals are withheld only at their verified current occurrence; a deleted or uncertain anchor cannot suppress another identical passage. Outside-feedback conversion reads current decisions for each batch and checks them again when adding comments, while retaining the prepared draft and instructions. Rejection and its reason are undoable together. Reopening a comment removes its rejection from the next request’s decision context. Reasons do not automatically become general writing rules: **Remember for this paper…** copies a reason into editable paper instructions for you to inspect and save.

**More options → Saved instructions for this paper** in Review are inspectable and editable. Both Continue and Fresh use the current saved wording. Saving instructions makes no model request. Completed paper Side Chat exchanges made while a review conversation is active are available to subsequent reviews as notes; editor-only help stays separate. Side Chat keeps its own bounded conversation, rather than taking over the review thread.

Section review sends one request per section of its fixed draft snapshot. A Fresh choice applies to the first section; the rest continue that conversation. **Resume sections** resumes the paused section queue. A newly requested review captures the latest editor draft.

Earlier exchanges are saved locally and can be looked up with a bounded history reader; long conversations may be compacted by Codex. The active conversation supports up to 1,000 exchanges, after which choose Fresh. Continuation is for collaboration, not a guaranteed speed or usage saving. **Usage & speed** labels Fresh/Continue requests so you can compare actual timings and reported tokens.

## Attach local reference material

In Review, open the arrow beside **Paste material** and choose **Attach files…**. You can also use **Attach context…** in a discussion, or **Actions → Context and reference files…**. Use **Add reference folder…** or **Add reference files…** for PDF, LaTeX, Markdown, or UTF-8 text. These locations are remembered for this paper. Codex can find and read relevant material during subsequent reviews and discussions without repeated file selection.

For example: “Use the revision comments and compare this proof with the earlier draft.” The current unsaved editor text remains the draft; other files are references. **Sources used…** shows the excerpts and search coverage actually returned to Codex. Disable a reference temporarily with its checkbox, or remove it without deleting any files. Reattach missing or moved locations.

To focus a request, expand **Choose exact excerpts (optional)**. Select files and PDF pages such as `1-3, 7` or text lines such as `20-80`, then **Preview selected context**. These optional selections last for the current session and changed files require another preview. Folder and file reading is bounded; notices identify incomplete coverage. PDF extraction reads text only, with no OCR or interpretation of figures. Attaching is local; asking Codex sends relevant text to its service.

## Compile a paper in a larger folder

Press **Compile** normally. Above **50 MB or 500 files**, the editor starts deterministic dependency discovery: it follows recognizable source, figure, bibliography and local-style references and prepares a smaller snapshot automatically. This is the discovery threshold; the cap on actual required inputs is **200 MB / 2,000 files**. Standard installed packages remain in the TeX installation. Local figure alternatives (such as both PDF and PNG) are kept together so TeX chooses normally. An unchanged copy of the bundled `tcilatex.tex` is recognized as support code. Windows drive and Parallels `//Mac/…` fallbacks in `\graphicspath` do not block macOS discovery when the figures are also available locally. They do not grant access to files outside the paper folder.

For ordinary SWP BMP figures on macOS, **Compile** also converts the referenced image to PNG inside the temporary build, keeping its display width and height. Your `.tex`, BMP files, SWP metadata and review anchors stay unchanged. The same preparation supports proposal and Changes PDFs. This handles literal `\includegraphics{file.bmp}` references to a single local image, up to 20 million pixels; other graphics commands or unresolved paths still need attention. No Codex request is needed for this preparation.

If compilation needs help, the compact input panel names the problem and keeps the file list under **Details**. Missing, outside or unsupported inputs require a local correction; a model-generated file list cannot fix them. For computed filenames, **Prepare file-list request…** creates a local preview; **Ask Codex for a file list** sends it only when clicked. Inspect the returned list, then choose **Compile selected files**. You can dismiss the panel and continue editing.

The explicit file choice is reused while this paper remains open and revalidated for each build. It uses the same **200 MB / 2,000-file** cap. If the required inputs exceed it, reduce those resources or use another compilation route. Successful compilation with unresolved computed references remains unverified: inspect the output and build details. The previous successful PDF stays available after a failed preparation or compile.

Planning and request preparation run locally. Only **Ask Codex for a file list** sends the previewed excerpts, relative filenames and dependency-check results through your configured Codex service. There is no separate file-upload workflow. See [privacy details](../PRIVACY.md).

## Choose a saved wording

Use **Quick alternative** beside the proposal to request one additional wording with Sol at low effort. It can read the draft, saved guidance and comment discussion, without browsing other folders. It leaves the current proposal and unsent question untouched. The same comment can also receive several options through [JSON import](FAQ.md#can-one-imported-comment-contain-several-wordings).

The compact **Wording** selector switches among saved options. Each option retains its own edits and package list. Selection is undoable and does not change the source; Accept, Accept & compile, and Preview use the selected wording. The selected option’s reason accompanies it. If no initial replacement was supplied, choose an option before accepting. Options for an earlier linked passage cannot be applied to the new passage.

## Discuss an alternative

Choose **Discuss**, write a question in **Your reply or note**, and choose **Ask Codex**. For example:

> Make the suggested change more compact while preserving the qualification in the second sentence.

Each reply separates the explanation from **Suggested wording**, which shows the actual LaTeX. **Use this wording** updates the proposal only and can be undone. Inspect it, then use an acceptance button to change the draft; Save writes the source. A deletion is explicitly labelled **Remove this passage**. A reply can also be an explanation without a replacement.

Three shortcuts are available in the open discussion:

- **Quick explanation** uses Sol with Low effort and can read the draft, saved guidance and comment discussion. It cannot return an edit and does not browse other folders. With a typed question it explains that question; otherwise it explains the current suggestion. Use a full discussion when it needs broader context.
- **Three alternatives** uses Sol with Medium effort and enabled references to offer up to three distinct wordings. Each has a reason and is saved in **Wording**, as well as retaining its **Use this wording** button in the discussion. Your proposal and unsent question stay unchanged until you choose.
- **Think again** asks the paper's model to recheck its reasoning and withdraw or narrow an unwarranted suggestion. It uses High effort, preserving a higher selected effort.

Quick alternative, Quick explanation and Three alternatives use GPT-6.1 Sol at the standard service tier, without changing your paper's model, effort or Fast setting. They still use your Codex account, and response time varies. A queued section review finishes its current request before a shortcut can run.

**Save note** records your note locally without calling Codex. A later explicit discussion request can include that saved note as context. Discussion actions leave the current proposal available until you choose another answer. **Preview request** previews the discussion context, including selected references.

If you keep typing while a response is generated, an answer based on the earlier draft may wait under **Actions → Waiting Codex results…**. Use the visible **Add** beside a result, or **Add all comments** to bring every displayed review batch into the queue. Neither accepts suggestions, changes the source or moves your current comment. Already-added comments are not duplicated, and uncertain anchors stay flagged. Discussion answers have their own **Attach answer** button; they are not included in Add all. Expand a result to inspect its contents or dismiss it.

## Review section by section

**Review section by section**, under the arrow beside Start/Continue review, processes complete sections of a frozen copy of the opened root file. Finished batches become available while the next section runs. **Pause after section** finishes the active section; **Resume sections** resumes the remaining sections of the same frozen copy. **Stop review** cancels unfinished work and keeps completed answers. To review a newer draft, stop and start a new pass.

You can discuss a comment during the pass. **Ask after this section** queues one question: the current section completes, Codex answers the question, and the remaining review stays paused until **Resume sections**. Section review and comment discussion share a request. Side Chat and anchor repair can run independently alongside them. Completed answers are retained, but the unfinished queue does not resume after quitting. A section must fit the 120,000-character request limit; a pass supports up to 40 sections. Use a narrower selection for an oversized section.

## Pasted context

Choose **Review → Paste material** to go straight to the paste form. The same action is available under **Actions → Context and reference files…** and from paper Side Chat. Paste plain text or Markdown, optionally name it, then use **Save and enable for this paper** above the text. **Not yet saved** remains visible until saving succeeds. **Back to review** returns to Review with its Start review button; other entry points show **Done**. Closing or returning keeps an unsaved paste in this form for the current open project, but does not save or attach it. The app preserves the supplied text verbatim in local application storage. It does not call Codex when you paste, save, inspect, rename, copy, disable or remove context.

After saving, background material is ready for the next review. For external feedback, choose **Turn into comments… → Prepare items → Convert remaining with Codex**. This reuses the saved material; saving alone does not generate comments. Use **Inspect / copy** to read the saved text, rename it or copy the full text. Uncheck it to keep the document locally but exclude it from future requests. **Remove** deletes a pasted document’s saved copy; removing an ordinary reference only detaches it. Earlier request excerpts may remain in Sources used or conversation records.

Each paste supports up to **2 MB of UTF-8 text**, with up to **12** combined pasted documents/reference locations per paper. A larger paste remains in the form so you can split it. Enabled context is available to reviews and comment discussions through bounded search/read tools; paper Side Chat uses it when **Let Codex read enabled context, references and the current draft** is selected. A large document is not automatically sent or read in full. **Sources used** records actual excerpts and coverage. Use **Paper instructions** for standing guidance and **Import outside feedback…** to convert a report into comments.

## Classic view

**View → Classic view** switches to a cream writing surface, narrow left controls and a bottom suggestion panel, inspired by the original ModernEditor. **Write / View** switches between the source and the current PDF or text comparison. **Comments** hides or restores the bottom panel for writing. The same Changes, Clean, Edit and comment Details controls remain available. **Actions → Workspace view** returns to the regular pane layout.

Both layouts use the same live source editor, proposal drafts, comments and Undo history. Switching layout does not save, compile or accept anything. The selected layout is remembered for the paper; Undo remains session-only.

## Files, history and PDF export

Open **Actions → Files & history…** for source and neighboring resources, saved paper state, attached context, Side Chat and available PDF builds. **Reveal** opens the item’s location in the system file manager; **Copy path** copies its local path. **Saved versions…** opens existing history and comparison controls. The inventory does not delete or restore files.

**Save displayed PDF…** exports the exact workspace PDF, including an older PDF, proposal preview or Changes PDF when selected. In **PDF mode**, Files & history instead offers **Save Changes PDF…**, **Save Proposed revision PDF…** and **Save Original PDF…**, each bound to that session’s named snapshot. Proposed may include tentative edits; an older snapshot is labelled accordingly. Check its status label first. It does not compile, apply proposals or save the source. The same export is in **PDF options (⋯)**; comparisons also have **⋯ → Save Changes PDF…** directly. **Compile current draft & save PDF…** deliberately compiles the current buffer before exporting; unsaved source remains unsaved. These commands use the native Save dialog, so the PDF goes where you choose.

## Arrange your workspace

Use **View** in the top bar to choose **Automatic**, **Source + comments**, **PDF + comments**, **Three panes**, **Source + PDF · writing**, or **PDF below · stacked**. Automatic uses three panes in a wide, tall window; smaller windows use **Source / PDF** tabs beside Comments so both have useful reading height. Left and right arrow keys switch between the focused tabs.

Switching views keeps your current comment, replacement draft, source selection, Undo, and reading positions. The view is saved for this paper. Collapse Comments with **Hide** in its header or choose the writing view; **Show comments** or **Command+2** restores it. **View → Reset pane widths** restores the default proportions.

For papers named `main.tex`, an optional **Actions → Compile & layout → Paper display name** makes the header easier to recognize. It changes only the local display label, not filenames.

## Read the corresponding PDF passage

The PDF scrolls continuously across pages. The page field and arrows still let you jump directly, and reopening restores your reading position and zoom. **Fit page** fits the complete page within the reader and preserves that choice when reopening. Zoom choices **1.25× fit**, **1.5× fit**, and **2× fit** are relative to **Fit width**, not an absolute printed scale.

Choose **Find** in the PDF toolbar to search its text. **Enter** or the down arrow advances to a highlighted match; **Shift+Enter** or the up arrow goes back. **Escape** closes search. Matches become available as indexing proceeds; the status shows incomplete or limited searches. Search uses the PDF currently displayed, including an older or candidate preview, and does not search images or change the source.

The comment's **Source · PDF** controls refer to that comment's passage. **Show in PDF** above the source uses the selection or cursor. **Command-click** a source passage to locate it in the PDF, or **Command-click a PDF passage** to select the corresponding LaTeX line. The PDF also has **right-click → Show in LaTeX**. These jumps use local SyncTeX, with no Codex request.

Use the **← Back** button at the left of the main toolbar, **View → Back to previous position**, or **Command+Option+Left** to return. Navigation history is separate from Undo, keeps up to 50 jumps for the open paper, and follows source edits. It restores the PDF's reading position and zoom only while that compiled snapshot remains available in the viewer. Source/PDF jumps keep pane widths; a hidden source or PDF is revealed when needed.

**Outline** above the source (also **View → Outline…**, **Command+Shift+O**, and the PDF-mode toolbar) searches headings, subsection titles, Beamer frame titles and labels in the current root source. Click a result or use the arrow keys and Enter. Escape closes it. The outline reads ordinary LaTeX structure locally; it does not expand macros or scan included files.

In **PDF mode**, Command-click the right-hand Original or Proposed PDF to inspect its exact source snapshot in an expandable popup. Neither PDF moves. Outline shows the current draft in the same popup. **Open in source editor** is offered for the current draft; original or tentative source stays clearly labelled and read-only. Changes PDF retains its clickable change/comment inspector rather than treating generated comparison source as the current manuscript.

**PDF options (⋯) → Follow selected comments** is enabled by default; it brings each selected comment’s passage into view. Deliberately moving through comments marks the matching PDF region when its location can be established, preserving zoom and keyboard focus. A closed PDF stays closed, and following pauses during a candidate preview. Background answers do not move your view.

Changing the PDF page, scrolling, changing zoom, or opening Compare cancels a pending jump. The selected comment's yellow highlight remains while you read or zoom, with brief emphasis when switching comments. Editing the source, choosing another comment, or opening Compare clears the old marker. Moving to another comment starts following again.

The PDF status distinguishes **Current draft**, **Earlier PDF**, **Candidate · not applied**, and **Unverified inputs**. An earlier PDF can still show unchanged, uniquely matched passages. A background check deferred during compilation does not by itself make a PDF outdated. A changed or ambiguous passage offers **Compile and show**; following never recompiles automatically. This compiles the current buffer without Save or acceptance. A failed build keeps the previous PDF. The marker locates a nearby typeset line or region, not necessarily each selected symbol. Preamble definitions and LaTeX comments may have no visible counterpart. Reverse jumps select a nearby source line, not an exact symbol. If that line changed or is ambiguous in the current draft, compile again and retry the PDF jump. Included-file passages are reported explicitly: source navigation currently covers the open root document.

Reopening a paper restores reading position, layout, and comment-list state. If the saved PDF preview is unavailable, compile again. Malformed reading-position settings are preserved separately before fresh settings are saved; manuscript and review recovery stay separate. This does not restore the Undo stack or unfinished model work.

## Compare with an original or saved version

In **Text diff** or **Changes PDF**, click the reference name in the comparison column's toolbar. Choose a dated version using its text excerpt:

- **Original pasted text:** the first paste into an empty draft, preserved exactly. Later pastes do not replace it.
- **Before first review**, **Before review 2**, and later checkpoints: the full current draft before sending the request, including unsaved edits, even when reviewing only a selection. Section reviews of the same frozen draft share one checkpoint; repeated reviews without source changes reuse the latest checkpoint.
- **Keep this version:** enter a name to retain the current draft.
- **Choose older file…:** select a separate `.tex` or `.txt` file.
- **Saved versions…:** choose a retained source backup and **Compare this version**, without leaving the column.

Selecting a reference changes only the comparison. Your draft, comments and Undo stay unchanged, and the reference stays fixed through Save, later reviews and reopening. **When opened** offers the current session's opening draft; selecting it retains that reference too. New automatic checkpoints cannot recover an original paste or pre-review draft that an earlier editor version never stored.

For a wider source comparison, use **Actions → Compare versions…**. **Baseline…**, **Side by side**, **Inline**, Previous/Next change and **Go to source** remain available. Comparisons cover this source file, using current dependencies for PDFs, rather than historical copies of every figure and included file.

In saved versions, **Storage for this folder** controls a 50 MB default target for managed source backups, adjustable from 1 to 1,000 MB. Identical saves reuse one copy; older unprotected versions can be pruned. Protected recovery and original versions may exceed the target. **Delete version…** is available only for unprotected copies. Automatic and named comparison checkpoints are separate and are not pruned by that backup target. See the [storage FAQ](FAQ.md#how-do-i-control-storage).

## Paste a fragment and create a preamble

Choose **Actions → New draft**, select a new `.tex` filename in your paper folder, paste the paragraph, then **Add preamble…**. Codex proposes the additions and the editor checks compilation before applying them. Passing additions remain visible and editable; Undo removes them in one step. It is available for text and fragments without a complete document wrapper.

Supply the original definitions of custom mathematical commands. This action preserves the body and makes additions only, so conflicting packages or errors in the paragraph may need manual correction. It accepts up to 120,000 characters and has no unchecked acceptance option. **Cancel preamble** stops the attempt. See [where new drafts are saved](FAQ.md#where-is-my-new-draft).

## Ask Codex Side Chat about the editor or paper

Open **Side Chat** in the top bar, or press **Command+Shift+H**. Drag its title to move the floating panel and drag an edge or corner to resize it. Its position and size are remembered locally; the source, comments and PDFs stay in place. **−** collapses it to a title strip, **+** expands it, and **⋯ → Reset position and size** restores the default placement. The title and bottom-right resize grip also accept arrow keys; hold Shift for larger steps.

**Model**, **Effort** and **Speed** appear in a compact summary below the chat title. Click it to expand the selectors; the question field and Send remain visible while settings or Context are open. Side Chat starts with **GPT-6.1 Sol · Extra high effort · Fast**, independently of the paper’s review preferences. Changes you make here apply only to Side Chat and are remembered locally across papers and restarts; existing saved choices are preserved. Choose **Editor default** to follow the application’s model setting instead. Model choices come from the installed CLI; unsupported effort options and Fast speed are unavailable. Effort includes Low, Medium, High, Extra high, Max and Ultra when supported; quick editorial shortcuts keep their separate modest effort. Switching models adjusts incompatible choices. **↻** refreshes the catalog without sending paper text or generating a reply. The prepared context records the settings used for that question.

Closing or collapsing the panel keeps the conversation, attachments and unsent question in this window; a running reply continues. Reopening a closed panel retains its collapsed or expanded state. Switching conversations also preserves each unsent question, attached screenshots and selected discussion in memory for this window. Select **Editor help** for program questions, even without an open paper, or **This paper** for its own conversation.

Ask, for example, “Why did compilation fail?”, “Explain this lemma”, or “Make this suggestion more compact.” The installed version accompanies **Ask Codex** questions; bundled guides are readable as `editor-help.md`. Expand **Context** to choose the current draft, selected passage, current comment, latest error/build details, or enabled context and references. **Preview what is sent** shows that request; **Preview Suggest edits** shows the quick editing request. Sent messages retain their context for inspection. The current draft can include unsaved changes. Long drafts have a review scope of the first 120,000 characters, with an explicit notice; select a later passage when needed.

Paste a screenshot with **Command+V**, drop it into the question area, or choose **Attach screenshot…**. Click a thumbnail to enlarge it or × to remove it before sending. Up to three PNG/JPEG screenshots are accepted, each at most 2 MB and 4096 × 4096 pixels. The editor removes image metadata; inspect the visible image itself before sending. Screenshots are sent as images. Older screenshots remain in the saved chat but are not resent automatically—reattach one to ask about its pixels again.

**Suggest edits** turns your request or recent discussion into comments you can accept or reject. It uses **Sol · Low effort · Fast** without changing the ordinary Side Chat selectors. Select source text to focus the request; otherwise it uses the current draft and your Context choices. A blank question asks for edits based on the recent discussion. The reader makes paper instructions and saved exchanges available, omits editor Help and build diagnostics, and reads additional files only as needed when enabled. **No source text** disables this action.

Suggestions join **Comments** as complete batches arrive, even if **Add suggestions as they arrive** is off for regular reviews. The chat stays open and your selected comment, source cursor and earlier decisions stay in place. **Stop** keeps received batches; an interrupted reply does not erase them. Adding comments does not accept edits or save the source. Results based on an older draft are checked against the current source; missing or uncertain passages require confirmation before acceptance. Delivery timing depends on the model; a reply that produces no early batch adds its suggestions when it finishes.

**Ask Codex** or **Command+Enter** sends the question. **Stop Side Chat** cancels only that request. You can use Side Chat while a review or anchor repair runs; their progress and Stop controls are separate. Replies advise; they cannot execute repairs, compile, or change the manuscript. Ask for several comments at once, for example “Give me five small edits to this section.” Each numbered comment has its own reason, original passage and optional replacement. **Add comment** adds one to the review queue and keeps chat open, marking the item **Added to Comments**. **Add all and review (N)** adds the remaining comments in one undoable step and opens the review queue. Neither action accepts edits or saves manuscript changes. Items already in the review queue or History are marked **Added to Comments**, including rejected items. **Discuss this** beside a suggestion selects its exact original and replacement for the next question. Add the suggestions you want to the queue before accepting them; accepting changes the draft and older replies may then require attachment confirmation. Replies support up to 100 comments within a 200,000-character output budget; ask for another batch for longer reviews. If a quotation cannot be matched, or the source has changed since the answer, placement needs confirmation. For a general answer without structured comments, select a passage and choose **Turn into comment** to attach it as a question. **Go to passage** and **Show in PDF** use a verified attached passage. Show in PDF opens the ordinary draft viewer, leaving PDF mode while preserving its reader positions. Chat context identifies the visible PDF role separately from the current source supplied to it.

Chats are saved in application storage, separately from source and review sidecars. Paper chats are keyed by the document's full path, so moving or renaming it starts a separate chat. **Context → Clear chat…** deletes that conversation after confirmation. The chat is limited to 100 exchanges and 16 MB; reaching a limit stops new sends without deleting earlier exchanges. Copy anything you need before clearing. Codex can search and page through all saved exchanges in `chat-history.md`, newest first, without copying them into each prompt. **Discuss this** puts the chosen suggestion’s exact wording at the top of that readable view. Old prompts and screenshots are not included in it. Earlier proposals do not imply acceptance. Unsent questions are not saved across app restarts.

If a completed reply cannot be saved, **Review unsaved replies** remains available even after switching papers or returning Home. Choose **Retry saving reply**, **Copy conversation**, or deliberately **Discard unsaved reply**. Copy includes the conversation's saved context and screenshots. Previously saved chat history is retained. Closing the project or quitting is blocked until unsaved replies are handled; the absence of an **Unsaved** indicator refers only to the source file.

## Keyboard shortcuts on Mac

To write with more room, choose **Hide** directly in the Comments heading or turn off **Actions → Show comments**. The source and PDF expand into the available space. **Show comments** above the source, **Command+2**, or **View → Show/hide comments** brings the pane back. In Classic view, the left **Comments** button restores the bottom panel. The choice is remembered for this paper; the current suggestion, proposal draft, discussions and pane widths are retained. A new review deliberately opens the pane, but background comments arriving after you hide it leave it hidden.

During a review, **Reviewing…** replaces the Comments header label without moving the comment. Click it for progress, the current section/count, Pause/Resume and Stop. Help is available through the small info hint. Existing comments remain usable while later sections are prepared. **Accept**, **Reject** and **Discuss** have small arrows for related actions. Accept includes **Accept & compile** for LaTeX; Reject includes optional reasons; Discuss offers **Quick explanation**, **Three alternatives** and **Think again**. Clicking the main part keeps the ordinary action. Bulk decisions stay in Details with explicit counts. Both acceptance actions keep placement guards and Undo.

Hover over the comment buttons for their shortcuts: **Shift+A** accepts without compiling, **Shift+R** rejects and **Shift+S** skips. These review shortcuts work while focus is in the comments controls, outside typing fields. Click a comment control such as **Next** to return focus there. They do not intercept uppercase letters in the source, replacement, note, or Find field.

| Shortcut | Action |
| --- | --- |
| **Shift+A** or **Option+Enter** | Accept without compiling and advance |
| **Shift+R** | Reject the current comment into History; Undo restores it |
| **Shift+N**, **Shift+S**, or **Option+Right** | Skip / next comment |
| **Shift+P** or **Option+Left** | Previous comment |
| **Shift+L** | Set aside for Later / return to pending |
| **Shift+D** | Open the current comment's discussion |
| **Option+Backspace** | Reject suggestion / resolve author question |
| **Command+O**, **Command+S** | Open, Save |
| **Command+T** or **Command+B** | Compile the current draft |
| **Command+Z**, **Command+Shift+Z** | Undo, Redo |
| **Command+F** | Find in the focused source, PDF or Text diff pane |
| **Command+1**, **Command+2** | Focus source / comments |
| **Command-click** source / PDF | Jump to the corresponding PDF / LaTeX passage |
| **Command+Shift+J** | Show source selection or cursor in PDF |
| **Command+Option+Left** | Back to previous reading position |
| **Command+Shift+O** | Search the document outline |
| **Command+Shift+P** | Show/hide PDF |
| **Command+Shift+M** | Show/hide toolbar |
| **Command+Shift+H** | Open Codex Side Chat |
| **Command+Enter** in Codex Side Chat | Send the question |
| **Command+,** | Settings |

While typing in a text field, Undo follows that field's text history. The native menus also list application shortcuts. If the toolbar is hidden, **Show controls ▾** brings it back.

## Settings and Help

Expand the visible **Model** summary beside **Reviewing** in **Review** to choose all three together. New reviews default to **GPT-6.1 Sol · Extra high (`xhigh`) effort · Fast**. Explicit saved model choices and each paper’s saved effort/speed are preserved; Settings can reset them to these defaults. The model list loads only when expanded; opening Review itself starts no Codex process or model turn. Available Astra, Sol and Luna choices come from the installed CLI's catalog. Each change saves immediately, preserving your review instructions. The model applies to future reviews and ordinary discussions; effort and speed are saved per paper. Side Chat has independent controls, and its **Editor default** model follows the saved review model. Unsupported combinations must be changed before starting a review. **Settings…** opens the full model/setup panel, where changes are staged until **Save settings**. **Refresh models** reloads the installed CLI’s account catalog without sending paper text or starting a model turn. It keeps your saved model, effort, speed and instructions. If the catalog recommends a replacement, a quiet notice offers **Choose …**; the change requires your click. Settings and Side Chat show the same notices for their selections. A missing saved model stays visible with a warning; choose an available replacement before sending. Refresh updates available choices, not the installed CLI itself.

**Actions → Codex effort** expands the paper’s effort choices: Low, Medium, High, Extra high, Max and Ultra, limited to those supported by the selected model. The list loads when you expand it and shows the selected model. The Model button above it also opens that choice. The choice is saved per paper; Side Chat’s Effort is separate. **Fast mode** in Actions controls service speed for paper requests, independently of effort. See the [effort and speed FAQ](FAQ.md#what-do-effort-fast-mode-and-answer-length-mean).

Open **Actions → Settings and Check setup…** or press **Command+,** to choose the installed Codex and latexmk executables. **Check setup** reads their local versions; **Save settings** applies your chosen paths to future work. Finish active review or compilation first. The storage detail shows where application data and managed samples live outside the source checkout.

**Copy setup details** checks the selected executables and copies editor, operating system, Codex and TeX versions with check status. It excludes manuscript text, file paths and account details. Expand **Copied setup details** to inspect the copied summary.

**Actions → Help and shortcuts…** opens searchable copies of this guide, Setup, the FAQ and the **Changelog** inside the editor. **Shortcuts** shows the current shortcut table. Help, Settings and **Modern Codex Editor → About** identify this release as **1.8.0**. Tab stays in an open Help or Settings panel; Escape closes it when no settings operation is running and returns keyboard focus.

## Changed settings and defaults

Open **Settings → Changed settings** to compare your current choices with this version's defaults. Settings are grouped by scope: application setup (Codex installation/model and compiler path), the open paper's review preferences (engine, effort, Fast mode and edit preferences), Changes PDF's update interval, and debugging. Layout, reading positions, context selections and history budgets remain in their existing controls.

Use **Reset** beside one setting or **Reset all … defaults** within a group. These actions stage values; review them and use that group's **Save** button to apply them. **Undo reset** restores the values from immediately before the last reset; save again if you already saved the reset. **Discard changes** returns to the last saved values. Closing Settings discards unsaved settings changes. The changed count reflects the displayed draft.

Resetting preferences preserves manuscript text, unsaved drafts, comments, alternatives, discussions, versions, attachments, authored paper instructions and account sign-in. Resetting debugging stages recording **off**, but does not delete any records. Executable paths are validated before a changed setup is saved; an unavailable default compiler must be replaced with your installed path.

## Usage and speed

Choose **Actions → Usage & speed…**, also available in Settings. Filter by **Today**, **This paper** or **Recent history**. The panel shows each Codex request's model, effort, speed, outcome, **First usable**, first saved batch, first answer, total time and reported tokens. **First usable** starts with the originating review or Suggest edits request and ends when a new edit or question is in Comments, recovery is saved, and Accept or discussion is available. It measures availability, not quality or your first click. Withheld repeats and unconfirmed replacements do not count. **Manual Add** includes your waiting time and should not be compared with automatic delivery. **Model response** describes the model call; **Review results** separately says whether ME validated and retained its answer, failed, or stopped. A completed model response can still fail validation or saving. **No comments** means a validated completed review saved none; **None yet** means none has become usable. Older requests and delivery after an app restart cannot provide this timing. These times start before connection/setup; total includes cleanup. A dash means unavailable. Requests show Fresh or Continue where applicable. Continued requests subtract the preceding recorded thread total so earlier turns are not counted again. Missing or reset usage reports stay unavailable. Cached input and reasoning are subsets, not additional tokens. The panel shows the latest 50 matching rows; summaries cover the retained matching history.

Metadata recording is on by default and can be disabled here. It retains the most recent **1,000 requests**, starting with this update; older rich debugging records are separate and are not imported or deleted. The metadata contains no prompts, responses or document text. **This paper** uses a hash of the paper path open when a request started, so renaming or moving a paper starts a different scope. This is a request monitor, not a complete keystroke/build activity log or billing estimate.

**Refresh account limits** separately reads the available account-wide allowance and reset times through your installed Codex CLI. It starts no model turn and sends no paper text. These limits include activity outside this editor; they cannot be calculated from the editor's token totals. They refresh only when requested. An unavailable quota stays labelled unavailable; old results retain their checked time.

## Optional debugging

**Settings → Debugging** can record Codex prompts, replies, request errors and input images locally, plus optional screenshots of the visible editor once a minute by default (adjustable from 30 to 600 seconds). Change the preferences and press **Save debugging settings** to apply them. It also records actions such as acceptance, navigation, discussion and choosing wording, with elapsed times for requests and builds. It does not record individual keystrokes. Small action and timing events share registered files of up to 100 events. It is **off by default**. These private files may contain manuscript text; they are not part of normal review context or recovery, and are never automatically uploaded. The register lists records and their sizes. Open the folder to inspect them, delete individual records, or **Delete all debug records…** to switch recording off and clear them. Recording stops at 200 MB or 500 entries until space is cleared.
