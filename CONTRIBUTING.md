# Contributing

Keep changes focused and describe the user-visible problem, the resulting
behavior, and how you checked it. Use synthetic papers when reporting bugs or
adding examples. Follow [SECURITY.md](SECURITY.md) for possible vulnerabilities.

## Development checks

Follow [SETUP.md](docs/SETUP.md) to install dependencies and build on macOS. Then
run these commands from the folder containing `package.json`:

```sh
npm run typecheck
npm test
npm run build
```

The automatic CI workflow runs these checks on macOS 26 with Node.js 24. The
tests use local fake services and do not contact a model or account. CI does not
run the desktop application or real TeX integration tests. Inspect the [CI run](https://github.com/slauerma/modern-editor-local/actions/workflows/ci.yml) for the commit under review.

For compiler changes, also run `npm run test:compile` with the documented MacTeX
installation. For discussion or review-interface changes, use the focused
desktop regression and relevant manual checks in [TESTING.md](TESTING.md).
Include a focused regression when a behavior change needs one. Documentation
changes need link and factual checks; report which checks were actually run.

## Files and dependencies

The repository uses a source allowlist in `.gitignore`. Review that list when
adding a new top-level file or script. Keep actual papers, credentials, sidecars,
runtime folders, test output, compiled documents, and recordings out of commits.
Inspect the staged diff and filenames before submitting; do not use force-add
to bypass an unexpected ignore rule without reviewing why the rule exists.

For dependency changes, preserve exact versions and the lockfile, audit the
updated dependency tree, and run `npm run notices` after installing the selected
dependencies. Review the generated notices and preserve `dist/licenses/` with
any distributed build. A clean advisory audit is not a guarantee of dependency
safety.

Original source and documentation contributions use this project's
[MIT license](LICENSE). Add only material you have the right to contribute, and
retain the notices for third-party material. Media needs its own provenance and
permission review; the project's source license does not establish those rights.

Update the relevant user guide when behavior or setup changes, and record
notable changes in [CHANGELOG.md](CHANGELOG.md). This repository contains source;
there is no packaged application release or supported Windows build yet.
