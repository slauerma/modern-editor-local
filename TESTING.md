# Testing

Run commands from the repository root after following [SETUP.md](docs/SETUP.md). Current automated and desktop evidence is from macOS. Windows and a fresh colleague-machine installation have not been validated; the commands below are not a Windows support claim.

[GitHub CI](https://github.com/slauerma/modern-editor-local/actions/workflows/ci.yml) records typecheck, offline test, and build results for each pushed commit.

```sh
npm run typecheck
npm test
npm run build
```

The unit suite covers source and review state, save/recovery behavior, proposal diffs, version history, PDF navigation decisions, and Codex request handling with a local fake server. Review-action tests cover bulk dismissal with one Undo/Redo, preserved Later/history/discussion and later arrivals, and question relinking that retains earlier wording without weakening replacement matching. Setup tests check that copied version summaries exclude private data; Help tests check release-version consistency and searchable release notes. The suite does not call an account or model service. Tests create disposable `.test-runs/` folders, and some also write `test-evidence/`.

Reference tests cover remembered native-picker grants, current unsaved text, bounded PDF/text search, path replacement, revocation, cancellation and source-use records. Build-input tests distinguish the **50 MB / 500-file** discovery threshold from the **200 MB / 2,000-file** required-input cap. They cover deterministic narrowing, a required 60 MB resource, reported size totals, explicit Codex-request preparation, and rejected paths, omissions and excessive limits. Mocked model answers test the control flow, not suggestion quality.

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

Large-folder cases include an unrelated 60 MB file, computed inputs requiring an explicit unverified preview, preserved earlier PDFs and cancellation during local planning.

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

1. Compile the sample with **Command+T**, then use **Command+B** after it finishes. Both shortcuts should invoke Compile; repeating either during an active build should not queue another build. Inspect a comment's Original, Proposed replacement, and Show changes.
2. Focus the comment controls, use **Shift+S** to skip, and **Shift+A** to accept a valid suggestion after its compile check. Use Undo and confirm that the source and review decision return. Verify uppercase A/S can still be typed normally inside a replacement or note field.
3. With two current, nonoverlapping pending replacements, choose **More → Accept all applicable suggestions (N)**. Verify one combined compile and one Undo for the applied source changes and decisions. Include question, stale, overlapping and Later controls and confirm they remain for individual review.
4. On a synthetic candidate with a warning such as `\ref{missing-label}`, verify that acceptance pauses with an explanation and unchanged source. Inspect the candidate PDF, then use **Apply despite warnings** after a successful build with verified inputs. Undo the application. Change the source or proposal while a warning is pending and confirm it requires a new check; changed compilation inputs must also block application. Failed or unverified builds must not offer the override. The current warning check includes pre-existing warnings and does not compare them with an earlier build.
5. Try **Accept without compiling** for an individual suggestion and confirm that the PDF is marked older. Compile again, then use Source/PDF navigation.
6. Put one pending comment in Later. Use **More → Dismiss pending comments**, inspect History, and Undo once. Confirm the pending batch returns, Later remains set, and source text and discussions are unchanged.
7. Add an author question to a source selection and rewrite that passage. Use **Link question to current selection** and verify that the card retains Earlier wording beside the Linked current passage. Undo the link and confirm the source stays unchanged by linking. Replacement suggestions must still require exact original text for reattachment.
8. Open Help and Settings, verify version **0.3.0**, inspect the Changelog, and use **Copy setup details**. Inspect the copied summary for editor/OS/Codex/TeX versions and check status, with no paper text, paths or account data.
9. Save, compare with the retained original, and reopen the sample to check saved comments and source. Test Undo before quitting; its history is session-only.

This check needs the local TeX toolchain but no model/account call. Source remains in the generated sample folder. See the [user guide](docs/USER_GUIDE.md) for the controls and [FAQ](docs/FAQ.md) for recovery.

### Help me chat checks

After building, `node scripts/check-help-chat.mjs` runs an isolated Electron check with synthetic papers, screenshots and controlled replies. If Playwright is installed elsewhere, pass `--playwright-package /absolute/path/to/playwright/package.json`. It checks context/version, image attachment and normalization, cancellation/retry, proposal conversion with Undo, changed-source guards, drawer layout, and conversation persistence. It uses a simulated paste event; physical operating-system clipboard delivery is a separate manual check. It makes no model request.

`node --experimental-strip-types scripts/check-chat-images-protocol.mjs /absolute/path/to/codex` uses the supported installed Codex runtime and a synthetic HTTP provider on localhost. It verifies that screenshot bytes reach the provider as an image input and that no account credentials accompany the request. The server replies with a fixed answer; this establishes transport, not visual understanding. Both checks put local results in ignored `.test-runs/` folders and may need permission to launch Electron or listen on localhost.

For a manual chat smoke check, paste/drop an image, inspect its thumbnail and context, ask about a synthetic error, then request a revision to a selected passage. Verify that **Turn into comment** leaves the source unchanged and that closing/reopening the drawer preserves the conversation. Live answer quality requires an explicitly sent account request.

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
