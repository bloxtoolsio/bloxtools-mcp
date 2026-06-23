/**
 * get_error_digest — the orientation tool. Composed CLIENT-SIDE from existing
 * read surface (no new backend endpoint):
 *
 *   - groups list (since = window start, sort=last_seen) → candidate new groups
 *     and top movers.
 *   - alert log (newest-first, filtered to the window) → regressions and spikes,
 *     read from the alert ruleType of in-window fires.
 *   - reports list (since = window start) → reportCount.
 *
 * Output: { window, newGroups, regressions, spikes, topMovers, reportCount },
 * each item a compact row with a one-line human `summary`. Its description tells
 * agents to call it FIRST.
 */
import { z } from 'zod';
import { gameIdSchema, previewText } from './shared.js';

const WINDOW_MS = { '1h': 3.6e6, '6h': 2.16e7, '24h': 8.64e7, '7d': 6.048e8, '30d': 2.592e9 };

function isoSince(window, now = Date.now()) {
  const ms = WINDOW_MS[window] ?? WINDOW_MS['24h'];
  return new Date(now - ms).toISOString();
}

export const getErrorDigest = {
  name: 'get_error_digest',
  title: 'Error digest — what changed',
  description:
    'CALL THIS FIRST when asked "what changed?" / "what’s new since yesterday?". Composes a single ' +
    'oriented snapshot for one game over a window (default 24h): newGroups (errors first seen in the ' +
    'window), regressions (resolved groups that came back), spikes (volume alerts that fired), ' +
    'topMovers (highest-count open groups seen in the window), and reportCount. Every item carries a ' +
    'one-line `summary` and a `dashUrl`, plus the group id to drill into with get_error_group / ' +
    'list_error_events / get_source_context. No new backend call beyond the read surface.',
  inputSchema: {
    gameId: gameIdSchema,
    window: z
      .enum(['1h', '6h', '24h', '7d', '30d'])
      .default('24h')
      .describe('Look-back window (default 24h).'),
    limit: z
      .number()
      .int()
      .min(1)
      .max(20)
      .default(5)
      .describe('Max items per section (default 5).'),
  },
  async handler({ client, dash }, { gameId, window, limit }, { now = Date.now() } = {}) {
    const since = isoSince(window, now);

    // Groups in-window, most-recently-seen first (covers new groups + movers).
    const groupsResp = await client.get(`/api/games/${gameId}/errors`, {
      query: { since, sort: 'last_seen', order: 'desc', limit: 100 },
    });
    const groups = groupsResp?.errors ?? [];

    // Alert fires (newest first); filter to the window client-side.
    let alertEntries = [];
    try {
      const logResp = await client.get(`/api/games/${gameId}/alerts/log`, {
        query: { limit: 100 },
      });
      alertEntries = (logResp?.entries ?? []).filter((e) => e.createdAt && e.createdAt >= since);
    } catch {
      // Alert log unavailable → digest still works from groups; leave empty.
      alertEntries = [];
    }

    // Reports in-window for the count.
    let reportCount = 0;
    try {
      const repResp = await client.get(`/api/games/${gameId}/reports`, {
        query: { since, limit: 100 },
      });
      reportCount = (repResp?.reports ?? []).length;
    } catch {
      reportCount = 0;
    }

    const firstSeenInWindow = (g) => g.firstSeen && g.firstSeen >= since;

    const newGroups = groups
      .filter((g) => firstSeenInWindow(g))
      .slice(0, limit)
      .map((g) => ({
        groupId: g.id,
        message: previewText(g.message),
        count: g.count ?? 0,
        status: g.status,
        summary: `New: ${previewText(g.message, 80)} (${g.count ?? 0}× since first seen)`,
        dashUrl: dash.errorGroup(gameId, g.id),
      }));

    const groupById = new Map(groups.map((g) => [g.id, g]));
    const seen = new Set();
    const fromAlerts = (type) =>
      alertEntries
        .filter((e) => e.ruleType === type)
        .filter((e) => {
          const k = e.groupId ?? e.id;
          if (seen.has(`${type}:${k}`)) return false;
          seen.add(`${type}:${k}`);
          return true;
        })
        .slice(0, limit)
        .map((e) => {
          const g = e.groupId ? groupById.get(e.groupId) : null;
          const msg = previewText(e.groupMessage ?? g?.message, 80);
          return {
            groupId: e.groupId ?? null,
            message: msg,
            firedAt: e.createdAt,
            detail: e.detail ?? null,
            summary:
              type === 'regression'
                ? `Regression: ${msg ?? 'a resolved group is firing again'}`
                : `Spike: ${e.detail ?? msg ?? 'volume jumped'}`,
            dashUrl: e.groupId ? dash.errorGroup(gameId, e.groupId) : dash.errors(gameId),
          };
        });

    const regressions = fromAlerts('regression');
    const spikes = fromAlerts('spike');

    const newIds = new Set(newGroups.map((n) => n.groupId));
    const topMovers = [...groups]
      .filter((g) => g.status === 'open' && !newIds.has(g.id))
      .sort((a, b) => (b.count ?? 0) - (a.count ?? 0))
      .slice(0, limit)
      .map((g) => ({
        groupId: g.id,
        message: previewText(g.message),
        count: g.count ?? 0,
        lastSeen: g.lastSeen ?? null,
        summary: `${g.count ?? 0}× — ${previewText(g.message, 80)}`,
        dashUrl: dash.errorGroup(gameId, g.id),
      }));

    return {
      window: { label: window, since },
      newGroups,
      regressions,
      spikes,
      topMovers,
      reportCount,
      dashUrl: dash.errors(gameId),
    };
  },
};

export { isoSince, WINDOW_MS };
