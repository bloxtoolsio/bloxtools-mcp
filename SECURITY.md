# Security Policy

## Reporting a vulnerability

Please report security vulnerabilities **privately** — do not open a public issue
for a suspected vulnerability.

- Preferred: open a [GitHub private security advisory](https://github.com/bloxtoolsio/bloxtools-mcp/security/advisories/new).
- Alternatively: email **security@bloxtools.io**.

We will acknowledge your report, investigate, and coordinate a fix and disclosure
timeline with you.

## Security model

The BloxTools MCP server is designed to run **locally** alongside your MCP client
(e.g. Claude). Understanding its trust boundaries:

- **It holds a user-supplied Personal Access Token (`blxt_…`) in its environment.**
  The PAT authenticates HTTP requests to the BloxTools API. It is read from env,
  used only as an `Authorization` credential, and is **never** logged, echoed, or
  placed in any tool output or error message. Treat your PAT like a password and
  scope it to the minimum (`read`, plus `manage` only if you want triage writes).

- **The source-context decryption key never leaves your machine.** BloxTools stores
  your source encrypted (AES-256-GCM); the backend never has the key. The
  `get_source_context` tool fetches ciphertext over HTTP and decrypts it **locally**
  using a project key you configure in your own environment. The key is never sent
  in any request, never logged, and never appears in any tool result. A wrong key is
  reported only by an 8-hex-char fingerprint, never by revealing key bytes.

- **Decrypted source flows to your agent — by design.** You configured the key on
  your own machine so the agent you trust can read your code. Decryption happens
  in-process; no plaintext is transmitted back to the BloxTools API.

If you believe any of these invariants can be violated, that is a security issue and
we want to hear about it via the private channels above.
