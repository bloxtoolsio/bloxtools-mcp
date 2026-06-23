/**
 * Tool registry. READ_TOOLS need only the `read` scope; WRITE_TOOLS additionally
 * need `manage` and are registered only when the startup scope probe confirms it.
 * Each entry is { name, title, description, inputSchema (zod raw shape), handler }.
 */
import { listGames, getOverview } from './games.js';
import { listErrorGroups, getErrorGroup, listErrorEvents } from './errors.js';
import { getErrorDigest } from './digest.js';
import { getSourceContext } from './source-context.js';
import { resolveInstancePathTool } from './sourcemap-tool.js';
import { listReports, getReport, listIssues, getIssue, getAlertLog } from './reports.js';
import { setErrorGroupStatus, setReportStatus, setIssueStatus } from './writes.js';

export const READ_TOOLS = [
  listGames,
  getOverview,
  getErrorDigest,
  listErrorGroups,
  getErrorGroup,
  listErrorEvents,
  getSourceContext,
  listReports,
  getReport,
  listIssues,
  getIssue,
  getAlertLog,
  resolveInstancePathTool,
];

export const WRITE_TOOLS = [setErrorGroupStatus, setReportStatus, setIssueStatus];
