# Wallet Connector Boundary

Every wallet connector in this console sits on the same non-custodial boundary: **the operator's
wallet holds the key and produces every signature; the dashboard never receives, stores or
transmits a secret.** The dashboard builds unsigned payloads, hands them to the wallet, and
forwards the signatures it gets back to Soroban RPC. There is no server, API route or setting that
could accept a key ([ADR 001](../adr/001-zero-server-architecture.md),
[ADR 003](../adr/003-non-custodial-wallet-model.md)).

This page lists, for every connector in
[`lib/guard/walletConnector.ts`](../../lib/guard/walletConnector.ts), what the console asks the
wallet for, what it never asks for, and where each one stops. `tests/unit/walletConnectorBoundaryDoc.test.ts`
reads the tables below and fails when they stop matching the code.

## Connectors

| Connector | Kind      | Calls the console makes                                                                                        | Silent reconnect | Live address check       | In-app network switch | Authorization entries     | Transaction envelope |
| --------- | --------- | -------------------------------------------------------------------------------------------------------------- | ---------------- | ------------------------ | --------------------- | ------------------------- | -------------------- |
| Freighter | extension | `requestAccess`, `getAddress`, `getNetworkDetails`, `signTransaction`, `signAuthEntry`, `requestNetworkAccess` | yes              | yes                      | yes                   | supported                 | supported            |
| Albedo    | web       | `connect`, `network`, `signedTx`, `signedAuth`                                                                 | no               | no                       | no                    | supported                 | supported            |
| xBull     | extension | `connect`, `getPublicKey`, `getNetwork`, `signTransaction`, `signAuthEntry`                                    | yes              | only with `getPublicKey` | no                    | only with `signAuthEntry` | supported            |

What the columns mean:

- **Calls the console makes** — the complete list of provider methods the connector invokes. Each
  one either reads public account and network details or asks the wallet to sign a payload it
  shows to the operator. None of them returns key material.
- **Silent reconnect** — whether a returning session reconnects on page load without a prompt.
  Only extensions do (`canReconnectSilently`); a web wallet would open a pop-up the operator did
  not ask for.
- **Live address check** — whether the console can re-read the active account _without a prompt_
  at a write boundary, so a wallet that switched accounts mid-write is caught before it signs
  (`currentAddress`). Without it the write still runs, with no live binding check.
- **In-app network switch** — whether the mismatch banner can ask the wallet to move networks.
  Only Freighter builds that expose `requestNetworkAccess` can; for every other case the banner
  gives manual steps (`manualSwitchInstructions`).
- **Authorization entries / Transaction envelope** — the two signatures a guard write can need
  (see [signing paths](#signing-paths-and-alternatives)).

## What no connector is ever asked for

- a secret key, seed phrase or mnemonic — there is no input for one, and the global
  [`SecretKeyGuard`](../../components/SecretKeyGuard.tsx) warns if one is pasted into any field;
- a signature over a payload for a different network — the signer is pinned to this deployment's
  `NETWORK.passphrase`, and a wallet on another network is left unconnected and reported as a
  mismatch (`detectNetworkMismatch`);
- a signature during a read — status, policy, telemetry, health probes and the setup checks are
  read-only and never call a signing method.

## Limits

- **xBull authorization entries** depend on the extension build. `createXbullConnector` refuses an
  authorization entry with `WalletUnsupportedError` when the build has no `signAuthEntry`; the
  wallet picker says so before a write starts.
- **Albedo** has no silent address read: every address read opens its pop-up, so it neither
  reconnects silently nor offers the live address check.
- **Detection** never calls `connect()`. Freighter is probed with `getNetworkDetails`; Albedo and
  xBull are detected by the presence of their injected objects. A provider the probe missed can
  still be tried from the picker.

## Observer mode

With no wallet connected the console is an observer. These work without any signature:

- Read guard status, policy, window state and WASM identity from the chain
- Watch the live telemetry feed and read every event's decision
- Review transaction history and export a printable compliance report

Write controls stay visible but disabled, each naming the missing wallet as the reason
([`lib/guard/observerMode.ts`](../../lib/guard/observerMode.ts)).

## Signing paths and alternatives

The wallet picker lists, for every connector, whether it can sign each step of a guard write, and
explains any step it cannot take ([`lib/guard/signingPaths.ts`](../../lib/guard/signingPaths.ts)).
When the connected wallet cannot sign a transaction envelope, or a signature has to come from
somewhere else, the envelope can leave the console instead:

| Path                         | Authorization entries | Transaction envelope |
| ---------------------------- | --------------------- | -------------------- |
| External signer (signed XDR) | not supported         | supported            |

1. **Export** the unsigned envelope from a write's export option.
2. **Sign** it in another wallet or on an offline machine
   ([air-gapped multisig guide](../guides/air-gapped-multisig-signing.md)).
3. **Merge** partial signatures and track signer weight in the Submit Signed XDR and Multisig
   approvals panels, if several co-signers are needed.
4. **Submit** it through **Submit Signed XDR**, which shows the envelope's network identity and
   broadcasts only the exact bytes that were checked.

The console has no import for separately signed authorization entries, so a write that needs one
is signed in a connected wallet.
