# Registry Backups vs. On-Chain State

**Audience:** the operator using the fleet tab's bulk cleanup and its **Restore
previous registry** undo.
**Applies to:** `captureRegistryBackup` and `restoreRegistryBackup` in
[`lib/guard/registry.ts`](../../lib/guard/registry.ts), and the saved-guard list they
read and write, defined in [`lib/guard/instance.ts`](../../lib/guard/instance.ts).
**Related:** [Routine policy updates](../runbooks/policy-updates.md) ·
[No Mock State](../concepts/no-mock-state.md) ·
[ADR 003: non-custodial wallet model](../adr/003-non-custodial-wallet-model.md) ·
[Telemetry export schema](../export-schema.md)

> A registry backup is a copy of **one browser's list of guard addresses**, taken
> immediately before a bulk cleanup so that cleanup can be undone in one step. It
> is not a backup of a contract, a policy, a balance or a key. Restoring it changes
> the address list in this browser and nothing else, and no backup can change
> anything on chain.

This page exists because that distinction is easy to blur and expensive to
discover late. If you have ever thought "I have a backup, so I can put the policy
back", read section 3 and section 6 before you rely on it.

---

## 1. Two kinds of state, and a backup only holds one of them

The dashboard keeps a small amount of data in the browser and reads everything
else from the ledger, every refresh.

| What                                                                                             | Where it actually lives                                                       | In a registry backup? |
| ------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------- | --------------------- |
| Guard address, operator label, network, date added, provenance                                   | `localStorage` under `stellar-agent-guard-dashboard.instances.v2.<network>`   | **Yes**               |
| The guard that was on screen when the cleanup was confirmed                                      | React state: the fleet tab passes it into the capture                         | **Yes**, one string   |
| The backup object itself                                                                         | React state (`useState`), same component                                      | It _is_ the backup    |
| Caps, assets, recipient allowlist, protocol allowlist, active window, pause flag, dead-man grace | the guard contract, read as `snapshot.policy` by `guardOps.readGuardSnapshot` | **No**                |
| `admin_frozen`, `heartbeat_expired`, `last_heartbeat`, `has_policy`                              | the guard contract, read as `snapshot.status`                                 | **No**                |
| Rolling spend total and its entries                                                              | the guard contract, read as `snapshot.window`                                 | **No**                |
| Pinned WASM identity                                                                             | the guard contract, read as `snapshot.identity`                               | **No**                |
| Secret keys                                                                                      | your wallet extension, never application JavaScript                           | **No**                |

Nothing in the on-chain rows is cached. `pollFleet` calls
[`readGuardSnapshot`](../../lib/guard/guardOps.ts) once per guard on every refresh
([`lib/guard/fleet.ts`](../../lib/guard/fleet.ts)), and the fleet table's
`derivedStatus`, `spend24h` and `dmsCountdownSecs` are recomputed from that fresh
read. The registry module states the same rule for the list itself: "only the
address, its label and the network it belongs to are remembered, and every number
the UI shows is read from the chain on each refresh"
([`lib/guard/instance.ts`](../../lib/guard/instance.ts)). See [No Mock
State](../concepts/no-mock-state.md).

**Consequence:** a cleanup plus undo can put your _shortcuts_ back. It cannot put a
_rule_ back, because the rules were never in the browser.

---

## 2. What a backup includes

### What the backup object holds

A backup is one object, `RegistryBackup` ([`lib/guard/registry.ts`](../../lib/guard/registry.ts)),
and it has exactly four fields:

| Field         | Type              | Value                                                                                                                                |
| ------------- | ----------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `network`     | `string`          | The network the captured list belongs to. Defaults to this build's `NETWORK.name`, which is `NEXT_PUBLIC_NETWORK_NAME` or `testnet`. |
| `capturedAt`  | `string`          | ISO-8601 time of the capture. Written at capture and never read back: a restore does not check how old the backup is.                |
| `activeGuard` | `string`          | The guard on screen when the cleanup was confirmed, or `""`. The undo moves you back to it if it is still in the restored list.      |
| `entries`     | `GuardInstance[]` | The saved list exactly as stored at capture time. Capped at the same 50 entries the store allows.                                    |

