#!/usr/bin/env node
/**
 * BloxTools MCP server — entry point. Local stdio server (stdio only;
 * remote HTTP+OAuth is a later milestone). Connect with:
 *
 *   claude mcp add bloxtools -- npx -y @bloxtools/mcp-server
 *
 * Startup sequence:
 *   1. Load + validate env config (fail fast with an actionable message).
 *   2. Probe the PAT's scopes via GET /api/account/token-info. A pre-merge
 *      backend that 404s the probe → assume read-only and say so on stderr.
 *      A 401 → crisp error + exit. Unreachable API → error + exit.
 *   3. Build the server (read tools always; write tools only with `manage`).
 *   4. Connect stdio.
 *
 * ALL diagnostics go to STDERR — stdout is the MCP transport. The PAT and every
 * project key are NEVER logged (we print only tokenLast4 / scope names / counts).
 */
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

import { loadConfig, redact } from './src/config.js';
import { createApiClient } from './src/api.js';
import { makeDashLinks } from './src/dash.js';
import { probeScopes } from './src/scope.js';
import { buildServer } from './src/server-factory.js';

const log = (msg) => process.stderr.write(`[bloxtools-mcp] ${redact(String(msg))}\n`);

async function main() {
  let config;
  try {
    config = loadConfig(process.env);
  } catch (err) {
    log(`startup error: ${err.message}`);
    process.exit(1);
  }

  const client = createApiClient({ apiUrl: config.apiUrl, pat: config.pat });
  const dash = makeDashLinks(config.dashUrl);

  let scope;
  try {
    scope = await probeScopes(client);
  } catch (err) {
    log(`cannot start: ${err.message}${err.hint ? ` — ${err.hint}` : ''}`);
    process.exit(1);
  }

  if (scope.degraded) {
    log(
      'token-info not available (pre-merge backend: 404 no route, or 403 session-only) — ' +
        'assuming READ-ONLY; write/triage tools will NOT be registered.',
    );
  } else {
    log(
      `connected as ${scope.name ?? 'PAT'} (…${scope.tokenLast4 ?? '????'}); ` +
        `scopes: ${scope.scopes.join(', ') || '(none)'}.`,
    );
    if (!scope.canManage) {
      log('no `manage` scope — triage write tools omitted. Mint read+manage to enable them.');
    }
  }

  const { server, toolNames } = buildServer({ client, dash, config }, scope);
  log(`registered ${toolNames.length} tools: ${toolNames.join(', ')}`);

  const transport = new StdioServerTransport();
  await server.connect(transport);
  log(`ready on stdio → API ${config.apiUrl}, dash ${config.dashUrl}`);
}

main().catch((err) => {
  log(`fatal: ${err?.message ?? err}`);
  process.exit(1);
});
