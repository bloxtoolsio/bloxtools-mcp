/**
 * Handler unit tests against a mocked client. Every tool: happy path + the
 * pinned degradations. Plus digest composition, decrypt round-trip,
 * sourcemap fixtures, scope probe, and the zero-knowledge invariant (no key/PAT
 * in any output).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { mockClient } from './mock-client.js';
import { makeDashLinks } from '../src/dash.js';
import { loadConfig, buildProjectKeys, projectKeyFor, redact } from '../src/config.js';
import { probeScopes } from '../src/scope.js';
import { encryptArtifact, fingerprintOfKey, decryptArtifact } from '../src/crypto.js';
import { resolveInstancePath } from '../src/sourcemap.js';

import { listGames, getOverview } from '../src/tools/games.js';
import { listErrorGroups, getErrorGroup, listErrorEvents } from '../src/tools/errors.js';
import { getErrorDigest } from '../src/tools/digest.js';
import { getSourceContext } from '../src/tools/source-context.js';
import { resolveInstancePathTool } from '../src/tools/sourcemap-tool.js';
import { listReports, getReport, listIssues, getIssue, getAlertLog } from '../src/tools/reports.js';
import { getPerformanceDigest, getPerformanceSeries } from '../src/tools/performance.js';
import { setErrorGroupStatus, setReportStatus, setIssueStatus } from '../src/tools/writes.js';
import { ApiError, createApiClient, isPlanRequired } from '../src/api.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const dash = makeDashLinks('http://localhost:3001');
const GAME = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
// A real 32-byte (44-char base64) AES key — test material only.
const KEY = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=';

function deps(routes, { projectKeys, sourcemapPath } = {}) {
  return {
    client: mockClient(routes),
    dash,
    config: {
      projectKeys: projectKeys ?? new Map(),
      sourcemapPath: sourcemapPath ?? join(__dirname, 'fixtures', 'sourcemap.json'),
    },
  };
}

// ── list_games ────────────────────────────────────────────────────────────────
test('list_games: presents id/name/link state + dashUrl', async () => {
  const d = deps({
    'GET /api/games': {
      games: [{ id: GAME, name: 'Demo', placeId: 123, robloxMeta: { name: 'Demo RBX' } }],
    },
  });
  const out = await listGames.handler(d);
  assert.equal(out.games.length, 1);
  assert.deepEqual(out.games[0], {
    id: GAME,
    name: 'Demo',
    linked: true,
    placeId: 123,
    robloxName: 'Demo RBX',
    disabled: false,
    dashUrl: `http://localhost:3001/games/${GAME}`,
  });
});

// ── get_overview ──────────────────────────────────────────────────────────────
test('get_overview: maps totals + per-game tallies, passes days', async () => {
  const d = deps({
    'GET /api/overview': (opts) => {
      assert.equal(opts.query.days, 7);
      return {
        window: { days: 7 },
        totals: { errorEvents: 5, openErrorGroups: 2, total: 10, open: 3 },
        games: [{ id: GAME, name: 'Demo', errorEvents: 5, openErrorGroups: 2, total: 10, open: 3 }],
      };
    },
  });
  const out = await getOverview.handler(d, { days: 7 });
  assert.equal(out.totals.errorEvents, 5);
  assert.equal(out.totals.openReports, 3);
  assert.equal(out.games[0].dashUrl, `http://localhost:3001/games/${GAME}/errors`);
});

// ── list_error_groups (filters + degrade) ────────────────────────────────────
test('list_error_groups: passes filters through and shapes rows', async () => {
  const d = deps({
    ['GET /api/games/' + GAME + '/errors']: (opts) => {
      assert.equal(opts.query.q, 'nil');
      assert.equal(opts.query.sort, 'count');
      assert.equal(opts.query.since, '2026-06-01T00:00:00Z');
      return {
        errors: [
          {
            id: 'g1',
            status: 'open',
            message: 'attempt to index nil',
            count: 42,
            topPath: 'ServerScriptService.Combat.Weapon',
            topFn: 'fire',
            firstVersion: 10,
            lastVersion: 13,
            firstSeen: '2026-06-02T00:00:00Z',
            lastSeen: '2026-06-10T00:00:00Z',
          },
        ],
      };
    },
  });
  const out = await listErrorGroups.handler(d, {
    gameId: GAME,
    q: 'nil',
    sort: 'count',
    since: '2026-06-01T00:00:00Z',
    limit: 20,
  });
  assert.equal(out.items[0].id, 'g1');
  assert.equal(out.items[0].count, 42);
  assert.deepEqual(out.items[0].topFrame, {
    path: 'ServerScriptService.Combat.Weapon',
    fn: 'fire',
  });
  assert.equal(out.items[0].dashUrl, `http://localhost:3001/games/${GAME}/errors/g1`);
});

test('list_error_groups: degrades gracefully when backend ignores filters (bare array order)', async () => {
  // Pre-merge backend ignores q/sort/since and returns its S1 order; we still
  // shape the rows and infer hasMore from a full page.
  const rows = Array.from({ length: 20 }, (_, i) => ({ id: `g${i}`, status: 'open', message: 'x', count: 1 }));
  const d = deps({ ['GET /api/games/' + GAME + '/errors']: { errors: rows } });
  const out = await listErrorGroups.handler(d, { gameId: GAME, q: 'ignored-by-backend', limit: 20 });
  assert.equal(out.items.length, 20);
  assert.equal(out.hasMore, true); // full page → assume more
});

// ── get_error_group ───────────────────────────────────────────────────────────
test('get_error_group: includes series + version range', async () => {
  const d = deps({
    ['GET /api/games/' + GAME + '/errors/g1']: {
      id: 'g1',
      status: 'open',
      message: 'boom',
      count: 3,
      firstVersion: 10,
      lastVersion: 12,
      series: [{ d: '2026-06-10', count: 3 }],
      stack: 'Script:1',
    },
  });
  const out = await getErrorGroup.handler(d, { gameId: GAME, groupId: 'g1', days: 14 });
  assert.deepEqual(out.series, [{ day: '2026-06-10', count: 3 }]);
  assert.deepEqual(out.versionRange, { first: 10, last: 12 });
  assert.equal(out.hasStack, true);
});

// ── list_error_events ─────────────────────────────────────────────────────────
test('list_error_events: shapes frames + passes cursor through', async () => {
  const d = deps({
    ['GET /api/games/' + GAME + '/errors/g1/events']: {
      events: [
        {
          id: 'e1',
          surface: 'server',
          message: 'nil',
          frames: [{ path: 'ServerScriptService.Combat.Weapon', fn: 'fire', line: 12 }],
          breadcrumbs: [],
        },
      ],
      nextCursor: 'CUR',
      hasMore: true,
    },
  });
  const out = await listErrorEvents.handler(d, { gameId: GAME, groupId: 'g1', limit: 20 });
  assert.equal(out.items[0].frames[0].line, 12);
  assert.equal(out.nextCursor, 'CUR');
  assert.equal(out.hasMore, true);
});

// ── reports / issues / alert log ──────────────────────────────────────────────
test('list_reports: shapes rows with dashUrl + masked nothing', async () => {
  const d = deps({
    ['GET /api/games/' + GAME + '/reports']: {
      reports: [
        {
          id: 'r1',
          status: 'open',
          createdAt: '2026-06-10T00:00:00Z',
          feedback: { category: 'Bug', message: 'broken' },
          device: { platform: 'PC' },
          session: { placeVersion: 13 },
          diagnostics: { hasErrors: true },
        },
      ],
      hasMore: false,
    },
  });
  const out = await listReports.handler(d, { gameId: GAME, limit: 20 });
  assert.equal(out.items[0].category, 'Bug');
  assert.equal(out.items[0].hasErrors, true);
  assert.equal(out.items[0].dashUrl, `http://localhost:3001/games/${GAME}/reports/r1`);
});

test('get_report: passes through + adds dashUrl', async () => {
  const d = deps({ ['GET /api/games/' + GAME + '/reports/r1']: { id: 'r1', status: 'open' } });
  const out = await getReport.handler(d, { gameId: GAME, reportId: 'r1' });
  assert.equal(out.dashUrl, `http://localhost:3001/games/${GAME}/reports/r1`);
});

test('list_issues + get_issue: signature-keyed', async () => {
  const issues = {
    issues: [{ signature: 'sig-1', category: 'Bug', status: 'open', count: 4, sample: 'oops' }],
  };
  const d = deps({ ['GET /api/games/' + GAME + '/issues']: issues });
  const list = await listIssues.handler(d, { gameId: GAME, limit: 20 });
  assert.equal(list.issues[0].signature, 'sig-1');
  assert.equal(list.issues[0].dashUrl, `http://localhost:3001/games/${GAME}/issues/sig-1`);

  const one = await getIssue.handler(d, { gameId: GAME, signature: 'sig-1' });
  assert.equal(one.signature, 'sig-1');

  const miss = await getIssue.handler(d, { gameId: GAME, signature: 'nope' });
  assert.ok(miss.error);
  assert.ok(miss.hint);
});

test('get_alert_log: never unmasks; webhook URL not present', async () => {
  const d = deps({
    ['GET /api/games/' + GAME + '/alerts/log']: {
      entries: [
        {
          id: 'a1',
          ruleType: 'new_group',
          status: 'sent',
          groupId: 'g1',
          groupMessage: 'boom',
          detail: 'fired',
          createdAt: '2026-06-10T00:00:00Z',
        },
      ],
      hasMore: false,
    },
  });
  const out = await getAlertLog.handler(d, { gameId: GAME, limit: 20 });
  assert.equal(out.items[0].ruleType, 'new_group');
  const json = JSON.stringify(out);
  assert.ok(!/discord\.com|webhooks/i.test(json), 'no webhook URL leaks into alert log output');
});

// ── performance: digest + series (Track A read contract) ──────────────────────
const PERF_PATH = 'GET /api/games/' + GAME + '/performance';

function perfPayload() {
  return {
    summary: {
      frameP95Ms: 18.4321,
      memAvgMb: 512.5,
      memMaxMb: 904.2,
      physicsFpsAvg: 58.9,
      crashCount: 3,
      crashRatePerHour: 0.25,
      ccuAvg: 42.3,
      ccuPeak: 88,
    },
    series: [
      { t: 1718000000, frameP50: 12.1, frameP95: 18.4, memAvg: 510, memMax: 900, netRecv: 120, netSend: 64, physicsFps: 59, ccu: 40 },
      { t: 1718003600, frameP50: 13.0, frameP95: 22.7, memAvg: 540, memMax: 950, netRecv: 130, netSend: 70, physicsFps: 57, ccu: 45 },
    ],
    clientByPlatform: [
      { platform: 'PC', fpsP50: 60, fpsP10: 48, pingP50: 55, pingP95: 120, memP50: 400, samples: 120 },
      { platform: 'Mobile', fpsP50: 34, fpsP10: 21, pingP50: 90, pingP95: 210, memP50: 320, samples: 60 },
    ],
    topMarks: [
      { name: 'EnemyAI.step', count: 4200, msP50: 1.2, msP95: 4.8, msMax: 19.3 },
    ],
    crashEvents: [
      { type: 'shutdown', surface: 'server', occurredAt: 1718003000, placeVersion: 13, uptimeSec: 3600 },
    ],
  };
}

test('get_performance_digest: headline cards + worst platform (lowest fpsP10) + marks + crashes + dashUrl', async () => {
  const d = deps({
    [PERF_PATH]: (opts) => {
      assert.equal(opts.query.days, 7);
      return perfPayload();
    },
  });
  const out = await getPerformanceDigest.handler(d, { gameId: GAME, window: 7 });
  // Headline cards consume Track A's summary field names verbatim, rounded.
  assert.equal(out.summary.frameP95Ms, 18.43);
  assert.equal(out.summary.crashCount, 3);
  assert.equal(out.summary.crashRatePerHour, 0.25);
  assert.equal(out.summary.ccuPeak, 88);
  // Worst client platform = lowest fpsP10 → Mobile (21 < 48).
  assert.equal(out.worstClientPlatform.platform, 'Mobile');
  assert.equal(out.worstClientPlatform.fpsP10, 21);
  assert.equal(out.topMarks[0].name, 'EnemyAI.step');
  assert.equal(out.recentCrashes[0].type, 'shutdown');
  assert.equal(out.dashUrl, `http://localhost:3001/games/${GAME}/performance`);
});

test('get_performance_digest: empty perf data → no worst platform, zeroed crash count, still has dashUrl', async () => {
  const d = deps({ [PERF_PATH]: {} });
  const out = await getPerformanceDigest.handler(d, { gameId: GAME, window: 7 });
  assert.equal(out.worstClientPlatform, null);
  assert.equal(out.summary.crashCount, 0);
  assert.equal(out.topMarks.length, 0);
  assert.equal(out.recentCrashes.length, 0);
  assert.equal(out.dashUrl, `http://localhost:3001/games/${GAME}/performance`);
});

test('get_performance_digest: 403 plan_required → graceful degrade (planRequired payload, no throw)', async () => {
  const d = deps({ [PERF_PATH]: new ApiError(403, 'plan_required') });
  const out = await getPerformanceDigest.handler(d, { gameId: GAME, window: 7 });
  assert.equal(out.planRequired, true);
  assert.equal(out.feature, 'performance');
  assert.equal(out.requiredPlan, 'pro');
  assert.match(out.hint, /performance/i);
  assert.equal(out.dashUrl, `http://localhost:3001/games/${GAME}/performance`);
});

test('get_performance_series: passes from/to/surface/granularity + shapes series + clientByPlatform', async () => {
  const d = deps({
    [PERF_PATH]: (opts) => {
      assert.equal(opts.query.from, '2026-06-01T00:00:00Z');
      assert.equal(opts.query.to, '2026-06-08T00:00:00Z');
      assert.equal(opts.query.surface, 'server');
      assert.equal(opts.query.granularity, 'hour');
      return perfPayload();
    },
  });
  const out = await getPerformanceSeries.handler(d, {
    gameId: GAME,
    from: '2026-06-01T00:00:00Z',
    to: '2026-06-08T00:00:00Z',
    surface: 'server',
    granularity: 'hour',
  });
  assert.equal(out.series.length, 2);
  assert.equal(out.series[1].frameP95, 22.7);
  assert.equal(out.series[0].ccu, 40);
  assert.equal(out.clientByPlatform[1].platform, 'Mobile');
  assert.equal(out.window.surface, 'server');
  assert.equal(out.dashUrl, `http://localhost:3001/games/${GAME}/performance`);
});

test('get_performance_series: 403 plan_required → graceful degrade', async () => {
  const d = deps({ [PERF_PATH]: new ApiError(403, 'plan_required') });
  const out = await getPerformanceSeries.handler(d, { gameId: GAME, days: 7 });
  assert.equal(out.planRequired, true);
  assert.equal(out.dashUrl, `http://localhost:3001/games/${GAME}/performance`);
});

test('api request(): real backend {error:{code,message,details}} 403 → isPlanRequired matches', async () => {
  // Regression: the backend renders errors as a NESTED object, not a flat string.
  // The handler mocks above throw `new ApiError(403, 'plan_required')` directly and
  // never exercise request()'s serialization — so this drives the REAL client against
  // the real body to prove the message is the human string (not "[object Object]").
  const body = JSON.stringify({
    error: {
      code: 'plan_required',
      message: 'This feature (performance) requires the pro plan. Upgrade to unlock it.',
      details: { feature: 'performance', requiredPlan: 'pro', plan: 'free' },
    },
  });
  const fetchImpl = async () => ({ ok: false, status: 403, text: async () => body });
  const client = createApiClient({ apiUrl: 'http://localhost:3001', pat: 'blxt_x', fetchImpl });
  await assert.rejects(
    () => client.get(`/api/games/${GAME}/performance`),
    (err) => {
      assert.equal(isPlanRequired(err), true);
      assert.match(err.message, /Upgrade/);
      assert.doesNotMatch(err.message, /\[object Object\]/);
      return true;
    },
  );
});

test('performance tools: no PAT or project key leaks into output', async () => {
  const d = deps({ [PERF_PATH]: perfPayload() });
  const dg = await getPerformanceDigest.handler(d, { gameId: GAME, window: 7 });
  const sr = await getPerformanceSeries.handler(d, { gameId: GAME, days: 7 });
  for (const out of [dg, sr]) {
    const json = JSON.stringify(out);
    assert.ok(!json.includes('Bearer'), 'no Authorization header echoed');
    assert.ok(!json.includes(KEY), 'no project key echoed');
    assert.ok(!/blxt?_/.test(json), 'no PAT-shaped token echoed');
  }
});

test('get_overview: folds per-game perf headline (frameP95Ms + crashRatePerHour)', async () => {
  const d = deps({
    'GET /api/overview': {
      window: { days: 14 },
      totals: { errorEvents: 0, openErrorGroups: 0, total: 0, open: 0 },
      games: [
        { id: GAME, name: 'Demo', perf: { frameP95Ms: 21.5, crashRatePerHour: 0.4 } },
        { id: 'g2', name: 'NoPerf' }, // perf absent → null
      ],
    },
  });
  const out = await getOverview.handler(d, { days: 14 });
  assert.deepEqual(out.games[0].perf, { frameP95Ms: 21.5, crashRatePerHour: 0.4 });
  assert.equal(out.games[1].perf, null);
});

// ── digest composition ────────────────────────────────────────────────────────
test('get_error_digest: composes newGroups/regressions/spikes/topMovers/reportCount', async () => {
  const since = '2026-06-10T00:00:00.000Z';
  const now = Date.parse('2026-06-11T00:00:00.000Z'); // window 24h → since = 06-10
  const d = deps({
    ['GET /api/games/' + GAME + '/errors']: {
      errors: [
        { id: 'gnew', status: 'open', message: 'brand new', count: 7, firstSeen: '2026-06-10T06:00:00Z', lastSeen: '2026-06-10T20:00:00Z' },
        { id: 'gold', status: 'open', message: 'old but busy', count: 99, firstSeen: '2026-05-01T00:00:00Z', lastSeen: '2026-06-10T20:00:00Z' },
      ],
    },
    ['GET /api/games/' + GAME + '/alerts/log']: {
      entries: [
        { id: 'a1', ruleType: 'regression', groupId: 'gold', groupMessage: 'old but busy', createdAt: '2026-06-10T12:00:00Z' },
        { id: 'a2', ruleType: 'spike', groupId: 'gnew', groupMessage: 'brand new', detail: '3x baseline', createdAt: '2026-06-10T13:00:00Z' },
        { id: 'a3', ruleType: 'new_group', groupId: 'gnew', createdAt: '2026-06-01T00:00:00Z' }, // out of window
      ],
    },
    ['GET /api/games/' + GAME + '/reports']: { reports: [{ id: 'r1' }, { id: 'r2' }] },
  });
  const out = await getErrorDigest.handler(d, { gameId: GAME, window: '24h', limit: 5 }, { now });
  assert.equal(out.window.since, since);
  assert.equal(out.newGroups.length, 1);
  assert.equal(out.newGroups[0].groupId, 'gnew');
  assert.ok(out.newGroups[0].summary.startsWith('New:'));
  assert.equal(out.regressions.length, 1);
  assert.equal(out.regressions[0].groupId, 'gold');
  assert.equal(out.spikes.length, 1);
  assert.equal(out.topMovers[0].groupId, 'gold'); // highest count, not a new group
  assert.equal(out.reportCount, 2);
});

test('get_error_digest: degrades when alert log + reports unavailable', async () => {
  const now = Date.parse('2026-06-11T00:00:00.000Z');
  const d = deps({
    ['GET /api/games/' + GAME + '/errors']: { errors: [{ id: 'g1', status: 'open', message: 'x', count: 1, firstSeen: '2026-06-10T06:00:00Z', lastSeen: '2026-06-10T06:00:00Z' }] },
    // alert log + reports routes absent → mock throws 404 → digest swallows.
  });
  const out = await getErrorDigest.handler(d, { gameId: GAME, window: '24h', limit: 5 }, { now });
  assert.equal(out.regressions.length, 0);
  assert.equal(out.spikes.length, 0);
  assert.equal(out.reportCount, 0);
  assert.equal(out.newGroups.length, 1);
});

// ── source context: decrypt round-trip + zero-knowledge ───────────────────────
test('get_source_context: decrypts the envelope and marks the crash line', async () => {
  const source = ['local x = nil', 'print(x.y)  -- crash here', 'return x'].join('\n');
  const { iv, ciphertext } = await encryptArtifact(KEY, source);
  const fp = await fingerprintOfKey(KEY);
  const projectKeys = new Map([[GAME, KEY]]);
  const d = deps(
    {
      ['GET /api/games/' + GAME + '/source']: (opts) => {
        assert.equal(opts.query.path, 'ServerScriptService.Combat.Weapon');
        return { artifact: { instancePath: 'ServerScriptService.Combat.Weapon', placeVersion: 13, iv, ciphertext, keyFingerprint: fp }, nearestVersion: null };
      },
    },
    { projectKeys },
  );
  const out = await getSourceContext.handler(d, {
    gameId: GAME,
    path: 'ServerScriptService.Combat.Weapon',
    line: 2,
    placeVersion: 13,
    context: 5,
  });
  const crash = out.snippet.find((s) => s.crash);
  assert.equal(crash.line, 2);
  assert.match(crash.text, /crash here/);
  assert.equal(out.exactVersion, true);
  // KEY NEVER IN OUTPUT.
  assert.ok(!JSON.stringify(out).includes(KEY), 'project key must not appear in output');
});

test('get_source_context: no key configured → error + dash hint, no source', async () => {
  const d = deps({}, { projectKeys: new Map() });
  const out = await getSourceContext.handler(d, { gameId: GAME, path: 'A.B', placeVersion: 0 });
  assert.ok(out.error);
  assert.match(out.hint, /games\//);
  assert.equal(out.snippet, undefined);
});

test('get_source_context: fingerprint mismatch names the wanted fingerprint, never the key', async () => {
  const projectKeys = new Map([[GAME, KEY]]);
  const d = deps(
    {
      ['GET /api/games/' + GAME + '/source']: {
        artifact: { instancePath: 'A.B', placeVersion: 13, iv: 'AAAAAAAAAAAAAAAA', ciphertext: 'AAAAAAAAAAAAAAAAAAAAAAA=', keyFingerprint: 'deadbeef' },
        nearestVersion: null,
      },
    },
    { projectKeys },
  );
  const out = await getSourceContext.handler(d, { gameId: GAME, path: 'A.B', placeVersion: 13 });
  assert.match(out.error, /mismatch/i);
  assert.match(out.hint, /deadbeef/);
  assert.ok(!JSON.stringify(out).includes(KEY));
});

test('get_source_context: nearestVersion fallback is labeled honestly', async () => {
  const source = 'return 1\n';
  const { iv, ciphertext } = await encryptArtifact(KEY, source);
  const fp = await fingerprintOfKey(KEY);
  const projectKeys = new Map([[GAME, KEY]]);
  const d = deps(
    {
      ['GET /api/games/' + GAME + '/source']: { artifact: { instancePath: 'A.B', placeVersion: 5, iv, ciphertext, keyFingerprint: fp }, nearestVersion: 5 },
    },
    { projectKeys },
  );
  const out = await getSourceContext.handler(d, { gameId: GAME, path: 'A.B', placeVersion: 0 });
  assert.equal(out.exactVersion, false);
  assert.match(out.note, /v5/);
  assert.match(out.note, /drift possible/);
});

// ── resolve_instance_path (sourcemap fixtures) ────────────────────────────────
test('resolve_instance_path: exact hit', async () => {
  const d = deps({});
  const out = await resolveInstancePathTool.handler(d, {
    instancePath: 'ServerScriptService.Combat.Main',
  });
  assert.equal(out.found, true);
  assert.deepEqual(out.filePaths, ['src/server/Combat/Main.server.luau']);
});

test('resolve_instance_path: nested ModuleScript + leading game segment', async () => {
  const d = deps({});
  const out = await resolveInstancePathTool.handler(d, {
    instancePath: 'game.ServerScriptService.Combat.Weapon',
  });
  assert.equal(out.found, true);
  assert.deepEqual(out.filePaths, ['src/server/Combat/Weapon.luau']);
});

test('resolve_instance_path: name with spaces', async () => {
  const d = deps({});
  const out = await resolveInstancePathTool.handler(d, {
    instancePath: 'ServerScriptService.Combat.Weapon.Hitbox Util',
  });
  assert.equal(out.found, true);
  assert.deepEqual(out.filePaths, ['src/server/Combat/HitboxUtil.luau']);
});

test('resolve_instance_path: miss → nearest-ancestor hint', async () => {
  const d = deps({});
  const out = await resolveInstancePathTool.handler(d, {
    instancePath: 'ServerScriptService.Combat.DoesNotExist',
  });
  assert.equal(out.found, false);
  assert.equal(out.missingSegment, 'DoesNotExist');
  assert.equal(out.nearestAncestor, 'game.ServerScriptService.Combat');
});

test('resolve_instance_path: no sourcemap file → error + rojo hint', async () => {
  const d = deps({}, {});
  d.config.sourcemapPath = '/nonexistent/sourcemap.json';
  const out = await resolveInstancePathTool.handler(d, { instancePath: 'A.B' });
  assert.match(out.error, /No sourcemap/);
  assert.match(out.hint, /rojo/i);
});

// ── write tools (status enums + scope 403) ────────────────────────────────────
test('set_error_group_status: confirms new status + dashUrl', async () => {
  const d = deps({
    ['PATCH /api/games/' + GAME + '/errors/g1']: (opts) => {
      assert.equal(opts.body.status, 'resolved');
      return { ok: true, status: 'resolved' };
    },
  });
  const out = await setErrorGroupStatus.handler(d, { gameId: GAME, groupId: 'g1', status: 'resolved' });
  assert.equal(out.status, 'resolved');
  assert.match(out.confirmation, /resolved/);
  assert.match(out.dashUrl, /errors\/g1/);
});

test('set_report_status + set_issue_status: happy paths', async () => {
  const d = deps({
    ['PATCH /api/games/' + GAME + '/reports/r1']: { ok: true, status: 'resolved' },
    ['PATCH /api/games/' + GAME + '/issues/sig-1']: { signature: 'sig-1', status: 'in_progress' },
  });
  const r = await setReportStatus.handler(d, { gameId: GAME, reportId: 'r1', status: 'resolved' });
  assert.equal(r.status, 'resolved');
  const i = await setIssueStatus.handler(d, { gameId: GAME, signature: 'sig-1', status: 'in_progress' });
  assert.equal(i.status, 'in_progress');
});

test('write tools: 403 → manage-scope hint (not a raw throw)', async () => {
  const { ApiError } = await import('../src/api.js');
  const d = deps({
    ['PATCH /api/games/' + GAME + '/errors/g1']: new ApiError(403, 'forbidden'),
  });
  const out = await setErrorGroupStatus.handler(d, { gameId: GAME, groupId: 'g1', status: 'open' });
  assert.match(out.error, /manage scope/);
  assert.match(out.hint, /read\+manage/);
});

// ── scope probe ───────────────────────────────────────────────────────────────
test('probeScopes: manage present → canManage true', async () => {
  const client = mockClient({ 'GET /api/account/token-info': { scopes: ['read', 'manage'], tokenLast4: '2ac2', name: 'mcp-agent' } });
  const scope = await probeScopes(client);
  assert.equal(scope.canManage, true);
  assert.equal(scope.degraded, false);
  assert.equal(scope.tokenLast4, '2ac2');
});

test('probeScopes: 404 (pre-merge) → read-only + degraded, never throws', async () => {
  const client = mockClient({}); // token-info route absent → 404
  const scope = await probeScopes(client);
  assert.equal(scope.canManage, false);
  assert.deepEqual(scope.scopes, ['read']);
  assert.equal(scope.degraded, true);
});

test('probeScopes: 403 (pre-merge session-only /api/account) → read-only + degraded', async () => {
  const { ApiError } = await import('../src/api.js');
  // Today’s main: /api/account is session-only; a VALID PAT hits requireSession
  // → 403 on token-info (not 404). We must degrade, not crash.
  const client = mockClient({
    'GET /api/account/token-info': new ApiError(403, 'Sign in to manage account credentials'),
  });
  const scope = await probeScopes(client);
  assert.equal(scope.canManage, false);
  assert.equal(scope.degraded, true);
  assert.deepEqual(scope.scopes, ['read']);
});

test('probeScopes: 401 → crisp throw', async () => {
  const { ApiError } = await import('../src/api.js');
  const client = mockClient({ 'GET /api/account/token-info': new ApiError(401, 'nope') });
  await assert.rejects(() => probeScopes(client), /rejected \(401\)/);
});

// ── config / crypto / redaction (zero-knowledge plumbing) ─────────────────────
test('buildProjectKeys: per-game var beats JSON map; lookup tries both id forms', () => {
  const keys = buildProjectKeys({
    BLOXTOOLS_PROJECT_KEYS: JSON.stringify({ [GAME]: KEY }),
    BLOXTOOLS_PROJECT_KEY_aaaaaaaabbbbccccddddeeeeeeeeeeee: 'OVERRIDE',
  });
  assert.equal(projectKeyFor(keys, GAME), 'OVERRIDE');
});

test('loadConfig: missing PAT throws actionable error', () => {
  assert.throws(() => loadConfig({}), /BLOXTOOLS_PAT is required/);
});

test('redact: scrubs PAT and base64 key shapes', () => {
  const line = `connected with blxt_abc123 and key ${KEY}`;
  const out = redact(line);
  assert.ok(!out.includes('blxt_abc123'));
  assert.ok(!out.includes(KEY));
});

test('crypto: decrypt round-trips the appended-tag GCM envelope', async () => {
  const { iv, ciphertext } = await encryptArtifact(KEY, 'hello world');
  const plain = await decryptArtifact(KEY, iv, ciphertext);
  assert.equal(plain, 'hello world');
});

// ── sourcemap pure walker direct (fixture loaded once) ────────────────────────
test('resolveInstancePath: root-only path returns root files when present', () => {
  const sm = JSON.parse(readFileSync(join(__dirname, 'fixtures', 'sourcemap.json'), 'utf8'));
  const out = resolveInstancePath(sm, 'ReplicatedStorage.Shared');
  assert.equal(out.found, false); // Shared is an empty Folder
  assert.match(out.hint, /no filePaths/);
});
