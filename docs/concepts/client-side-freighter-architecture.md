# Client-Side Freighter & Wallet Architecture

The dashboard is designed under a strict zero-trust, client-only principle:

## No Server-Side Private Keys

- No server API routes handle private keys or secrets.
- All write operations construct a `SorobanAuthorizationEntry` and transaction envelope in the operator's browser.
- The user's wallet extension (Freighter, Albedo, xBull) prompts the operator to review the exact authorization entries and fee parameters before signing.
- Broadcast transactions are submitted directly to Soroban RPC over CORS-enabled endpoints (`https://soroban-testnet.stellar.org`).

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
