/**
 * Monetization read tools — a thin, honest surface over Track A's
 * `GET /api/games/:id/monetization` read endpoint (SPRINT.md §3). No new backend
 * call beyond that one contract. Mirrors src/tools/performance.js.
 *
 *   get_monetization_digest — orientation: the revenue headline (robux, est-USD,
 *                             txns, paying users, ARPPU, conversion %, DevEx rate),
 *                             the top items, the top whales (Pro+, passed through),
 *                             and a dash deep link. "How is my game earning now?"
 *   get_revenue_series      — the daily series (robux, txns, paying users) for the
 *                             agent to chart / drill into, window-bounded.
 *
 * Currency: amounts are Robux integers on the wire; `usdEstimate` is computed by
 * the backend at read time from `DEVEX_USD_PER_ROBUX` and is ALWAYS an estimate —
 * we carry `devexRate` so the agent can show the assumption. `conversionPct` is
 * `null` in v1 (no active-user denominator yet) — we pass it through honestly and
 * never fabricate it.
 *
 * Gating: the read endpoint 403s `plan_required` on free / downgraded accounts
 * (EXACTLY the performance/sourceContext gate, `{ feature:'monetization',
 * requiredPlan:'pro', plan }`). Both tools degrade gracefully into a
 * `{ planRequired, ... }` payload with the dash upgrade link rather than surfacing
 * a raw error. Ingest (`POST /api/purchases`) keeps running on every plan; only the
 * read is gated. These tools use the SAME `read` scope as every other read tool;
 * no new scope. Secrets are never echoed.
 */
import { z } from 'zod';
import { gameIdSchema, previewText } from './shared.js';
import { isPlanRequired } from '../api.js';

/** Round a number to <= `places` decimals; pass through non-numbers as null. */
function round(n, places = 2) {
  if (typeof n !== 'number' || !Number.isFinite(n)) return null;
  const f = 10 ** places;
  return Math.round(n * f) / f;
}

/** Coerce to an int, defaulting to 0 (Robux/txn counts are integers on the wire). */
function int(n) {
  return typeof n === 'number' && Number.isFinite(n) ? Math.trunc(n) : 0;
}

/** The graceful-degrade payload when the read endpoint 403s plan_required. */
function planRequiredResult(dash, gameId) {
  return {
    planRequired: true,
    feature: 'monetization',
    requiredPlan: 'pro',
    error: 'Monetization analytics is a Pro+ feature for this account.',
    hint:
      'Purchase capture keeps running on every plan, but the revenue read endpoints need a Pro or ' +
      `Studio plan. Upgrade, then re-run: ${dash.monetization(gameId)}`,
    dashUrl: dash.monetization(gameId),
  };
}

/**
 * Shape Track A's `summary` block into the revenue headline (Track A field names
 * verbatim). `conversionPct` is null in v1 — pass it through honestly (don't
 * fabricate). `usdEstimate` is a backend-computed estimate; `devexRate` carries the
 * assumption used.
 */
function presentSummary(s = {}) {
  return {
    robux: int(s.robux),
    usdEstimate: round(s.usdEstimate),
    txns: int(s.txns),
    payingUsers: int(s.payingUsers),
    arppuRobux: round(s.arppuRobux),
    conversionPct: typeof s.conversionPct === 'number' ? round(s.conversionPct) : null,
    devexRate: typeof s.devexRate === 'number' ? s.devexRate : null,
  };
}

/** Shape one topItems row (Track A field names verbatim). */
function presentItem(i = {}) {
  return {
    productId: i.productId ?? null,
    kind: i.kind ?? null,
    name: previewText(i.name, 120),
    robux: int(i.robux),
    txns: int(i.txns),
  };
}

/** Shape one whales row (Pro+, raw userId is intentional — whale drill-down). */
function presentWhale(w = {}) {
  return {
    userId: w.userId ?? null,
    robux: int(w.robux),
    txns: int(w.txns),
  };
}

export const getMonetizationDigest = {
  name: 'get_monetization_digest',
  title: 'Monetization digest — revenue now',
  description:
    'CALL THIS FIRST for "how is my game earning?" / "what is my revenue / ARPPU / who are my whales?". ' +
    'Composes a single oriented revenue snapshot for one game over a window (default 30 days) from ' +
    "Track A's monetization read endpoint: the headline (total Robux, estimated USD, transaction count, " +
    'paying-user count, ARPPU in Robux, conversion % [null in v1 — not yet measured], and the DevEx rate ' +
    'used for the USD estimate), the top-earning items (dev products + gamepasses), and the top whales ' +
    '(highest-spending users, Pro+, capped). USD is always an ESTIMATE via the DevEx rate. Carries a ' +
    '`dashUrl` to the Monetization tab. On a free / downgraded account the read is Pro+ gated → returns ' +
    '`{ planRequired:true, ... }` with the upgrade link, never an error. Drill deeper with ' +
    'get_revenue_series.',
  inputSchema: {
    gameId: gameIdSchema,
    window: z
      .number()
      .int()
      .min(1)
      .max(365)
      .default(30)
      .describe('Look-back window in days (1–365, default 30).'),
  },
  async handler({ client, dash }, { gameId, window }) {
    let data;
    try {
      data = await client.get(`/api/games/${gameId}/monetization`, {
        query: { days: window },
      });
    } catch (err) {
      if (isPlanRequired(err)) return planRequiredResult(dash, gameId);
      throw err;
    }

    const summary = presentSummary(data?.summary ?? {});
    const topItems = (data?.topItems ?? []).slice(0, 20).map(presentItem);
    const topWhales = (data?.whales ?? []).slice(0, 100).map(presentWhale);

    return {
      window: { days: window },
      summary,
      topItems,
      topWhales,
      dashUrl: dash.monetization(gameId),
    };
  },
};

export const getRevenueSeries = {
  name: 'get_revenue_series',
  title: 'Revenue time series',
  description:
    'Daily revenue series for one game, for charting / drill-down after get_monetization_digest. ' +
    'Returns `series` (per-day Robux, transaction count, paying users). Window-bounded: pass `from`/`to` ' +
    '(ISO) or `days` for a relative window. On a free / downgraded account the read is Pro+ gated → ' +
    'returns `{ planRequired:true, ... }` with the upgrade link, never an error.',
  inputSchema: {
    gameId: gameIdSchema,
    from: z.string().optional().describe('ISO lower bound for the window (start).'),
    to: z.string().optional().describe('ISO upper bound for the window (end).'),
    days: z
      .number()
      .int()
      .min(1)
      .max(365)
      .optional()
      .describe('Relative window in days; use instead of from/to (1–365).'),
  },
  async handler({ client, dash }, { gameId, from, to, days }) {
    let data;
    try {
      data = await client.get(`/api/games/${gameId}/monetization`, {
        query: { from, to, days },
      });
    } catch (err) {
      if (isPlanRequired(err)) return planRequiredResult(dash, gameId);
      throw err;
    }

    const series = (data?.series ?? []).map((p) => ({
      t: p.t ?? null,
      robux: int(p.robux),
      txns: int(p.txns),
      payingUsers: int(p.payingUsers),
    }));

    return {
      window: { from: from ?? null, to: to ?? null, days: days ?? null },
      series,
      dashUrl: dash.monetization(gameId),
    };
  },
};

export { presentSummary, presentItem, presentWhale, planRequiredResult };
