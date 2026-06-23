/**
 * get_source_context — the zero-knowledge feature. Resolve a crash frame to REAL
 * decrypted source lines:
 *
 *   frame.path + placeVersion → GET /api/games/:id/source?placeVersion=&path=
 *   → ciphertext + iv + keyFingerprint  (the API never has the key)
 *   → fingerprint-check the LOCAL key, then AES-256-GCM decrypt in-process
 *   → return ±N lines around frame.line, the crash line marked.
 *
 * Zero-knowledge invariants: the project key is read from env, used only for
 * this local decrypt, and NEVER appears in any output, hint, or error.
 * placeVersion-unknown semantics: the backend serves the latest stored artifact
 * and sets `nearestVersion`; we label drift honestly.
 */
import { z } from 'zod';
import { gameIdSchema } from './shared.js';
import { isNotFound } from '../api.js';
import { fingerprintOfKey, decryptArtifact, isValidProjectKey } from '../crypto.js';
import { projectKeyFor } from '../config.js';

export const getSourceContext = {
  name: 'get_source_context',
  title: 'Get decrypted source context',
  description:
    'The payoff tool: given a crash frame (instance path + line) and a placeVersion, fetch the ' +
    'ENCRYPTED source artifact from BloxTools and decrypt it LOCALLY with the project key you configured ' +
    'in env, returning the real ±N lines around the crash line (crash line marked). The key never ' +
    'leaves this machine and never appears in output. Get the path/line/placeVersion from ' +
    'list_error_events frames. If no key is configured for the game, or the upload used a different ' +
    'key, you get a clear `{error, hint}` with the dashboard setup link — never source.',
  inputSchema: {
    gameId: gameIdSchema,
    path: z
      .string()
      .min(1)
      .describe('Instance path of the crashing script (frame.path from list_error_events).'),
    line: z
      .number()
      .int()
      .min(1)
      .optional()
      .describe('1-based crash line (frame.line); centers the window. Omit to show the file head.'),
    placeVersion: z
      .number()
      .int()
      .min(0)
      .default(0)
      .describe('Place version of the event; 0 = unknown → backend serves the latest upload.'),
    context: z
      .number()
      .int()
      .min(0)
      .max(80)
      .default(10)
      .describe('Lines of context on each side of the crash line (default 10).'),
  },
  async handler({ client, config, dash }, { gameId, path, line, placeVersion, context }) {
    const key = projectKeyFor(config.projectKeys, gameId);
    if (!key) {
      return {
        error: `No project key configured for game ${gameId}.`,
        hint:
          `Set BLOXTOOLS_PROJECT_KEY_<gameId> or add it to BLOXTOOLS_PROJECT_KEYS, using the 44-char key ` +
          `from the game’s source setup page: ${dash.gameSetup(gameId)}`,
      };
    }
    if (!isValidProjectKey(key)) {
      return {
        error: 'The configured project key is not a valid 44-character base64 AES-256 key.',
        hint: `Copy the exact key from ${dash.gameSetup(gameId)} (it is shown once at setup).`,
      };
    }

    // Fetch the encrypted artifact. 404 / artifact:null → no source uploaded.
    let resp;
    try {
      resp = await client.get(`/api/games/${gameId}/source`, {
        query: { placeVersion, path },
      });
    } catch (err) {
      if (isNotFound(err)) {
        return {
          error: 'No source artifacts have been uploaded for this game.',
          hint: `Upload encrypted source from the Studio plugin; see ${dash.gameSetup(gameId)}`,
        };
      }
      throw err;
    }

    const artifact = resp?.artifact ?? null;
    if (!artifact) {
      return {
        error: `No stored source for path "${path}"${placeVersion ? ` at version ${placeVersion}` : ''}.`,
        hint:
          'The crashing script may not have been published yet, or the instance path moved. ' +
          `Check uploads at ${dash.gameSetup(gameId)}`,
      };
    }

    // Fingerprint-check BEFORE decrypt so a wrong key is a clean message, not a
    // raw GCM tag throw. We compute the local key's fingerprint and compare to
    // the one the upload recorded. The key itself is NEVER surfaced.
    const localFp = await fingerprintOfKey(key);
    if (artifact.keyFingerprint && artifact.keyFingerprint !== localFp) {
      return {
        error: 'Project key mismatch — the configured key cannot decrypt this artifact.',
        hint:
          `This upload was encrypted with key fingerprint ${artifact.keyFingerprint}, but your ` +
          `configured key is ${localFp}. Use the key that game was set up with (${dash.gameSetup(gameId)}).`,
      };
    }

    let plaintext;
    try {
      plaintext = await decryptArtifact(key, artifact.iv, artifact.ciphertext);
    } catch {
      // GCM auth failure with a matching fingerprint ⇒ corrupt/tampered bytes.
      return {
        error: 'Decryption failed (GCM authentication) — the stored ciphertext appears corrupt.',
        hint: 'Re-publish the source from the Studio plugin to refresh the artifact.',
      };
    }

    const lines = plaintext.split('\n');
    const nearestVersion = resp.nearestVersion ?? null;
    const exactVersion = placeVersion > 0 && nearestVersion === null;

    // Window around the crash line (1-based). No line → show the head.
    const total = lines.length;
    let from = 1;
    let to = Math.min(total, context * 2 + 1);
    if (line && line >= 1) {
      from = Math.max(1, line - context);
      to = Math.min(total, line + context);
    }

    const snippet = [];
    for (let n = from; n <= to; n++) {
      snippet.push({ line: n, text: lines[n - 1] ?? '', crash: line ? n === line : false });
    }

    const versionNote = exactVersion
      ? `source from v${placeVersion} (exact match)`
      : nearestVersion != null
        ? `source from v${nearestVersion}; error version ${
            placeVersion > 0 ? `v${placeVersion}` : 'unknown'
          } — line drift possible`
        : `source version unknown — line drift possible`;

    return {
      path: artifact.instancePath,
      requestedVersion: placeVersion,
      sourceVersion: artifact.placeVersion ?? nearestVersion ?? null,
      nearestVersion,
      exactVersion,
      crashLine: line ?? null,
      lineCount: total,
      snippet,
      note: versionNote,
      dashUrl: dash.errors(gameId),
    };
  },
};
