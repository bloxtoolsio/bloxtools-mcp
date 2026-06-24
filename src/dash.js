/**
 * Dashboard deep-link composition. We emit FULL URLs that an agent can relay
 * verbatim — no rebuild-instructions indirection. Built from BLOXTOOLS_DASH_URL;
 * the dashboard's own alert links use the same `${dashUrl}/games/:id/...` shape.
 */
export function makeDashLinks(dashUrl) {
  const base = String(dashUrl).replace(/\/+$/, '');
  return {
    game: (gameId) => `${base}/games/${gameId}`,
    errors: (gameId) => `${base}/games/${gameId}/errors`,
    errorGroup: (gameId, groupId) => `${base}/games/${gameId}/errors/${groupId}`,
    reports: (gameId) => `${base}/games/${gameId}/reports`,
    performance: (gameId) => `${base}/games/${gameId}/performance`,
    report: (gameId, reportId) => `${base}/games/${gameId}/reports/${reportId}`,
    issues: (gameId) => `${base}/games/${gameId}/issues`,
    issue: (gameId, signature) =>
      `${base}/games/${gameId}/issues/${encodeURIComponent(signature)}`,
    gameSetup: (gameId) => `${base}/games/${gameId}/settings`,
  };
}
