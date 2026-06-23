/**
 * Live stdio seam check — NOT part of the unit suite. Runs the REAL server.js as
 * a child over stdio (via the SDK client) against a tiny in-process stub backend
 * that serves the pinned wire, then actually calls tools over the transport:
 *
 *   - lists tools (asserts the manage-gated writes appear with a manage PAT)
 *   - calls list_games, get_error_digest, get_source_context (real ciphertext)
 *   - asserts decrypted source comes back and the project KEY never appears
 *
 * Usage: node spec/inspector.mjs   (prints the tool list + a PASS/FAIL summary)
 *
 * This is a "call tools over stdio, not just unit-test handlers" seam audit,
 * runnable without a full backend or a real PAT.
 */
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { encryptArtifact, fingerprintOfKey } from '../src/crypto.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const GAME = '11111111-2222-3333-4444-555555555555';
const KEY = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=';
const SOURCE = ['local Weapon = {}', 'function Weapon.fire(self)', '  return self.ammo.count -- crash: ammo is nil', 'end', 'return Weapon'].join('\n');

async function main() {
  const { iv, ciphertext } = await encryptArtifact(KEY, SOURCE);
  const fp = await fingerprintOfKey(KEY);

  // ── stub backend serving the pinned wire ────────────────────────────────────
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    const send = (code, obj) => {
      res.writeHead(code, { 'content-type': 'application/json' });
      res.end(JSON.stringify(obj));
    };
    const p = url.pathname;
    if (p === '/api/account/token-info') return send(200, { scopes: ['read', 'manage'], tokenLast4: 'beef', name: 'seam' });
    if (p === '/api/games') return send(200, { games: [{ id: GAME, name: 'Seam Demo', placeId: 99 }] });
    if (p === `/api/games/${GAME}/errors`)
      return send(200, {
        errors: [
          // An OLD group still firing → a top mover (firstSeen well before the window).
          { id: 'grp1', status: 'open', message: 'attempt to index nil (ammo)', count: 17, topPath: 'ServerScriptService.Weapon', topFn: 'fire', firstSeen: new Date(Date.now() - 30 * 8.64e7).toISOString(), lastSeen: new Date().toISOString(), firstVersion: 13, lastVersion: 13 },
          // A brand-new group inside the window.
          { id: 'grp2', status: 'open', message: 'new this hour', count: 3, firstSeen: new Date(Date.now() - 3.6e6).toISOString(), lastSeen: new Date().toISOString() },
        ],
      });
    if (p === `/api/games/${GAME}/alerts/log`) return send(200, { entries: [], hasMore: false });
    if (p === `/api/games/${GAME}/reports`) return send(200, { reports: [], hasMore: false });
    if (p === `/api/games/${GAME}/source`)
      return send(200, { artifact: { instancePath: url.searchParams.get('path'), placeVersion: 13, iv, ciphertext, keyFingerprint: fp }, nearestVersion: null });
    return send(404, { error: 'not found' });
  });
  await new Promise((r) => server.listen(0, r));
  const port = server.address().port;

  // ── connect the SDK client to the REAL server.js over stdio ─────────────────
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [join(__dirname, '..', 'server.js')],
    env: {
      ...process.env,
      BLOXTOOLS_PAT: 'blxt_seamtest',
      BLOXTOOLS_API_URL: `http://localhost:${port}`,
      BLOXTOOLS_DASH_URL: 'http://localhost:3001',
      BLOXTOOLS_PROJECT_KEYS: JSON.stringify({ [GAME]: KEY }),
    },
  });
  const client = new Client({ name: 'seam-inspector', version: '0.0.0' });
  await client.connect(transport);

  const fails = [];
  const { tools } = await client.listTools();
  const names = tools.map((t) => t.name).sort();
  console.log(`\nTools listed over stdio (${names.length}):`);
  for (const t of tools) console.log(`  - ${t.name}: ${t.description.slice(0, 72)}…`);
  if (!names.includes('set_error_group_status')) fails.push('manage write tool missing despite manage scope');

  const { prompts } = await client.listPrompts();
  console.log(`Prompts: ${prompts.map((p) => p.name).join(', ')}`);

  const games = await callJson(client, 'list_games', {});
  if (games.games?.[0]?.id !== GAME) fails.push('list_games did not return the stub game');

  const digest = await callJson(client, 'get_error_digest', { gameId: GAME, window: '24h' });
  console.log(`Digest newGroups: ${digest.newGroups?.[0]?.summary ?? '(none)'}`);
  console.log(`Digest topMovers: ${digest.topMovers?.[0]?.summary ?? '(none)'}`);
  if (!digest.newGroups?.length) fails.push('digest produced no newGroups');
  if (!digest.topMovers?.length) fails.push('digest produced no topMovers');

  const src = await callJson(client, 'get_source_context', { gameId: GAME, path: 'ServerScriptService.Weapon', line: 3, placeVersion: 13, context: 2 });
  const crash = src.snippet?.find((s) => s.crash);
  console.log(`Decrypted crash line ${crash?.line}: ${crash?.text}`);
  if (!/ammo is nil/.test(crash?.text ?? '')) fails.push('source context did not decrypt the expected crash line');
  if (JSON.stringify(src).includes(KEY)) fails.push('PROJECT KEY LEAKED into get_source_context output');

  await client.close();
  await new Promise((r) => server.close(r));

  if (fails.length) {
    console.error(`\nSEAM CHECK FAILED:\n - ${fails.join('\n - ')}`);
    process.exit(1);
  }
  console.log('\nSEAM CHECK PASSED — tools called over stdio, source decrypted locally, key never echoed.');
}

async function callJson(client, name, args) {
  const res = await client.callTool({ name, arguments: args });
  if (res.isError) throw new Error(`${name} errored: ${res.content?.[0]?.text}`);
  return JSON.parse(res.content[0].text);
}

main().catch((e) => {
  console.error('inspector fatal:', e.message);
  process.exit(1);
});
