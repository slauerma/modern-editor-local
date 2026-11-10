# Changelog

## 1.8.0 — Review workflows and local data

- Default reviews to GPT-6.1 Sol with Extra high (`xhigh`) effort and Fast speed. Preserve explicit saved model and paper preferences.

- Simplify Review around instructions and scope, with the model and folder access always visible. Keep secondary controls under More options, add Paste material and Start/Continue split buttons, and make selection versus whole-document scope explicit.

- Upgrade the desktop runtime to Electron 45.2.3, including its Chromium and Node.js updates.
- Update Zod, Vite and Undici to patched releases; adapt review and Side Chat validation for Zod 4 while preserving saved-data defaults.

- Make Review history readable, with full instructions, returned suggestions, and **Use these instructions again**. Keep raw records under Technical details and preserve current draft/settings on reuse.
- Link outside-feedback items to their current comments or History, displaying current decisions and wording without reopening or duplicating comments.
- Summarize stopped/failed reviews using request-attributed retained batches and verified delivery receipts. Offer scoped local retry and distinguish model completion from review validation/storage in Usage & speed.

- Keep rejected suggestions tied to their verified occurrence, including after nearby edits. Refresh decisions between outside-feedback batches and show whether each saved comment is in Comments, withheld by a prior rejection, or available to add.
- Let an explicit current rewrite request override the minimal-edit preference. Ask a question for consequential uncertainty without a safe correction; leave satisfactory prose alone.
- Add **First usable** to Usage & speed for reviews and Side Chat Suggest edits, measured after comment recovery is saved and Accept or discussion is available. Distinguish manual additions, no-comment results and unmeasured older requests.
- Search Comments Overview across wording, discussions and rejection reasons, with visible counts for matches hidden by filters. Clarify delivery/Stop labels and preserve earlier suggestions and accepted edits when a final response fails.

- Add **Settings → Data & cleanup** for old builds or selected papers' editing records. Protect open work, show full paths/dates/sizes, and verify one dated recovery archive before removal.
- Add Language, Technical consistency and Slides review purposes, plus **Changes since version** using the existing comparison picker. Read exact changes and context through tools, keep replacements within that scope, and encourage the first useful suggestion immediately without a batch quota.

- Keep review prompts short: read the unsaved draft, paper instructions, decisions and navigable history through existing tools. Use read-only Markdown views of existing records, with no new context folders or model-maintained logs. Side Chat, outside-feedback conversion and preamble assistance use the same snapshot reading; retain scope checks, early delivery and recovery.

- Open common non-UTF-8 text through a warning, encoding preview and an exclusive new UTF-8 copy. Preserve original bytes and refuse lossy decoding, stale inputs and conflicting legacy LaTeX declarations.
- Add related-action arrows beside Accept, Reject and Discuss. Keep one-click decisions, add preset/custom rejection reasons, and keep reasons in History with Undo.
- Put **Paste material (context/comments)…** directly in Review, keep Save above the paste, show truthful save status, and provide **Back to review / Done** and a direct saved-feedback conversion route.
- Add a searchable recent-project picker on Home, in the filename and under Actions. Reopen existing source/recovery and paper records; keep missing files labelled and the list bounded locally.

- Default Side Chat to GPT-6.1 Sol with Extra high effort and Fast speed, preserving explicitly saved chat choices.

- Closing a project now offers an optional file-by-file cleanup preview, with full paths, contents, sizes and modification dates. Saved drafts are required; a verified dated recovery archive precedes removal. Sources, exports, other papers and shared or unverified data stay intact.

- Let Side Chat and Repair anchors run alongside a review, with independent progress and Stop controls. Preserve simultaneous comment arrivals, review history and source-use records; recheck the current text before applying repaired anchors.

- Add **Suggest edits** in Side Chat: Sol with Low effort and Fast speed delivers saved suggestions directly to Comments as they arrive. Keep ordinary chat settings, author decisions and the current selection; Stop retains received suggestions.

- Upgrade the editor-managed Codex CLI to 0.163.0. Refresh model choices directly in Review; show catalog replacement notices without silently changing a saved model. Keep automatic CLI model routing disabled.
- Add **Add suggestions as they arrive** in Review, Comments details and running-review controls. Codex can publish validated batches before finishing; completed batches survive Stop and are deduplicated against the final answer. Record time to the first saved batch in Usage & speed.

