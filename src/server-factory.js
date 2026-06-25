/**
 * Builds a configured McpServer: registers read tools always, write tools only
 * when `canManage`, plus the two prompts and the open-errors resource. Pure
 * wiring — no env reads, no stdio — so it is unit-testable and reusable by the
 * inspector/seam-audit script. Secrets live in `client`/`config`; nothing here
 * logs them.
 */
import { McpServer, ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import { READ_TOOLS, WRITE_TOOLS } from './tools/index.js';
import {
  triageErrorsPrompt,
  fixTopCrashPrompt,
  performanceReviewPrompt,
  revenueReviewPrompt,
} from './prompts.js';
import {
  ERRORS_URI_TEMPLATE,
  makeErrorsResourceList,
  makeErrorsResourceRead,
  PERFORMANCE_URI_TEMPLATE,
  makePerformanceResourceList,
  makePerformanceResourceRead,
  MONETIZATION_URI_TEMPLATE,
  makeMonetizationResourceList,
  makeMonetizationResourceRead,
} from './resources.js';

const SERVER_INFO = { name: 'bloxtools', version: '0.1.0' };

/** A tool result wrapping a JSON-able object as text + structuredContent. */
function toResult(data) {
  return {
    content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
    structuredContent: data,
  };
}

/** A legible error result (isError) — never leaks secrets (handlers don't put them in errors). */
function toErrorResult(message, hint) {
  const payload = hint ? { error: message, hint } : { error: message };
  return { content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }], isError: true };
}

function registerTool(server, deps, tool) {
  server.registerTool(
    tool.name,
    {
      title: tool.title,
      description: tool.description,
      inputSchema: tool.inputSchema,
    },
    async (args) => {
      try {
        const data = await tool.handler(deps, args ?? {});
        return toResult(data);
      } catch (err) {
        // ApiError carries status + optional hint; anything else → generic message.
        return toErrorResult(err?.message ?? 'Tool failed', err?.hint);
      }
    },
  );
}

/**
 * @param {object} deps  { client, dash, config }
 * @param {object} scope { canManage: boolean }
 * @returns {{ server: McpServer, toolNames: string[] }}
 */
export function buildServer(deps, scope) {
  const server = new McpServer(SERVER_INFO);
  const toolNames = [];

  for (const tool of READ_TOOLS) {
    registerTool(server, deps, tool);
    toolNames.push(tool.name);
  }
  if (scope?.canManage) {
    for (const tool of WRITE_TOOLS) {
      registerTool(server, deps, tool);
      toolNames.push(tool.name);
    }
  }

  // Prompts.
  server.registerPrompt(
    'triage_errors',
    {
      title: 'Triage errors',
      description:
        'Orient on recent errors (digest), review the top open groups, and propose + optionally apply triage statuses.',
      argsSchema: {
        gameId: z.string().optional().describe('Game id; omit to have the agent pick via list_games.'),
        window: z.string().optional().describe('Look-back window, e.g. 24h, 7d (default 24h).'),
      },
    },
    ({ gameId, window }) => ({
      messages: [
        {
          role: 'user',
          content: { type: 'text', text: triageErrorsPrompt({ gameId, window }) },
        },
      ],
    }),
  );

  server.registerPrompt(
    'fix_top_crash',
    {
      title: 'Fix the top crash',
      description:
        'Walk the top crash from group → sampled events → decrypted source → local file → a concrete fix plan.',
      argsSchema: {
        gameId: z.string().optional().describe('Game id; omit to have the agent pick via list_games.'),
        window: z.string().optional().describe('Look-back window, e.g. 24h, 7d (default 24h).'),
      },
    },
    ({ gameId, window }) => ({
      messages: [
        {
          role: 'user',
          content: { type: 'text', text: fixTopCrashPrompt({ gameId, window }) },
        },
      ],
    }),
  );

  server.registerPrompt(
    'performance_review',
    {
      title: 'Review performance',
      description:
        'Orient on perf health (digest), single out the worst client platform, chart the trend (series), and propose concrete perf fixes.',
      argsSchema: {
        gameId: z.string().optional().describe('Game id; omit to have the agent pick via list_games.'),
        window: z.string().optional().describe('Look-back window in days, e.g. 7, 30 (default 7).'),
      },
    },
    ({ gameId, window }) => ({
      messages: [
        {
          role: 'user',
          content: { type: 'text', text: performanceReviewPrompt({ gameId, window }) },
        },
      ],
    }),
  );

  server.registerPrompt(
    'revenue_review',
    {
      title: 'Review monetization',
      description:
        'Orient on revenue health (digest), inspect the top items + whales, chart the trend (series), and propose concrete monetization improvements.',
      argsSchema: {
        gameId: z.string().optional().describe('Game id; omit to have the agent pick via list_games.'),
        window: z.string().optional().describe('Look-back window in days, e.g. 30, 90 (default 30).'),
      },
    },
    ({ gameId, window }) => ({
      messages: [
        {
          role: 'user',
          content: { type: 'text', text: revenueReviewPrompt({ gameId, window }) },
        },
      ],
    }),
  );

  // Resource: per-game open-errors snapshot, listed dynamically from list_games.
  server.registerResource(
    'game-errors',
    new ResourceTemplate(ERRORS_URI_TEMPLATE, {
      list: makeErrorsResourceList(deps.client, deps.dash),
    }),
    {
      title: 'Open errors snapshot',
      description: 'Current open error groups for a game, as JSON.',
      mimeType: 'application/json',
    },
    makeErrorsResourceRead(deps.client, deps.dash),
  );

  // Resource: per-game performance digest snapshot, listed dynamically from list_games.
  server.registerResource(
    'game-performance',
    new ResourceTemplate(PERFORMANCE_URI_TEMPLATE, {
      list: makePerformanceResourceList(deps.client, deps.dash),
    }),
    {
      title: 'Performance digest snapshot',
      description: 'Current performance digest (headline cards, worst platform, top marks) for a game, as JSON.',
      mimeType: 'application/json',
    },
    makePerformanceResourceRead(deps.client, deps.dash),
  );

  // Resource: per-game monetization digest snapshot, listed dynamically from list_games.
  server.registerResource(
    'game-monetization',
    new ResourceTemplate(MONETIZATION_URI_TEMPLATE, {
      list: makeMonetizationResourceList(deps.client, deps.dash),
    }),
    {
      title: 'Monetization digest snapshot',
      description: 'Current revenue digest (headline, top items, top whales) for a game, as JSON.',
      mimeType: 'application/json',
    },
    makeMonetizationResourceRead(deps.client, deps.dash),
  );

  return { server, toolNames };
}

export { toResult, toErrorResult, SERVER_INFO };
