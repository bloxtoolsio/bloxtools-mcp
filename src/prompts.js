/**
 * MCP prompts — reusable agent workflows wired with arguments.
 *
 *   triage_errors      — digest → top open groups → propose + optionally apply statuses
 *   fix_top_crash      — top group → events → source context → sourcemap → fix plan
 *   performance_review — perf digest → worst platform → series → propose perf fixes
 *   revenue_review     — monetization digest → top items → whales → series → propose
 *                        concrete monetization improvements
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
    `1. Call get_performance_diagnosis (window=${window}) FIRST to orient — this is the "what's wrong and what to change" surface. It returns the server-computed diagnosis[] (plain-language signals, likely causes, suggestions — computed on the backend; relay them VERBATIM, do not re-derive or second-guess), plus the evidence: memory by category (with growth MB/hr — the leak signal), top scripts by CPU, slow-frame attribution, and version regression. If it returns planRequired, stop and relay the upgrade link.\n` +
    `2. Lead with the diagnosis[] entries, worst severity first (critical → warn → info). For each, restate the signal + likely cause + suggestion in your own summary and include its deepLink.\n` +
    `3. Call get_performance_digest (window=${window}) for the headline cards (p95 frame time, memory, physics FPS, crash rate, CCU) and the worst client platform (lowest fps p10) — those players have the roughest frame rate. Note its fps p10 and ping.\n` +
    `4. Call get_performance_series (surface="server", granularity="hour") to confirm whether the diagnosed issues (a leaking memory category, an expensive script, a slow-frame label, a bad release version) are trending up, spiking, or steady over the window. Pull surface="client" if the platform breakdown needs more detail.\n` +
    `5. Produce a concrete perf plan: the top 1–3 issues from the diagnosis (memory leak in a named category, an expensive script handler, physics load, a regressed release version), the likely cause, and the change to make. Include the dashUrl.\n\n` +
    `Always include the performance dashUrl for anything you recommend acting on.`
  );
}

export function revenueReviewPrompt({ gameId, window = '30' } = {}) {
  const target = gameId ? `game ${gameId}` : 'my game (call list_games first to pick the gameId)';
  return (
    `Review the monetization health of ${target} and propose concrete improvements.\n\n` +
    `1. Call get_monetization_digest (window=${window}) to orient: the headline (total Robux, estimated USD, transactions, paying users, ARPPU in Robux, conversion %, and the DevEx rate used). If it returns planRequired, stop and relay the upgrade link. Note that USD is an estimate via the DevEx rate, and that conversion % may be null (not yet measured in v1) — do not invent it.\n` +
    `2. Look at the top-earning items (dev products + gamepasses) from the digest: which products drive most of the revenue, and is the mix concentrated or broad?\n` +
    `3. Look at the top whales (highest-spending users): how concentrated is revenue among the top spenders? Flag if a few whales carry the game (a retention/whale-churn risk).\n` +
    `4. Call get_revenue_series (days=${window}) to see whether daily Robux / transactions / paying users are trending up, spiking, or declining over the window.\n` +
    `5. Produce a concrete monetization plan: the top 1–3 opportunities (e.g. a stalling product, an over-reliance on one item or one whale, a declining paying-user trend), the likely driver, and the change to make (pricing, new product, conversion funnel). Keep ARPPU and paying-user growth in view; be honest that USD figures are estimates.\n\n` +
    `Always include the monetization dashUrl for anything you recommend acting on.`
  );
}
