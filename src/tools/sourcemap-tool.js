/**
 * resolve_instance_path tool — wraps the pure sourcemap walker with file I/O. It
 * needs NO backend: it reads the configured Rojo sourcemap.json (BLOXTOOLS_SOURCEMAP,
 * default ./sourcemap.json) and maps a Roblox instance path to local file path(s).
 */
import { readFile } from 'node:fs/promises';
import { z } from 'zod';
import { resolveInstancePath } from '../sourcemap.js';

async function loadSourcemap(path) {
  let raw;
  try {
    raw = await readFile(path, 'utf8');
  } catch {
    return { error: 'nofile' };
  }
  try {
    return { sourcemap: JSON.parse(raw) };
  } catch {
    return { error: 'badjson' };
  }
}

export const resolveInstancePathTool = {
  name: 'resolve_instance_path',
  title: 'Resolve instance path to local file',
  description:
    'Map a Roblox instance path (e.g. "ServerScriptService.Combat.Weapon" — from an error frame’s ' +
    '`path`) to the local source file(s) via the project’s Rojo sourcemap.json. Pure local lookup; ' +
    'no backend needed. Use it right after get_source_context to open the real file on disk. On a ' +
    'miss it returns the nearest matched ancestor so you can see where the path diverges. Requires ' +
    'BLOXTOOLS_SOURCEMAP (or ./sourcemap.json) to point at a Rojo sourcemap.',
  inputSchema: {
    instancePath: z
      .string()
      .min(1)
      .describe('Dot-separated Roblox instance path, e.g. ServerScriptService.Foo.Bar.'),
  },
  async handler({ config }, { instancePath }) {
    const loaded = await loadSourcemap(config.sourcemapPath);
    if (loaded.error === 'nofile') {
      return {
        error: `No sourcemap found at ${config.sourcemapPath}.`,
        hint:
          'Generate one with `rojo sourcemap default.project.json -o sourcemap.json` and point ' +
          'BLOXTOOLS_SOURCEMAP at it (or run the server from a directory containing sourcemap.json).',
      };
    }
    if (loaded.error === 'badjson') {
      return {
        error: `Sourcemap at ${config.sourcemapPath} is not valid JSON.`,
        hint: 'Re-generate it with the Rojo CLI.',
      };
    }
    return resolveInstancePath(loaded.sourcemap, instancePath);
  },
};

export { loadSourcemap };
