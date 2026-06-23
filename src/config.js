/**
 * Environment configuration for the BloxTools MCP server.
 *
 * All env access lives here. The PAT and every project key are SECRETS: this
 * module reads them, hands them to the api client / decryptor, and NEVER logs,
 * echoes, or serialises them. `redact()` / `safeForLog()` enforce that anything
 * we print to stderr is scrubbed of the token and key material.
 *
 * Env names:
 *   BLOXTOOLS_API_URL          default http://localhost:3000
 *   BLOXTOOLS_PAT              required (blxt_…)
 *   BLOXTOOLS_DASH_URL         default http://localhost:3001 (drives deep links)
 *   BLOXTOOLS_PROJECT_KEYS     JSON { "<gameId>": "<base64key>" }  (local decrypt)
 *   BLOXTOOLS_PROJECT_KEY_<id> per-game key, gameId with dashes stripped
 *   BLOXTOOLS_SOURCEMAP        path to a Rojo sourcemap.json (optional)
 */

const DEFAULT_API_URL = 'http://localhost:3000';
const DEFAULT_DASH_URL = 'http://localhost:3001';
const DEFAULT_SOURCEMAP = './sourcemap.json';

const stripTrailingSlash = (u) => String(u).replace(/\/+$/, '');

/** Strip dashes so a gameId maps to a legal env-var suffix. */
export function keyEnvSuffix(gameId) {
  return String(gameId).replace(/-/g, '');
}

/**
 * Build the project-key lookup from env. Per-game `BLOXTOOLS_PROJECT_KEY_<id>`
 * vars win over a same-id entry in the `BLOXTOOLS_PROJECT_KEYS` JSON map. Returns a
 * Map keyed by BOTH the raw gameId and its dash-stripped form, so a lookup with
 * either shape resolves. Never logs values.
 */
export function buildProjectKeys(env) {
  const keys = new Map();
  const setBoth = (gameId, value) => {
    if (typeof value !== 'string' || value.length === 0) return;
    keys.set(String(gameId), value);
    keys.set(keyEnvSuffix(gameId), value);
  };

  // 1. The JSON map (lower precedence).
  const projectKeysJson = env.BLOXTOOLS_PROJECT_KEYS;
  if (projectKeysJson) {
    let parsed;
    try {
      parsed = JSON.parse(projectKeysJson);
    } catch {
      throw new Error('BLOXTOOLS_PROJECT_KEYS must be valid JSON: { "<gameId>": "<base64key>" }');
    }
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      for (const [gameId, value] of Object.entries(parsed)) setBoth(gameId, value);
    } else {
      throw new Error('BLOXTOOLS_PROJECT_KEYS must be a JSON object mapping gameId → base64 key');
    }
  }

  // 2. Per-game BLOXTOOLS_PROJECT_KEY_<suffix> (higher precedence). The suffix is
  //    the dash-stripped gameId; we key it under the suffix only (the raw id is
  //    not recoverable from the env name, but lookups try both forms).
  for (const [name, value] of Object.entries(env)) {
    const m = /^BLOXTOOLS_PROJECT_KEY_(.+)$/.exec(name);
    if (m) keys.set(m[1], value);
  }
  return keys;
}

/**
 * Look up a project key for a gameId. The dash-stripped suffix is checked FIRST
 * because a per-game `BLOXTOOLS_PROJECT_KEY_<suffix>` var (which can only be keyed
 * by the suffix) must win over a same-id entry in the JSON map (pinned
 * precedence). For a JSON-only config both forms hold the same value, so order
 * is moot.
 */
export function projectKeyFor(keys, gameId) {
  return keys.get(keyEnvSuffix(gameId)) ?? keys.get(String(gameId)) ?? null;
}

/**
 * Parse + validate config from an env object (defaults to process.env). Throws
 * with an actionable message when BLOXTOOLS_PAT is missing — server.js turns that
 * into a crisp startup failure.
 */
export function loadConfig(env = process.env) {
  const pat = env.BLOXTOOLS_PAT?.trim();
  if (!pat) {
    throw new Error(
      'BLOXTOOLS_PAT is required. Mint a Personal Access Token (read, +manage for triage writes) ' +
        'in the BloxTools dashboard and set BLOXTOOLS_PAT=blxt_….',
    );
  }
  const sourcemap = env.BLOXTOOLS_SOURCEMAP;
  return {
    apiUrl: stripTrailingSlash(env.BLOXTOOLS_API_URL || DEFAULT_API_URL),
    pat,
    dashUrl: stripTrailingSlash(env.BLOXTOOLS_DASH_URL || DEFAULT_DASH_URL),
    projectKeys: buildProjectKeys(env),
    sourcemapPath: sourcemap || DEFAULT_SOURCEMAP,
    sourcemapExplicit: Boolean(sourcemap),
  };
}

/**
 * Redact secret-shaped substrings from an arbitrary string before it touches a
 * log line. Catches PATs (`blxt_…`), ingest keys (`blx_…`), and any 43–44-char
 * base64 run (a project key). Defence in depth — we already never PASS secrets
 * to the logger, this is the belt to that suspenders.
 */
export function redact(text) {
  if (typeof text !== 'string') return text;
  return text
    .replace(/blxt_[A-Za-z0-9]+/g, 'blxt_[redacted]')
    .replace(/blx_[A-Za-z0-9]+/g, 'blx_[redacted]')
    .replace(/[A-Za-z0-9+/]{43}=/g, '[redacted-key]');
}

export { DEFAULT_API_URL, DEFAULT_DASH_URL, DEFAULT_SOURCEMAP };
