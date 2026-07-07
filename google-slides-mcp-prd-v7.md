# PRD: Google Slides MCP Server for Claude Desktop

**Status:** Draft v8 (amended)
**Owner:** Jader Feijo
**Date:** 7 July 2026
**Codename:** `slides-mcp` (working name)

---

## 1. Overview

A locally-running MCP (Model Context Protocol) server that gives Claude Desktop full programmatic control of Google Slides. The tool is open source, distributed via GitHub, and installable by anyone. Each user authenticates against their own Google Cloud OAuth client, provisioned through a one-time setup flow guided by Claude itself in conversation, which automates every step the Google APIs permit. Credentials are stored in the macOS Keychain. Multiple Google accounts are supported concurrently.

There is no hosted component and no shared OAuth application. Nothing leaves the user's machine except direct calls to Google's APIs.

### 1.1 Goals

1. Anyone can clone or install the tool from GitHub and be creating slides from Claude Desktop within ~10 minutes.
2. Expose the complete Google Slides API surface, not a curated subset. If Google allows it via API, the MCP server supports it.
3. Zero centralised infrastructure: no shared client ID, no verification bottleneck, no quota pooling, no maintainer liability for user data.
4. Multi-account support with per-call account selection.
5. Credentials at rest only in the macOS Keychain, never in plaintext files.
6. One-click registration with Claude Desktop via an MCPB bundle — the sole install path.

### 1.2 Non-Goals

- Windows or Linux support (v1 is macOS-only; the Keychain dependency is deliberate).
- A hosted/remote MCP variant.
- Google Docs, Sheets, or general Drive management beyond what Slides workflows require (template copy, image upload, Sheets-chart linking, PDF export, deck listing).
- A GUI or standalone installer. Setup is conversational: Claude itself detects the unconfigured state and guides the user through it (§5); runtime is headless under Claude Desktop.
- WYSIWYG design intelligence. The server exposes capability; layout/design quality is Claude's job, aided by semantic convenience tools.
- A `claude_desktop_config.json` (JSON-config) install path. MCPB is the sole supported install; a second path doubles the documentation, testing, and support surface for no user benefit. Power users can still extract the `.mcpb` (a zip archive) and wire it manually at their own risk, but this is not documented or supported.
- A standalone notarised binary, and no npm registry publication. The single install path (MCPB) needs neither; release integrity is handled by SHA-256 checksums and GitHub artefact attestations.

---

## 2. Users and Use Cases

**Primary persona:** a technical or semi-technical Claude Desktop user (developer, consultant, solution engineer) comfortable running a terminal command, who wants Claude to produce and edit real Google Slides decks rather than PPTX files.

**Representative use cases:**

- (First run) "Make me a deck" → Claude detects the tool is unconfigured and walks the user through the one-time setup conversationally.
- "Create a 10-slide partner proposal deck from this outline, using my company template."
- "Duplicate the Q2 QBR deck, update the title slide, and replace every instance of 'Q2' with 'Q3'."
- "Read slides 4 through 8 of this deck and summarise the argument."
- "Insert this chart image onto slide 6, top-right quadrant."
- "Link the revenue chart from my forecast spreadsheet onto the summary slide."
- "Export the deck to PDF."
- "Do all of the above on my work account, not my personal one."

---

## 3. Architecture

```
┌────────────────┐   stdio (MCP)   ┌──────────────────┐   HTTPS   ┌─────────────┐
│ Claude Desktop  │ ◄─────────────► │  slides-mcp       │ ◄───────► │ Google APIs │
│                 │                 │  (local Node proc)│           │ Slides v1   │
└────────────────┘                 │                   │           │ Drive v3    │
                                   │  ┌─────────────┐  │           │ Sheets v4*  │
                                   │  │ Auth manager │◄─┼──── macOS Keychain
                                   │  └─────────────┘  │      (tokens + client config)
                                   └──────────────────┘   * read-only, extended tier
                                            ▲
                                   ┌────────┴─────────┐
                                   │ setup engine      │──── gcloud CLI (project/API
                                   │ (in-server, Claude│      provisioning) + browser
                                   │  guided via tools)│      (OAuth consent, console steps)
                                   └──────────────────┘
```

**Components:**

