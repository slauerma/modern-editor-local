# Modern Codex Editor

A local desktop editor for LaTeX source, compiled PDF reading, and Codex-assisted review. It uses Electron, React, CodeMirror, and PDF.js.

[Watch the quick overview or the 50-second Changes PDF demonstration](demo/README.md).

**Version 1.6.0.** Help, Settings and the native About window show the editor version. See the [changelog](CHANGELOG.md) for this release's features.

This is a personal project, kept lean for individual use. **macOS is the currently validated platform. Windows is not yet supported.** The repository contains development source; there is no packaged application or installer.

## Start here

- [Install and run on a Mac](docs/SETUP.md): repository access, prerequisites, executable paths, first launch, and safe updates.
- [User guide and shortcuts](docs/USER_GUIDE.md): review a paper, accept or discuss suggestions, follow comments in the PDF, and compare versions.
- [PDF review mode](docs/USER_GUIDE.md#pdf-review-mode): inspect the whole proposed revision in two PDFs, with a popup comment inspector and section decisions.
- [Import comments from Astra Pro or another reviewer](docs/USER_GUIDE.md#import-prepared-comments): prepare JSON, load it locally, and review each suggestion. Includes a [ready-to-use prompt](docs/USER_GUIDE.md#generate-comment-json).
- [FAQ and troubleshooting](docs/FAQ.md): saved files, recovery, Codex connection problems, compilation, and current limitations.
- [Privacy and local data](PRIVACY.md) · [Developer tests](TESTING.md).

These Markdown guides can be read locally without an account or internet connection. The same guides are available through **Actions → Help and shortcuts**, with local search.

## Overview

Open a `.tex` or `.txt` file, import prepared comments or request a review, then inspect each suggestion before applying it. **Accept** changes the working draft; **Save** writes the source file. Previewing or exporting a proposal does not accept it.

- **Source and comments:** read a contextual inline diff, switch to clean wording, edit or discuss a suggestion, and choose among saved alternatives. Text fragments have a live text diff; complete LaTeX papers also have a compiled PDF.
- **Changes PDF:** compare the draft with a fixed baseline using struck deletions and underlined additions, or a clean paper with change markers. The workspace comparison prepares a local PDF, then requests GPT-6.1 Sol explanations. A local-only option is available.
- **PDF mode:** choose **View → PDF mode** to preview the whole proposed revision, with Changes on the left and Proposed or Original on the right. Click a change to inspect, edit, accept or reject it in a popup. Bulk acceptance checks compilation, including a batch of one. Routine preview updates are local; Sol refinement is optional.
- **Context and guidance:** import [comment JSON](docs/USER_GUIDE.md#import-prepared-comments) directly, convert outside prose feedback with Codex, or attach references and large pasted text. Paper instructions and minimal-edit preferences are shared across reviews and discussions. Side Chat is a movable, resizable panel with its own Model, Effort and Speed controls, optional screenshots, inspectable context and batches of comments. Add individually without closing chat, or add all and review. **Discuss this** carries a chosen suggestion into a follow-up even when a large batch needs a compact history index.
- **Reading and recovery:** jump between LaTeX and PDF with Command-click, return with Back, search headings and labels in Outline, scroll or search PDFs, preserve the last successful PDF after a failed build, compare saved versions, and export source recovery. **View → Classic view** offers a cream writing surface with bottom suggestions. **Actions → Files & history…** gathers saved state, context and named PDF exports.

PDF mode shares the workspace's source, comments, Save and Undo. Its Original snapshot lasts for the open paper session. Exports can contain tentative or removed text; live comment controls and tentative gray shading remain in the editor. See the [PDF mode guide](docs/USER_GUIDE.md#pdf-review-mode) for session behavior and limitations.

[Watch the 55-second overview](demo/2026-09-28/modern-editor-overview-55s.mp4) · [Three-minute walkthrough, downloads and credits](demo/README.md). These 28 September recordings show the three-column workspace. The current guide covers later additions, including two-PDF review, floating Side Chat and two-way PDF/source navigation.

## Install and run on Mac

Use Node.js 24 LTS with npm, full MacTeX, and your own Codex account for AI features. The locked dependencies install a separate **Codex CLI 0.160.1** for the editor; no Codex desktop app or global CLI is required. The minimum Node version is 22.18. Follow the [setup guide](docs/SETUP.md) before building. **Actions → Settings and Check setup** lets you choose the installed executables and check their versions.

From the repository folder containing `package.json`:

```sh
npm ci --ignore-scripts
npm rebuild esbuild
node node_modules/electron/install.js
npm run build
npm start
```

For AI review, run `npm run codex:login` once if you are not already signed in. Keep **Editor-managed CLI** in Settings; desktop Codex updates do not change it. See [Codex setup](docs/SETUP.md#3-configure-codex-if-you-want-ai-review).

The rebuild step prepares esbuild. The explicit Electron installer downloads or retrieves the pinned platform runtime and its licences. The build is local and writes `dist/`. `npm start` launches the desktop application without an HTTP server.

After the first build, `npm start` launches the editor again. **Try the working sample** provides prepared comments without calling Codex; compilation needs TeX. **Command+T** or **Command+B** compiles the current draft. **Accept** or **Shift+A** applies without compiling and advances; **Accept & compile** checks compilation first. **Shift+S** skips. Review shortcuts work while focused on the comments controls, outside typing fields. See the [shortcut reference](docs/USER_GUIDE.md#keyboard-shortcuts-on-mac).

For troubleshooting, **Settings → Copy setup details** copies editor, operating system, Codex and TeX versions with check status. It excludes paper text, file paths and account details.

The editor stores document recovery, reviews, paper settings, and saved source versions in a `.modern-editor` folder beside the paper. Application state and build snapshots live outside the checkout, in the OS application-data folder. **New draft asks where to save the paper.** Existing managed drafts are copied from legacy `.runtime/` storage with verification; originals are preserved. Export source creates a new source-only file; open that copy to continue working there. See [PRIVACY.md](PRIVACY.md) and the [recovery FAQ](docs/FAQ.md#how-do-i-recover-after-a-crash-or-an-external-edit).

## Development and licensing

[TESTING.md](TESTING.md) describes type checking, unit tests, real-TeX integration, and desktop checks, including their validation limits.

[Contributing](CONTRIBUTING.md) · [Security reporting](SECURITY.md) · [Changelog](CHANGELOG.md).

Apart from the demonstration videos and posters, the repository contains text source. `scripts/build.mjs` bundles the application; `src/main` handles local files, compilation, and Codex; `src/renderer` implements the interface; `src/shared` defines contracts and pure review logic. The bundled Scientific Word support file retains its original redistribution notice; see [its provenance](resources/tex-support/README.md).

The project source and original documentation use the [MIT license](LICENSE). We acknowledge [Kevin Bryan's original ModernEditor (July 2025)](https://github.com/kevincure/ModernEditor) and the subsequent [Modern-Editor-w-Import](https://github.com/slauerma/Modern-Editor-w-Import) browser port as earlier work in this editor's history. See [third-party notices and the preserved predecessor credit](THIRD_PARTY_NOTICES.md).

The build writes `dist/licenses/`, including Electron/Chromium notices from the installed runtime. Preserve these notices with distributed builds. Full collected npm license texts are included in the source checkout; refresh them with `npm run notices` when changing dependencies.