`captureRegistryBackup` fills `entries` from `loadSavedInstances`, which reads the
namespaced bucket and nothing else.

### What each entry holds

Five fields, no more. This is the whole of `GuardInstance`:

| Field        | Meaning                                                                                                                   |
| ------------ | ------------------------------------------------------------------------------------------------------------------------- |
| `guard`      | The guard contract address (`C…`). This is the entry's identity: a restore de-duplicates on it and nothing else.          |
| `label`      | The operator's name for that address. Stored empty it falls back to the truncated-address label from `defaultGuardLabel`. |
| `network`    | The network the address belongs to. A restore compares it to the target network and drops the entry when they differ.     |
| `addedAt`    | ISO-8601 time the operator saved it. A restore keeps the captured value rather than re-stamping it.                       |
| `provenance` | Where the address came from, shown in the selector ("Added from this browser." for a local save).                         |

An entry is a **pointer plus a sticky note**. It carries no amount, no cap, no
recipient, no freeze flag and no key material, and it cannot: none of that data
ever reaches `localStorage` from this code path.

---

## 3. What a backup excludes, and where that data really is

| Excluded                                                                                                                 | Its real home                                                                                                                                | How you get it back                                                                                                                                                                               |
| ------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Policy: per-transaction cap, rolling cap and length, assets, recipients, protocols, active window, pause, dead-man grace | On chain, inside the guard contract. Read per refresh (`snapshot.policy`).                                                                   | It was never lost. A cleanup touches no contract. To move a policy to an earlier value, re-install it from the baseline you captured: [policy updates, section 3](../runbooks/policy-updates.md). |
| Freeze state, heartbeat, expiry                                                                                          | On chain (`snapshot.status`).                                                                                                                | Read the Overview screen after the restore; the console re-reads it.                                                                                                                              |
| 24h / rolling spend                                                                                                      | On chain (`snapshot.window`).                                                                                                                | Same: it is a live read, not stored state.                                                                                                                                                        |
| Build-seeded guards (`KNOWN_INSTANCES`)                                                                                  | Constants compiled into the build, not storage. `loadSavedInstances` reads stored entries only, so a capture never contains them.            | They are still offered by the selector: a bulk cleanup cannot delete them and `planBulkCleanup` names them as skipped.                                                                            |
| Secret keys, seed phrases                                                                                                | Your wallet. This dashboard is non-custodial: keys never enter application JavaScript ([ADR 003](../adr/003-non-custodial-wallet-model.md)). | Your wallet's own recovery phrase. No registry backup contains a key, in any form.                                                                                                                |
| Another browser, another device, another profile                                                                         | Nowhere. The saved list is per browser profile and nothing syncs it.                                                                         | Add the guards again, or move the profile. There is no registry backup file to carry.                                                                                                             |

One nuance on build-seeded guards, because it surprises people: a seeded guard is
not captured, but **a rename of one is**. Renaming a seeded guard writes a saved
shadow entry into the bucket (`renameInstance` in
[`lib/guard/instance.ts`](../../lib/guard/instance.ts) pushes it with
`provenance: "Renamed from this browser. …"`), and a saved shadow is exactly what
`loadSavedInstances` returns. So your custom name for a Phase 1 or Phase 2 guard
survives a cleanup; the seeded address was never at risk.

There is also no file format for the registry. The import/export buttons next to
the address book
([`components/AddressBookModal.tsx`](../../components/AddressBookModal.tsx)) move
**contacts**, which are a different record from saved guards, and the fleet table
has no export at all. If you need the guard list as a durable artifact, export the
contact book or take the printed report; do not assume "Restore previous registry"
is a backup you can keep.

---

## 4. Network scoping