- Fix `.txt` save-history ownership checks. Preserve the first paste into an empty draft and full drafts before review requests; select dated versions directly in Text diff and Changes PDF. Keep the selected comparison fixed through Save and reopening.

- Remove the standard review's eight-comment prompt quota and its separate 30-comment response restriction. Longer reviews use the existing review storage limits.

- Continue one saved review conversation per paper, with a Fresh review choice and inspectable earlier exchanges. Refresh the current draft, instructions and author decisions on every request; ordinary comment discussions share that conversation.
- Add optional author rejection reasons and an explicit way to copy a preference into paper instructions. Keep one-click Reject and Undo. Record Fresh/Continue timing and per-request reported usage.

- Add all waiting review comments in one action, with a visible Add beside each result. Preserve the current source, selection, decisions and hand-edited proposals; keep uncertain anchors flagged and discussion answers separate.

- Enable read-only access to the opened paper’s folder and subfolders by default, with a remembered checkbox in Review and Context. Keep the unsaved draft available independently, read other documents on demand, and show actual reading coverage in Sources used.

- Compile ordinary SWP BMP figures on macOS through temporary PNG copies, preserving original source, image dimensions, checked acceptance and PDF/source navigation. Allow local figures alongside Parallels graphics-path fallbacks.
- Keep compilation-input problems compact and dismissible, with file details collapsed. Offer Codex file-list assistance only when it can help resolve computed dependencies.

- Keep small suggestions compact with nearby sentences and More/Less context, preserving the complete edit in Changes, Clean and Edit.
- Preserve unchanged comment anchors when pasting a lightly revised large selection. Keep edited quotations stale and preserve Undo/Redo.
- Add Usage & speed with bounded local metadata, timing and reported tokens, plus a separate read-only account-limit refresh.
- Choose model, effort and speed together in Review. Keep instructions and settings scope intact, with supported catalog choices.
- Put routine review progress and its controls in the existing comments header; expand info hints on hover or keyboard focus.

- Repair affected comment anchors together using Sol with High effort and Fast mode. Repairs preserve the source and suggestions, support Undo, and leave uncertain passages flagged.
- Open the review model choice directly from Review. The Review dialog and Actions show the saved model; effort uses Low, Medium, High, Extra high, Max and Ultra consistently.

## 1.7.0 — Beamer slides and comparison

- Mark ordinary Beamer frame, bullet, block and column wording changes inline, using in-frame comparison anchors. Preserve article rendering and exact source protections. List unsupported changes on separate comparison-notes slides and report TeX overflow.
- Give Sol frame context and slide-specific visual inspection instructions.
- Search frame titles in Outline; add a persistent Fit page zoom option. Clarify the empty Changes pane in PDF review mode.
- Add a narrated 45-second slide demonstration with captions, showing the three-column review and Changes PDF workflow.

## 1.6.0 — Current Codex runtime and review refinements

- Update the managed Codex CLI to stable 0.160.1, with verified restrictions and no automatic switch of saved model choices.
- Use GPT-6.1 Sol for Changes PDF and quick editorial actions. Offer catalog-supported Extra deep/xhigh and Ultra effort, with suitable time limits; Think again preserves higher effort.
- Update Electron, PDF.js and CodeMirror, and patch the source-map build dependency. Align Help, setup and privacy guidance with the current runtime, Side Chat settings and PDF/source navigation. Keep earlier demonstration recordings labelled by date.

- Route draft/candidate PDF commands to their visible workspace reader; distinguish PDF-review snapshot roles and freshness in status and chat context.
- Keep large chat batches available as numbered history indexes, with exact selected wording through Discuss this. Preserve unsent conversation drafts within the window and keep chat open after adding an individual comment.
- Protect the chat composer with expandable settings/context, expose PDF page and zoom controls, constrain the expanded inspector, and keep suggestion navigation within the selected section.
- Guard stopped and obsolete PDF work after asynchronous checks; revalidate retained snapshots before publishing Sol refinement. Label uncertain edit ownership as Related suggestion or Manual/unlinked change.
- Keep Outline keyboard focus aligned with the selected entry.

