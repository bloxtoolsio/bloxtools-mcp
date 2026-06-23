/**
 * Resource: bloxtools://games/{gameId}/errors → current open-groups snapshot (JSON).
 * The list callback enumerates one resource per game (from list_games), so an
 * agent can browse open-error snapshots per game.
 */
import { presentGroup } from './tools/errors.js';

export const ERRORS_URI_TEMPLATE = 'bloxtools://games/{gameId}/errors';

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
