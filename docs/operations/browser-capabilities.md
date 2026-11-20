## 1. Clipboard API

**Module:** `lib/guard/clipboard.ts`

**Purpose:** Copy policy text, guard addresses, or other data to the system clipboard.

**Secure-context requirement:** The async Clipboard API only exists in a secure context (HTTPS, or `file:`/`localhost` exemptions) and only when the user's browser agent has granted write access.

**Fallback behavior:**

- If `navigator.clipboard` is unavailable (insecure context, permission denied), the `copyToClipboard()` function returns `{ ok: false, error: "clipboard is unavailable — this browser context is not secure or has denied clipboard access" }` rather than throwing.
- The UI component (`CopyButton`) must surface this as a visible failure — showing the manual-select hint and announcing it — never as silence.

**Tested behavior:**

- `secureContextOk()` returns `false` when `window.isSecureContext` is not `true` or when `liveClipboard()` returns `null`.
- `copyToClipboard()` never throws; rejections come back as `{ ok: false, error }`.
- In jsdom and other test environments without the Clipboard API, the fallback path is taken.

**Related code:** `lib/guard/clipboard.ts`, `components/CopyButton.tsx`

## 2. Storage APIs (Soroban Contract Storage)

**Module:** `lib/guard/storage.ts`

**Purpose:** Decode and interpret the guard's persistent on-chain storage entries (Policy, Window, DeadManSwitch, Paused).

**Secure-context requirement:** N/A — this is a read-only RPC interaction, not a browser API.

**Fallback behavior:**

- Missing or uninitialized storage decodes to an `Uninitialized` marker rather than throwing, so a caller can render "not set" without a try/catch.
- A TTL entry reports the remaining ledger lifetime instead of throwing.
- Partially readable storage maps report what is readable next to entries that cannot be read — an honest answer without losing the readable half.

**Tested behavior:**

- `decodeStorageFootprint()` returns `{ decoded: false, value: "Uninitialized" }` when data is missing.
- `decodeStorageFootprint()` reports `ttl` when a Soroban TTL entry is supplied.
- Entries with unrecognized types decode gracefully.

**Related code:** `lib/guard/storage.ts`, `components/StorageExplorer.tsx`

## 3. Web Workers (WASM Parsing and Hashing)

**Modules:** `lib/guard/wasmInspector.ts`, `lib/worker/wasmParse.ts`, `lib/worker/wasmHash.ts`

**Purpose:** Offload WASM binary parsing and SHA-256 hash computation to a Web Worker so the UI thread stays responsive.

**Secure-context requirement:** Web Workers require a secure context in some browsers. If a worker cannot be created, the fallback is to perform the work on the main thread (which may block the UI briefly).

**Fallback behavior:**

- If `Worker` construction fails or the worker script cannot be loaded, `inspectWasmInWorker()` and `hashWasmInWorker()` reject with an error that the UI catches and renders as a read failure.
- The UI shows a named read error rather than rendering `0` or a verified value from a stale read.
- Workers are created with `type: "module"` so they can use `import` statements.

**Tested behavior:**

- Worker creation is wrapped in try/catch; errors are reported through the `onError` callback.
- The `onParsedProgress` and `onHashProgress` callbacks are optional — they default to no-op functions.
- In environments without Worker support (e.g., some test runners), the code degrades gracefully.

**Related code:** `lib/guard/wasmInspector.ts`, `lib/worker/wasmParse.ts`, `lib/worker/wasmHash.ts`

## 4. Wallet API (Freighter Integration)

**Module:** `lib/guard/wallet.ts`

**Purpose:** Connect to the Freighter wallet extension, read the connected address and network, and validate that the network matches the dashboard's expected network.

**Secure-context requirement:** The Freighter extension API is only available when Freighter is installed and the browser is on a compatible network. The wallet connection flow refuses to proceed if the wallet's passphrase does not match the dashboard's expected network.

**Fallback behavior:**

- If Freighter is not installed, `connectWallet()` prompts the user to connect a wallet and reports that writes are disabled until a wallet is connected.
- If the wallet is on a different network, a mismatch banner is displayed and write controls are disabled.
- No wallet? The console stays in observer mode: reads, telemetry, and the storage explorer work, and write controls explain that a wallet is required.

**Tested behavior:**

- `connectWallet()` reads the network Freighter is pointed at via `getNetworkDetails()` and refuses to connect if the wallet's passphrase does not match `NETWORK.passphrase` (`lib/guard/network.ts`).
- The `DEMO MODE — Static Fixture Data` path works without a wallet — reads, telemetry, and the storage explorer work with seeded fixture data.
- Write controls are disabled in demo mode; fixtures never touch RPC.

**Related code:** `lib/guard/wallet.ts`, `components/GuardProvider.tsx`, `components/StatusPanel.tsx`

## 5. Summary: Capability Matrix

| API / Feature      | Module                       | Secure Context               | Fallback                       | Test Entry                                    |
| ------------------ | ---------------------------- | ---------------------------- | ------------------------------ | --------------------------------------------- |
| Clipboard API      | `lib/guard/clipboard.ts`     | Required (`isSecureContext`) | Returns `{ok: false, error}`   | `secureContextOk()`, `copyToClipboard()`      |
| Storage (Soroban)  | `lib/guard/storage.ts`       | N/A (RPC read)               | `Uninitialized` marker         | `decodeStorageFootprint()`                    |
| Web Workers        | `lib/guard/wasmInspector.ts` | Recommended                  | Main-thread fallback           | `inspectWasmInWorker()`, `hashWasmInWorker()` |
| Wallet (Freighter) | `lib/guard/wallet.ts`        | Required (network match)     | Observer mode, disabled writes | `connectWallet()`, `currentAddress()`         |

## 6. Troubleshooting Links

- **Clipboard failures:** See `CopyButton.tsx` — manual-select hint appears when clipboard is unavailable.
- **Read failures:** See `StatusPanel.tsx` — failed reads are never rendered as `0`; they are labeled as errors with diagnostics.
- **Wallet mismatch:** See `GuardProvider.tsx` — network passphrase mismatch prevents writes.
- **Worker errors:** See `wasmInspector.ts` — worker errors are caught and surfaced as read failures.
- **Storage explorer:** See `components/StorageExplorer.tsx` — partially readable storage is handled gracefully.

## 7. How Capability Changes Affect Merges

When adding, renaming, or removing a browser capability:

1. Update the matrix in this document.
2. Update any UI components that depend on the capability.
3. Add or update unit tests in `tests/unit/` that cover the new behavior/edge cases.
4. Run `npm test` to verify all unit tests pass.
5. Reference this file in the PR description so maintainers can verify completeness.
