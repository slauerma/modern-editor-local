# Changelog

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
