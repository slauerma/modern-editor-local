# Testing

Run commands from the repository root after following [SETUP.md](docs/SETUP.md). Current automated and desktop evidence is from macOS. Windows and a fresh colleague-machine installation have not been validated; the commands below are not a Windows support claim.

[GitHub CI](https://github.com/slauerma/modern-editor-local/actions/workflows/ci.yml) records typecheck, offline test, and build results for each pushed commit.

```sh
npm run typecheck
npm test
npm run build
```

The unit suite covers source and review state, save/recovery behavior, proposal diffs, version history, PDF navigation decisions, and Codex request handling with a local fake server. It does not call an account or model service. Tests create disposable `.test-runs/` folders, and some also write `test-evidence/`.

## Real TeX integration

```sh
npm run test:compile
```

The `pretest:compile` hook runs `scripts/generate-compile-fixtures.mjs`. That script reads no outside artwork and deterministically generates two ignored files:

- `fixtures/audit-paper/figures/allocation.pdf`: a small vector identity-allocation diagram.
- `fixtures/texpile/allocation.jpg`: a grayscale diagonal diagram encoded directly from numeric pixel blocks.

No PDF, JPEG, font, or other binary fixture is checked in. The generated files preserve coverage for both PDF and JPEG graphic inclusion. To run a single compile integration file directly, generate the graphics first:

```sh
node scripts/generate-compile-fixtures.mjs
node --experimental-strip-types --test tests/compile.audit.ts
```

The compile suite requires the MacTeX locations documented in the README. It exercises pdfLaTeX, LuaLaTeX, XeLaTeX, BibTeX, relative source/graphics inputs, Unicode paths, local fonts, missing glyphs and references, candidate validation, preserved PDFs, Scientific Word macros, and SyncTeX. The multilingual tests locate the installed `FreeSerif.otf` font using `kpsewhich` and copy it only into an ignored test run.

Compile tests run serially and may take several minutes. They write logs, temporary paper copies, and compiled output under `.test-runs/` and `test-evidence/`. These directories and the generated fixture graphics are ignored. A missing TeX package or binary should be fixed in the local installation before retrying the relevant test.

## Desktop smoke check

The focused native discussion regression uses Playwright as an optional test tool. It is separate from `npm test`. Use an already installed copy with the `--playwright-package` option, or install it locally without changing the checked-in dependency lockfile:

```sh
npm install --no-save --package-lock=false playwright
npm run build
node scripts/check-discussion-proposals.mjs
```

For an existing installation, pass its package manifest, for example `node scripts/check-discussion-proposals.mjs --playwright-package /path/to/testing-tools/package.json`. This opens an isolated Electron copy with synthetic files, controlled model replies, and predetermined file-picker choices. It does not contact Codex or compile a paper. Screenshots and a JSON receipt stay in ignored `test-evidence/`; disposable paper/runtime copies stay in `.test-runs/`. The receipt distinguishes simulated responses from actual renderer/file operations.

The regression checks review focus and invokes the registered native Undo command. Test physical keyboard shortcuts manually as part of the sample check below; simulated browser key events do not establish operating-system shortcut delivery.

### Manual sample check — no Codex request

After `npm run build` and `npm start`, choose **Try the working sample**. It has prepared comments, but no prepared discussion replies.

1. Compile the sample and inspect a comment's Original, Proposed replacement, and Show changes.
2. Focus the comment controls, use **Shift+S** to skip, and **Shift+A** to accept a valid suggestion after its compile check. Use Undo and confirm that the source and review decision return. Verify uppercase A/S can still be typed normally inside a replacement or note field.
3. Try **Accept without compiling** and confirm that the PDF is marked older. Compile again, then use Source/PDF navigation.
4. Save, compare with the retained original, and reopen the sample to check saved comments and source. Test Undo before quitting; its history is session-only.

This check needs the local TeX toolchain but no model/account call. Source remains in the generated sample folder. See the [user guide](docs/USER_GUIDE.md) for the controls and [FAQ](docs/FAQ.md) for recovery.

### Optional live Codex check — uses your account

On a synthetic paper, request a short language review. Ask one resulting comment, “Make the suggested change more compact.” Check that the reply's exact **Suggested wording** is readable separately from the explanation. **Use this wording** should update the proposal only; inspect it, accept it, then Save. Also check cancellation and any reported unsupported effort/Fast setting as needed.

Live requests use your separately configured CLI and account and may consume service usage. They are not part of the automatic test commands above. Do not treat controlled model replies as evidence of live connection or model quality.

## Real Codex configuration check — no account request

```sh
node --experimental-strip-types scripts/check-codex-isolation.mjs
```

Use `--codex /absolute/path/to/codex` for another executable location. The currently supported runtime is **0.153.4**; an unknown version must fail closed. The script uses a disposable Codex home and synthetic trusted project under `.test-runs/`, without copying credentials or changing your normal configuration. It never starts a model turn.

The positive control demonstrates that the old empty-table override starts a harmless MCP server and exposes its tool. The corrected cases use the actual editor client, with inherited home configuration, home plus trusted-project configuration, and an inherited desktop-launcher identity. All must report every server disabled, expose no MCP tools/resources, and leave the startup markers absent. The probe uses automatic tool approval settings to ensure that rejecting approval callbacks is not mistaken for disabling a server. It records CLI version and tested source hashes in ignored `test-evidence/`.

Run this check after changing the client policy or CLI version. A successful probe alone does not authorize adding a new supported version: review its protocol, feature defaults and configuration behavior as well. It verifies static inherited configurations and the pre-request inventory gate, not an operating-system sandbox or every built-in capability. Mocked tests additionally cover malformed configuration, unexpected/active servers, incomplete pagination, and refusal before any paper text is sent.

## CI and preparing a release candidate

The committed GitHub Actions workflow runs type checking, offline tests and the build on macOS with Node 24, read-only repository permissions and no account credentials. It does not run TeX, native desktop interaction, live Codex requests or a secret scanner. See the [CI runs](https://github.com/slauerma/modern-editor-local/actions/workflows/ci.yml) for a particular commit.

For a release candidate, start from a fresh checkout of its commit and record the exact macOS, Node, npm, Electron, Codex and TeX versions:

```sh
npm ci --ignore-scripts
npm rebuild esbuild
node node_modules/electron/install.js
npm run typecheck
npm test
npm run build
npm run test:compile
npm audit --include=dev
node --experimental-strip-types scripts/check-codex-isolation.mjs
```

Then run the desktop regression above. Audit all dependencies, including development dependencies: Electron is a development dependency but runs the app. Review the exact Git tree and reachable history with a redacting secret scanner, and inspect binary assets separately. Do not upload private logs, scanner matches, or manuscript-derived test evidence to public CI or issues. See [SECURITY.md](SECURITY.md) for reporting guidance.