| Component | Responsibility |
|---|---|
| MCP server (stdio) | Tool registration, request handling, Slides/Drive/Sheets API calls, token refresh |
| Auth manager | Keychain read/write, per-account token lifecycle, PKCE loopback flow |
| Setup engine (in-server) | One-time first-run provisioning, orchestrated by Claude in conversation via setup tools: gcloud automation, guided console steps, client import, first account auth; progress persisted so setup resumes across sessions (§5) |
| Template registry | Local config mapping friendly template names to deck IDs (§7.5) |
| MCPB bundle | Distribution artefact for one-click install into Claude Desktop |

**Process model: stateless handlers inside a client-owned resident process.** "Server" is MCP protocol terminology, not an architectural commitment. The MCP stdio transport is a persistent JSON-RPC session: Claude Desktop spawns the process via the MCPB entry point at app launch, performs the `initialize` handshake, and sends `tools/call` messages down the same stdin/stdout pipe for the life of the session. Claude Desktop owns this lifecycle entirely — the process is an invisible child that dies when the app quits. Nothing about it is server-like in the operational sense: no listening port (the loopback OAuth listener exists only for the seconds an auth flow is active, on an ephemeral port), no daemon, no launchd agent, nothing the user starts, stops, or monitors. Idle cost is a dormant Node process (~30–80MB RAM, zero CPU).

Within that process, **every tool handler must be stateless**: each `tools/call` independently resolves the target account, reads credentials from the Keychain, obtains a valid access token, makes the Google API call, and returns. No session state, on-disk state, or cross-call memory may be required for correctness — killing the process mid-session must lose nothing. (Durable configuration — Keychain entries, the setup state file, the template registry — is written as the explicit effect of a tool call and re-read on demand; it is persistence, not session state.) Exactly two in-memory caches are permitted, both pure optimisations: (1) a per-account access-token cache, saving a token-refresh round trip to Google (~200–400ms) on every call; (2) the Keychain handle, so the macOS permission prompt fires once per session rather than per call. A per-call exec model (fresh process per tool invocation) is not possible under the stdio transport without a resident proxy shim, which would reintroduce the process with added complexity; the resident-process-with-stateless-handlers model is the deliberate design, not an accident of the protocol.

**Runtime:** Node.js (LTS), TypeScript. Node is chosen over Python because the MCPB format runs on Claude Desktop's bundled Node runtime with no assumption of `uv`/`python` on the user's machine, and Claude Desktop's MCPB support is Node-first.

**Native runtime, not Docker.** The server must run directly on macOS: the Keychain is only reachable from a native process, the OAuth flow must launch the user's default browser, and Claude Desktop spawns the server as a local stdio child process. Docker is used for everything it is good at in this project: CI, linting, building the MCPB, and integration tests against recorded API fixtures. `docker compose run ci` (wrapped as `make ci`) is the canonical build; `make run` runs the server natively.

---

## 4. Authentication Design

### 4.1 Decision: per-user OAuth Desktop client, own GCP project

Each user provisions their own Google Cloud project and their own OAuth "Desktop app" client. The tool ships no client ID.

Rationale:

- **No centralised bottleneck.** A shipped client ID would make the maintainer's GCP project a single point of failure: Google verification requirements, shared per-client quota, the annual re-verification treadmill, and reputational liability. It also violates the project's "nothing centralised" principle.
- **No verification burden on users.** A user's own unverified client, pushed to "In production" publishing status, works indefinitely for that user. Google shows a one-time "unverified app" interstitial that the project owner can click through. Since every user is the sole user of their own client, the 100-user cap on unverified apps is irrelevant.
- **Full quota per user.** Slides API per-project quotas belong entirely to each user.

### 4.2 Alternatives considered (and why they were rejected)

| Alternative | Why rejected |
|---|---|
| **Ship a shared client ID in the repo** (rclone model) | Creates the centralised bottleneck: Google verification for the `presentations` (sensitive) scope, shared quota, and a permanent obligation to keep the GCP project alive. Google also auto-deletes OAuth clients inactive for 6 months, adding maintenance risk. |
| **gcloud ADC (`gcloud auth application-default login --scopes=…`)** | Dead end for Workspace APIs. Adding Drive/Slides scopes to ADC requires supplying your own OAuth client via `--client-id-file` anyway, because the default flow uses gcloud's internal Google-owned project where the Slides/Drive APIs cannot be enabled. Since a user-owned client is unavoidable, ADC adds nothing and takes away multi-account (ADC is one credential file) and Keychain storage (ADC is plaintext JSON on disk). |
| **`gcloud auth login --enable-gdrive-access` token reuse** | Grants Drive but not Slides scope, single account, and repurposing gcloud's client credentials inside a third-party tool is fragile and against the spirit of Google's client terms. |
| **Service account + domain-wide delegation** | Workspace-admin-only; excludes consumer accounts; wrong trust model for a personal tool. |
| **Device code flow** | Google restricts allowed scopes on the device flow; Slides/Drive scopes are not reliably available. Loopback PKCE is the supported pattern for desktop apps. |

