# Security reports

Please report possible vulnerabilities privately. Do not put manuscript text,
account tokens, local recovery data, or exploit details in a public issue or pull
request.

If GitHub offers **Security → Report a vulnerability** for this repository, use
[that private reporting form](https://github.com/slauerma/modern-editor-local/security/advisories/new).
Its availability depends on the repository settings. If it is unavailable,
contact the maintainer through your existing private channel. If you have no
private contact route, open an issue asking for one without describing the
vulnerability or attaching sensitive material.

Include the affected commit, operating system, expected and observed behavior,
and the smallest synthetic reproduction you can make. Sanitize paths and logs;
recovery folders and discussion records can contain complete source passages.

## Maintenance scope

This is a personal development project. Security fixes are considered for the
current `main` branch; there are no separately maintained release branches or
guaranteed response times. macOS is the currently validated platform. Windows
is not supported.

## Relevant trust boundaries

- TeX subprocesses run as the local user. Disabling shell escape and validating
  copied inputs does not provide an operating-system sandbox. Compile trusted
  documents.
- AI requests use the separately installed Codex CLI and account. Review the
  context preview before sending sensitive material; the request can leave the
  machine.
- Document sidecars, recovery data, test evidence, and development runtime
  folders can contain source text and local paths. Git ignore rules do not
  remove files already committed to history.

See [PRIVACY.md](PRIVACY.md) for storage and request details, and
[TESTING.md](TESTING.md) for the scope and limits of validation.