- Jump both ways between LaTeX and its compiled PDF with Command-click; right-click a PDF passage for Show in LaTeX. Back restores reading positions separately from Undo. Search source headings and labels in Outline. PDF mode opens an expandable source popup without moving either PDF. Older or included-file passages are checked before navigation.

- Choose Model, Effort and Speed directly in Side Chat, independently of paper review settings. Remember choices locally and use the installed CLI’s catalog for supported options.

- Side Chat can return multiple numbered comments with separate reasons and source quotations. Add them individually or together with Undo; repeated additions preserve existing and rejected comments. Follow-ups include the proposed wording.

- Move Side Chat by its title and resize it from any edge or corner without shifting the workspace or PDFs. Remember placement locally, collapse to a title strip, and reset position and size from its ⋯ menu. Keep drafts, attachments and pending replies when moving or collapsing.

## 1.5.0 — PDF review mode

- Preview the whole proposed revision in two PDFs: Changes beside Proposed or Original. Open a movable, expandable comment inspector directly from measured change regions without shifting the pages.
- Show accepted and tentative edits together; use faint gray live cues for tentative edits. Keep rejected suggestions in History and remove them from the proposed revision.
- Accept or reject individual suggestions or a manuscript section's remaining edits, using the existing source checks, comments, Save and Undo. Bulk acceptance verifies compilation even when only one suggestion remains.
- Prepare previews locally, keep the previous pair readable while updating, and offer an explicit Sol arrangement and optional visual check.
- Put Save Changes PDF and Save comparison LaTeX directly in the comparison's ⋯ menu, saving the displayed snapshot without rebuilding or changing the manuscript.
- In PDF mode, Files & history offers explicit Changes, Proposed revision and Original PDF exports, without falling back to the hidden workspace PDF.
- Use consistent Accept all applicable and Reject all remaining labels. Rejection keeps unmatched comments and discussions in History with Undo.
- Collapse the comments column directly with Hide in its header; restore it with Show comments above the source or Comments in Classic view. Keep the current suggestion, draft, discussion and chosen layout.

## 1.4.0 — Quieter contextual review and settings defaults

- Copy the external-review prompt, JSON example and import format notes directly from Help.
- Inspect settings that differ from defaults and stage individual or scoped resets, with Undo reset and explicit Save. Preserve paper content, authored instructions and existing debug records.
- Compile uses the same neutral toolbar style as Save and Review. Review offers Import comments with optional help for generating JSON in Astra Pro or another reviewer. Direct import remains local; the documentation separates it from feedback conversion and context attachments.
- Uniform comment actions and pane headers, quieter selected modes and preview status, and a simpler review dialog with optional info hints. PDF passage highlights no longer include a margin bar.
- Show one contextual inline diff per suggestion, with Clean and Edit modes; acceptance still applies only the exact proposal span.
- Keep discussion closed until requested; preserve replies while switching comments.
- Use one compact comment header with hover/click/keyboard Details, and move infrequent main-toolbar actions into menus.
- Reduce repeated instructions, borders and status text; show PDF navigation warnings without shifting the workspace.
- Refresh the three narrated demonstrations with the three-column Changes PDF workflow.

## 1.3.0 — Writing workflow and outside feedback

- Add one-click Quick alternative with Sol Low, and import/save multiple wordings on one comment with per-option drafts, reasons, packages and Undo. Reviews with choices use version 2; older review files remain supported.
- Expose a paper-specific automatic-arrival switch while reviewing; keep rejected suggestions in History, include rejection context in later reviews and suppress exact repeated incoming proposals.

- Save large named pasted context locally, enable it per paper, and inspect, copy, rename, disable or remove it later.
- Reuse original wording in a proposal; Accept & compile stays for PDF inspection until Next.
- Add Classic view with a cream writing surface, left controls and bottom suggestions, preserving the live editor and Undo.
- Share saved paper instructions and minimal-edit preferences across paper reviews and discussions.
- Combine PDF controls in one toolbar; expose exact PDF export and Files & history.
- Convert saved context or pasted numbered reviews into resumable comment batches, preserving original item numbers and completed results after interruption.
- Add completed review comments automatically without moving the current selection or interrupting Undo; keep manual inspection available.
- Offer Quick explanation, Three alternatives and Think again in comment discussions, with optional private interaction and operation timing.
- Display the local Changes PDF before Sol adds explanations; reuse identical verified PDFs without reloading and show compact stage/timing feedback.
- Use labelled Before/After paragraphs for dense ordinary prose, count source notes separately, and keep the PDF reader stable when returning from a text-only comparison.
- Preserve the displayed Changes PDF when clearing older builds, and keep partially completed debug-log writes inspectable and removable.
- Preserve newer pasted drafts during a pending save and reconcile partial context writes without leaving an undisclosed saved copy.
- Retain recorded reasons for small repeated-word corrections and deletions at paragraph boundaries; protect accent and line-break arguments from unsafe revision markup.
- Verify cached PDF contents before viewing, reuse and export; reuse source plans and cancel obsolete comparison work without cancelling a newer operation.