### 4.3 OAuth flow

- **Authorization Code + PKCE** with a loopback redirect (`http://127.0.0.1:<ephemeral-port>/callback`). The server binds an ephemeral port per auth attempt, opens the system browser, and captures the redirect.
- `access_type=offline` with `prompt=consent select_account` to guarantee a refresh token and let the user pick which Google account to add.
- Refresh tokens are long-lived because the setup flow pushes the consent screen to **"In production"** status. (In "Testing" status, Google expires refresh tokens after 7 days; the setup engine treats production status as a required step, not an optional one.)
- Incremental scopes: the base auth requests the core scope set (4.4); the extended tier is a separate, explicit opt-in re-auth.

### 4.4 Scopes

Two tiers, chosen at setup (changeable later by re-running `authenticate_account` with `tier: "extended"`, or headlessly via `node dist/cli.js auth login --tier extended` from an extracted bundle):

| Tier | Scopes | Enables |
|---|---|---|
| **Core** (default) | `https://www.googleapis.com/auth/presentations`, `https://www.googleapis.com/auth/drive.file` | Full read/write on all the user's Slides decks (the presentations scope covers every presentation the user can access). `drive.file` covers files the tool itself creates: image uploads, decks created via the tool, and export of those files. |
| **Extended** (opt-in) | Core + `https://www.googleapis.com/auth/drive`, `https://www.googleapis.com/auth/spreadsheets.readonly` | Copying arbitrary existing decks as templates (`files.copy`), listing/searching all decks, exporting any deck to PDF, inserting images already stored in Drive, and linking live charts from Google Sheets into slides (`createSheetsChart` requires read access to the source spreadsheet). |

The two-tier design exists because `drive.file` cannot read files the tool did not create, so template duplication of a pre-existing deck genuinely requires the broad Drive scope. Users who never template-copy or chart-link stay on the least-privilege core tier. The consent screen registers both tiers' scopes at setup, so upgrading later never requires console changes: the user touches the Google console twice during setup, and never again.

**Accepted risk — `drive` is a restricted scope.** The full `drive` scope sits in Google's *restricted* category (stricter than the *sensitive* `presentations`/`spreadsheets.readonly` scopes). For a user's own unverified client in production this works today via the unverified-app interstitial, but Google has tightened restricted-scope policy over time. This is accepted and documented in the FAQ; the mitigation is that the core tier never needs it, and a future fallback is scoping extended features to `drive.readonly` where feasible.

### 4.5 Multi-account model

- Accounts are identified by their Google email (retrieved via the `openid email` scopes added to the token request).
- Each account has its own refresh token entry in the Keychain.
- One account is marked **default** (the first added, changeable via the `set_default_account` tool or `node dist/cli.js accounts default <email>`).
- Every content tool accepts an optional `account` parameter (email or unambiguous prefix). Omitted → default account.
- `list_accounts` and `authenticate_account` tools let Claude discover and add accounts mid-conversation (the auth tool opens the browser and blocks with a progress message until the loopback callback fires or times out at 5 minutes).

---

## 5. Claude-Guided Setup

There is no separate installer and no CLI wizard: setup happens inside the Claude conversation, one time. The server ships a built-in setup engine; Claude orchestrates it. When the server starts with no credentials in the Keychain it enters **unconfigured mode**: every content tool responds with a structured setup-required status, and the tool descriptions instruct Claude to begin the guided flow. So the user's experience is simply: install the MCPB, ask Claude for a deck, and Claude notices setup is needed and walks them through it. Design principle unchanged: **automate everything Google's APIs allow; make the remaining manual steps impossible to get wrong** — the difference is that Claude, not a terminal, is the guide.

### 5.1 Setup engine

The engine is a persisted state machine (progress stored in `~/.config/slides-mcp/state.json`, non-secret), exposed to Claude through three tools:

