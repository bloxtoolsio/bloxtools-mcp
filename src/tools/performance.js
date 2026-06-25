/**
 * Performance read tools — a thin, honest surface over Track A's
 * `GET /api/games/:id/performance` read endpoint (SPRINT.md §3). No new backend
 * call beyond that one contract.
 *
 *   get_performance_digest  — orientation: headline cards + worst client platform
 *                             (lowest fpsP10) + top marks + recent crashes + a
 *                             dash deep link. "How is my game's perf right now?"
 *   get_performance_series  — series + clientByPlatform passthrough for the agent
 *                             to chart / drill into, window-bounded.
 *   get_performance_diagnosis — the "what's wrong and what do I change" surface:
 *                             the SERVER-COMPUTED diagnosis[] (returned VERBATIM —
 *                             the plain-language signals/causes/suggestions are
 *                             computed backend-side; we never re-derive them), plus
 *                             memory categories + growth, top scripts by CPU,
 *                             slow-frame attribution, and version regression, over
 *                             Track A's `GET /api/games/:id/performance/diagnosis`.
 *
 * Gating: the read endpoint 403s `plan_required` on free / downgraded accounts
 * (EXACTLY the sourceContext gate, `{ feature:'performance', requiredPlan:'pro',
 * plan }`). Both tools degrade gracefully into a `{ planRequired, ... }` payload
 * with the dash upgrade link rather than surfacing a raw error — mirroring the
 * existing scope-probe/degrade pattern. These tools use the SAME `read` scope as
 * every other read tool; no new scope. Secrets are never echoed.
 */
import { z } from 'zod';
import { gameIdSchema, previewText } from './shared.js';
import { isPlanRequired } from '../api.js';

const SURFACES = ['server', 'client'];
const GRANULARITIES = ['hour', 'day'];

/** Round a number to <= `places` decimals; pass through non-numbers as null. */
function round(n, places = 2) {
  if (typeof n !== 'number' || !Number.isFinite(n)) return null;
  const f = 10 ** places;
  return Math.round(n * f) / f;
}

/** The graceful-degrade payload when the read endpoint 403s plan_required. */
function planRequiredResult(dash, gameId) {
  return {
    planRequired: true,
    feature: 'performance',
    requiredPlan: 'pro',
    error: 'Performance analytics is a Pro+ feature for this account.',
    hint:
      'Performance ingest keeps running on every plan, but the read endpoints need a Pro or Studio ' +
      `plan. Upgrade, then re-run: ${dash.performance(gameId)}`,
    dashUrl: dash.performance(gameId),
  };
}

/** Shape Track A's `summary` block into the headline cards (rounded, null-safe). */
function presentSummary(s = {}) {
  return {
    frameP95Ms: round(s.frameP95Ms),
    memAvgMb: round(s.memAvgMb),
    memMaxMb: round(s.memMaxMb),
    physicsFpsAvg: round(s.physicsFpsAvg),
    crashCount: s.crashCount ?? 0,
    crashRatePerHour: round(s.crashRatePerHour),
    ccuAvg: round(s.ccuAvg),
    ccuPeak: s.ccuPeak ?? null,
  };
}

/** Shape one clientByPlatform cohort row (Track A field names verbatim). */
function presentPlatform(p = {}) {
  return {
    platform: p.platform ?? null,
    fpsP50: round(p.fpsP50),
    fpsP10: round(p.fpsP10),
    pingP50: round(p.pingP50),
    pingP95: round(p.pingP95),
    memP50: round(p.memP50),
    samples: p.samples ?? 0,
  };
}