- Preserve newly edited alternative drafts through selection Undo/Redo, protect saved feedback batches after storage errors, and discard delayed PDF navigation when the viewer closes.

## 1.2.1 — PDF viewing and comparison reliability

- Keep PDF reading stable at fit width and preserve the selected change, open explanation and reading position during Changes PDF refreshes.
- Use a compact viewer toolbar and bottom explanations. Reasons appear first; exact LaTeX comparisons expand on request, and margin buttons appear with **Why?**.
- Route Find to the active PDF or Text diff view, and avoid doing hidden text-diff work.
- Show ordinary prose edits alongside source comments, theorem/proof structure and unchanged equations. Use exact comparison destinations, preserve existing `ulem` options, and explicitly omit unsafe command arguments or grouped content.
- Reuse unchanged comparison results after checking their inputs. Refresh still requests Sol; **Build locally without Sol** and a clearly labeled local result keep comparisons usable when Sol analysis fails.
- Offer editable review presets adapted from Kevin Bryan's ModernEditor and a smallest-local-edits option.
- Tighten Sol arrangement validation, make paused reason recording visible, and improve bounded debug-record cleanup.

## 1.2.0 — Text viewer, Changes PDF and proposal previews

- Open UTF-8 `.txt` files and LaTeX fragments in Text mode, with the comment queue and a live text diff. Compare with Session start or an older version; Save keeps the baseline fixed.
- **Preview** displays a tentative text diff or a compiled proposal PDF with its own passage highlight. Source, comment decisions and Undo remain unchanged; Return to draft restores the ordinary view. Changes to source, proposals or compilation inputs make the PDF visibly out of date.
- **Changes PDF** compares the draft with a fixed source baseline. Choose Revision markup (struck deletions and underlined additions) or Clean paper (revised wording with numbered markers). Both share compact navigation and expandable before/after explanations. Switching styles makes no further model request.
- Opening Changes PDF starts GPT-6 Sol arrangement, with updates after five accepts by default, Save or Refresh. The agent can request a visual check. Exact source is inserted by ordinary code; every change is shown or explicitly listed as not shown. Accepted-edit reasons are retained in an optional local journal.
- Unsupported previews stop with **Preview not possible**; Text diff remains available. Proposal and comparison PDFs stay separate from the ordinary paper PDF.
- **Add preamble…** makes one checked, undoable attempt while preserving the text body. Undo restores Text mode. Wrapped `.txt` drafts can be exported as LaTeX copies.
- The editor installs an exact pinned Codex CLI with its locked dependencies. Desktop/global Codex updates no longer change that copy; explicit custom executable settings remain available.
- Optional debugging records prompts, replies and editor screenshots locally, with a bounded register and deletion controls. It is off by default.
- Author and original ModernEditor credits appear in the app. Viewer hiding, Compare → View navigation and divider visibility in narrow layouts are corrected.

## 1.1.0 — Reading and review stability

- Support tested Codex CLI 0.155.0-alpha.9.2, with its goal tools explicitly disabled and the existing review restrictions retained.
- Choose GPT‑6 Sol, GPT‑6 Luna or another available model in Settings. The selector reads the installed CLI’s catalog; model, effort, Fast mode and screenshot support are checked before sending a request.
- Compact Source/PDF tabs beside Comments, plus six workspace views that retain edits, Undo, and reading positions.
- Fixed comment navigation and decisions, compact editable replacements, remembered Changes visibility, and exact before/after blocks for longer rewrites.
- A quieter amber PDF marker with a constant-width margin bar, one-time emphasis, and preserved selection, search, zoom and manual scrolling. Clear current, earlier, candidate and unverified PDF labels.
- Background PDF validation yields to explicit compilation. Switching papers clears the displayed Codex context.
- Failed Side Chat saves remain visible across papers, with retry, copy and deliberate discard that preserve saved history.
- Package insertion and PDF navigation recognize commented examples and spaced document openings. Codex connection metadata uses the actual editor version.

