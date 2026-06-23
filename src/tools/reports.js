/**
 * Player-feedback read tools: list_reports, get_report, list_issues, get_issue,
 * get_alert_log.
 *
 * Issues are keyed by `signature` (not an id) — that is the backend wire. The
 * alert log passes `urlMasked` through untouched; this server NEVER unmasks a
 * webhook URL.
 */
import { z } from 'zod';
import { gameIdSchema, limitSchema, cursorSchema, paginated, previewText } from './shared.js';

const REPORT_STATUSES = ['open', 'resolved'];
const ISSUE_STATUSES = ['open', 'in_progress', 'resolved'];

function presentReportRow(r, dash, gameId) {
  return {
    id: r.id,
    status: r.status,
    category: r.feedback?.category ?? null,
    title: r.feedback?.title ?? null,
    message: previewText(r.feedback?.message),
    signature: r.signature ?? null,
    platform: r.device?.platform ?? null,
    placeVersion: r.session?.placeVersion ?? null,
    hasErrors: Boolean(r.diagnostics?.hasErrors),
    createdAt: r.createdAt,
    dashUrl: dash.report(gameId, r.id),
  };
}

export const listReports = {
  name: 'list_reports',
  title: 'List player reports',
  description:
    'List player-submitted feedback reports for a game (bugs, suggestions, other), newest first. ' +
    'Filter by status, category, platform, placeVersion, substring `q`, `since`/`until` (ISO), and ' +
    '`hasErrors`. Cursor-paginated. Use get_report for the full per-report context (device, session, ' +
    'logs).',
  inputSchema: {
    gameId: gameIdSchema,
    status: z.enum(REPORT_STATUSES).optional(),
    category: z.string().optional().describe('e.g. Bug, Suggestion, Other.'),
    platform: z.string().optional(),
    q: z.string().optional().describe('Substring match on the report message.'),
    since: z.string().optional().describe('ISO lower bound on createdAt.'),
    until: z.string().optional().describe('ISO upper bound on createdAt.'),
    hasErrors: z.boolean().optional().describe('Only reports that carried captured errors.'),
    placeVersion: z.number().int().optional(),
    limit: limitSchema,
    cursor: cursorSchema,
  },
  async handler({ client, dash }, { gameId, limit, cursor, ...filters }) {
    const data = await client.get(`/api/games/${gameId}/reports`, {
      query: { ...filters, limit, cursor },
    });
    const items = (data?.reports ?? []).map((r) => presentReportRow(r, dash, gameId));
    return paginated(items, { nextCursor: data?.nextCursor, hasMore: data?.hasMore });
  },
};

export const getReport = {
  name: 'get_report',
  title: 'Get a player report',
  description:
    'Full detail for one player report: feedback, player, session, device, performance, gameState, ' +
    'and the combined client+server log tail. Call after list_reports to read everything the player ' +
    'and the SDK captured.',
  inputSchema: {
    gameId: gameIdSchema,
    reportId: z.string().min(1).describe('Report id from list_reports.'),
  },
  async handler({ client, dash }, { gameId, reportId }) {
    const r = await client.get(`/api/games/${gameId}/reports/${reportId}`);
    return { ...r, dashUrl: dash.report(gameId, reportId) };
  },
};

function presentIssue(i, dash, gameId) {
  return {
    signature: i.signature,
    category: i.category ?? null,
    status: i.status ?? 'open',
    sample: previewText(i.sample),
    count: i.count ?? 0,
    openCount: i.openCount ?? 0,
    last24h: i.last24h ?? 0,
    affectedVersions: i.affectedVersions ?? [],
    platforms: i.platforms ?? [],
    firstSeen: i.firstSeen ?? null,
    lastSeen: i.lastSeen ?? null,
    regressed: Boolean(i.regressed),
    dashUrl: dash.issue(gameId, i.signature),
  };
}

export const listIssues = {
  name: 'list_issues',
  title: 'List issues',
  description:
    'List a game’s issues — player-report signatures grouped across versions with a workflow status ' +
    '(open / in_progress / resolved). Use to see recurring problems and their triage state; mutate ' +
    'with set_issue_status (needs the manage scope).',
  inputSchema: {
    gameId: gameIdSchema,
    sort: z.enum(['count', 'recent']).optional().describe('Order by count (default) or recency.'),
    limit: limitSchema,
  },
  async handler({ client, dash }, { gameId, sort, limit }) {
    const data = await client.get(`/api/games/${gameId}/issues`, { query: { sort, limit } });
    return { issues: (data?.issues ?? []).map((i) => presentIssue(i, dash, gameId)) };
  },
};

export const getIssue = {
  name: 'get_issue',
  title: 'Get an issue',
  description:
    'Detail for one issue by its signature: status, counts, affected versions/platforms, and ' +
    'regression state. Issues are addressed by signature (from list_issues), not a numeric id.',
  inputSchema: {
    gameId: gameIdSchema,
    signature: z.string().min(1).describe('Issue signature from list_issues.'),
  },
  async handler({ client, dash }, { gameId, signature }) {
    // The backend has no single-issue GET; pull the issues feed and select.
    const data = await client.get(`/api/games/${gameId}/issues`, { query: { limit: 100 } });
    const found = (data?.issues ?? []).find((i) => i.signature === signature);
    if (!found) {
      return {
        error: `No issue with signature "${signature}" in the current feed.`,
        hint: 'List issues first; the signature must match exactly.',
      };
    }
    return presentIssue(found, dash, gameId);
  },
};

export const getAlertLog = {
  name: 'get_alert_log',
  title: 'Get alert log',
  description:
    'Recent alert fires for a game (new-group, regression, threshold, spike, report), newest first, ' +
    'cursor-paginated. Each entry references the group/rule that fired. Webhook URLs are ALWAYS ' +
    'masked by the API and stay masked here. get_error_digest composes this with the groups list — ' +
    'call the digest first for an oriented summary.',
  inputSchema: {
    gameId: gameIdSchema,
    limit: limitSchema,
    cursor: cursorSchema,
  },
  async handler({ client, dash }, { gameId, limit, cursor }) {
    const data = await client.get(`/api/games/${gameId}/alerts/log`, {
      query: { limit, cursor },
    });
    const items = (data?.entries ?? []).map((e) => ({
      id: e.id,
      ruleType: e.ruleType ?? null,
      status: e.status ?? null,
      groupId: e.groupId ?? null,
      groupMessage: previewText(e.groupMessage),
      detail: e.detail ?? null,
      createdAt: e.createdAt,
      dashUrl: e.groupId ? dash.errorGroup(gameId, e.groupId) : dash.errors(gameId),
    }));
    return paginated(items, { nextCursor: data?.nextCursor, hasMore: data?.hasMore });
  },
};

export { presentReportRow, presentIssue, REPORT_STATUSES, ISSUE_STATUSES };
