# FAQ and troubleshooting

[Setup](SETUP.md) · [User guide](USER_GUIDE.md) · [Privacy](../PRIVACY.md)

## Does it run on Windows?

Windows is currently unsupported. The application and its save/compile tests need platform changes beyond executable paths. There is no Windows installer or validated WSL workaround. See [Windows status](SETUP.md#windows-status). The current Mac route is a source build, not a signed application download.

## What works without an account or internet?

After installation, editing, prepared sample comments, version comparison, recovery, and compilation with an installed TeX toolchain work locally. AI review, discussion replies, and preamble generation require your own configured Codex CLI and service access. The sample has prepared comments, but no prepared discussion replies.

## Build reports a missing Electron runtime or licence file

Run `node node_modules/electron/install.js` from the repository folder, then rebuild. The pinned Electron version downloads its binary on demand; `npm rebuild electron` alone does not install it. The build needs the runtime's complete licence notices as well as the JavaScript package. Follow the full [installation sequence](SETUP.md#4-install-build-and-launch).

## Codex works in Terminal. Why does the editor fail?

The editor may be launching a different executable. It currently has a fixed default path and no automatic PATH discovery. Check the [Codex setup step](SETUP.md#3-configure-codex-if-you-want-ai-review), authenticate the intended executable, update the source default if needed, and rebuild before restarting.

If the error says **Codex review restrictions could not be verified**, no paper text was sent by that attempt. This build supports CLI **0.153.4** and verifies that inherited MCP servers are disabled before sending the request. Check the executable version and report a synthetic reproduction if that supported version still fails. A maintainer must rerun the configuration probe and review compatibility before enabling another version; removing the guard is not a setup fix. The check does not change your saved Codex settings.

If the error names an unsupported effort, choose an effort listed as supported in that error. If Fast mode was refused, turn **Fast mode** off in Actions or check the model's access before retrying. The app reports an unsupported setting instead of silently substituting one. Authentication details belong in your own CLI configuration, never in a paper or shared bug report.

## What do effort, Fast mode, and answer length mean?

**Actions → Codex effort** offers Quick (`low`), Standard (`medium`), Deep (`high`), and Max (`max`). These request different reasoning efforts from the configured model; they do not promise a fixed thinking time or answer length. The choice is saved per paper. **Think more** requests Deep/high effort, retaining Max if already selected.

**Fast mode** separately requests faster service at increased usage, when the model/account supports it. It does not lower effort or change the selected model. Ask for “three concise comments” or “a shorter explanation” in your instructions when you want a shorter answer. Changing effort is not a verbosity control.

## Why did a whole-document review miss an included section?

The editor reviews the opened root file or the selected passage. It does not expand the contents of `\input` or `\include` files into the AI request. Check the request heading and context preview. A separate source file can be opened and reviewed on its own; compiling a fragment may need the original root's preamble and dependencies. Attaching PDFs or other files as AI context is planned, not available yet.

## Can I import comments from elsewhere?

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

## Why is acceptance disabled, or why did its compile check fail?

Acceptance is blocked if the original passage is missing, ambiguous, or needs confirmation. Select the exact original words in the intended place and choose **Attach to selected text**, or request a fresh review if you have rewritten them.

**Accept and next** checks the candidate before changing the draft. Detected unresolved references, missing glyphs, or unverified build inputs can prevent checked acceptance even if TeX produced a PDF. Inspect **Build details**. **Accept without compiling** is a separate deliberate action that skips the build check, while retaining source-placement guards. Both actions change the editor buffer; Save is separate. Neither compilation nor a Codex review establishes mathematical correctness.

## Why is the PDF old or not jumping to my comment?

Typing and unchecked acceptance do not automatically compile. An **Older PDF** reflects an earlier source snapshot. Unchanged passages can still be located when matching is unambiguous; changed passages may require **Compile and show**. A failed build preserves the previous successful PDF.

Open the PDF and check **PDF follows comments** in Actions. Automatic following leaves a hidden preview closed and pauses for candidate previews. Uncertain comment placement needs confirmation first. Preamble text, comments, and some macro-generated material have no useful typeset location; try nearby prose. The current viewer shows one page at a time and has no PDF search or reverse PDF-to-source navigation.

## A compile fails on this machine. What should I check?

1. Try compiling the synthetic sample. If that also fails, check the MacTeX executable path and installation in [Setup](SETUP.md).
2. Check **LaTeX engine** in Actions and read **Build details → Full build output**. Select source-line diagnostics to find the problem where available.
3. Keep bibliography files, figures, and local styles in the paper folder with relative paths. Linked or external project resources need a self-contained copy. The app disables shell escape and `latexmkrc` startup scripts, so workflows that require them need another compilation route or an adjusted paper.
4. Supply missing packages, fonts, and custom definitions. A pasted paragraph can use **Add preamble and compile**, but source-body errors or conflicting existing definitions can require manual work.

`tcilatex.tex` is bundled for Scientific Word/WorkPlace source and supplied inside build snapshots when the paper has no root-level copy. This does not convert Windows graphics paths, BMP figures, or Scientific Word graphics specials. A working Mac compile does not establish a Windows/SWP round trip.

## Does Save happen automatically?

**Save writes the `.tex` file.** Automatic recovery stores the unsaved buffer separately; comments, proposals, and discussion are also saved separately. Compile can use unsaved text. Recovery writes can be delayed or fail on slow or unavailable storage, so they are an additional safeguard rather than a replacement for Save and ordinary backups.

**Use this wording** changes only the proposal. **Accept** changes the draft. **Save** writes the source. These are separate steps.

## Where is my new draft?

In this development version, **New blank draft**, **New draft**, and the sample create paper copies under `.runtime/papers/` inside the editor checkout. Ordinary Save keeps writing that location. Preserve `.runtime/` when replacing or updating the checkout.

To place the source elsewhere, use **Actions → Export source…**, choose a new filename, and then **Open paper…** to open that exported copy. Export never overwrites an existing file and does not switch the current document. It exports only source, not comments, bibliography, figures, or saved versions. The original draft and its review remain in their original location.

## Where are comments and previous versions stored?

Each `.tex` filename has its own state under `.modern-editor/documents/<document-id>/` beside the paper. It includes `review.json`, settings, reading state, recovery, comparison baselines, and source backups. Comments are never inserted into the LaTeX. Different root files in one folder can coexist; a renamed copy starts with separate state. Moving the whole folder with its hidden `.modern-editor` folder preserves that state.

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

The target does not cover comments, recovery archives, comparison archives, or PDF build caches. **Actions → Clear older builds** removes eligible app-marked compilation caches; another paper may need compiling again afterward. It preserves source and source-recovery records. Do not delete `.runtime/` as a general cleanup step: it can contain drafts.

If Save reports that version history needs attention, the source was saved but history maintenance is paused. Keep the affected metadata and backups for inspection; automatic pruning and manual version deletion stop while protection records cannot be verified. Repeated unchanged Saves reuse a recovery archive as well as a source backup.

## How should I report a problem?

Include the operating system, editor commit if known, Node/Codex/TeX versions, the exact action and error, and whether the synthetic sample reproduces it. A small synthetic `.tex` example is most useful. Inspect logs, screenshots, and `.modern-editor` records before sharing: they may contain source, discussion, or local paths. Do not include authentication tokens or account configuration. The [testing guide](../TESTING.md) separates offline checks from optional live Codex requests.
