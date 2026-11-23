# Client-Side Freighter Architecture

The dashboard is designed under a strict zero-trust principle:

## No Server-Side Private Keys

- No server API routes handle private keys or secrets.
- All write operations construct a `SorobanAuthorizationEntry` and transaction envelope in the operator's browser.
- The user's Freighter extension prompts the operator to review the exact authorization entries and fee parameters before signing.
- Broadcast transactions are submitted directly to Soroban RPC over CORS-enabled endpoints (`https://soroban-testnet.stellar.org`).

## Read-Only RPC vs Write Network Separation

The dashboard separates read and write network concerns:

- **Read-Only RPC Endpoint**: Used exclusively for telemetry polling, simulation, guard state inspection, and ledger reads. Read endpoints hold no private keys, require no authorization, and do not sign or submit transactions.
- **Write Network (Wallet Network)**: The network domain where the operator's wallet (e.g. Freighter) signs transaction envelopes. Signatures produced on one network cannot authorize calls on another. Switching the read RPC endpoint does not alter the wallet's write network; changing the write network requires explicit confirmation to prevent cross-network mistakes.

## Read-Only Endpoint Probing

Operators can execute an operator-controlled read-only probe against custom or fallback endpoints:

- Queries the documented read-only method `getNetwork`.
- Measures round-trip latency in milliseconds and verifies network identity (`passphrase` and `protocolVersion`).
- Does not sign, submit, or persist the probe result as chain state.

## Centralized Diagnostic Redaction

Endpoints may contain sensitive credentials in userinfo (`https://user:password@...`) or query parameters (`?token=...&apiKey=...`). Centralized redaction ensures:

- DOM title attributes and rendered strings replace credentials with `[redacted]`.
- Copy actions produce sanitized URLs (`safeCopyEndpoint`).
- Diagnostic surfaces and error messages strip all credential material prior to display or logging.

## Network-Specific Cursor Reset

Event cursors are strictly bound to their originating endpoint and network:

- When switching endpoints or networks (e.g. failover, re-configuration), event cursors are reset to prevent skipping events or attributing stale event IDs across contexts.
- Validated continuity checks verify matching passphrases and synchronized endpoints before carrying any cursor forward.
