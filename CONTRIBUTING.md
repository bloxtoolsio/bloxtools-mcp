# Contributing

Thanks for your interest in improving the BloxTools MCP server.

## Development setup

```bash
git clone https://github.com/bloxtoolsio/bloxtools-mcp.git
cd bloxtools-mcp
npm install
```

The package depends only on `@modelcontextprotocol/sdk` and `zod`.

## Running tests

```bash
npm test          # handler unit tests (mocked client; no backend, no network)
```

The suite runs via `node --test spec/handlers.suite.js`. All tests should pass
before you open a pull request. CI runs the same suite on Node 20 and 22.

There is also an optional live stdio seam check that runs the real server over a
stdio transport against an in-process stub backend:

```bash
npm run seam
```

## Pull request flow

1. Fork the repo and create a branch off `main`.
2. Make your change. Keep the secret-handling invariants intact — the PAT and any
   project key must never be logged, echoed, or returned in tool output (see
   `SECURITY.md`).
3. Run `npm test` and make sure it passes.
4. Open a pull request against `main` with a clear description of the change and
   why. Reference any related issue.

By contributing, you agree that your contributions are licensed under the project's
MIT license.
