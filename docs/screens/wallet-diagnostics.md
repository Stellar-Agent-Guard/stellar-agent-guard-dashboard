# Wallet Diagnostics

The **Wallet diagnostics** button in the wallet header ([`components/WalletBar.tsx`](../../components/WalletBar.tsx))
opens a modal that answers "what can this browser's wallet actually do for this console?" — the
question behind most "my wallet is behaving strangely" reports. Everything in it is public metadata
about the provider and the connected account, gathered without a prompt.

## What it shows

- **State headline** — one of four states, collected by
  [`collectWalletDiagnostics`](../../lib/guard/walletDiagnostics.ts): `not-connected` (no provider
  selected, so the console is read-only), `ready`, `account-unavailable` (a provider is selected but
  has no established account for this tab), or `provider-error`.
- **Providers this browser reports** — Freighter, xBull and Albedo, each as detected, absent, or not
  yet checked, with an install link for the ones that are missing. "Not checked yet" is never shown as
  "not installed".
- **Public account metadata** — the connected address (honouring the privacy mask and address-book
  nicknames, as everywhere else in the console) and the network the wallet says it is on. Keys, seeds,
  signatures and transaction XDR are never read and never shown.
- **Both networks** — the wallet's own and the one this console writes to, plus a mismatch explanation
  from [`lib/guard/networkSwitch.ts`](../../lib/guard/networkSwitch.ts) when they differ.
- **Capabilities** — connect, address read, network read, envelope signing, authorization-entry
  signing, network switching and hardware support, each `supported`, `unsupported` or `unknown`.
  `unknown` means "this build does not expose a way to ask", which is a different next step from
  `unsupported` ("this provider will never do that"); the non-supported rows are repeated as
  sentences beneath the list so the gap is not buried in a table.

Capability states come from the same optional-method checks
[`lib/guard/walletConnector.ts`](../../lib/guard/walletConnector.ts) uses to decide whether to raise
`WalletUnsupportedError`, so the diagnostic and the signing path cannot disagree about a wallet.

## Refresh without a prompt

The **Refresh** action re-runs the same collection. It calls neither `connect()` — a permission prompt
on several providers — nor `signTransaction`/`signAuthEntry`, and the paths it does use
(`detectInstalledProviders`, Freighter's silent account and network reads) cannot raise a signature
dialog on any of the three providers. Where a provider can only answer a question by being asked to
connect — xBull without a published `getPublicKey`, or Albedo, which reports its account solely as part
of a connect request — the field is reported as unavailable with the reason instead of the console
quietly prompting the operator's wallet. A refresh also reuses the session's own connector rather than
building a second handle, so the diagnostic and the panel that signs read the same wallet.

## Tests

[`tests/unit/walletDiagnostics.test.ts`](../../tests/unit/walletDiagnostics.test.ts) covers the three
provider builds and their differences, an absent extension, a wallet that errors on every read, an
account that is available on one refresh and gone on the next, capability states that appear between
builds, network agreement and disagreement, and the two claims that matter for a support tool: that a
refresh reaches no prompt, and that the object the panel carries holds public facts and nothing a
wallet signs.
