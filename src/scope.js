/**
 * Startup scope probe. Calls GET /api/account/token-info (Track A pin) for the
 * CURRENT PAT → { scopes, tokenLast4, name }. Used to decide whether to register
 * the write tools.
 *
 * Degradations (pinned + verified against today's main):
 *   - 404 (pre-merge backend without the endpoint) → assume READ-ONLY, warn on
 *     stderr, never crash.
 *   - 403 (pre-merge `/api/account` is session-only and rejects PATs with
 *     `requireSession` BEFORE route matching, so a VALID PAT gets 403 — not 404 —
 *     on token-info until Track A makes it PAT-reachable) → SAME read-only
 *     degrade. Verified live: a valid PAT hits requireSession → 403; a bogus PAT
 *     never reaches here (401 below).
 *   - 401 → the PAT is genuinely bad/revoked; throw a crisp startup error
 *     (server.js exits). A pre-merge 401 means a bad token, not a missing route.
 *   - network failure / other → throw (the API is unreachable; can't proceed).
 *
 * Returns { scopes, canManage, tokenLast4, name, degraded } — `degraded` true
 * when we fell back to read-only because the endpoint was absent or PAT-blocked.
 */
import { ApiError, isNotFound } from './api.js';

export async function probeScopes(client) {
  let info;
  try {
    info = await client.get('/api/account/token-info');
  } catch (err) {
    // 404 (no route) OR 403 (route exists but is session-only pre-merge) both
    // mean "this backend can't tell me my scopes yet" → degrade to read-only.
    if (isNotFound(err) || (err instanceof ApiError && err.status === 403)) {
      return {
        scopes: ['read'],
        canManage: false,
        tokenLast4: null,
        name: null,
        degraded: true,
      };
    }
    if (err instanceof ApiError && err.status === 401) {
      throw new ApiError(401, 'The BloxTools PAT was rejected (401). Is the token revoked or mistyped?', {
        hint: 'Mint a fresh read(+manage) PAT in the dashboard and set BLOXTOOLS_PAT.',
      });
    }
    throw err;
  }

  const scopes = Array.isArray(info?.scopes) ? info.scopes : [];
  return {
    scopes,
    canManage: scopes.includes('manage'),
    tokenLast4: info?.tokenLast4 ?? null,
    name: info?.name ?? null,
    degraded: false,
  };
}
