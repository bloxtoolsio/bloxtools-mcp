/**
 * Triage WRITE tools — registered ONLY when the PAT carries the `manage` scope
 * (server.js gates registration on the startup scope probe, so an agent never
 * sees a tool it cannot use). Status enums are validated client-side with zod so
 * the agent gets instant feedback; a 403 from the API (token lost the scope mid-
 * session) surfaces as an {error, hint} pointing at minting read+manage.
 *
 * Wire (pinned): PATCH errors/:id and reports/:id by id; issues/:signature by
 * signature. The `manage` scope grants EXACTLY these three mutations.
 */
import { z } from 'zod';
import { gameIdSchema } from './shared.js';
import { ApiError } from '../api.js';
import { ERROR_STATUSES } from './errors.js';
import { REPORT_STATUSES, ISSUE_STATUSES } from './reports.js';

function scopeError(err) {
  if (err instanceof ApiError && err.status === 403) {
    return {
      error: 'This token lacks the manage scope.',
      hint: 'Mint a PAT with read+manage in the dashboard, then reconnect the MCP server.',
    };
  }
  return null;
}

export const setErrorGroupStatus = {
  name: 'set_error_group_status',
  title: 'Set error group status',
  description:
    'Triage an error group: set its status to open, resolved, or ignored. Resolving a group that ' +
    'later sees new events auto-regresses it. Returns a one-line confirmation with the new status and ' +
    'the dashUrl. Requires the manage scope.',
  inputSchema: {
    gameId: gameIdSchema,
    groupId: z.string().min(1).describe('Error group id from list_error_groups.'),
    status: z.enum(ERROR_STATUSES).describe('New status: open | resolved | ignored.'),
  },
  async handler({ client, dash }, { gameId, groupId, status }) {
    try {
      const res = await client.patch(`/api/games/${gameId}/errors/${groupId}`, {
        body: { status },
      });
      const dashUrl = dash.errorGroup(gameId, groupId);
      return {
        ok: true,
        groupId,
        status: res?.status ?? status,
        confirmation: `Error group ${groupId} set to ${res?.status ?? status}. ${dashUrl}`,
        dashUrl,
      };
    } catch (err) {
      const scoped = scopeError(err);
      if (scoped) return scoped;
      throw err;
    }
  },
};

export const setReportStatus = {
  name: 'set_report_status',
  title: 'Set report status',
  description:
    'Triage a player report: set its status to open or resolved. Returns a one-line confirmation ' +
    'with the new status and the dashUrl. Requires the manage scope.',
  inputSchema: {
    gameId: gameIdSchema,
    reportId: z.string().min(1).describe('Report id from list_reports.'),
    status: z.enum(REPORT_STATUSES).describe('New status: open | resolved.'),
  },
  async handler({ client, dash }, { gameId, reportId, status }) {
    try {
      const res = await client.patch(`/api/games/${gameId}/reports/${reportId}`, {
        body: { status },
      });
      const dashUrl = dash.report(gameId, reportId);
      return {
        ok: true,
        reportId,
        status: res?.status ?? status,
        confirmation: `Report ${reportId} set to ${res?.status ?? status}. ${dashUrl}`,
        dashUrl,
      };
    } catch (err) {
      const scoped = scopeError(err);
      if (scoped) return scoped;
      throw err;
    }
  },
};

export const setIssueStatus = {
  name: 'set_issue_status',
  title: 'Set issue status',
  description:
    'Triage an issue (addressed by its signature, from list_issues): set status to open, in_progress, ' +
    'or resolved. Resolving marks the matching reports resolved too. Returns the updated issue with ' +
    'the dashUrl. Requires the manage scope.',
  inputSchema: {
    gameId: gameIdSchema,
    signature: z.string().min(1).describe('Issue signature from list_issues.'),
    status: z.enum(ISSUE_STATUSES).describe('New status: open | in_progress | resolved.'),
    resolvedInVersion: z
      .string()
      .optional()
      .describe('Optional version label recorded when resolving.'),
  },
  async handler({ client, dash }, { gameId, signature, status, resolvedInVersion }) {
    try {
      const res = await client.patch(
        `/api/games/${gameId}/issues/${encodeURIComponent(signature)}`,
        { body: { status, resolvedInVersion } },
      );
      const dashUrl = dash.issue(gameId, signature);
      const newStatus = res?.status ?? status;
      return {
        ok: true,
        signature,
        status: newStatus,
        confirmation: `Issue ${signature} set to ${newStatus}. ${dashUrl}`,
        dashUrl,
      };
    } catch (err) {
      const scoped = scopeError(err);
      if (scoped) return scoped;
      throw err;
    }
  },
};
