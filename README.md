# slides-mcp

A macOS [MCP](https://modelcontextprotocol.io) server that gives Claude
Desktop full programmatic control of **Google Slides**. Ask Claude for a
deck and it creates, reads, and edits real presentations in your Google
account — not PPTX files.

- **Your own Google Cloud, not ours.** There is no shared OAuth
  application, no hosted component, and no telemetry. You provision a
  personal Google Cloud project once (Claude automates most of it), and
  everything afterwards is your machine talking directly to Google over
  TLS.
- **Credentials live in the macOS Keychain.** Refresh tokens and the
  OAuth client are stored in your login keychain; access tokens exist in
  memory only; no secret ever sits in a plaintext file.
- **The full Slides API, not a curated subset.** A `batch_update`
  passthrough exposes every request type Google supports, with semantic
  convenience tools layered on top.

> **Status:** pre-1.0. The core loop (M1) and Claude-guided setup (M2)
> are complete; the full tool surface, multi-account support, and signed
> release artefacts are in progress — see the
> [milestones](../../milestones).

## How it works

```
┌────────────────┐   stdio (MCP)   ┌──────────────────┐   HTTPS   ┌─────────────┐
│ Claude Desktop  │ ◄─────────────► │  slides-mcp       │ ◄───────► │ Google APIs │
│                 │                 │  (local Node proc)│           │ Slides v1   │
└────────────────┘                 │                   │           │ Drive v3    │
                                   │   Auth manager ◄──┼──── macOS Keychain
                                   │   Setup engine ───┼──── gcloud CLI + browser
                                   └──────────────────┘
```

Claude Desktop spawns the server as an invisible child process and talks
to it over stdio. Every tool call is stateless: it independently resolves
the target account, reads credentials from the Keychain, refreshes an
access token if needed, calls Google, and returns. Killing the process at
any moment loses nothing.

Authentication is the standard OAuth **Authorization Code + PKCE** flow
for desktop apps: the server opens your browser, you sign in with Google,
and the callback lands on a temporary localhost listener that exists only
for the seconds the sign-in takes.

## Installation

The supported install is a one-click **`.mcpb` bundle** (open it, or drag
it into Claude Desktop, confirm one dialog). Until the first tagged
release is published, build it from source:

```sh
git clone https://github.com/jaderfeijo/google-slides-mcp.git
cd google-slides-mcp
make bundle          # builds out/slides-mcp-<version>.mcpb + SHA-256 checksum
open out/slides-mcp-*.mcpb
```

Requirements: macOS (the Keychain dependency is deliberate; Windows/Linux
are out of scope for v1) and Claude Desktop. Node is only needed to build
— the bundle runs on Claude Desktop's own runtime.

## Setup

There is no installer and no wizard. Install the bundle, then simply ask
Claude for a deck. The server detects it is unconfigured, and Claude
walks you through a one-time setup conversationally — about **10
minutes**, resumable at any point if you close the app mid-way.

Behind the scenes, setup is a five-step state machine. Claude runs each
step through the server, shows you **every command before or as it
executes**, and asks before anything that opens a browser, creates cloud
resources, or installs software:

| Step | What happens | Automated? |
|---|---|---|
| 1. Preflight | Finds the Google Cloud CLI (`gcloud`); offers to install it via Homebrew if missing | ✅ (install needs your consent) |
| 2. Provisioning sign-in | `gcloud auth login` — any Google account; used only to create infrastructure | ✅ (browser sign-in) |
| 3. Project provisioning | Creates a dedicated free project (`slides-mcp-…`) and enables the Slides, Drive, and Sheets APIs — or reuses a project you name | ✅ |
| 4. Consent screen + OAuth client | **Manual** — see below | ❌ Google provides no API for this |
| 5. First account sign-in | Browser sign-in for the account whose Slides you'll edit, then a live verification (a throwaway deck is created and immediately trashed) | ✅ |

No billing account is ever required — the Slides, Drive, and Sheets APIs
are free.

### The manual Google Cloud steps (step 4)

Google offers **no API for creating a standard Desktop OAuth client**, so
this part is done by hand in the Google Cloud console. Claude gives you
direct links (already scoped to your new project) and walks you through
this checklist item by item:

1. **Branding** — set an app name (e.g. *"Slides MCP (personal)"*) and
   your email address.
2. **Audience** — user type **External**. (On a Google Workspace account,
   **Internal** also works and removes the unverified-app warning
   entirely.)
3. **Data access** — add all four scopes, so upgrading tiers later never
   requires another console visit:
   - `https://www.googleapis.com/auth/presentations`
   - `https://www.googleapis.com/auth/drive.file`
   - `https://www.googleapis.com/auth/drive`
   - `https://www.googleapis.com/auth/spreadsheets.readonly`
4. **Audience → Publishing status** — set to **In production**. This
   matters: in *Testing* status Google expires every sign-in after 7
   days, which silently breaks the tool a week later.
5. **Clients** — *Create Client* → application type **Desktop app** →
   *Create* → **Download JSON**.
6. Hand the downloaded `client_secret_*.json` to Claude — paste its
   contents into the chat, or give the file path. It is imported into
   the Keychain, and Claude asks your permission to delete the plaintext
   file.

**About the "unverified app" screen:** when you sign in (step 5), Google
shows a warning that the app is unverified. This is expected and safe to
proceed past (*Advanced → continue*): the "app" is your own private OAuth
client, in your own project, that only you can use. Verification is a
process for apps distributed to other people — this one never is.

### Scope tiers

| Tier | Scopes | What it enables |
|---|---|---|
| **Core** (default) | `presentations`, `drive.file` | Full read/write on all your decks; Drive access only to files the tool itself creates |
| **Extended** (opt-in) | + `drive`, `spreadsheets.readonly` | Copying existing decks as templates, listing/searching all decks, exporting any deck to PDF, linking live Sheets charts |

You choose at setup and can upgrade later with a single re-
authentication — no console changes needed.

### If something breaks

Ask Claude to **run diagnostics**. Every check (Keychain access, OAuth
client health, token validity, API enablement, the Testing-status
signature) maps to a named fix that Claude can relay or, with your
consent, execute.

## Tools

| Tool | Purpose |
|---|---|
| `create_presentation` | Create a deck; returns its ID, revision, and URL |
| `get_presentation` | Full deck JSON, with an optional field mask |
| `batch_update` | Full passthrough of `presentations.batchUpdate` — every request type the Slides API supports |
| `get_setup_status` | Where the one-time setup stands |
| `run_setup_step` | Execute the next (or a named) setup step |
| `run_diagnostics` | Health checks with named fixes |

More tools (thumbnails, PDF export, image upload, Sheets charts, template
registry, multi-account) arrive with milestones M3 and M4.

## Headless / development usage

Everything is also runnable without Claude via the Makefile (`make` lists
all targets):

```sh
make test            # unit tests (portable)
make test-mac        # + real-Keychain integration tests
make ci              # canonical build in Docker: typecheck, tests, bundle
make run             # run the MCP server on stdio
make inspect         # list tools via MCP Inspector
make auth-status     # show configured client and account
make diagnostics     # health checks
```

Setup steps are equally scriptable:
`node dist/cli.js setup status`, `node dist/cli.js setup step …`,
`node dist/cli.js auth import <client_secret.json>`, and so on.

## Security and privacy

- Traffic goes exclusively from your machine to Google. No telemetry, no
  analytics, nothing a maintainer can see.
- Refresh tokens and the OAuth client config rest in the macOS Keychain;
  access tokens are held in memory only.
- Secrets are never passed on process argv or written to plaintext files.
- Least privilege by default (core tier); broad Drive access is an
  explicit, explained opt-in.
- Revoke at any time: ask Claude to remove the account, run
  `node dist/cli.js auth remove`, or use
  [Google's account permissions page](https://myaccount.google.com/permissions).

## License

[MIT](LICENSE)
