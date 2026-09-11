# Changelog

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