export const getPerformanceDigest = {
  name: 'get_performance_digest',
  title: 'Performance digest — health now',
  description:
    'CALL THIS FIRST for "how is my game performing?" / "is anything slow or crashing?". Composes a ' +
    'single oriented perf snapshot for one game over a window (default 7 days) from Track A\'s ' +
    'performance read endpoint: the headline cards (p95 frame time, avg/max memory, physics FPS, ' +
    'crash count + crash rate per hour, avg/peak CCU), the WORST client platform (the one with the ' +
    'lowest fps p10 — the players having the roughest time), the top custom perf marks, and recent ' +
    'crash/shutdown/timeout events. Carries a `dashUrl` to the Performance tab. On a free / ' +
    'downgraded account the read is Pro+ gated → returns `{ planRequired:true, ... }` with the ' +
    'upgrade link, never an error. Drill deeper with get_performance_series.',
  inputSchema: {
    gameId: gameIdSchema,
    window: z
      .number()
      .int()
      .min(1)
      .max(90)
      .default(7)
      .describe('Look-back window in days (1–90, default 7).'),
  },
  async handler({ client, dash }, { gameId, window }) {
    let data;
    try {
      data = await client.get(`/api/games/${gameId}/performance`, {
        query: { days: window },
      });
    } catch (err) {
      if (isPlanRequired(err)) return planRequiredResult(dash, gameId);
      throw err;
    }

    const summary = presentSummary(data?.summary ?? {});

    // Worst client platform = the cohort with the LOWEST fps p10 (lowest = worst
    // experience). Cohorts without an fpsP10 are skipped from the ranking.
    const platforms = (data?.clientByPlatform ?? []).map(presentPlatform);
    const ranked = platforms.filter((p) => typeof p.fpsP10 === 'number');
    const worstClientPlatform =
      ranked.length > 0
        ? ranked.reduce((worst, p) => (p.fpsP10 < worst.fpsP10 ? p : worst))
        : null;

    const topMarks = (data?.topMarks ?? []).slice(0, 10).map((m) => ({
      name: previewText(m.name, 64),
      count: m.count ?? 0,
      msP50: round(m.msP50),
      msP95: round(m.msP95),
      msMax: round(m.msMax),
    }));

    const recentCrashes = (data?.crashEvents ?? []).slice(0, 10).map((e) => ({
      type: e.type ?? null,
      surface: e.surface ?? null,
      occurredAt: e.occurredAt ?? null,
      placeVersion: e.placeVersion ?? null,
      uptimeSec: e.uptimeSec ?? null,
    }));

    return {
      window: { days: window },
      summary,
      worstClientPlatform,
      clientByPlatform: platforms,
      topMarks,
      recentCrashes,
      dashUrl: dash.performance(gameId),
    };
  },
};

export const getPerformanceSeries = {
  name: 'get_performance_series',
  title: 'Performance time series',
  description:
    'Time-bucketed performance series for one game, for charting / drill-down after ' +
    'get_performance_digest. Returns `series` (per-bucket frame p50/p95, memory avg/max, network ' +
    'recv/send, physics FPS, CCU) plus the per-platform client breakdown (`clientByPlatform`). ' +
    'Window-bounded: pass `from`/`to` (ISO) or `days` for a relative window; `surface` ' +
    '(server|client) and `granularity` (hour|day) are passed through to Track A\'s endpoint. On a ' +
    'free / downgraded account the read is Pro+ gated → returns `{ planRequired:true, ... }` with ' +
    'the upgrade link, never an error.',
  inputSchema: {
    gameId: gameIdSchema,
    from: z.string().optional().describe('ISO lower bound for the window (start).'),
    to: z.string().optional().describe('ISO upper bound for the window (end).'),
    days: z
      .number()
      .int()
      .min(1)
      .max(90)
      .optional()
      .describe('Relative window in days; use instead of from/to (1–90).'),
    surface: z
      .enum(SURFACES)
      .optional()
      .describe('Limit to the server-health or client-cohort surface.'),
    granularity: z
      .enum(GRANULARITIES)
      .optional()
      .describe('Bucket granularity: hour (fine) or day (trend).'),
  },
  async handler({ client, dash }, { gameId, from, to, days, surface, granularity }) {
    let data;
    try {
      data = await client.get(`/api/games/${gameId}/performance`, {
        query: { from, to, days, surface, granularity },
      });
    } catch (err) {
      if (isPlanRequired(err)) return planRequiredResult(dash, gameId);
      throw err;
    }

    const series = (data?.series ?? []).map((p) => ({
      t: p.t ?? null,
      frameP50: round(p.frameP50),
      frameP95: round(p.frameP95),
      memAvg: round(p.memAvg),
      memMax: round(p.memMax),
      netRecv: round(p.netRecv),
      netSend: round(p.netSend),
      physicsFps: round(p.physicsFps),
      ccu: p.ccu ?? null,
    }));

    return {
      window: { from: from ?? null, to: to ?? null, days: days ?? null, granularity: granularity ?? null, surface: surface ?? null },
      series,
      clientByPlatform: (data?.clientByPlatform ?? []).map(presentPlatform),
      dashUrl: dash.performance(gameId),
    };
  },
};

/** Shape one memory category row (Track A field names verbatim, null-safe). */
function presentCategory(c = {}) {
  return {
    tag: c.tag ?? null,
    mbAvg: round(c.mbAvg),
    mbMax: round(c.mbMax),
    growthMbPerHr:
      typeof c.growthMbPerHr === 'number' ? round(c.growthMbPerHr) : null,
  };
}

