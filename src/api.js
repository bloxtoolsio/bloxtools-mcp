/**
 * Thin authed fetch client for the BloxTools REST API. The ONLY place the PAT is
 * attached to a request. It is sent solely as the `Authorization: Bearer` header
 * to `BLOXTOOLS_API_URL`; it is never placed in a URL, query string, body, log, or
 * error message (`ApiError` below carries status + the server's message only).
 *
 * Handlers depend on this client's surface (`get`, `patch`, `request`), so they
 * stay unit-testable with a plain mock object — no network, no SDK.
 */

export class ApiError extends Error {
  constructor(status, message, { hint } = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    if (hint) this.hint = hint;
  }
}

/** A 404 from the API — distinguishable so callers can degrade gracefully. */
export const isNotFound = (err) => err instanceof ApiError && err.status === 404;

export function createApiClient({ apiUrl, pat, fetchImpl = fetch }) {
  const base = String(apiUrl).replace(/\/+$/, '');

  async function request(method, path, { query, body } = {}) {
    let url = base + path;
    if (query) {
      const qs = new URLSearchParams();
      for (const [k, v] of Object.entries(query)) {
        if (v !== undefined && v !== null && v !== '') qs.set(k, String(v));
      }
      const s = qs.toString();
      if (s) url += `?${s}`;
    }

    let res;
    try {
      res = await fetchImpl(url, {
        method,
        headers: {
          authorization: `Bearer ${pat}`,
          'content-type': 'application/json',
          accept: 'application/json',
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch (cause) {
      // Network-level failure — surface the URL host, never the PAT.
      throw new ApiError(0, `Cannot reach the BloxTools API at ${base}`, {
        hint: 'Is the backend running and BLOXTOOLS_API_URL correct?',
      });
    }

    let payload = null;
    const text = await res.text();
    if (text) {
      try {
        payload = JSON.parse(text);
      } catch {
        payload = { error: text.slice(0, 200) };
      }
    }

    if (!res.ok) {
      const message =
        (payload && (payload.error || payload.message)) || `HTTP ${res.status}`;
      throw new ApiError(res.status, message, { hint: hintFor(res.status) });
    }
    return payload;
  }

  return {
    base,
    request,
    get: (path, opts) => request('GET', path, opts),
    patch: (path, opts) => request('PATCH', path, opts),
    post: (path, opts) => request('POST', path, opts),
  };
}

function hintFor(status) {
  if (status === 401) return 'The PAT was rejected — is the token revoked or mistyped?';
  if (status === 403)
    return 'This token lacks the required scope; mint one with read+manage in the dashboard.';
  if (status === 404) return undefined;
  return undefined;
}