Saved guards are namespaced per network, one bucket each:

```text
stellar-agent-guard-dashboard.instances.v2.testnet
stellar-agent-guard-dashboard.instances.v2.mainnet
```

`instanceStorageKey(network)` builds the key and `NETWORK.name` picks the bucket
([`lib/guard/instance.ts`](../../lib/guard/instance.ts),
[`lib/guard/network.ts`](../../lib/guard/network.ts)). The reason is not tidiness: a
guard address is an account on one specific network, and a signature produced under
one passphrase cannot authorize on another, so an address from the wrong bucket is
not merely untidy, it is an entry you can select and then fail to sign with. The
registry module's own header states the rule: a Testnet address and a Mainnet
address are never offered in the same list.

**A capture records the network it read from** in `backup.network`, and it can only
ever contain the one bucket it read. Each entry carries its own `network` field,
which the store keeps equal to the bucket by construction; a disagreement between
the two is possible only in a list something other than this console wrote, and
section 5 says what happens to it: the entry is dropped.

A cross-network restore has two independent layers, and they are not equally
effective. This page states which one does the work:

1. **The refusal in `restoreRegistryBackup`**
   ([`lib/guard/registry.ts`](../../lib/guard/registry.ts)): if `backup.network`
   differs from the target network, the restore is refused with "That restore point
   belongs to another network." The target is `options.network ?? backup.network`,
   so **it defaults to the backup's own network**. The only in-app caller,
   `restoreRegistry` in
   [`components/GuardProvider.tsx`](../../components/GuardProvider.tsx), calls
   `restoreRegistryBackup(backup)` with no options at all. In the shipped UI that
   comparison is therefore always equal and this layer never fires: it protects
   callers that name a target network, not the undo button.
2. **The per-entry filter in `restoreInstances`**
   ([`lib/guard/instance.ts`](../../lib/guard/instance.ts)):
   `if (instance.network !== network) continue;` drops any entry whose network is
   not the target, silently. This is the layer that actually keeps a Testnet
   bucket free of Mainnet addresses, and it is the one the fleet undo depends on.

Practical reading: the undo writes into the bucket named by the backup, which is
the bucket it was captured from, so the in-app undo can never move addresses
between networks. What it does _not_ do is notice that you have since switched
networks, because the caller never passes the current one. A switch that matters
cannot happen through this dialog anyway: the backup lives in React state, so
leaving the page or reloading discards it.

If you need a restore applied to a specific network bucket, that is a caller-side
decision, not something the UI offers. Do not treat layer 1 as a safety net you can
rely on from the fleet tab.

---

## 5. Restore conflicts

`restoreInstances` **merges**, it does not replace. It iterates
`[...entries, ...saved]`, backup entries first, keeping the first record of each
address in a `seen` set, then writes the result.

| Situation                                           | What the restore does                                                                                                                          | Is it reported?                         |
| --------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------- |
| Address in the backup and still stored              | The **backup's** version wins; the stored one is skipped.                                                                                      | No.                                     |
| You renamed a guard after the capture               | The captured label is written back over your rename.                                                                                           | No conflict is raised.                  |
| Address added after the capture, not in the backup  | Kept. A merge, not an overwrite.                                                                                                               | No.                                     |
| Entry whose `network` differs from the target       | Dropped.                                                                                                                                       | Silently.                               |
| Entry whose `guard` is not a valid contract address | Dropped (`looksLikeContractAddress`, `^C[A-Z2-7]{55}$`).                                                                                       | Silently.                               |
| Merged list longer than `INSTANCE_LIMIT` (50)       | Cut to the first 50 in backup-first order, so what falls off is entries added **after** the capture.                                           | Silently.                               |
| The storage write throws                            | Nothing is written. `restoreRegistryBackup` returns `ok: false` with "The previous registry could not be written back — nothing was restored." | Yes, this is the only reported failure. |

The worst of these is the second row, because it destroys work without asking:

1. Capture happens as part of confirming a cleanup. Your registry says `Treasury`.
2. Before or after the cleanup, you rename that guard to `Cold - do not touch`.
3. You press **Restore previous registry**.
4. The merged entry is the captured one. The list says `Treasury` again, and the
   console says "Restored the registry as it was before the cleanup", which is
   literally true and exactly the problem.

Labels are operator intent, and a restore resolves them in favor of the older
capture. Nothing in the code treats that as a conflict, so nothing in the code can
tell you about it.

**What the restore does report:** success or a write failure, and the resulting
combined list. `RegistryRestoreResult.restored` is a length delta
(`merged.length - saved.length`), not a count of conflicts, and
`restoreRegistryBackup` discards it. There is no "3 entries were dropped" message.

### Safe procedure

- **Re-read after restoring.** Select the guard and look at the Overview screen. The
  contract is the authority on what that address is and does; the registry entry is
  only how the console finds it.
- **Re-apply labels last, not first.** If you renamed anything between the capture
  and the restore, expect to rename it again. Do the cleanup, restore, then fix
  names.
- **Do not use a restore as a review checkpoint.** Once you dismiss the notice, or
  reload the page, the backup is gone. If a list matters, record the addresses
  before the cleanup.
- **Use the printed report or a contact export for anything you must keep.** The
  undo is one step, in memory, in this tab.

---

## 6. What a backup is not

- **Not key recovery.** The dashboard never sees a secret key, so no backup it
  makes can contain one. Losing a key is a wallet problem; see
  [ADR 003](../adr/003-non-custodial-wallet-model.md) and
  [agent key rotation](../runbooks/agent-key-rotation.md).
- **Not a policy rollback.** Policies are contract state. Rolling one back means
  re-installing an earlier configuration with an admin signature, which is
  [the policy runbook](../runbooks/policy-updates.md), not this.
- **Not a contract backup.** A guard account cannot be recreated from an address
  list; deploying is a chain write from the pinned artifact, covered in the
  [deploy panel screen](../screens/deploy-panel.md).
- **Not a freeze undo or a freeze audit trail.** Freezing is a signed write
  ([emergency freeze](../runbooks/emergency-freeze.md)); a registry restore neither
  freezes nor unfreezes anything and leaves no ledger trace.
- **Not an archive.** It is in-memory, single-step, per tab. For history you can
  keep, use the telemetry and transaction exports described in
  [export-schema.md](../export-schema.md).

If you find yourself wanting a registry backup that survives a reload, what you
want is the list of addresses written down, not this feature.

---

## 7. Checklist before a bulk cleanup

- [ ] You know that only the saved list is affected. No contract is touched, and the
      notice says so.
- [ ] Any **rename you plan to make after this point** is either deferred until after
      a possible restore, or noted down, since a restore overwrites it.
- [ ] You are on the network you expect (the header and the wallet bar show it), and
      the addresses you are clearing are on that network.
- [ ] You have written down the addresses you are clearing, in case the undo is
      dismissed or the tab reloads.
- [ ] Build-seeded guards in the selection are understood to be skipped, not removed.
- [ ] After a restore, you re-read each guard you rely on rather than trusting the
      list.

---

## 8. Where this is enforced

The claims on this page are checked, not assumed:

- `tests/unit/guardRegistry.test.ts` pins the backup shape, the exclusion of
  build-seeded entries, the merge order that overwrites a later rename, the drop of
  foreign-network and malformed entries, the 50-entry cap, and the
  optionless restore exactly as the fleet undo performs it.
- `tests/unit/registryBackupGuide.test.ts` reads this file and compares the entry
  field list in section 2 against the fields the code actually produces, so adding
  a field to `GuardInstance` fails the guide instead of silently making it wrong.
- `npm run test:docs` resolves every relative link written here.

If you change `RegistryBackup`, `GuardInstance`, `captureRegistryBackup`,
`restoreRegistryBackup` or `restoreInstances`, change this page in the same pull
request.