/** Shape one byScript (top-scripts-by-CPU) row (Track A field names verbatim). */
function presentScript(s = {}) {
  return {
    scriptPath: previewText(s.scriptPath, 200),
    kind: s.kind ?? null,
    msP95: round(s.msP95),
    count: typeof s.count === 'number' && Number.isFinite(s.count) ? Math.trunc(s.count) : 0,
    sharePct: round(s.sharePct),
  };
}

/** Shape one version-regression row (Track A field names verbatim, null-safe). */
function presentVersion(v = {}) {
  return {
    placeVersion: v.placeVersion ?? null,
    frameP95: round(v.frameP95),
    memAvgMb: round(v.memAvgMb),
    crashRatePerHr: round(v.crashRatePerHr),
    deltaFrameP95Pct:
      typeof v.deltaFrameP95Pct === 'number' ? round(v.deltaFrameP95Pct) : null,
    deltaMemPct: typeof v.deltaMemPct === 'number' ? round(v.deltaMemPct) : null,
  };
}

export const getPerformanceDiagnosis = {
  name: 'get_performance_diagnosis',
  title: 'Performance diagnosis — what is wrong & what to change',
  description:
    'CALL THIS FIRST for "what is wrong with my game\'s performance and what do I change?". This is the ' +
    'orientation tool for perf: it returns the SERVER-COMPUTED diagnosis (plain-language signals, likely ' +
    'causes, and concrete suggestions) for one game over a window (default 7 days) from Track A\'s ' +
    'performance diagnosis read endpoint, VERBATIM — the heuristics run once on the backend so the ' +
    'dashboard and this tool never diverge; do NOT re-derive or second-guess them. Alongside the ' +
    'diagnosis it returns the evidence the rules fired on: memory by actionable category (avg/max + ' +
    'growth MB/hr, the leak signal), top scripts by CPU (p95 ms, call count, share %), slow-frame ' +
    'attribution (worst stall + the labels running when frames stalled), and version regression (frame ' +
    'p95 / memory deltas per place version). Each diagnosis entry carries a `deepLink`; the result also ' +
    'carries a `dashUrl` to the Performance tab. On a free / downgraded account the read is Pro+ gated → ' +
    'returns `{ planRequired:true, ... }` with the upgrade link, never an error. Drill into the numbers ' +
    'with get_performance_digest / get_performance_series.',
  inputSchema: {
    gameId: gameIdSchema,
    window: z
      .number()
      .int()
      .min(1)
      .max(90)
      .default(7)
      .describe('Look-back window in days (1–90, default 7).'),
  },
  async handler({ client, dash }, { gameId, window }) {
    let data;
    try {
      data = await client.get(`/api/games/${gameId}/performance/diagnosis`, {
        query: { days: window },
      });
    } catch (err) {
      if (isPlanRequired(err)) return planRequiredResult(dash, gameId);
      throw err;
    }

    const mem = data?.memory ?? {};
    const memory = {
      totalMbAvg: round(mem.totalMbAvg),
      totalMbMax: round(mem.totalMbMax),
      categories: (mem.categories ?? []).map(presentCategory),
      series: (mem.series ?? []).map((p) => ({
        t: p.t ?? null,
        tag: p.tag ?? null,
        mbAvg: round(p.mbAvg),
      })),
    };

    const byScript = (data?.byScript ?? []).slice(0, 20).map(presentScript);

    const sf = data?.slowFrames ?? {};
    const slowFrames = {
      count: typeof sf.count === 'number' && Number.isFinite(sf.count) ? Math.trunc(sf.count) : 0,
      worstMs: round(sf.worstMs),
      topLabels: (sf.topLabels ?? []).map((l) => ({
        label: previewText(l.label, 200),
        count: typeof l.count === 'number' && Number.isFinite(l.count) ? Math.trunc(l.count) : 0,
        maxMs: round(l.maxMs),
      })),
    };

    const versions = (data?.versions ?? []).map(presentVersion);

    // diagnosis[] is computed SERVER-SIDE (deterministic heuristics, SPRINT.md §4).
    // Pass it through VERBATIM — the dashboard and the MCP must never diverge, so we
    // do NOT reshape, re-round, or re-derive these entries.
    const diagnosis = data?.diagnosis ?? [];

    return {
      window: { days: window },
      memory,
      byScript,
      slowFrames,
      versions,
      diagnosis,
      dashUrl: dash.performance(gameId),
    };
  },
};

export {
  presentSummary,
  presentPlatform,
  presentCategory,
  presentScript,
  presentVersion,
  planRequiredResult,
};
