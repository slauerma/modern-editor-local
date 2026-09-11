# FAQ and troubleshooting

[Setup](SETUP.md) · [User guide](USER_GUIDE.md) · [Privacy](../PRIVACY.md)

## Does it run on Windows?

Windows is currently unsupported. The application and its save/compile tests need platform changes beyond executable paths. There is no Windows installer or validated WSL workaround. See [Windows status](SETUP.md#windows-status). The current Mac route is a source build, not a signed application download.

## What works without an account or internet?

After installation, editing, prepared sample comments, version comparison, recovery, Help, PDF reading/search, local reference previews, and compilation with installed TeX work locally. AI review, discussion, preamble generation, and conversion of outside feedback require your configured Codex service. The sample has prepared comments, but no prepared discussion replies.

## Build reports a missing Electron runtime or licence file

Run `node node_modules/electron/install.js` from the repository folder, then rebuild. The pinned Electron version downloads its binary on demand; `npm rebuild electron` alone does not install it. The build needs the runtime's complete licence notices as well as the JavaScript package. Follow the full [installation sequence](SETUP.md#4-install-build-and-launch).

## Codex works in Terminal. Why does the editor fail?

The editor may be launching a different executable. Open **Settings** with **Command+,**, choose that same absolute path, run **Check setup**, and **Save settings**. Authenticate the executable separately as described in [Codex setup](SETUP.md#3-configure-codex-if-you-want-ai-review). Path changes need no rebuild; a successful version check does not establish sign-in or account access.

If the error says **Codex review restrictions could not be verified**, no paper text was sent by that attempt. This build supports CLI **0.153.4** and verifies that inherited MCP servers are disabled before sending the request. Check the executable version and report a synthetic reproduction if that supported version still fails. A maintainer must rerun the configuration probe and review compatibility before enabling another version; removing the guard is not a setup fix. The check does not change your saved Codex settings.

If the error names an unsupported effort, choose an effort listed as supported in that error. If Fast mode was refused, turn **Fast mode** off in Actions or check the model's access before retrying. The app reports an unsupported setting instead of silently substituting one. Authentication details belong in your own CLI configuration, never in a paper or shared bug report.

## Can I ask about an error or the paper with a screenshot?

For questions about the editor, errors, or a paper, open **Help me** (**Command+Shift+H**). It supports screenshots and optional error context. See the [chat guide](USER_GUIDE.md#ask-help-me-about-the-editor-or-paper). The ordinary searchable **Help** works offline; **Help me** calls Codex when you send a question. In paper conversations it uses that paper's effort/Fast settings; editor-only help uses Standard effort with Fast mode off.

## What do effort, Fast mode, and answer length mean?

**Actions → Codex effort** offers Quick (`low`), Standard (`medium`), Deep (`high`), and Max (`max`). These request different reasoning efforts from the configured model; they do not promise a fixed thinking time or answer length. The choice is saved per paper. **Think more** requests Deep/high effort, retaining Max if already selected.

**Fast mode** separately requests faster service at increased usage, when the model/account supports it. It does not lower effort or change the selected model. Ask for “three concise comments” or “a shorter explanation” in your instructions when you want a shorter answer. Changing effort is not a verbosity control.

## Why did a whole-document review miss an included section?

The editor reviews the opened root file or the selected passage. It does not expand `\input` or `\include` automatically. Open a separate source file to review it directly, or use **Attach context…** to include selected reference excerpts. Attached source is context; comments still target the opened source. Check the request heading and preview.

## Can I import comments from elsewhere?

For unstructured notes, choose **Actions → Import outside feedback…**, paste the feedback, and inspect **Preview request**. **Turn into comments with Codex** saves the raw feedback first, then asks Codex to evaluate it and propose source-linked comments. Inspect the result and choose **Add selected comments**; this changes the review, not the manuscript. Failed attempts and unmatched advice remain available under Saved feedback. See the [outside-feedback guide](USER_GUIDE.md#turn-outside-feedback-into-comments).

Use **Actions → Import JSON…** for a JSON object with a `comments` array, or a bare array of comments. A simple example is:

```json
{
  "comments": [{
    "id": "clarity-1",
    "title": "Shorten the sentence",
    "explanation": "Remove the unnecessary lead-in.",
    "original": "It follows that the allocation is monotone.",
    "replacement": "The allocation is monotone.",
    "packages": []
  }]
}
```

The `original` must match the source exactly; `before` and `after` text can disambiguate repeated passages. A `null` replacement is an author question; an empty string proposes deletion. JSON requires LaTeX backslashes to be escaped as `\\`. The [synthetic review fixture](../fixtures/sample/review.json) shows a fuller record tied to its sample paper. If an imported record specifies `rootFile`, it must name the open file; a different `sourceHash` requires placement confirmation. Import does not accept suggestions or overwrite the source.

## How do local attachments work?

Use **Attach context… → Add reference folder…** or **Add reference files…**. The locations are remembered per paper. During a review or discussion, Codex can search and read eligible references as needed. **Sources used…** shows returned excerpts and search coverage. You can disable or remove a reference without deleting its files. Attaching is local; relevant text is sent to the configured service when Codex reads it during your request.

Up to 12 reference locations can be remembered. Reading uses at most 40 tool calls and 120,000 UTF-8 bytes of tool results per request. Folder inventory is limited to 100 eligible files, 500 entries and three nested levels; incomplete inventories are labelled. Hidden, linked, generated, sensitive-name and unsupported items are excluded. PDFs must be at most 20 MB and text files at most 2 MB. PDF searches cover 20 pages per call with a continuation; text extraction can miss scans or mathematical detail. There is no OCR or figure interpretation.

**Choose exact excerpts (optional)** retains the earlier page/line preview controls: up to eight files, 48,000 characters in total and 12,000 per file. These optional selections are session-only. They do not restrict additional reading from separately enabled remembered references; disable those locations when you want only the exact excerpts sent.

## Why does compilation ask about the paper folder?

Above **50 MB or 500 files**, a deterministic local dependency check identifies the required inputs so unrelated archives need not be copied. The actual input cap is **200 MB / 2,000 files**, including explicit selections. If filenames are computed or ambiguous, **Prepare Codex request…** shows a bounded request preview and **Ask Codex to help** explicitly sends it. Inspect the proposed list before **Compile selected files**. Unknown or unsafe paths are rejected, and unresolved dependency commands prevent checked acceptance even if a PDF is produced. If the required inputs exceed the cap, reduce those resources or use another compilation route. See [large-folder compilation](USER_GUIDE.md#compile-a-paper-in-a-larger-folder).

## Can I accept several suggestions together?

Choose **More → Accept all applicable suggestions (N)** in the Comments pane. The count includes pending, current replacements that match the source exactly and do not overlap. Questions, stale or ambiguous suggestions, overlapping proposals and Later comments stay for individual review. The editor compiles the combined draft once before applying the eligible batch. One Undo restores its source changes and review decisions; Save remains separate. A candidate with warnings may pause for the explicit override described below.

## What is the difference between Reject, Skip and Resolve?

**Reject** or **Shift+R** moves the current comment into History without changing the source; Undo restores it. **Skip** or **Shift+S** advances while leaving the comment pending. **Resolve** separately records that you have addressed an author question. **Accept and next** or **Shift+A** applies a suggestion after its compile check. The buttons show these key hints; the shortcuts work from comment controls outside typing fields. **Option+Backspace** still rejects a suggestion or resolves an author question.

## How do I dismiss pending comments together?

In the Comments pane, choose **More → Dismiss pending comments**. This closes the current pending batch without changing the source. Later comments, existing history and discussions are retained. One Undo restores the batch; comments arriving afterward retain their own status through Undo and Redo. You can also reopen individual dismissed comments from History.

## A question refers to wording I have rewritten

Select the current passage and choose **Link question to current selection** on the question card. It preserves **Earlier wording** and the discussion, shows the newly linked passage, and can be undone without changing the source. Earlier proposed alternatives remain readable; a fresh proposal is needed for the new passage. You may instead discuss or resolve the question as it stands.

This action is available only for questions without a replacement. Replacement suggestions still require the exact original words before **Attach to selected text** can enable acceptance.

## Why is acceptance disabled, or why did its compile check fail?

Acceptance is blocked if the original passage is missing, ambiguous, or needs confirmation. Select the exact original words in the intended place and choose **Attach to selected text**, or request a fresh review if you have rewritten them.

**Accept and next** and **Accept all applicable suggestions** check the candidate before changing the draft. A successfully generated PDF can still have undefined citations or references, duplicate labels, or missing characters (glyphs). The editor explains these acceptance warnings and preserves the unchanged draft while you inspect **View candidate PDF** and **Build details**.

When compilation succeeded and its inputs are verified, **Apply despite warnings** lets you apply the checked candidate deliberately. It rechecks the source, suggestions and compilation inputs before applying; changed state requires another compile. Failed compilation and unverified inputs never offer this override. The warning check does not compare against an earlier build, so it may pause for warnings that already existed before the suggestions.

**Accept without compiling** remains a separate action for an individual suggestion. It skips the build check while retaining source-placement guards. Acceptance changes the editor buffer and is undoable; Save is separate. Neither compilation nor a Codex review establishes mathematical correctness.

## Why is the PDF old or not jumping to my comment?

Typing and unchecked acceptance do not automatically compile. An **Older PDF** reflects an earlier source snapshot. Unchanged passages can still be located when matching is unambiguous; changed passages may require **Compile and show**. A failed build preserves the previous successful PDF.

Open the PDF and check **PDF follows comments** in Actions. Automatic following leaves a hidden preview closed and pauses for candidate previews. Uncertain comment placement needs confirmation first. Preamble text, comments, and some macro-generated material have no useful typeset location; try nearby prose. Clicking from PDF back to source is not implemented.

## How do I read or search several PDF pages?

Scroll continuously through the PDF, or use its page field and arrows. **Find** searches the text of the displayed PDF. Enter/down goes to the next highlighted match; Shift+Enter/up goes back. Escape closes search. Older and candidate PDFs are labelled and search their own contents.

Matches arrive while pages are indexed. **Stop** pauses indexing; **Continue indexing** resumes. Search reports incomplete results and limits: up to 1,000 pages, five million extracted characters, and 2,000 matches. Narrow the query if needed. The reader supports up to 5,000 pages. Images and scanned text are not searched, and PDF extraction may not preserve mathematical notation or reading order exactly.

## A compile fails on this machine. What should I check?

1. Try compiling the synthetic sample. If that also fails, check the MacTeX executable path and installation in [Setup](SETUP.md).
2. Check **LaTeX engine** in Actions and read **Build details** and its build output. The displayed output is bounded and may omit earlier lines. Select source-line diagnostics to find the problem where available.
3. Keep bibliography files, figures, and local styles in the paper folder with relative paths. Linked or external project resources need a self-contained copy. The app disables shell escape and `latexmkrc` startup scripts, so workflows that require them need another compilation route or an adjusted paper.
4. Supply missing packages, fonts, and custom definitions. A pasted paragraph can use **Add preamble and compile**, but source-body errors or conflicting existing definitions can require manual work.

`tcilatex.tex` is bundled for Scientific Word/WorkPlace source and supplied inside build snapshots when the paper has no root-level copy. This does not convert Windows graphics paths, BMP figures, or Scientific Word graphics specials. A working Mac compile does not establish a Windows/SWP round trip.

## Does Save happen automatically?

**Save writes the `.tex` file.** Automatic recovery stores the unsaved buffer separately; comments, proposals, and discussion are also saved separately. Compile can use unsaved text. Recovery writes can be delayed or fail on slow or unavailable storage, so they are an additional safeguard rather than a replacement for Save and ordinary backups.

**Use this wording** changes only the proposal. **Accept** changes the draft. **Save** writes the source. These are separate steps.

## Where is my new draft?

**New blank draft** and **New draft** ask you to choose a new `.tex` file outside the editor checkout. Save writes that file. Existing files are never overwritten by the new-paper action.

Samples live in managed application storage outside the checkout. **Settings → Storage and supported Codex version** shows its location. Upgrading an older checkout copies verified managed papers and saved state from its `.runtime/`, preserving the old originals; see [update instructions](SETUP.md#launch-again-or-update).

To place the source elsewhere, use **Actions → Export source…**, choose a new filename, and then **Open paper…** to open that exported copy. Export never overwrites an existing file and does not switch the current document. It exports only source, not comments, bibliography, figures, or saved versions. The original draft and its review remain in their original location.

## Where are comments and previous versions stored?

Each `.tex` filename has its own state under `.modern-editor/documents/<document-id>/` beside the paper. It includes `review.json`, settings, reading state, recovery, comparison baselines, source backups, and saved outside feedback. Comments are never inserted into the LaTeX. Different root files in one folder can coexist; a renamed copy starts with separate state. Moving the whole folder with its hidden `.modern-editor` folder preserves that state.

Back up the paper folder with its dependencies and hidden state. Recovery and discussion files can contain manuscript text, so sharing the whole folder also shares that material. See [Privacy](../PRIVACY.md).

## How do I recover after a crash or an external edit?

Reopening normally restores recoverable unsaved work when its source revision matches. Conflicting recovery records are retained for inspection. If opening fails or versions conflict:

1. Preserve the paper and its `.modern-editor` folder. If the current buffer is visible, use **Export source…** to keep a new copy before reloading anything.
2. Choose **Actions → Recover source…**, select the paper, and inspect the labelled source versions. This is also available without an open paper.
3. Choose the text you need and **Export selected source…** to a new filename. Open and check that file. Recovery does not choose the “newest” version automatically or overwrite the original.

Recovery can inspect readable disk text, session/save records, archived conflicting recovery, and verified source backups. It cannot reconstruct records that were never written or are unreadable. If another editor changed the disk file, normal Save blocks overwriting it; preserve your buffer, inspect the disk version, and use **Reload disk** only once you have accounted for your edits. Undo lasts only for the current session; retained versions and recovery are the routes to earlier text after reopening.

## How do I control storage?

Review records and their complete recovery envelopes have a **32,000,000-byte JSON limit**, including UTF-8 characters, escaping, source text, and metadata. An update that would exceed it is rejected, and discussion history is never silently shortened to fit. Use **Export source…** to preserve your current text if a large review reaches the limit. Oversized or corrupt records may need manual recovery.

In **Compare versions… → Save history…**, expand **Storage for this folder**. The default 50 MB target covers managed automatic source backups across the folder's root documents. Repeated saves of identical text reuse a copy. Lowering the target or a successful Save can prune older unprotected versions. Protected originals, current/previous checkpoints, and versions required for recovery or the pinned baseline can exceed the target. **Delete version…** refuses protected copies.

The target does not cover comments, outside feedback, recovery archives, comparison archives, or PDF build caches. **Actions → Clear older builds** removes eligible app-marked compilation caches; another paper may need compiling again afterward. It preserves source and source-recovery records. Keep application storage and legacy `.runtime/` copies if they contain papers you need.

If Save reports that version history needs attention, the source was saved but history maintenance is paused. Keep the affected metadata and backups for inspection; automatic pruning and manual version deletion stop while protection records cannot be verified. Repeated unchanged Saves reuse a recovery archive as well as a source backup.

## How should I report a problem?

Use **Settings → Copy setup details** for the editor, operating system, Codex and TeX versions with check status. The copied summary excludes manuscript text, file paths and account details; expand **Copied setup details** to inspect it. Help, Settings and the native About window identify the editor version, currently **0.3.0**.

Add the exact action and error, whether the synthetic sample reproduces it, your Node version (`node --version`), and the editor commit if known. A small synthetic `.tex` example is most useful. Inspect logs, screenshots, and `.modern-editor` records before sharing: they may contain source, discussion, or local paths. Do not include authentication tokens or account configuration. The [testing guide](../TESTING.md) separates offline checks from optional live Codex requests.
