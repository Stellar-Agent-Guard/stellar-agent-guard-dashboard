# Runbook — Recovering from a Lost Browser Profile

**Audience:** an operator whose browser profile was cleared, reset, replaced, or lost — or who is
opening the console from a different browser or origin for the first time.
**Applies to:** any `stellar-agent-guard` smart account this dashboard reads or writes.
**Related:** [Emergency freeze & incident response](./emergency-freeze.md) ·
[Routine policy updates](./policy-updates.md) · [Dual-freeze semantics](../concepts/dual-freeze-semantics.md) ·
[Client-side Freighter architecture](../concepts/client-side-freighter-architecture.md) ·
[Storage inventory](../../lib/guard/storageInventory.ts)

> **The one sentence to hold on to:** a lost browser profile loses this browser's _view_ of your
> guards, never the guards themselves. Every policy, freeze flag, spend window, heartbeat and
> ledger event lives on chain. Nothing in `localStorage` can move funds, and clearing it deletes
> no contract.

---

## 1. Separate the two losses

Operators conflate these, and the mistake changes the response:

| Loss                                           | What it means                                                                                                            | Where recovery happens                                                          |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------- |
| **Browser profile / site data**                | This browser's saved addresses, labels, drafts, local transaction record and preferences are gone.                       | This runbook. Re-add addresses, reconnect the wallet, re-read the chain.        |
| **Wallet / extension, or its recovery phrase** | The admin key itself is unavailable. The guard still exists on chain and still enforces its policy, but nobody can sign. | Your wallet's own recovery process. The dashboard never holds or restores keys. |
| **The guard contract**                         | The account was retired or never existed on this network.                                                                | Nothing here recovers it; verify the address and network before concluding.     |

A dashboard profile is also **per origin**. Moving the console to a new URL (or from `localhost`
to a deployed host) makes it look exactly like a lost profile even though the old browser data
still exists under the old origin. Check the address bar before assuming data loss.

---

## 2. What survives, and what does not

### Survives profile loss (read it back from the chain)

- The guard **contract address** and its code (the pinned artifact).
- The installed **policy**: caps, rolling window, assets, recipients, protocols, pause state and
  dead-man grace.
- The **freeze state** (`admin_frozen`, `heartbeat_expired`), `last_heartbeat` and the rolling
  spend window.
- **Balances** and all ledger history.
- **Telemetry**, within the RPC provider's event retention window.
- The **admin key**, if the wallet extension itself survived — it is the wallet's data, not the
  dashboard's, even when both live in the same browser profile.

### Lost with the profile unless you exported it first

This is the complete list of what the console persists; it is the same inventory the Storage
Explorer shows in the UI.

| Data                                                                                                                           | Key (localStorage/sessionStorage)                                                                                                                                                                                                                                                                                                                        | If it is gone                                                                                                            |
| ------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Saved guard addresses and labels, per network                                                                                  | `stellar-agent-guard-dashboard.instances.v2.{network}`                                                                                                                                                                                                                                                                                                   | Re-add each address; the label is cosmetic and can be retyped. Build-seeded guards reappear automatically.               |
| The pre-migration (v1) guard list                                                                                              | `stellar-agent-guard-dashboard.instances.v1`                                                                                                                                                                                                                                                                                                             | Rarely present; the current list above is authoritative.                                                                 |
| Address book (contact labels and public addresses)                                                                             | `stellar-agent-guard-dashboard.addressBook.v1`                                                                                                                                                                                                                                                                                                           | Re-import a prior JSON export, or re-enter each recipient and verify it.                                                 |
| Local transaction record (hashes, operations, outcomes, fees)                                                                  | `stellar-agent-guard-dashboard.txHistory.v1`                                                                                                                                                                                                                                                                                                             | **Unrecoverable from this browser.** Re-read individual hashes on a block explorer; the console cannot rebuild the list. |
| Webhook destination and event preferences                                                                                      | `stellar-agent-guard-dashboard.webhooks.v1`                                                                                                                                                                                                                                                                                                              | Reconfigure by hand. The destination is not stored anywhere else.                                                        |
| Per-guard drafts and saved filters                                                                                             | `stellar-agent-guard-dashboard.scoped.v1.{base}.{network}.{guard}`                                                                                                                                                                                                                                                                                       | **Unrecoverable drafts.** Re-create from the installed policy, then validate before signing.                             |
| Setup checklist progress                                                                                                       | `stellar-agent-guard-dashboard.setup-wizard.v1`                                                                                                                                                                                                                                                                                                          | Re-open the checklist; it restarts.                                                                                      |
| Panel layout, named layouts, fleet view, density, theme, sidebar, privacy mask, idle timeout, alert settings, preferred wallet | `stellar-agent-guard-dashboard.layout.v1`, `stellar-agent-guard-dashboard.namedLayouts.v1`, `stellar-agent-guard-dashboard.fleet-view.v1`, `display-density`, `theme`, `sidebar-collapsed`, `privacy-mask`, `stellar-agent-guard-dashboard.idleTimeout.v1`, `stellar-agent-guard-dashboard.alerts.v1`, `stellar-agent-guard-dashboard.walletProvider.v1` | Preferences only; reset to defaults and re-choose.                                                                       |
| Cross-tab event transport (short-lived)                                                                                        | `stellar-agent-guard-dashboard.tab-sync.v1`                                                                                                                                                                                                                                                                                                              | Ephemeral; re-created on the next broadcast. No action.                                                                  |
| Session-bytecode cache                                                                                                         | sessionStorage, `stellar_bytecode_hash_cache`                                                                                                                                                                                                                                                                                                            | Re-fetched on the next deploy verification. No action.                                                                   |

