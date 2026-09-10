# Third-party notices and acknowledgements

The project's original source code and documentation are licensed under the [MIT license](LICENSE). Third-party material keeps its own copyrights and license terms. The MIT license does not replace the notices below.

## Earlier ModernEditor work

We acknowledge **Kevin Bryan's original ModernEditor (July 2025)** and the subsequent **Modern-Editor-w-Import** browser port as earlier work in this editor's history:

- [Original ModernEditor by Kevin Bryan](https://github.com/kevincure/ModernEditor/tree/ba8839833de51fc1d2d99847fc390e0faebd8936). Its README identifies Kevin Bryan, July 2025, and MIT licensing.
- [Modern-Editor-w-Import](https://github.com/slauerma/Modern-Editor-w-Import/tree/6502dd6171ade2f593722b4b680b33bc085dbee5). Its README credits "Original: Kevin Bryan (July 2025)" and identifies the subsequent port/maintainer. Its complete MIT notice, including both copyright holders, is preserved in [licenses/modern-editor-predecessor-MIT.txt](licenses/modern-editor-predecessor-MIT.txt).

This acknowledgement records the project's history. This repository contains the new Electron implementation; it does not import the predecessor's Git history or publish the predecessor's browser application. If predecessor material is copied into a later revision, retain its complete existing MIT notice.

## JavaScript dependencies and Electron

[THIRD_PARTY_LICENSES.txt](THIRD_PARTY_LICENSES.txt) contains the original license and notice texts supplied by the installed npm packages. It includes copyright lines and full terms, rather than only license names. [licenses/dependencies.json](licenses/dependencies.json) records every locked package's exact version and declared license, whether it was installed for this verification, and the source paths and hashes of collected notices.

| Component | Version | Terms and role |
| --- | --- | --- |
| Electron | 42.11.2 | MIT for Electron itself; its Chromium, Node.js and other bundled components have additional terms in the runtime's notices. |
| React / React DOM | 18.3.1 | MIT; interface rendering. Scheduler and related dependency notices are included. |
| CodeMirror and Lezer | Exact component versions in the inventory | MIT; source editing, syntax and comparison. Helper dependency notices are included. |
| PDF.js (`pdfjs-dist`) | 6.3.289 | Apache-2.0; PDF rendering and worker. |
| Zod | 3.25.76 | MIT; input validation. |
| Vite / esbuild / Rollup | 7.3.6 / 0.28.2 / 4.63.1 | MIT and their bundled third-party terms; build tools. Vite's module-preload helper can appear in output. |
| TypeScript | 5.9.3 | Apache-2.0 plus its supplied third-party notices; development tool. |

Other development and transitive dependencies are covered by the inventory and collected texts. Some optional packages target other operating systems and are not installed here; they are identified as such, not represented as inspected binaries.

The source repository does not distribute `node_modules`, Electron binaries or compiled application bundles. Electron installation supplies `node_modules/electron/dist/LICENSE` and `node_modules/electron/dist/LICENSES.chromium.html`. The build copies both files **verbatim** into `dist/licenses`, together with the project license, these notices and the collected npm texts. Keep that directory with any distributed build. Keep Electron's original runtime notices with the runtime as well. Use the notices from the exact runtime version and platform being distributed; Electron's MIT text alone does not cover Chromium and all bundled components.

The installed `@electron-internal/extract-zip` package declares BSD-2-Clause but supplies no separate license file. The installed platform-specific esbuild, Rollup and canvas helper packages also have no separate notice file and declare MIT; their parent packages' supplied notices are included. These install/build helpers and native canvas binaries are not copied into this application build or source repository. If a future release distributes those binaries or additional dependencies, collect the corresponding upstream and bundled-component notices before distribution.

PDF.js ships additional notices for Adobe CMaps, Foxit and Liberation fonts, WebAssembly image/color helpers and ICC profiles. The collector preserves these in full for reference, including Liberation's GPL terms and font exceptions. The current build uses PDF.js JavaScript, CSS, worker and referenced UI assets; it does not copy those additional CMap/font/WASM/ICC directories. Retain their notices if those assets are added later.

To refresh after changing dependencies, install the locked versions, run `npm run notices`, inspect the generated diff and rerun the build. The collector makes no network requests and does not copy dependency code or binaries. Do not substitute this macOS inventory for the notices of a different packaged runtime.

## Scientific Word / Scientific WorkPlace macros

`resources/tex-support/tcilatex.tex` retains **Copyright (C) 2005 Mackichan Software, Inc.** Its header states that the macro file is not proprietary and may be freely copied and distributed. It is included unchanged under that original notice, not relicensed as project-authored MIT code. See [the support-file provenance](resources/tex-support/README.md).

## External tools and demonstration

Codex and the TeX toolchain are separate prerequisites. Their software, account credentials and service rights are not distributed by this repository. No affiliation or endorsement by their providers is implied.

Demo narration generated with ElevenLabs. Background music created for this demonstration. The project’s source-code MIT license does not grant rights to third-party voices, trademarks, or services.
