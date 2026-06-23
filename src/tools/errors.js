/**
 * Error-group read tools: list_error_groups, get_error_group, list_error_events.
 *
 * list_error_groups passes Track A's new filters (q, sort, since, order) straight
 * through. A pre-merge backend ignores the unknown params and returns the S1
 * order — that is a graceful degrade, not an error; we never assume the filter
 * was honoured.
 */
import { z } from 'zod';
import { gameIdSchema, limitSchema, cursorSchema, paginated, previewText } from './shared.js';

const ERROR_STATUSES = ['open', 'resolved', 'ignored'];

function presentGroup(g, dash, gameId) {
  const topFrame =
    g.topPath || g.topFn ? { path: g.topPath ?? null, fn: g.topFn ?? null } : null;
  return {
    id: g.id,
    status: g.status,
    message: previewText(g.message),
    surface: g.surface ?? null,
    count: g.count ?? 0,
    topFrame,
    versionRange:
      g.firstVersion != null || g.lastVersion != null
        ? { first: g.firstVersion ?? null, last: g.lastVersion ?? null }
        : null,
    firstSeen: g.firstSeen ?? null,
    lastSeen: g.lastSeen ?? null,
    dashUrl: dash.errorGroup(gameId, g.id),
  };
}

export const listErrorGroups = {
  name: 'list_error_groups',
  title: 'List error groups',
  description:
    'List a game’s aggregated error groups (one row per distinct crash signature), newest or most ' +
    'frequent first. Filter by status (open/resolved/ignored), substring `q` (matches message + top ' +
    'frame), `since` (ISO; groups seen at/after it), and `sort`. This is the drill-in tool after a ' +
    'digest: pick a group id, then call get_error_group for the version range + daily series, or ' +
    'list_error_events for sampled frames. Returns `{ items, hasMore }`; raise `limit` or refine `q` ' +
    'to narrow.',
  inputSchema: {
    gameId: gameIdSchema,
    status: z.enum(ERROR_STATUSES).optional().describe('Filter by triage status.'),
    q: z.string().optional().describe('Case-insensitive substring of message or top frame path.'),
    sort: z
      .enum(['count', 'last_seen', 'first_seen'])
      .optional()
      .describe('Order by occurrence count or recency.'),
    order: z.enum(['asc', 'desc']).optional().describe('Sort direction.'),
    since: z.string().optional().describe('ISO timestamp; only groups with lastSeen ≥ since.'),
    limit: limitSchema,
  },
  async handler({ client, dash }, { gameId, status, q, sort, order, since, limit }) {
    const data = await client.get(`/api/games/${gameId}/errors`, {
      query: { status, q, sort, order, since, limit },
    });
    const rows = data?.errors ?? [];
    const items = rows.map((g) => presentGroup(g, dash, gameId));
    // The S1 list wire is a bare array (no cursor). If A adds hasMore/cursor we
    // pass it through; otherwise infer hasMore from a full page.
    return paginated(items, {
      nextCursor: data?.nextCursor ?? null,
      hasMore: data?.hasMore ?? rows.length >= limit,
    });
  },
};

export const getErrorGroup = {
  name: 'get_error_group',
  title: 'Get an error group',
  description:
    'Full detail for one error group: aggregates, status, affected place-version range, top frame, ' +
    'and a daily occurrence series. Call after list_error_groups (or a digest) to understand a single ' +
    'crash’s shape and trend before pulling sampled events or source context.',
  inputSchema: {
    gameId: gameIdSchema,
    groupId: z.string().min(1).describe('Error group id from list_error_groups.'),
    days: z
      .number()
      .int()
      .min(1)
      .max(90)
      .default(14)
      .describe('Daily-series window in days (1–90, default 14).'),
  },
  async handler({ client, dash }, { gameId, groupId, days }) {
    const g = await client.get(`/api/games/${gameId}/errors/${groupId}`, { query: { days } });
    return {
      ...presentGroup(g, dash, gameId),
      message: previewText(g.message, 400),
      platform: g.platform ?? null,
      sdkVersion: g.sdkVersion ?? null,
      series: (g.series ?? []).map((p) => ({ day: p.d ?? p.day, count: p.count })),
      hasStack: Boolean(g.stack),
    };
  },
};

export const listErrorEvents = {
  name: 'list_error_events',
  title: 'List sampled error events',
  description:
    'Sampled raw events for an error group, newest first: parsed stack frames (path/fn/line), ' +
    'breadcrumbs, and player/device context. Use a frame here — its `path` (an instance path) and ' +
    '`line` — as input to get_source_context (decrypt the real source) and resolve_instance_path ' +
    '(find the local file). Cursor-paginated: pass back `nextCursor` to page.',
  inputSchema: {
    gameId: gameIdSchema,
    groupId: z.string().min(1).describe('Error group id.'),
    limit: limitSchema,
    cursor: cursorSchema,
  },
  async handler({ client }, { gameId, groupId, limit, cursor }) {
    const data = await client.get(`/api/games/${gameId}/errors/${groupId}/events`, {
      query: { limit, cursor },
    });
    const items = (data?.events ?? []).map((e) => ({
      id: e.id,
      surface: e.surface ?? null,
      platform: e.platform ?? null,
      placeVersion: e.placeVersion ?? null,
      message: previewText(e.message, 300),
      frames: (e.frames ?? []).map((f) => ({
        path: f.path ?? null,
        fn: f.fn ?? null,
        line: f.line ?? null,
      })),
      breadcrumbs: e.breadcrumbs ?? [],
      player: e.player ?? null,
      device: e.device ?? null,
      occurredAt: e.occurredAt ?? null,
    }));
    return paginated(items, { nextCursor: data?.nextCursor, hasMore: data?.hasMore });
  },
};

export { presentGroup, ERROR_STATUSES };
