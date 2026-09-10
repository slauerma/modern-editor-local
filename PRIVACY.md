# Privacy and local data

Editing, compilation, saved comments, and version comparison run locally. AI review, discussion, and preamble assistance send text through your configured Codex service. Review the context preview before sending sensitive material.

## Local storage

Opening and editing papers can create `.modern-editor/documents/<document-id>/` beside the root `.tex` file. This holds review comments and discussions, paper instructions, recovery drafts, source backups and version records, baselines, and reading state. These records can contain manuscript text and file identities. Existing legacy `.modern-editor` records may also be retained.

In a development checkout, `.runtime/` holds application state, draft/sample paper copies, compiler snapshots, PDFs, and logs. A packaged build uses Electron's application data location instead. These files can contain source text and absolute local paths. The local Codex CLI manages its own account configuration separately.

**New drafts and samples are real paper copies under `.runtime/papers/`.** Save writes that location; preserve it when updating or replacing the checkout. **Export source…** creates a source-only file at a new path, without switching the open document or copying its comments, bibliography, figures, or history. Open the exported file to continue there.

Automatic recovery stores unsaved text separately from ordinary Save. Retained source versions also differ from the session-only Undo history. **Recover source…** lets you inspect readable versions and export a selected source to a new file, preserving originals. See the [recovery and storage FAQ](docs/FAQ.md#how-do-i-recover-after-a-crash-or-an-external-edit) before reloading or cleaning up data.

Keep personal papers outside the editor checkout. Sharing a paper folder can also share its hidden recovery and discussion records; inspect the files before sharing.

## Codex requests

AI actions launch the external Codex CLI with its existing sign-in and model configuration. Submitted text can leave the machine through that service. The editor sends structured text according to the action:

- A review includes the selected passage, bounded nearby text and preamble, review instructions, and saved paper instructions.
- A discussion includes the comment, current proposal, recent discussion messages, author reply, bounded nearby source, and saved paper instructions.
- Preamble assistance includes the current root source and, when retrying, the previous attempt and compiler output.

The review and discussion context preview shows the payload assembled by the editor. No other paper files are attached by the editor. Codex responses, including rejected responses, may be retained in the document's local review records so completed work is recoverable.

Review scope is the opened root source or selection; included source files are not expanded into the request. **Save note** stores a discussion note locally without contacting Codex. Saved notes can be included as context when you later explicitly ask Codex about that comment; inspect **Context…** before sending. The [user guide](docs/USER_GUIDE.md) explains how to preview context and distinguish local actions from AI requests.

Before sending paper text, the client checks the CLI version and reads its effective configuration, including trusted project configuration. It disables each configured MCP server explicitly in the new task, then checks the task's complete MCP inventory: every expected server must report disabled, with no tools or resources. Missing, unexpected, active, or uncheckable entries stop the request before paper text is sent.

This policy is currently verified for **Codex CLI 0.153.4**. Other versions stop before an AI request until their compatibility is tested and the supported-version list is deliberately updated. The [real configuration probe](TESTING.md#real-codex-configuration-check--no-account-request) exercises the same client against harmless inherited MCP servers, without sending a model request or copying account credentials.

The client also checks its configured restrictions on web search, shell execution, plugins, apps, host instruction discovery and other tool features, requests an ephemeral read-only task with approvals disabled, and rejects incoming tool/permission callbacks. These are CLI configuration controls, not proof of a complete empty built-in tool catalog or an operating-system sandbox. The configuration read and task creation are separate operations: a concurrent local configuration change could start a newly added integration before the inventory check refuses the task. The tested, unchanged configurations do not start the disabled servers. These controls do not alter the service's account data policies, and the editor does not rewrite your Codex configuration.

## Compilation

LaTeX runs locally on a copied paper snapshot, with shell escape and user `latexmk` startup files disabled. The snapshot can include local bibliography, graphics, and font resources from the paper folder. The application checks recorded dependencies before treating a compile as suitable for checked acceptance. TeX runs as the local user, so these checks are not a filesystem isolation boundary; compile documents you trust.
