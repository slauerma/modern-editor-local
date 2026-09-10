# Installing Modern Codex Editor

This is a **macOS source build**: there is no standalone installer or double-clickable application download. You will use Terminal for installation and launch. Windows is not supported yet.

You need Node.js with npm to run the editor, MacTeX to compile papers, and your own Codex account for AI features. You can try editing and prepared comments without configuring Codex.

## 1. Get the source

Open [modern-editor-local](https://github.com/slauerma/modern-editor-local). While the repository is private, accept the owner's invitation and sign into the GitHub account that received it.

- **ZIP:** choose **Code → Download ZIP**, extract it, and keep the folder in a writable location. Git and GitHub CLI are not required.
- **Git:** with Git installed and GitHub authentication configured, run:

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
/Library/TeX/texbin/latexmk -v
~~~

## 3. Configure Codex if you want AI review

**This editor currently requires Codex CLI 0.153.4.** A newer CLI is not automatically compatible. The editor checks the version and its tool restrictions before sending paper text. Editing and compilation still work if the AI connection is unavailable.

If you already have that version, reuse it and verify its absolute executable path. Otherwise, install a separate copy for this editor, leaving any other Codex installation in place:

~~~sh
npm install --prefix .tools/codex --no-audit --no-fund @openai/codex@0.153.4
./.tools/codex/node_modules/.bin/codex --version
./.tools/codex/node_modules/.bin/codex login
./.tools/codex/node_modules/.bin/codex login status
printf '%s/.tools/codex/node_modules/.bin/codex\n' "$PWD"
~~~

Complete the browser sign-in using your own account. See the [official Codex CLI guide](https://learn.chatgpt.com/docs/codex/cli) and [authentication options](https://learn.chatgpt.com/docs/auth) for sign-in help, including API-key access. The separate executable uses your normal Codex account configuration.

**Set the executable path before building.** Copy the absolute path printed by the last command. Open [src/main/codex-client.ts](../src/main/codex-client.ts) in a plain-text or code editor, find this constructor default, and replace only the quoted path:

~~~ts
binary = '/Applications/ChatGPT.app/Contents/Resources/codex'
~~~

For an existing CLI available as `codex`, `command -v codex` shows its path. Check and authenticate that same executable. The bundled default above can be used only if it exists and reports version 0.153.4. There is no tool-path setting or automatic PATH discovery in the editor yet. Do not remove the supported-version check to bypass an error.

For a nonstandard TeX installation, the corresponding default is in [src/main/compile-service.ts](../src/main/compile-service.ts):

~~~ts
latexmk = '/Library/TeX/texbin/latexmk'
~~~

The compiler expects `kpsewhich` and `synctex` beside it. Standard MacTeX is the simplest route.

## 4. Install, build, and launch

~~~sh
npm ci --ignore-scripts
npm rebuild esbuild
node node_modules/electron/install.js
npm run build
npm start
~~~

These commands install the locked dependencies, prepare esbuild and the Electron runtime, build into `dist/`, and open the desktop editor. Keep the explicit Electron installer step; `npm rebuild electron` alone does not install this version's runtime. Installation needs internet access. The editor itself needs no web server.

Choose **Try the working sample**. Compile it, inspect a comment, accept a suggestion, and Undo. Prepared comments and compilation need no Codex account. To check the AI connection, choose **Review with Codex** and request a short language review of the sample; this uses your account.

Keep real papers in their own folders with their bibliography, figures, and local styles. Start with a copy while learning the editor. **Use this wording** changes a proposal; **Accept** changes the draft; **Save** writes the `.tex` file. The [user guide](USER_GUIDE.md) covers the next steps, and the [FAQ](FAQ.md) covers setup errors and recovery.

## Launch again or update

Return to the same repository folder and run `npm start`. Quit through **Modern Codex Editor → Quit** or **Command+Q** when finished. Rebuild after changing source or executable paths. If dependencies change, repeat step 4.

Quit before updating. **Preserve `.runtime/`: new drafts and samples live in `.runtime/papers/`.** Save keeps writing that location. Export source creates a new source-only file; open the exported copy to continue there. Comments remain with the original document.

- **ZIP updates:** extract into a new folder and keep the previous folder until drafts and comments are accounted for. Repeat setup in the new folder, including the Codex installation/path if you used `.tools/codex`.
- **Git updates:** inspect `git status`, preserve your executable-path edit, and reconcile local changes before `git pull --ff-only`. Then repeat step 4. Do not discard the path edit just to make a pull succeed.

Back up paper folders with their hidden `.modern-editor` state. Do not delete `.runtime/` or document sidecars as an update-cleanup step. See [storage and recovery](FAQ.md#where-are-comments-and-previous-versions-stored).

## Windows status

This version has no supported Windows or WSL setup. Changing executable paths alone is insufficient; saving, compilation, and process handling need a separate portability pass. Use a Mac for the current version.
