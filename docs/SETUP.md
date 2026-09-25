# Installing Modern Codex Editor

This is a **macOS source build**: there is no standalone installer or double-clickable application download. You will use Terminal for installation and launch. Windows is not supported yet.

You need Node.js with npm to run the editor, MacTeX to compile papers, and your own Codex account for AI features. You can try editing and prepared comments without configuring Codex.

## 1. Get the source

Open the public [modern-editor-local repository](https://github.com/slauerma/modern-editor-local). Downloading the source needs no invitation or GitHub account.

- **ZIP:** choose **Code → Download ZIP**, extract it, and keep the folder in a writable location. Git and GitHub CLI are not required.
- **Git:** with Git installed, run:

  ~~~sh
  git clone https://github.com/slauerma/modern-editor-local.git
  cd modern-editor-local
  ~~~

Run all commands below from the folder containing `package.json`. For a ZIP download, open Terminal, type `cd ` (including the space), drag the extracted folder from Finder into Terminal, and press Return. This also handles spaces in the folder name.

## 2. Install Node and TeX

Use **Node.js 24 LTS** with npm from the [official Node download page](https://nodejs.org/en/download). The project's minimum is Node 22.18. Check your installation:

~~~sh
node --version
npm --version
~~~

Install **full MacTeX** using the [official installation instructions](https://tug.org/mactex/mactex-download.html), or use an existing full installation. The editor expects `latexmk`, pdfLaTeX, LuaLaTeX, XeLaTeX, `kpsewhich`, and `synctex` under `/Library/TeX/texbin`. A minimal TeX installation may need additional packages.

Check the main compiler command:

~~~sh
/Library/TeX/texbin/latexmk -norc -v
~~~

## 3. Configure Codex if you want AI review

The source download pins **Codex CLI 0.155.0-alpha.9.2** in `package.json` and `package-lock.json`. Step 4 installs this editor-owned copy under `node_modules`, including the native binary for your Mac. No global Codex installation or desktop app is required. Desktop app updates do not change this copy; CLI upgrades come through a tested editor dependency update.

After installing dependencies in step 4, check the pinned CLI and, if needed, sign in:

~~~sh
npm run codex:version
npm run codex:login
npm run codex:login -- status
~~~

Complete the browser sign-in using your own account. The CLI uses your normal Codex account configuration and cached sign-in; the editor does not copy credentials into the repository. See the [official CLI guide](https://learn.chatgpt.com/docs/codex/cli) and [authentication options](https://learn.chatgpt.com/docs/auth). For device sign-in, use `npm run codex:login -- --device-auth` if your account permits it.

**Settings → Codex installation → Editor-managed CLI** is the default. There is no executable path to paste. Its location follows the current checkout, so a new ZIP folder uses its own locked installation. The former automatic desktop-app path switches to this default when upgrading; explicitly selected custom paths are preserved.

To use another installation, select **Custom executable**, choose its absolute path, then **Check setup → Save settings**. Custom versions must be one of the tested versions: **0.153.4**, **0.154.0-alpha.6.2**, **0.155.0-alpha.2.6** or **0.155.0-alpha.9.2**. An unsupported version stops before paper text is sent. Editing and compilation remain available. Do not remove the version guard to bypass an error.

You can configure Codex and TeX independently. Leave the other path unchanged if that tool is not installed; saving validates the paths you changed. **Check setup** still reports unavailable tools: Codex is needed for AI requests, and TeX for compilation.

Settings also lets you choose a nonstandard **latexmk** path. The compiler expects the TeX engines, `kpsewhich`, and `synctex` beside it. Standard MacTeX supplies these. Check setup reads local executable versions; it does not authenticate or make an AI request. The stricter review checks still run before paper text is sent; do not remove the supported-version guard to bypass an error.

To choose a model, use **Settings → Load models**, select **GPT‑6 Sol**, **GPT‑6 Luna** or another model offered by your CLI, then **Save settings**. Availability depends on your CLI and account. **Use Codex default** keeps the CLI’s configured choice. The editor’s choice applies to future reviews, discussions and Side Chat; it does not change your general Codex settings. Loading the catalog sends no paper text and starts no AI response.

## 4. Install, build, and launch

~~~sh
npm ci --ignore-scripts
npm rebuild esbuild
node node_modules/electron/install.js
npm run build
npm start
~~~

These commands install the locked dependencies (including the pinned Codex CLI), prepare esbuild and the Electron runtime, build into `dist/`, and open the desktop editor. Keep the explicit Electron installer step; `npm rebuild electron` alone does not install this version's runtime. Installation needs internet access. The editor itself needs no web server.

For AI features, complete the sign-in commands in step 3. Open **Settings**, keep **Editor-managed CLI**, choose a nonstandard TeX path if needed, and run **Check setup**. Then choose **Try the working sample**. Compile it with **Command+T** or **Command+B**, inspect a comment, accept a suggestion, and Undo. Prepared comments and compilation need no Codex account. To check the AI connection, choose **Review with Codex** and request a short language review of the sample; this uses your account.

Help, Settings and **Modern Codex Editor → About** show the editor version, **1.2.1** for this release. For setup troubleshooting, **Settings → Copy setup details** checks the selected executables and copies editor, operating system, Codex and TeX versions with check status. It makes no AI request and excludes paper text, file paths and account details. The **Changelog** tab in Help summarizes the release.

Keep real papers in their own folders with their bibliography, figures, and local styles. Start with a copy while learning the editor. **Use this wording** changes a proposal; **Accept** changes the draft; **Save** writes the `.tex` file. The [user guide](USER_GUIDE.md) covers the next steps, and the [FAQ](FAQ.md) covers setup errors and recovery.

## Launch again or update

Return to the same repository folder and run `npm start`. Quit through **Modern Codex Editor → Quit** or **Command+Q** when finished. Rebuild after source changes. If dependencies change, repeat step 4.

Quit before updating. New papers are saved in the folder you choose. Application data and managed samples live outside the checkout; **Settings → Storage and supported Codex version** shows the location. Executable settings persist there, so ordinary updates do not require another source-path edit.

When upgrading an older checkout, first launch the updated code from that same checkout while its `.runtime/` is still present. The editor copies and verifies old managed papers, their comments/recovery, and runtime state into the new location, preserving the originals. Keep the old folder until you have reopened and checked your work. If copying fails or conflicts, the startup error names the problem; preserve both locations and resolve it before removing files.

- **ZIP updates:** extract into a new folder and keep the previous folder until drafts and comments are accounted for. An old checkout's `.runtime/` is not discovered in a different folder automatically; preserve it with the old papers or copy the complete folder into the new checkout before its first launch. Repeat step 4. The editor-managed CLI is installed again with step 4 and follows the new folder. If you deliberately use a custom CLI, keep that installation or change its path in Settings.
- **Git updates:** inspect `git status`, preserve local changes, and use `git pull --ff-only`. Then repeat step 4. Existing manual source-path edits may need reconciliation; choose the paths in Settings once the new version runs.

Back up paper folders with their hidden `.modern-editor` state. Preserve legacy `.runtime/` until migration is checked, and keep the managed-sample/data folder if it holds work you want. See [storage and recovery](FAQ.md#where-are-comments-and-previous-versions-stored). **Help and shortcuts…** in Actions opens the bundled guides inside the editor.

## Windows status

This version has no supported Windows or WSL setup. Changing executable paths alone is insufficient; saving, compilation, and process handling need a separate portability pass. Use a Mac for the current version.
