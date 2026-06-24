/**
 * MCP prompts — reusable agent workflows wired with arguments.
 *
 *   triage_errors      — digest → top open groups → propose + optionally apply statuses
 *   fix_top_crash      — top group → events → source context → sourcemap → fix plan
 *   performance_review — perf digest → worst platform → series → propose perf fixes
 *
 * Each returns a single user message that steers the agent through the BloxTools
 * tools in the right order. Kept as plain text builders so they are unit-testable.
 */

export function triageErrorsPrompt({ gameId, window = '24h' } = {}) {
  const target = gameId ? `game ${gameId}` : 'my game (call list_games first to pick the gameId)';
  return (
    `Triage recent errors for ${target}.\n\n` +
    `1. Call get_error_digest (window="${window}") to orient: new groups, regressions, spikes, top movers.\n` +
    `2. Call list_error_groups (status="open", sort="count") for the worst offenders.\n` +
    `3. For each notable group, summarise what it is and how often it fires (one line each).\n` +
    `4. Propose a status for each: resolved (looks fixed / stale), ignored (noise we accept), or open (needs work). Explain briefly.\n` +
    `5. If I confirm, apply your proposals with set_error_group_status. Also flag any related player issues (list_issues) worth set_issue_status.\n\n` +
    `Always include the dashUrl for anything you recommend acting on.`
  );
}

export function fixTopCrashPrompt({ gameId, window = '24h' } = {}) {
  const target = gameId ? `game ${gameId}` : 'my game (call list_games first to pick the gameId)';
  return (
    `Find and plan a fix for the top crash in ${target}.\n\n` +
    `1. Call get_error_digest (window="${window}") then list_error_groups (sort="count") to pick the single worst open group.\n` +
    `2. Call get_error_group for its version range and trend, then list_error_events for sampled stack frames.\n` +
    `3. Take the top in-app frame (path + line + placeVersion) and call get_source_context to read the REAL decrypted source around the crash line.\n` +
    `4. Call resolve_instance_path on that frame’s path to find the local file on disk.\n` +
    `5. Produce a concrete fix plan: the file + line, the likely root cause from the source + breadcrumbs, and the change to make. Include the dashUrl.\n` +
    `Do not mark anything resolved until the fix is actually shipped.`
  );
}

export function performanceReviewPrompt({ gameId, window = '7' } = {}) {
  const target = gameId ? `game ${gameId}` : 'my game (call list_games first to pick the gameId)';
  return (
    `Review the performance health of ${target} and propose concrete fixes.\n\n` +
    `1. Call get_performance_digest (window=${window}) to orient: the headline cards (p95 frame time, memory, physics FPS, crash rate, CCU), the worst client platform (lowest fps p10), the top custom marks, and recent crash events. If it returns planRequired, stop and relay the upgrade link.\n` +
    `2. Single out the worst client platform from the digest — those players have the roughest frame rate. Note its fps p10 and ping.\n` +
    `3. Call get_performance_series (surface="server", granularity="hour") to see whether frame time / memory / crash rate is trending up, spiking, or steady over the window. Pull surface="client" if the platform breakdown needs more detail.\n` +
    `4. Correlate any crash/timeout events and high marks with the trend — is a specific placeVersion, mark, or memory climb the driver?\n` +
    `5. Produce a concrete perf plan: the top 1–3 regressions, the likely cause (memory leak, expensive mark, physics load, a bad release version), and the change to make. Include the dashUrl.\n\n` +
    `Always include the performance dashUrl for anything you recommend acting on.`
  );
}