| Tool | Purpose |
|---|---|
| `get_setup_status` | Current state, completed and remaining steps, and per-step user-facing instructions for Claude to relay |
| `run_setup_step` | Execute the next (or a named) step; returns the outcome plus exactly what to tell or ask the user next |
| `run_diagnostics` | Post-setup health checks (§5.2) |

Because progress is persisted, the flow survives interruption: if the user closes Claude Desktop mid-setup, the next conversation resumes at the first incomplete step.

**Steps, in order** (each a `run_setup_step` invocation, narrated by Claude):

1. **Preflight.** Verify macOS version and detect `gcloud`. Because the server is a GUI-spawned child of Claude Desktop, its `PATH` is minimal — detection probes well-known absolute paths (`/opt/homebrew/bin/gcloud`, `/usr/local/bin/gcloud`, `~/google-cloud-sdk/bin/gcloud`) and never relies on `PATH`. If absent, the step returns the install command (`brew install google-cloud-sdk`, again via absolute `brew` path) for Claude to relay, or runs it with the user's explicit go-ahead.
2. **Google sign-in for provisioning.** Runs `gcloud auth login` (opens the browser); this identity is only used to create infrastructure and can differ from the Slides accounts added later — Claude explains this distinction before the browser opens.
3. **Project provisioning (automated).** `gcloud projects create slides-mcp-<random-suffix> --name="Slides MCP"` (or reuse an existing project the user names), then `gcloud services enable slides.googleapis.com drive.googleapis.com sheets.googleapis.com`. No billing account required; the Slides, Drive, and Sheets APIs are free. Every gcloud command executed is included in the tool result so Claude can show the user exactly what ran. **Workspace org-policy branch:** on managed Google Workspace accounts, project creation or the External consent-screen type may be blocked by org policy. The step detects the failure, explains it, and offers the alternatives: reuse an existing project the user can access, provision under a personal Google account (the provisioning identity is independent of the Slides accounts added later), or ask a Workspace admin. Internal user type, where available, is also fine — it removes the unverified-app interstitial entirely.
4. **Consent screen + OAuth client (guided manual).** There is no public API for creating standard Desktop OAuth clients, so this step opens the exact console URLs and returns the checklist for Claude to relay conversationally, one item at a time if the user wants:
   - Branding page (pre-scoped to the right project): app name (pre-suggested), user type **External**, add both scope tiers (including `spreadsheets.readonly`), set publishing status **In production**, acknowledge the unverified-app notice.
   - Clients page: **Create Client → Desktop app → Create → Download JSON**.
   - The step then asks the user (via Claude) for the downloaded `client_secret_*.json` — the primary flow is the user telling Claude the file's path (or pasting its contents), since programmatically watching `~/Downloads` triggers a macOS privacy (TCC) prompt attributed to Claude Desktop and can fail silently if declined. A best-effort Downloads scan runs only as a convenience when permission is already granted. The step validates the JSON, imports it into the Keychain, and deletes the plaintext file after the user confirms.
5. **First account auth.** Runs the PKCE flow (§4.3) for the user's first Slides account; verifies with a live `presentations.create` smoke test followed by a `presentations.get` on the created deck, then trashes it via Drive (`drive.file` covers tool-created files, so cleanup works on both tiers).

There is no Claude Desktop registration step: setup runs through the already-registered server, so installation *is* registration. On completion, `run_setup_step` returns a summary for Claude to relay — accounts configured, scope tier granted — and everything afterwards stays conversational too ("add my work account", "register this deck as my pitch template").

### 5.2 Diagnostics

`run_diagnostics` checks: Keychain entries readable, OAuth client not deleted or disabled upstream, tokens refresh successfully per account, APIs still enabled, template registry entries still resolvable. Every failure maps to a structured, named fix that Claude can relay or, where safe and consented, execute directly. The README's first-aid instruction is a single line: *ask Claude to run diagnostics*. For automation and power users, all setup and diagnostic steps are also invocable headlessly via `node dist/cli.js <command>` from an extracted `.mcpb` (a standard zip archive), but the conversational path is the primary, documented experience.

### 5.3 Setup friction budget

Target: ≤ 10 minutes end-to-end within a single conversation, of which the two console interactions (consent screen, client creation) are the only manual portions, each with a deep link and a checklist Claude relays step by step. Every gcloud action is surfaced to the user verbatim as it runs, so they always see what is executed against their account.

