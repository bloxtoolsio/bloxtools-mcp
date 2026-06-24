# BloxTools MCP server

`@bloxtools/mcp-server` is a local [Model Context Protocol](https://modelcontextprotocol.io)
server that makes an AI agent a first-class [BloxTools](https://bloxtools.io) client. Connect it
to Claude (or any MCP client) and the agent can:

- **orient** — "what changed in my errors since yesterday?"
- **drill** — error groups → sampled events → the **real decrypted source** around the crash line
- **fix** — resolve a crashing instance path to a local file via your Rojo sourcemap
- **close the loop** — triage errors, reports, and issues — without opening the dashboard

It is `stdio`-only (it runs locally on your machine) and talks to the public BloxTools API over
HTTP. It depends only on `@modelcontextprotocol/sdk` and `zod`.

[BloxTools](https://bloxtools.io) is an error-monitoring and crash-triage service for Roblox
games. See also the companion Studio plugin,
[`bloxtools-plugin`](https://github.com/bloxtoolsio/bloxtools-plugin).

## What you need

1. A **BloxTools account** — sign up at [https://bloxtools.io](https://bloxtools.io).
2. Your **access token** — the dashboard auto-provisions a single combined token (starts with
   `blxt_`, already scoped read + upload + manage) and shows it on your setup page. The same token
   powers both the Studio plugin and this MCP server — there's no scope to pick. Copy it into
   `BLOXTOOLS_PAT`.

That's everything required. Two **optional** features can be layered on later (see
[Optional: decrypt source & resolve paths](#optional-decrypt-source--resolve-paths)).

## Install / connect

The package is published to npm, so you don't need to clone anything — `npx` will fetch and run it.
The production API and dashboard URLs are **baked into the package as defaults**, so the only
variable you must set is `BLOXTOOLS_PAT`. Pick your client:

<details>
<summary><b>Claude Code (CLI)</b></summary>

```bash
claude mcp add bloxtools -e BLOXTOOLS_PAT=blxt_your_token -- npx -y @bloxtools/mcp-server
```

Optional — add one (or both) of the independent extras (see notes below):

```bash
# Decrypt plugin-uploaded source for one game (project key):
claude mcp add bloxtools \
  -e BLOXTOOLS_PAT=blxt_your_token \
  -e BLOXTOOLS_PROJECT_KEY_<gameId>=<44-char-base64-key> \
  -- npx -y @bloxtools/mcp-server

# Resolve instance paths to local files (Rojo sourcemap):
claude mcp add bloxtools \
  -e BLOXTOOLS_PAT=blxt_your_token \
  -e BLOXTOOLS_SOURCEMAP=/path/to/your/sourcemap.json \
  -- npx -y @bloxtools/mcp-server
```
</details>

<details>
<summary><b>Claude Desktop (GUI)</b></summary>

Edit `claude_desktop_config.json` (Settings → Developer → Edit Config) and add:

```json
{
  "mcpServers": {
    "bloxtools": {
      "command": "npx",
      "args": ["-y", "@bloxtools/mcp-server"],
      "env": {
        "BLOXTOOLS_PAT": "blxt_your_token"
      }
    }
  }
}
```

Optional extras — add either/both to the `env` block (independent features, see notes below):

```json
"env": {
  "BLOXTOOLS_PAT": "blxt_your_token",
  "BLOXTOOLS_PROJECT_KEY_<gameId>": "<44-char-base64-key>",
  "BLOXTOOLS_SOURCEMAP": "/path/to/your/sourcemap.json"
}
```
</details>

<details>
<summary><b>Codex (CLI + GUI)</b></summary>

Add an `[mcp_servers.bloxtools]` table to `~/.codex/config.toml`:

```toml
[mcp_servers.bloxtools]
command = "npx"
args = ["-y", "@bloxtools/mcp-server"]
env = { BLOXTOOLS_PAT = "blxt_your_token" }
```

Optional extras — add either/both to the `env` table (independent features, see notes below):

```toml
[mcp_servers.bloxtools]
command = "npx"
args = ["-y", "@bloxtools/mcp-server"]
env = { BLOXTOOLS_PAT = "blxt_your_token", BLOXTOOLS_PROJECT_KEY_<gameId> = "<44-char-base64-key>", BLOXTOOLS_SOURCEMAP = "/path/to/your/sourcemap.json" }
```
</details>

<details>
<summary><b>Cursor / Windsurf / VS Code</b></summary>

These editors share the `{"mcpServers": {...}}` config shape (Cursor: `~/.cursor/mcp.json`;
Windsurf: `~/.codeium/windsurf/mcp_config.json`; VS Code: `.vscode/mcp.json` or user settings):

```json
{
  "mcpServers": {
    "bloxtools": {
      "command": "npx",
      "args": ["-y", "@bloxtools/mcp-server"],
      "env": {
        "BLOXTOOLS_PAT": "blxt_your_token"
      }
    }
  }
}
```

Optional extras — add either/both to the `env` block (independent features, see notes below):

```json
"env": {
  "BLOXTOOLS_PAT": "blxt_your_token",
  "BLOXTOOLS_PROJECT_KEY_<gameId>": "<44-char-base64-key>",
  "BLOXTOOLS_SOURCEMAP": "/path/to/your/sourcemap.json"
}
```
</details>

### Optional: decrypt source & resolve paths

`BLOXTOOLS_PROJECT_KEY_<gameId>` and `BLOXTOOLS_SOURCEMAP` are **two independent, optional
features** — set neither, either, or both:

- **`BLOXTOOLS_PROJECT_KEY_<gameId>`** (project key) — decrypts the source the **plugin uploaded**
  so `get_source_context` can show the real lines around a crash. `<gameId>` is your gameId with
  dashes stripped. Copy the key from the dashboard.
- **`BLOXTOOLS_SOURCEMAP`** (Rojo sourcemap) — feeds the separate **`resolve_instance_path`** tool,
  mapping a crashing instance path to a local file on disk.

## Environment variables

| Variable | Required | Default | Purpose |
|---|---|---|---|
| `BLOXTOOLS_PAT` | **yes** | — | Combined access token (`blxt_…`), auto-minted in the dashboard (read + upload + manage). |
| `BLOXTOOLS_API_URL` | optional | `https://bloxtools-backend-production.up.railway.app` | BloxTools API base URL. Defaulted to the hosted service; override only for self-hosting/local dev. |
| `BLOXTOOLS_DASH_URL` | optional | `https://bloxtools.io` | Dashboard base URL; drives the `dashUrl` deep links in every payload. Defaulted to the hosted dashboard. |
| `BLOXTOOLS_PROJECT_KEYS` | optional (source decrypt) | — | JSON map `{ "<gameId>": "<base64key>" }` of per-game project keys. |
| `BLOXTOOLS_PROJECT_KEY_<id>` | optional (source decrypt) | — | Per-game key; `<id>` is the gameId with dashes stripped. Wins over the JSON map. |
| `BLOXTOOLS_SOURCEMAP` | optional (`resolve_instance_path`) | `./sourcemap.json` (if present) | Path to a Rojo `sourcemap.json`. |

The PAT and project keys are **secrets**. They are read from env, used only to authenticate to the
API (PAT) and to decrypt locally (keys), and are **never** logged, echoed, or placed in any tool
output or error message.

## Zero-knowledge source context (the differentiator)

BloxTools stores your source **encrypted** (AES-256-GCM); the backend never has the key.
`get_source_context` fetches the ciphertext, then decrypts it **locally** with the project key you
configured — on **your** machine — and hands the agent the real source lines around the crash.

- The **decrypted source flows to your agent. That is the feature**: you configured the key on your
  own machine, so the agent you trust can read your code.
- The **key never leaves the machine**: it is never sent in any request, never logged, and never
  appears in any tool result. A wrong key is reported by fingerprint (8 hex chars), never by
  revealing key bytes.

This is something a hosted error tracker structurally cannot offer.

## Scopes: read vs read+manage

The server probes your PAT's scopes at startup (`GET /api/account/token-info`):

- **read** — all the read tools (list/get/digest/source/resolve).
- **read + manage** — additionally registers the three **triage write** tools
  (`set_error_group_status`, `set_report_status`, `set_issue_status`). The `manage` scope grants
  only those three triage mutations — no access to keys, tokens, or alert channels.

If the PAT lacks `manage`, the write tools are **not registered at all**, so the agent never sees a
tool it can't use. Triage writes are part of BloxTools' paid (Pro+) tiers; if your plan or token
doesn't grant `manage`, the server simply runs read-only. (Against an older backend build that
doesn't serve `token-info`, the server assumes **read-only** and says so on stderr.)

## Tools

Reads (need `read`): `list_games`, `get_overview`, `get_error_digest`, `list_error_groups`,
`get_error_group`, `list_error_events`, `get_source_context`, `list_reports`, `get_report`,
`list_issues`, `get_issue`, `get_alert_log`, `resolve_instance_path`.

Writes (need `manage`): `set_error_group_status`, `set_report_status`, `set_issue_status`.

Prompts: `triage_errors`, `fix_top_crash`. Resource: `bloxtools://games/{gameId}/errors`
(open-groups snapshot, listed per game).

## First session (5 lines)

```
You: What changed in my game's errors in the last day?
Agent → get_error_digest(gameId, window="24h")  → new groups, regressions, spikes, top movers
You: Show me the top crash and its source.
Agent → list_error_groups → list_error_events → get_source_context (real decrypted lines) → resolve_instance_path (local file)
You: Mark it resolved.   →  Agent → set_error_group_status(status="resolved")
```

## Develop

```bash
git clone https://github.com/bloxtoolsio/bloxtools-mcp.git
cd bloxtools-mcp
npm install
npm test          # handler unit tests (mocked client; no backend, no network)
```

See [CONTRIBUTING.md](CONTRIBUTING.md) for the PR flow and [SECURITY.md](SECURITY.md) for how to
report a vulnerability.

## License

[MIT](LICENSE) © 2026 BloxTools
