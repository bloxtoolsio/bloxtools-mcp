/**
 * Account-level read tools: list_games + get_overview.
 */
import { z } from 'zod';
import { previewText } from './shared.js';

/** Compact a backend game row, with link state + dashUrl. */
function presentGame(g, dash) {
  return {
    id: g.id,
    name: g.name,
    linked: Boolean(g.placeId),
    placeId: g.placeId ?? null,
    robloxName: g.robloxMeta?.name ?? null,
    disabled: Boolean(g.disabled),
    dashUrl: dash.game(g.id),
  };
}

export const listGames = {
  name: 'list_games',
  title: 'List BloxTools games',
  description:
    'List the games this BloxTools account owns: id, name, Roblox link state, and a dashUrl. ' +
    'Call this first to discover the gameId every other tool needs. Returns a compact array; ' +
    'most accounts have a handful of games so there is no pagination.',
  inputSchema: {},
  async handler({ client, dash }) {
    const data = await client.get('/api/games');
    const games = (data?.games ?? []).map((g) => presentGame(g, dash));
    return { games };
  },
};

export const getOverview = {
  name: 'get_overview',
  title: 'Account overview tallies',
  description:
    'Account-wide tallies across all games for a window (default 14 days): error events, open ' +
    'error groups, player reports, and per-game rollups. Each game also carries a `perf` headline ' +
    '({ frameP95Ms, crashRatePerHour }, null when no perf data / not gated) so you can spot ' +
    'perf-hot games, and a `revenue` headline ({ robux, usdEstimate }, null when no revenue data / ' +
    'not gated; USD is an estimate) so you can spot top-earning games across the portfolio — drill ' +
    'in with get_performance_digest / get_monetization_digest. Use it for a portfolio-level "how are ' +
    'things overall" answer. For "what changed since yesterday" on one game, prefer get_error_digest.',
  inputSchema: {
    days: z
      .number()
      .int()
      .min(1)
      .max(90)
      .default(14)
      .describe('Window length in days (1–90, default 14).'),
  },
  async handler({ client, dash }, { days }) {
    const data = await client.get('/api/overview', { query: { days } });
    const totals = data?.totals ?? {};
    return {
      window: data?.window ?? { days },
      totals: {
        errorEvents: totals.errorEvents ?? 0,
        openErrorGroups: totals.openErrorGroups ?? 0,
        reports: totals.total ?? 0,
        openReports: totals.open ?? 0,
        resolvedInWindow: totals.resolvedInWindow ?? 0,
        regressedInWindow: totals.regressedInWindow ?? 0,
      },
      games: (data?.games ?? []).map((g) => ({
        id: g.id,
        name: g.name,
        errorEvents: g.errorEvents ?? 0,
        openErrorGroups: g.openErrorGroups ?? 0,
        reports: g.total ?? 0,
        openReports: g.open ?? 0,
        last24h: g.last24h ?? 0,
        spike: g.spike ?? null,
        perf: g.perf
          ? {
              frameP95Ms: g.perf.frameP95Ms ?? null,
              crashRatePerHour: g.perf.crashRatePerHour ?? null,
            }
          : null,
        revenue: g.revenue
          ? {
              robux: g.revenue.robux ?? null,
              usdEstimate: g.revenue.usdEstimate ?? null,
            }
          : null,
        sample: previewText(g.name),
        dashUrl: dash.errors(g.id),
      })),
    };
  },
};

export { presentGame };