---

## 6. Credential Storage

- **Store:** macOS Keychain (default login keychain) via the system `security` CLI (`find-generic-password` / `add-generic-password`). This is the primary mechanism, not a fallback: it ships with every macOS install and avoids bundling a native `.node` module that would have to match the ABI of Claude Desktop's bundled Node runtime on both arm64 and x64 (`keytar` is deprecated; its successors all ship prebuilt native binaries). Secrets are never passed on `argv` (visible in `ps`) — writes go through `security -i` on stdin, with payloads base64-encoded.
- **Entries:**
  - `slides-mcp.client` → OAuth client ID + client secret JSON (one per configured project).
  - `slides-mcp.account.<email>` → refresh token, granted scopes, tier, added-at timestamp.
  - `slides-mcp.meta` → default account, schema version.
- Access tokens are held in memory only, never persisted.
- No plaintext credential ever remains on disk after setup (the client-import step deletes the downloaded client JSON with user confirmation).
- Keychain ACL: there is no dedicated `slides-mcp` binary — the process is Claude Desktop's bundled Node running a script — so entries are created via and ACL'd to the `security` tool; the standard macOS prompt governs first access after OS or app updates (§9 covers the denied-access path).
- Removing an account (`node dist/cli.js auth remove <email>`, or conversationally via a future account-removal flow) revokes the token with Google (`oauth2.revoke`) and deletes the Keychain entry.
- The template registry (§7.5) is **not** in the Keychain: it contains only deck IDs and friendly names, no secrets, and lives at `~/.config/slides-mcp/templates.json` for easy inspection and versioning.
- Setup progress (§5.1) is likewise outside the Keychain at `~/.config/slides-mcp/state.json`: step-completion flags and the provisioned project ID only, no secrets.
- Note for contributors: the Desktop-app client secret is not treated as confidential by Google's own model, but we store it in the Keychain anyway for hygiene and to keep a single storage story.

---

## 7. MCP Tool Surface

Design constraint: **full API coverage without context-window bloat.** The Slides API's ~50 `batchUpdate` request types are not exposed as 50 tools; they are reachable through one typed passthrough tool, with semantic convenience tools layered on top for the operations Claude performs constantly. Target: ~22 tools.

### 7.1 Setup, diagnostics, and account tools

| Tool | Purpose |
|---|---|
| `get_setup_status` | Setup state machine status and per-step instructions (§5.1) |
| `run_setup_step` | Execute the next or a named setup step (§5.1) |
| `run_diagnostics` | Health checks with structured fixes (§5.2) |
| `list_accounts` | Enumerate configured accounts, scope tier, default flag |
| `authenticate_account` | Launch browser OAuth to add a new account or re-auth an existing one; accepts a `tier` parameter (`core`/`extended`) so scope-tier upgrades are a re-auth, never a console change (5-min timeout) |
| `set_default_account` | Change the default account |

In unconfigured mode (§5), the content tools below return a structured setup-required status pointing Claude to `get_setup_status`; they never fail opaquely.

### 7.2 Presentation lifecycle

| Tool | Purpose |
|---|---|
| `create_presentation` | `presentations.create` (title, optional locale, optional `template` name from the registry — resolved via `files.copy`, extended tier) |
| `get_presentation` | Full deck JSON, with `fields` mask and an optional `summary` mode that returns a compact per-slide digest (IDs, layout, text content, object inventory) to save tokens |
| `get_slide` | Single page (`presentations.pages.get`) |
| `list_presentations` | Drive search for Slides MIME type (extended tier; core tier lists tool-created decks only) |
| `copy_presentation` | `files.copy` for template-driven workflows (extended tier) |
| `delete_presentation` | Drive delete/trash (tier-dependent reach) |
| `export_pdf` | Drive export to PDF, saved to a user-visible path |
| `get_slide_thumbnail` | `pages.getThumbnail`; returns the image so Claude can visually verify layout work |

### 7.3 Content manipulation

