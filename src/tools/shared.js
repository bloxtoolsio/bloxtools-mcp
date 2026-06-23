/**
 * Shared helpers for tool handlers. Handlers are pure: they take `deps`
 * ({ client, dash, config }) + validated `args`, and return a plain object that
 * server.js JSON-stringifies into the tool result. No SDK, no process.env here.
 */
import { z } from 'zod';

/** Standard list-size cap. Agents page with `limit` + the returned cursor. */
export const DEFAULT_LIMIT = 20;
export const MAX_LIMIT = 100;

export const limitSchema = z
  .number()
  .int()
  .min(1)
  .max(MAX_LIMIT)
  .default(DEFAULT_LIMIT)
  .describe(`Max items to return (1–${MAX_LIMIT}, default ${DEFAULT_LIMIT}).`);

export const gameIdSchema = z.string().min(1).describe('BloxTools game id (uuid).');

export const cursorSchema = z
  .string()
  .optional()
  .describe('Opaque pagination cursor from a previous call’s `nextCursor`.');

/**
 * Wrap a paginated backend response ({ records, nextCursor, hasMore }) into our
 * compact list shape with a stable `items` key. Backend list endpoints differ in
 * the array key name, so the caller maps to `items` explicitly.
 */
export function paginated(items, { nextCursor = null, hasMore = false } = {}) {
  return { items, nextCursor: nextCursor ?? null, hasMore: Boolean(hasMore) };
}

/** Short, single-line message preview for digests/summaries. */
export function previewText(s, max = 120) {
  if (typeof s !== 'string') return null;
  const oneLine = s.replace(/\s+/g, ' ').trim();
  return oneLine.length > max ? `${oneLine.slice(0, max - 1)}…` : oneLine;
}
