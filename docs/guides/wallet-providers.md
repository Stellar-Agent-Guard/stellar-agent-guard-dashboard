# Supported Wallet Providers and Capability Limitations

The Stellar Agent Guard Dashboard provides a client-only, non-custodial operator interface. It integrates with external wallet providers through a unified multi-wallet connector interface (`lib/guard/walletConnector.ts`).

---

## Non-Custodial Architecture & Security Directives

- **Zero Secret Key Access**: The dashboard **never** receives, requests, or persists secret keys, seed phrases, or private key material.
- **User-Controlled Prompts**: All transaction envelope signing (`signTransaction`) and Soroban authorization entry signing (`signAuthEntry`) occur directly inside the user's wallet extension or popup window.
- **Client-Side Enforceability**: The dashboard builds transaction payloads locally or via Soroban RPC simulations, then passes XDR payloads to the active wallet connector for signing.

---

## Supported Providers

| Provider | Kind | Monogram | Install URL | Web / Extension Notes |
| --- | --- | --- | --- | --- |
| **Freighter** | Extension | `FR` | [https://www.freighter.app](https://www.freighter.app) | Official browser extension by Stellar Development Foundation. Also routes hardware wallet connections (Ledger, Trezor). |
| **Albedo** | Web | `AL` | [https://albedo.link](https://albedo.link) | Web-based popup wallet. Signs through popup windows; requires no browser extension installation. |
| **xBull** | Extension | `XB` | [https://xbull.app](https://xbull.app) | Extension wallet available for Chrome, Firefox, Edge, and Brave. |

---

## Connection and Signing Behaviors

### 1. Multi-Extension Installs
Browsers may have multiple wallet extensions installed simultaneously (e.g. both Freighter and xBull).
- Global injections (`window.freighter`, `window.xbull`, `window.albedo`) are evaluated via `readWalletScope()`.
- The dashboard avoids guessing or defaulting to an arbitrary installed extension when multiple are present.
- The operator explicitly selects their preferred provider in the wallet connection modal. The choice is saved to local storage under key `stellar-agent-guard-dashboard.walletProvider.v1` and used by `resolveConnector()`.

### 2. Silent Reconnection vs. Popup Prompts
- **Extensions (Freighter, xBull)**: Support silent auto-reconnection (`canReconnectSilently(id) === true`) using non-invasive probes like `getNetworkDetails()` or saved permissions.
- **Web Wallets (Albedo)**: Cannot auto-reconnect silently (`canReconnectSilently('albedo') === false`) because doing so on page load would trigger an unwanted browser popup. Operator interaction is required.

---

## Capability Limitations & Error Handling

Capability limitations are derived directly from `lib/guard/walletConnector.ts`:

1. **Soroban Authorization Entry Signing (`signAuthEntry`)**:
   - **Freighter**: Supported natively via `@stellar/freighter-api` `signAuthEntry`.
   - **Albedo**: Supported via `window.albedo.signedAuth`.
   - **xBull**: Requires `window.xbull.signAuthEntry`. If an installed xBull build lacks `signAuthEntry`, the connector throws `WalletUnsupportedError('xbull', 'Soroban authorization entries')`.

2. **Network Passphrase Enforcement**:
   - Every connector normalizes the wallet's network via `normalizeWalletNetwork()`.
   - `connectorSigner()` pins the expected network passphrase (`NETWORK.passphrase`) during signing calls. If the wallet is pointed at a different network, signing fails, preventing cross-network transaction broadcasts.

3. **Standardized Error Taxonomy**:
   - `WalletNotInstalledError`: Raised when the requested extension or API is unavailable. Includes `installUrl` and `guideUrl` for UI recovery links.
   - `WalletUserRejectedError`: Raised when an operator explicitly declines or closes a signing or access prompt.
   - `WalletUnsupportedError`: Raised when a provider is missing a required interface method (e.g., Soroban auth entry signing).

---

## Maintainer Verification Checklist

When updating `lib/guard/walletConnector.ts` or supporting new provider capabilities, maintainers must verify:

- [ ] **No Secret Key Leakage**: Confirm no new method accepts or logs raw secret key strings (`S...`).
- [ ] **Provider List Synchronization**: `WALLET_PROVIDERS` array in `lib/guard/walletConnector.ts` must match the documentation table in this guide.
- [ ] **Headless Testability**: Ensure new connectors can be injected and tested in `node --test` without requiring a browser environment (`readWalletScope`).
- [ ] **Error Normalization**: All raw provider errors thrown during `connect`, `signTransaction`, or `signAuthEntry` must be mapped via `mapConnectorError`.
- [ ] **Network Passphrase Integrity**: Verify that `connectorSigner` continues to enforce network passphrase bounds.
