/**
 * A tiny mock of the api client surface ({ get, patch, post }) for handler unit
 * tests. Routes are matched by `METHOD path` (the path WITHOUT query string);
 * the handler is `(opts) => responseOrThrow`. `calls` records every request so a
 * test can assert the query the handler built and — critically — that the PAT
 * never appears (the mock never sees a PAT; that lives in the real client).
 */
import { ApiError } from '../src/api.js';

export function mockClient(routes = {}) {
  const calls = [];
  function handle(method, path, opts = {}) {
    calls.push({ method, path, opts });
    const route = routes[`${method} ${path}`];
    if (route === undefined) {
      throw new ApiError(404, `mock: no route for ${method} ${path}`);
    }
    const value = typeof route === 'function' ? route(opts) : route;
    if (value instanceof Error) throw value;
    return Promise.resolve(value);
  }
  return {
    calls,
    base: 'http://localhost:3000',
    request: (m, p, o) => handle(m, p, o),
    get: (p, o) => handle('GET', p, o),
    patch: (p, o) => handle('PATCH', p, o),
    post: (p, o) => handle('POST', p, o),
  };
}

export { ApiError };