| Tool | Purpose |
|---|---|
| `batch_update` | Full passthrough of `presentations.batchUpdate`. Accepts the complete Google request-array schema, validated locally before send. This is the "everything Google allows" guarantee: every current and future request type works without a tool release. |
| `add_slide` | Semantic: create slide from a predefined or theme layout with title/body/placeholder text in one call (compiles to batchUpdate requests) |
| `set_text` | Semantic: replace text of a shape/placeholder by object ID, or `replaceAllText` across the deck |
| `insert_image` | Semantic: accepts a local file path or URL; local files are uploaded to Drive (`drive.file`), made link-readable, inserted via `createImage`, then the temporary permission is scoped back down. Handles the "Slides can only insert publicly fetchable or Drive-resident images" constraint invisibly. |
| `insert_sheets_chart` | Semantic: link a chart from a Google Sheets spreadsheet onto a slide via `createSheetsChart`, in linked or snapshot mode (extended tier; requires `spreadsheets.readonly`) |
| `apply_template_layouts` | Semantic: list a deck's layouts/masters and instantiate slides from them (the bridge between template copies and new content) |

### 7.4 Tool design notes

- Every write tool returns the affected object IDs and the deck's new `revisionId` so Claude can chain edits safely; `batch_update` supports `writeControl.requiredRevisionId` for optimistic concurrency.
- `get_presentation(summary=true)` exists because full deck JSON for a 40-slide deck can exceed 100k tokens; the digest keeps iterative editing viable.
- The thumbnail tool is what makes "everything via API" practically useful: Claude generates EMU-coordinate layouts blind, then inspects the render and self-corrects.
- Errors from Google are translated into structured, actionable messages (`INSUFFICIENT_SCOPE` → "this needs the extended tier; ask me to call `authenticate_account` with `tier: \"extended\"`").

### 7.5 Template registry

A local mapping of friendly names to deck IDs so users (and Claude) can say "use the boxxed pitch template" instead of pasting deck URLs.

| Tool / command | Purpose |
|---|---|
| `register_template` / `node dist/cli.js template add <name> <deck-url-or-id>` | Add or update a named template |
| `list_templates` | Enumerate registered templates with names, IDs, and last-verified status |

Behaviour and constraints:

- Stored in `~/.config/slides-mcp/templates.json` (names, deck IDs, optional per-template default account). No secrets.
- **Template instantiation (`files.copy`) requires the extended tier.** A `drive.file`-only path was investigated and ruled out: the `drive.file` grant for pre-existing files depends on the Google Picker "open with" flow, which cannot run in a headless CLI/MCP context, and a fidelity clone via the Slides API alone is impossible because `batchUpdate` cannot create masters or custom layouts, so a branded theme cannot be replayed into a fresh deck. Rather than ship a degraded clone, core-tier users who register a template get a clear message that instantiating it needs the extended tier (`authenticate_account` with `tier: "extended"`).
- Registered templates are verified by `run_diagnostics` (deck still exists, still readable) and lazily at use time.

---

## 8. Packaging and Distribution

- **GitHub releases are the single distribution channel, and `slides-mcp-<version>.mcpb` is the single artefact.** The MCPB bundle contains the manifest and compiled server, executed on Claude Desktop's bundled Node runtime. `user_config` in the manifest exposes: default account (informational), log level, and scope tier display.
- **Single install path:** download the `.mcpb`, open it (or drag it into Claude Desktop), confirm one dialog. There is no JSON-config path and no npm package (§1.2); headless automation of setup/diagnostic steps (§5.2) runs from an extracted `.mcpb`, which is a standard zip archive.
- **No npm publication.** A registry package would add a second channel to keep in lockstep, an account/token maintenance obligation, and a supply-chain surface (`npx` fetches from the registry at cold start) — all misaligned with the "nothing centralised, minimal maintainer obligation" principle. Users get a pinned, checksum-verifiable artefact instead of auto-updating latest, which is the preferable default for a credential-holding tool.
- **Release integrity:** SHA-256 checksum for the `.mcpb` in the release notes, plus a GitHub artefact attestation linking it to the exact workflow run and commit that built it.
- **Docs shipped with the repo:** README with a 10-minute quickstart, architecture doc, and a FAQ covering the unverified-app interstitial.
- **Build/CI in Docker:** lint, typecheck, unit tests, fixture-based integration tests, MCPB assembly, checksum generation. `docker compose run ci` is the canonical build; contributors never need a local Node toolchain for CI parity. Runtime remains native (see §3).
- Versioning: semver, one artefact per tagged build.

---

## 9. Error Handling and Edge Cases

