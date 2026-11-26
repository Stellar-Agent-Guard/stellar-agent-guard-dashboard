# Client-Side Freighter & Wallet Architecture

The dashboard is designed under a strict zero-trust, client-only principle:

## No Server-Side Private Keys

- No server API routes handle private keys or secrets.
- All write operations construct a `SorobanAuthorizationEntry` and transaction envelope in the operator's browser.
- The user's wallet extension (Freighter, Albedo, xBull) prompts the operator to review the exact authorization entries and fee parameters before signing.
- Broadcast transactions are submitted directly to Soroban RPC over CORS-enabled endpoints (`https://soroban-testnet.stellar.org`).

## Bounded Fleet Concurrency

- Manual refresh and automated fleet polling use a documented concurrency bound (`DEFAULT_FLEET_PROBE_CONCURRENCY = 5`) to prevent rate-limiting and browser socket exhaustion.
- Per-row errors are isolated so healthy guards update uninterrupted, and active refreshes cancel cleanly via `AbortSignal` upon navigation or network switch.

## Strict Payload Validation & Write Safety

- HTTP 200 responses with missing, partial, or malformed payloads for `status()`, `policy()`, `balance`, or event queries are parsed strictly without inventing defaults or assuming safe states.
- Malformed states surface localized errors and strictly prohibit initiating or confirming transactions until verified state is restored.

## Pending Action Signer Binding

- Every pending approval dialog (freezes, deployments, policy updates) binds the transaction to an immutable account snapshot displaying the shortened address, copy action, and network.
- If the operator switches accounts or disconnects in their wallet between review and signing, the pending action cancels safely to prevent signing unauthorized transactions.

## Third-Party Endpoint Evaluation

- Operators deploying or configuring custom endpoints can review the provider-neutral checklist in `docs/guides/evaluating-rpc-endpoints.md` covering integrity, availability, logging policies, and browser request data boundaries.

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

## Read-Only Connection Preview & Observer Mode

- Connecting a wallet only requests read-only access to the public Stellar address and active network.
- No signing authority is granted upon connection; all signatures remain individually user-initiated.
- If connection is cancelled, observer mode remains fully available for live contract inspection and telemetry.

## Refusal vs. User Cancellation

- Explicit distinction between operator cancellation (local prompt dismiss/abort) and wallet/policy refusal (denied by policy or wallet security rule).
- Refused writes are surfaced explicitly with the provider reason and are never automatically retried.

## Account Change Protection in Confirmations

- Confirmation modals (such as policy change diffs and freeze challenges) monitor the active wallet account.
- If the account changes while a confirmation is open, the action is immediately invalidated, submission is blocked, and a recovery path is displayed.

## Pending Write Disconnect Guidance

- Disconnecting while a write is in flight provides stage-specific guidance.
- If broadcast was already initiated, the dashboard never claims post-submit cancellation and provides lookup guidance via Transaction History or chain RPC.
