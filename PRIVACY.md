# Privacy and local data

Editing, compilation preparation, saved comments, version comparison, PDF reading/search, Help, setup checks, and reference previews run locally. AI review, discussion, preamble assistance, conversion of outside feedback, and explicitly requested help with compilation inputs send text through your configured Codex service.

## Local storage

Opening and editing papers can create `.modern-editor/documents/<document-id>/` beside the root `.tex` file. This holds review comments and discussions, paper instructions, recovery drafts, source backups and version records, baselines, reading state, and raw/converted outside feedback. These records can contain manuscript text, third-party feedback, and file identities. Existing legacy `.modern-editor` records may also be retained.

Application state, managed samples, compiler snapshots, PDFs, logs, executable settings, remembered reference locations, and **Sources used** records live outside the checkout in the application data location. **Settings → Storage and supported Codex version** shows the exact folder. These files can contain source text and absolute local paths. Old `.runtime/` copies are preserved after migration and can still contain the same material. The Codex CLI manages its own account configuration separately.

**New drafts use the `.tex` location you choose outside the checkout.** Managed samples are real paper copies in application storage. **Export source…** creates a source-only file at a new path, without switching the open document or copying its comments, bibliography, figures, or history. Open the exported file to continue there.

Automatic recovery stores unsaved text separately from ordinary Save. Retained source versions also differ from the session-only Undo history. **Recover source…** lets you inspect readable versions and export a selected source to a new file, preserving originals. See the [recovery and storage FAQ](docs/FAQ.md#how-do-i-recover-after-a-crash-or-an-external-edit) before reloading or cleaning up data.

Keep personal papers outside the editor checkout. Sharing a paper folder can also share its hidden recovery and discussion records; inspect the files before sharing.

**Settings → Copy setup details** runs local version checks and writes a fixed summary to the clipboard: editor version, operating system version, Codex and TeX versions, and check status. It copies parsed version numbers rather than raw executable output and excludes manuscript text, file paths, account details and failure diagnostics. The button makes no Codex request; the copied summary is also available to inspect in Settings.

## Codex requests

AI actions launch the external Codex CLI with its existing sign-in and model configuration. Submitted text can leave the machine through that service. The editor sends structured text according to the action:

- A review includes the selected passage, bounded nearby text and preamble, review instructions, and saved paper instructions.
- A discussion includes the comment, current proposal, recent discussion messages, author reply, bounded nearby source, and saved paper instructions.
- Preamble assistance includes the current root source and, when retrying, the previous attempt and compiler output.
- Outside-feedback conversion includes the pasted feedback, its source label, the current root source, and saved paper instructions. The raw feedback and source snapshot are saved locally before the request, including when a conversion later fails.
- Reviews and discussions can consult enabled reference files and folders using bounded, read-only list/search/read tools. Returned display names, excerpts, page/line ranges and coverage notices go to Codex. Optional manually previewed excerpts accompany the initial request.
- **Ask Codex to help** with compilation inputs sends the locally prepared preview: source excerpts, relative file inventory and dependency-check results. It proposes a file list without running LaTeX or changing source.

The context preview shows the initial text supplied by the editor. The external Codex runtime may also add its own configuration or model metadata beyond that preview. Attaching references makes no model request. Locations are remembered for this paper; later reviews and discussions may read relevant excerpts without another file-by-file preview. **Sources used** records returned excerpts and search coverage after each request. Disable or remove a location to exclude it from future requests. Optional exact-excerpt selections remain available and require their own preview.

This avoids manual upload management, but content returned to Codex leaves the computer through that service. Reading tools use opaque IDs rather than arbitrary paths and omit absolute root paths from their metadata; source text itself can contain identifying information. The current unsaved draft is authoritative. References cannot be edited by these tools. Missing or changed locations produce notices or stop the read. Root permissions are stored by the app, not accepted from a paper's imported sidecars.

Codex responses, including rejected responses, may be retained in the document's local review records so completed work is recoverable. Removing a reference does not delete its local file or erase content already included in an earlier request or answer.

Review scope is the opened root source or selection; included source files are not expanded automatically. **Save note** stores a discussion note locally without contacting Codex. Saved notes can be included as context when you later explicitly ask Codex about that comment; inspect **Preview request** before sending. The [user guide](docs/USER_GUIDE.md) explains how to preview context and distinguish local actions from AI requests.

Before sending paper text, the client checks the CLI version and reads its effective configuration, including trusted project configuration. It disables each configured MCP server explicitly in the new task, then checks the task's complete MCP inventory: every expected server must report disabled, with no tools or resources. Missing, unexpected, active, or uncheckable entries stop the request before paper text is sent.

This policy is currently verified for **Codex CLI 0.153.4**. Other versions stop before an AI request until their compatibility is tested and the supported-version list is deliberately updated. The [real configuration probe](TESTING.md#real-codex-configuration-check--no-account-request) exercises the same client against harmless inherited MCP servers, without sending a model request or copying account credentials.

The client also checks its configured restrictions on web search, shell execution, plugins, apps, host instruction discovery and other tool features, and requests an ephemeral read-only task with approvals disabled. Only the editor's three reference callbacks are accepted, when enabled for that request and matched to its thread and turn. Other tool/permission callbacks are rejected. These are CLI configuration controls, not proof of a complete empty built-in tool catalog or an operating-system sandbox. The configuration read and task creation are separate operations: a concurrent local configuration change could start a newly added integration before the inventory check refuses the task. The tested, unchanged configurations do not start the disabled servers. These controls do not alter the service's account data policies, and the editor does not rewrite your Codex configuration.

## Compilation

LaTeX runs locally on a copied paper snapshot, with shell escape and user `latexmk` startup files disabled. The snapshot can include local bibliography, graphics, and font resources from the paper folder. The application checks recorded dependencies before treating a compile as suitable for checked acceptance. TeX runs as the local user, so these checks are not a filesystem isolation boundary; compile documents you trust.

Above **50 MB or 500 files**, the editor starts local dependency discovery to leave unrelated files out of the snapshot. The cap on actual required inputs is **200 MB / 2,000 files**, including explicit file selections. Ambiguous references require a deliberate file choice; Codex assistance starts only through **Ask Codex to help**. Proposed paths are checked within the paper folder. A PDF with unresolved dependency commands remains unverified and cannot authorize checked acceptance.
