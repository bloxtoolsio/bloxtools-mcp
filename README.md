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
2. A **Personal Access Token (PAT)** — mint one in the dashboard. It starts with `blxt_`. Give it
   the `read` scope; add `manage` if you want the agent to be able to triage (change statuses).
3. *(Optional, for decrypting source context)* the per-game **project key** BloxTools generated
   when you set up source upload, and the path to your Rojo `sourcemap.json`.

## Install / connect

The package is published to npm, so you don't need to clone anything — `npx` will fetch and run it.

### Claude Code / Claude Desktop (CLI)

```bash
claude mcp add bloxtools \
  --env BLOXTOOLS_PAT=blxt_your_token_here \
  --env BLOXTOOLS_API_URL=https://bloxtools-backend-production.up.railway.app \
  --env BLOXTOOLS_DASH_URL=https://bloxtools.io \
  --env BLOXTOOLS_PROJECT_KEYS='{"<gameId>":"<44-char-base64-key>"}' \
  --env BLOXTOOLS_SOURCEMAP=/path/to/your/sourcemap.json \
  -- npx -y @bloxtools/mcp-server
```

### `.mcp.json` / config-block form

```json
{
  "mcpServers": {
    "bloxtools": {
      "command": "npx",
      "args": ["-y", "@bloxtools/mcp-server"],
      "env": {
        "BLOXTOOLS_PAT": "blxt_your_token_here",
        "BLOXTOOLS_API_URL": "https://bloxtools-backend-production.up.railway.app",
        "BLOXTOOLS_DASH_URL": "https://bloxtools.io",
        "BLOXTOOLS_PROJECT_KEYS": "{\"<gameId>\":\"<44-char-base64-key>\"}",
        "BLOXTOOLS_SOURCEMAP": "/path/to/your/sourcemap.json"
      }
    }
  }
}
```

## Environment variables

| Variable | Required | Default | Purpose |
|---|---|---|---|
| `BLOXTOOLS_PAT` | **yes** | — | Personal Access Token (`blxt_…`). Mint **read** (+ **manage** for triage writes) in the dashboard. |
| `BLOXTOOLS_API_URL` | recommended | `http://localhost:3000` | BloxTools API base URL. For the hosted service use `https://bloxtools-backend-production.up.railway.app`. |
| `BLOXTOOLS_DASH_URL` | recommended | `http://localhost:3001` | Dashboard base URL; drives the `dashUrl` deep links in every payload. For the hosted dashboard use `https://bloxtools.io`. |
| `BLOXTOOLS_PROJECT_KEYS` | for source decrypt | — | JSON map `{ "<gameId>": "<base64key>" }` of per-game project keys. |
| `BLOXTOOLS_PROJECT_KEY_<id>` | for source decrypt | — | Per-game key; `<id>` is the gameId with dashes stripped. Wins over the JSON map. |
| `BLOXTOOLS_SOURCEMAP` | for `resolve_instance_path` | `./sourcemap.json` (if present) | Path to a Rojo `sourcemap.json`. |

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
