/**
 * Resources:
 *   bloxtools://games/{gameId}/errors       → current open-groups snapshot (JSON).
 *   bloxtools://games/{gameId}/performance  → current perf-digest snapshot (JSON).
 *   bloxtools://games/{gameId}/monetization → current revenue-digest snapshot (JSON).
 * Each list callback enumerates one resource per game (from list_games), so an
 * agent can browse the snapshot per game.
 */
import { presentGroup } from './tools/errors.js';
import { getPerformanceDigest } from './tools/performance.js';
import { getMonetizationDigest } from './tools/monetization.js';

export const ERRORS_URI_TEMPLATE = 'bloxtools://games/{gameId}/errors';
export const PERFORMANCE_URI_TEMPLATE = 'bloxtools://games/{gameId}/performance';
export const MONETIZATION_URI_TEMPLATE = 'bloxtools://games/{gameId}/monetization';

/** Build the dynamic resource `list` callback from the games list. */
export function makeErrorsResourceList(client, dash) {
  return async () => {
    const data = await client.get('/api/games');
    const resources = (data?.games ?? []).map((g) => ({
      uri: `bloxtools://games/${g.id}/errors`,
      name: `${g.name} — open errors`,
      description: `Current open error groups for ${g.name}`,
      mimeType: 'application/json',
    }));
    return { resources };
  };
}

/** Read one game's open-groups snapshot as JSON text. */
export function makeErrorsResourceRead(client, dash) {
  return async (uri, { gameId }) => {
    const data = await client.get(`/api/games/${gameId}/errors`, {
      query: { status: 'open', sort: 'count', limit: 50 },
    });
    const groups = (data?.errors ?? []).map((g) => presentGroup(g, dash, gameId));
    const body = { gameId, openGroups: groups, count: groups.length, dashUrl: dash.errors(gameId) };
    return {
      contents: [
        { uri: uri.href, mimeType: 'application/json', text: JSON.stringify(body, null, 2) },
      ],
    };
  };
}

/** Build the dynamic performance-resource `list` callback from the games list. */
export function makePerformanceResourceList(client, dash) {
  return async () => {
    const data = await client.get('/api/games');
    const resources = (data?.games ?? []).map((g) => ({
      uri: `bloxtools://games/${g.id}/performance`,
      name: `${g.name} — performance`,
      description: `Current performance digest for ${g.name}`,
      mimeType: 'application/json',
    }));
    return { resources };
  };
}

/** Read one game's performance-digest snapshot as JSON text (reuses the tool). */
export function makePerformanceResourceRead(client, dash) {
  return async (uri, { gameId }) => {
    const body = await getPerformanceDigest.handler({ client, dash }, { gameId, window: 7 });
    return {
      contents: [
        { uri: uri.href, mimeType: 'application/json', text: JSON.stringify(body, null, 2) },
      ],
    };
  };
}

/** Build the dynamic monetization-resource `list` callback from the games list. */
export function makeMonetizationResourceList(client, dash) {
  return async () => {
    const data = await client.get('/api/games');
    const resources = (data?.games ?? []).map((g) => ({
      uri: `bloxtools://games/${g.id}/monetization`,
      name: `${g.name} — monetization`,
      description: `Current revenue digest for ${g.name}`,
      mimeType: 'application/json',
    }));
    return { resources };
  };
}

/** Read one game's monetization-digest snapshot as JSON text (reuses the tool). */
export function makeMonetizationResourceRead(client, dash) {
  return async (uri, { gameId }) => {
    const body = await getMonetizationDigest.handler({ client, dash }, { gameId, window: 30 });
    return {
      contents: [
        { uri: uri.href, mimeType: 'application/json', text: JSON.stringify(body, null, 2) },
      ],
    };
  };
}
