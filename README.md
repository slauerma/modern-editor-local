# Modern Codex Editor

A local desktop editor for LaTeX source, compiled PDF reading, and Codex-assisted review. It uses Electron, React, CodeMirror, and PDF.js.

**Version 0.2.1.** Help, Settings and the native About window show the editor version. See the [changelog](CHANGELOG.md) for this release's features.

This is a personal project, kept lean for individual use. **macOS is the currently validated platform. Windows is not yet supported.** The repository contains development source; there is no packaged application or installer.

## Start here

- [Install and run on a Mac](docs/SETUP.md): repository access, prerequisites, executable paths, first launch, and safe updates.
- [User guide and shortcuts](docs/USER_GUIDE.md): review a paper, accept or discuss suggestions, follow comments in the PDF, and compare versions.
- [FAQ and troubleshooting](docs/FAQ.md): saved files, recovery, Codex connection problems, compilation, and current limitations.
- [Privacy and local data](PRIVACY.md) · [Developer tests](TESTING.md).

These Markdown guides can be read locally without an account or internet connection. The same guides are available through **Actions → Help and shortcuts**, with local search.

## Overview

Open a root `.tex` file, review a selection or document, discuss comments, and inspect proposed replacements before applying them. The editor can compile a candidate before accepting it, preserve the last successful PDF after a failed compile, compare saved versions, and export source recovery to a new file. Discussion replies show their proposed source changes beside the explanation. Scroll continuously through the PDF or search its text. You can also convert outside feedback into comments and attach reference files or folders that Codex can consult during reviews and discussions.

[Watch the short demonstration](demo/modern-editor-demo.mp4) · [Demo credits](demo/README.md).

## Install and run on Mac

Use Node.js 24 LTS with npm, full MacTeX, and Codex CLI **0.153.4** authenticated with your own account for AI features. The minimum Node version is 22.18. Follow the [setup guide](docs/SETUP.md) before building. **Actions → Settings and Check setup** lets you choose the installed executables and check their versions.

From the repository folder containing `package.json`:

```sh
npm ci --ignore-scripts
npm rebuild esbuild
node node_modules/electron/install.js
npm run build
npm start
```

The rebuild step prepares esbuild. The explicit Electron installer downloads or retrieves the pinned platform runtime and its licences. The build is local and writes `dist/`. `npm start` launches the desktop application without an HTTP server.

After the first build, `npm start` launches the editor again. **Try the working sample** provides prepared comments without calling Codex; compilation needs TeX. **Command+T** or **Command+B** compiles the current draft. **Shift+A** accepts after a compilation check and **Shift+S** skips while focused on the comments controls, outside typing fields. See the [shortcut reference](docs/USER_GUIDE.md#keyboard-shortcuts-on-mac).

For troubleshooting, **Settings → Copy setup details** copies editor, operating system, Codex and TeX versions with check status. It excludes paper text, file paths and account details.

The editor stores document recovery, reviews, paper settings, and saved source versions in a `.modern-editor` folder beside the paper. Application state and build snapshots live outside the checkout, in the OS application-data folder. **New draft asks where to save the paper.** Existing managed drafts are copied from legacy `.runtime/` storage with verification; originals are preserved. Export source creates a new source-only file; open that copy to continue working there. See [PRIVACY.md](PRIVACY.md) and the [recovery FAQ](docs/FAQ.md#how-do-i-recover-after-a-crash-or-an-external-edit).

## Development and licensing

[TESTING.md](TESTING.md) describes type checking, unit tests, real-TeX integration, and desktop checks, including their validation limits.

[Contributing](CONTRIBUTING.md) · [Security reporting](SECURITY.md) · [Changelog](CHANGELOG.md).

Apart from the demonstration MP4, the repository contains text source. `scripts/build.mjs` bundles the application; `src/main` handles local files, compilation, and Codex; `src/renderer` implements the interface; `src/shared` defines contracts and pure review logic. The bundled Scientific Word support file retains its original redistribution notice; see [its provenance](resources/tex-support/README.md).

The project source and original documentation use the [MIT license](LICENSE). We acknowledge [Kevin Bryan's original ModernEditor (July 2025)](https://github.com/kevincure/ModernEditor) and the subsequent [Modern-Editor-w-Import](https://github.com/slauerma/Modern-Editor-w-Import) browser port as earlier work in this editor's history. See [third-party notices and the preserved predecessor credit](THIRD_PARTY_NOTICES.md).

The build writes `dist/licenses/`, including Electron/Chromium notices from the installed runtime. Preserve these notices with distributed builds. Full collected npm license texts are included in the source checkout; refresh them with `npm run notices` when changing dependencies.