## 0.3.2 — Faster acceptance and Close project

- Support the tested Codex CLI 0.155.0-alpha.2.6 for reviews and Codex Side Chat, retaining the existing configuration, skill and tool restrictions. Other untested versions still require verification.
- **Close project** returns to a clean home screen, preserving source recovery, comments and reading position. Closing a project also clears automatic reopening; opening the paper again restores its saved state.
- **Accept**, **Shift+A** and **Option+Enter** apply a suggestion without compiling and advance to the next comment. **Accept & compile** is a separate button for checking the candidate first. Both remain undoable; Save is separate. **Accept all** continues to compile its combined candidate once.

## 0.3.1 — Codex and SWP compatibility

- Support the tested Codex CLI 0.154.0-alpha.6.2 alongside 0.153.4, retaining the full version and all pre-request restrictions. Setup reports the detected version clearly.
- Large-folder compilation recognizes an unchanged bundled TCI support file, keeps local graphics alternatives for TeX to choose, and tolerates Windows drive fallbacks when local figures resolve on macOS.
- Manuscript contents, build budgets and input freshness checks remain unchanged.

## 0.3.0 — Codex Side Chat

- Prominent review progress in the Comments pane, including section progress and pause/stop controls.
- Hide Comments for more writing space; restore with the source-heading button or Command+2. The choice is saved per paper and background arrivals respect it.
- A smaller secondary action for accepting without compilation; checked acceptance and its shortcuts remain primary.

- A collapsible chat drawer for editor questions, errors, paper discussions and suggestions, available with Command+Shift+H.
- Paste, drop or attach screenshots, with removable/enlargeable thumbnails and image inputs to Codex.
- Inspectable context using bundled guides and the running version; optional paper, comment, diagnostics and reference reading.
- Separate saved conversations for editor help and each paper. Explicit, undoable conversion of answers into review comments; manuscript edits still require acceptance.

## 0.2.1 — Independent tool setup

- Save a Codex or TeX executable path even when the unchanged other tool is unavailable. Changed paths are still validated before saving.
- Update the desktop discussion check for the visible Reject button.

## 0.2.0 — Reading, references and setup

- Continuous PDF reading and text search across the compiled paper.
- Reference folders that Codex can search and read on demand, with a record of sources used.
- Deterministic build preparation for large paper folders: discovery above 50 MB / 500 files, with a 200 MB / 2,000-file cap on required inputs and a reviewed file choice when needed.
- Command+T as an additional compile shortcut, alongside Command+B.
- A visible **Reject** button moves the current comment into History with Undo. Buttons show **Shift+A** for checked acceptance, **Shift+R** for rejection and **Shift+S** for skipping; question **Resolve** remains separate.
- **More → Accept all applicable suggestions** compiles one combined draft for current, exact, nonoverlapping pending replacements and applies the batch with one Undo; questions, stale or overlapping suggestions and Later comments remain for individual review.
- Successful candidates with verified inputs explain acceptance warnings and offer **Apply despite warnings**, with source, suggestion and input freshness checked again before applying.
- **More → Dismiss pending comments** closes the current batch with one Undo, preserving Later comments, history, discussions and later arrivals.
- **Link question to current selection** lets you relink a stale question while keeping its earlier wording; replacement suggestions retain their exact-match requirement.
- Searchable in-app help, a visible editor version and a Copy setup details button for version-only troubleshooting information.

## 0.1.0 — Initial source snapshot

- Local LaTeX editing, compilation and PDF navigation.
- Codex review and per-comment discussion with visible suggested wording and undoable acceptance.
- Saved-version comparison, guarded saves, source backups and recovery.
- Synthetic examples, a short demonstration, Mac setup and user guides.
- MIT licensing, predecessor credit and third-party notices.

This is an experimental source distribution, with no packaged application or installer. See [Setup](docs/SETUP.md) for prerequisites and [Testing](TESTING.md) for development checks. Windows is not yet supported.