| Scenario | Behaviour |
|---|---|
| Server started before setup is complete | Unconfigured mode (§5): content tools return a structured setup-required status; Claude detects it, calls `get_setup_status`, and guides the user through the remaining steps. |
| Refresh token revoked/expired mid-session | Auth manager surfaces a structured error naming the account; Claude is instructed (via tool description) to offer `authenticate_account`. Server keeps other accounts working. |
| Consent screen left in "Testing" (7-day token expiry) | `run_diagnostics` detects testing status via token age heuristics + first-refresh failures and names the fix explicitly. The setup flow prevents this state in the happy path. |
| OAuth client auto-deleted by Google (6-month inactivity) | `run_diagnostics` check; recovery is Claude re-running the console step (§5.1 step 4) only. Documented in FAQ. |
| Slides API quota (per-minute) exceeded | Exponential backoff with jitter inside the server; surfaced to Claude only after retries exhaust, with the reset window. |
| Loopback port collision / callback timeout | Ephemeral port retry ×3; 5-minute auth timeout with a clean cancel. |
| Claude Desktop kills the process mid-write | All writes are single `batchUpdate` calls (atomic on Google's side); no local state to corrupt. |
| Keychain access denied after app update | Detected at startup; server responds to every tool call with the one-line fix rather than crashing, so the failure is visible inside the conversation. |
| Registered template deleted or access lost | `run_diagnostics` flags it; at use time the error names the template and offers re-registration. |
| Sheets chart source spreadsheet inaccessible | `insert_sheets_chart` returns a structured error distinguishing missing scope (upgrade path) from missing sharing (ask the sheet owner). |
| Two Claude Desktop windows / concurrent sessions | Server is stateless per request; Keychain and Google handle concurrency; `requiredRevisionId` protects deliberate edit chains. |
| Workspace org policy blocks project creation or External consent type | Setup step 3 detects the failure and offers the documented alternatives: existing project, personal provisioning account, Internal user type (no interstitial), or admin escalation (§5.1). FAQ entry. |
| `~/Downloads` unreadable (TCC declined) | Client-JSON import proceeds via the primary conversational path — user gives Claude the file path or contents (§5.1 step 4); no hard dependency on Downloads access. |
| `gcloud`/`brew` not on the GUI process `PATH` | All external binaries resolved via absolute-path probing (§5.1 step 1); never `PATH`-dependent. |

Logging: structured logs to `~/Library/Logs/slides-mcp/` (rotated), never containing tokens or document content above title level. `--log-level=debug` opt-in for troubleshooting.

---

## 10. Security and Privacy

- All traffic is direct user-machine ↔ Google over TLS. No telemetry, no analytics, no maintainer-visible anything.
- Tokens: Keychain at rest, memory at runtime, revocable via `auth remove` and Google's account permissions page (documented).
- Least privilege by default (core tier); broad Drive scope and Sheets read access are an explicit, explained opt-in.
- The unverified-app interstitial is documented honestly in the README, and Claude names the exact screens Google will show during guided setup: users are approving *their own* application.
- Supply-chain: single distribution channel (GitHub releases) with SHA-256 checksums and artefact attestations; no registry dependency at install or runtime; minimal dependency tree (per-API `@googleapis/*` packages — not the monolithic `googleapis` — plus the MCP SDK; Keychain access via the system `security` CLI, zero native modules).

---

## 11. Milestones

| Milestone | Scope |
|---|---|
| **M1: Core loop** | PKCE auth (single account), Keychain storage, `create_presentation`, `get_presentation`, `batch_update`, installable as an MCPB. Proves the architecture end-to-end. |
| **M2: Claude-guided setup** | Setup engine state machine (`get_setup_status`, `run_setup_step`, persisted progress, unconfigured mode), gcloud automation, guided console steps, client JSON import, `run_diagnostics`, production-status enforcement, all scopes (both tiers, including `spreadsheets.readonly`) registered on the consent screen. |
| **M3: Full surface** | All §7 tools, two-tier scopes, thumbnails, image upload pipeline, `insert_sheets_chart`, template registry (§7.5), PDF export. |
| **M4: Multi-account** | Account CRUD tools, per-call `account` param, default account, per-template default account. |
| **M5: Distribution** | Release automation for the single `.mcpb` artefact, checksummed and attested (GitHub releases as sole channel), README/FAQ, Docker CI, tagged v1.0. |
