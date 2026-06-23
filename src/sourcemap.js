/**
 * Pure Rojo `sourcemap.json` walker. A node is
 *   { name, className, filePaths?: string[], children?: Node[] }.
 * The root node is the DataModel ("game"); an instance path like
 * "ServerScriptService.Foo.Bar" is matched by walking children by `name`,
 * tolerating an optional leading "game"/root segment.
 *
 * No I/O here — callers pass the parsed sourcemap object. This keeps the walker
 * trivially unit-testable against checked-in fixtures and usable with no backend.
 */

/** Split a GetFullName()-style path into name segments. */
function segments(instancePath) {
  return String(instancePath)
    .split('.')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/**
 * Resolve an instance path against a parsed sourcemap.
 * → { found, filePaths, matched, className } on a hit, or
 *   { found:false, nearestAncestor, missingSegment, hint } on a miss.
 */
export function resolveInstancePath(sourcemap, instancePath) {
  if (!sourcemap || typeof sourcemap !== 'object') {
    return { found: false, error: 'sourcemap is not a valid object' };
  }
  let segs = segments(instancePath);
  if (segs.length === 0) {
    return { found: false, error: 'instancePath is empty' };
  }

  // Tolerate a leading root segment that names the DataModel itself.
  if (
    sourcemap.name &&
    segs[0] === sourcemap.name &&
    !(sourcemap.children ?? []).some((c) => c.name === segs[0])
  ) {
    segs = segs.slice(1);
  }
  if (segs.length === 0) {
    // Path was just the root → return the root's own files if any.
    return {
      found: Boolean(sourcemap.filePaths?.length),
      filePaths: sourcemap.filePaths ?? [],
      matched: sourcemap.name ?? null,
      className: sourcemap.className ?? null,
    };
  }

  let node = sourcemap;
  const matchedSegs = sourcemap.name ? [sourcemap.name] : [];
  for (let i = 0; i < segs.length; i++) {
    const child = (node.children ?? []).find((c) => c.name === segs[i]);
    if (!child) {
      return {
        found: false,
        missingSegment: segs[i],
        nearestAncestor: matchedSegs.join('.') || null,
        hint:
          `No child "${segs[i]}" under ${matchedSegs.join('.') || '(root)'}. ` +
          `Nearest match in the sourcemap: ${matchedSegs.join('.') || '(root)'}.`,
      };
    }
    node = child;
    matchedSegs.push(child.name);
  }

  const filePaths = node.filePaths ?? [];
  return {
    found: filePaths.length > 0,
    filePaths,
    matched: matchedSegs.join('.'),
    className: node.className ?? null,
    ...(filePaths.length === 0
      ? {
          hint: `Instance "${matchedSegs.join('.')}" exists but has no filePaths (e.g. a Folder or non-script instance).`,
        }
      : {}),
  };
}

export { segments };
