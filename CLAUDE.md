# slides-mcp

A macOS-only MCP server giving Claude Desktop full programmatic control of
Google Slides. Canonical spec: `google-slides-mcp-prd-v7.md` (Draft v8;
`prd.md` is a symlink to it — always edit the target, never delete either).

## Architecture constraints (from the PRD — do not violate)

- **Stateless tool handlers** (§3): every `tools/call` independently resolves
  account → Keychain → token → API call. Only two in-memory caches are
  permitted: the per-account access-token cache and the Keychain handle.
- **Keychain via the system `security` CLI** (§6): no native `.node` modules,
  ever (MCPB runs on Claude Desktop's bundled Node; ABI mismatch risk).
  Secrets never on argv — write via `security -i` stdin, base64 payloads.
- **Access tokens live in memory only**; refresh tokens and client config in
  the Keychain; nothing secret on disk.
- **Minimal deps** (§10): per-API `@googleapis/*` packages, never the
  monolithic `googleapis`. MCP SDK pinned to 1.x; zod pinned ^3.25 (SDK 1.x
  breaks with zod v4).
- `batch_update` is a full passthrough — no shadow schema of Google's
  request types.
- stdout is the MCP channel; log to stderr only.

## Workflow

- One-ticket-one-PR: branch `feature/NNN-slug` per issue, PR body `Closes #NNN`.
- Roadmap: GitHub milestones v0.1.0–v1.0.0, epics #1–#5 with sub-issues.
- `docker compose run ci` is the canonical build; `make dev` runs natively.
- Keychain integration tests are macOS-only (`make test-mac`); they self-skip
  in Docker.

## Indentation

- ts: tabs
- yml,yaml: 2 spaces
- default: tabs