> **Never do this to "restore" a policy:** re-installing the policy to make the Overview screen
> look like it used to. `set_policy` resets the rolling spend window and restarts the dead-man
> clock. If the chain already holds the policy you want, leave it alone — see
> [Routine policy updates](./policy-updates.md).

---

## 3. Recovery procedure

Work in this order. Steps 1–2 restore the ability to read; nothing here signs a write.

### Step 1 — Recover the wallet, or confirm it still exists

If the extension survived, unlock it and confirm the admin account is present. If the extension
was removed with the profile, restore it through the wallet's own recovery phrase flow — do that in
the wallet, never by typing a secret into this dashboard. The console's `SecretKeyGuard` refuses
`S…`-shaped input for exactly that reason.

Confirm the wallet network matches the console's network. A mismatch is refused at connect time
with a banner naming both sides; see [Client-side Freighter architecture](../concepts/client-side-freighter-architecture.md).

### Step 2 — Re-add each guard by address

The build-seeded guards (Phase 1, Phase 2, and a local sandbox guard if configured) appear in the
selector without any stored state. For every guard you added yourself:

1. Open the guard selector in the WalletBar.
2. Add the `C…` address and a label.
3. Let the live `status()` read complete. An address that cannot be read is reported as a failed
   read, not silently saved as a working guard.
4. Repeat per network. The registry is namespaced by network, so a Testnet address is never
   offered under Mainnet, and re-adding it there would be a different, probably empty, account.

Verify each address independently before trusting it: compare it character-for-character with the
address in your incident log, change ticket, or block explorer. A mistyped but valid `C…` address
opens a different (or nonexistent) contract.

### Step 3 — Re-read and confirm the on-chain state

For each restored guard, confirm against the chain rather than against memory:

```bash
npm run inspect -- --guard C…YOUR_GUARD
npm run inspect -- --guard C…YOUR_GUARD --json   # machine-readable for the ticket
```

Expected output includes the current `status()`, the installed policy (or "no policy" — which is
default-deny, not an absent read) and `is Phase 1 artifact`. A `false` artifact check means you are
not looking at the contract this dashboard deploys; stop and investigate before any write.

In the UI, the Overview screen's **Policy in force** line and the panic panel's status must agree
with the CLI output. An unreadable value is shown as unavailable, never as a zero.

### Step 4 — Restore the data you can, and record what you cannot

- **Address book:** if you exported it (the Address Book modal exports JSON), import it and review
  the merge report. Without an export, re-enter the recipients you actually use and verify every
  address against its source.
- **Webhook settings:** re-enter the destination URL and event choices. Test the destination with a
  benign event where the provider supports it.
- **Transaction history:** re-import only if you exported the CSV backup before the loss. Otherwise
  treat the local history as gone; the ledger still has every hash, but this console cannot
  reconstruct the list from it.
- **Drafts and filters:** recreate the draft from the installed policy with `Load installed` on
  `/configure`; do not submit it just to "restore" state.
- **Preferences:** reset and re-choose. They are presentation only.

### Step 5 — Verification checklist

- [ ] The wallet is connected, on the console's network, with the expected admin account.
- [ ] Every guard you operate is present under the correct network and its address matches the
      source of truth character-for-character.
- [ ] Each guard's `status()` was read live, not taken from a stale tab or memory.
- [ ] Each guard's installed policy matches the change record (or is knowingly absent).
- [ ] `is Phase 1 artifact` is true for every guard this console is expected to manage.
- [ ] The address book contains only verified recipients, and the allowlist consequences were
      re-checked (an enabled allowlist with no recipients refuses every transfer).
- [ ] Webhook alerts, if used, are restored and were tested.
- [ ] The recovery is written into the incident/change log, with what was unrecoverable stated
      explicitly.

---

## 4. What this runbook does not claim

- **No policy backup.** The dashboard does not store a copy of a policy, and losing the profile
  does not lose the on-chain policy. There is no "restore policy from browser" action. The
  Migration Wizard copies a policy from one _live guard_ to another; it is not a backup file and
  will not recreate a policy from local data.
- **No address or history backup.** Only an export you made and kept is recoverable.
- **No key custody.** The dashboard never sees, stores, or restores an admin or agent secret. A
  lost wallet is recovered through the wallet, not here.
- **No hidden server copy.** This is a pure client-side console: there is no API route, account
  database, or server-side persistence that could restore your local list. Anything not in this
  browser and not exported is gone.

---

## 5. If the loss happens during an incident

Do not spend the incident recovering a profile. The emergency freeze path that does not need this
browser's local data is in the [Emergency freeze runbook](./emergency-freeze.md): connect the admin
wallet on the correct network, or use the Stellar CLI fallback, and verify `status()` on chain.
Recover labels, drafts and history after the account is safe — and record timestamps for both the
incident and the recovery so the two are not conflated.
