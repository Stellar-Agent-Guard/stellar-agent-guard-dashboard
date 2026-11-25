# Runbook — Fleet-Wide Emergency Freeze Rehearsal

**Audience:** an operator accountable for **more than one** guard account, and the on-call who
would cover for them.
**Applies to:** rehearsing identification, per-guard confirmation and per-guard verification of an
emergency freeze across a fleet — before a real incident.
**Related:** [Emergency freeze & incident response](./emergency-freeze.md) ·
[Dual-freeze semantics](../concepts/dual-freeze-semantics.md) ·
[Panic button & freeze](../screens/panic-freeze.md) · [Fleet screen notes](#6-what-the-fleet-screen-can-and-cannot-do)

> **The rule this rehearsal exists to teach:** there is **no bulk freeze** in this dashboard, and
> this runbook never performs one. Each guard is a separate contract with its own admin
> authorization, its own transaction and its own confirmation. A rehearsal that "freezes the fleet"
> in one click would train an action that does not exist.

---

## 1. Why a fleet is frozen one guard at a time

| Fact                                                             | Consequence for a fleet incident                                                                                            |
| ---------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Every guard is its own Soroban contract                          | Freezing A does not freeze B, even when both are in the same registry and use the same wallet.                              |
| `freeze()` is authorized by that guard's admin identity          | Each call needs a wallet prompt and a separate confirmed transaction.                                                       |
| A signed authorization entry is bound to one contract invocation | A signed payload cannot be replayed for another guard. "Sign once, freeze many" is not available.                           |
| The Fleet screen is a **read-and-navigate** surface              | It derives each row's status from a live read and routes you to one guard. Its bulk action removes _registry_ entries only. |
| Verification is a fresh `status()` read per guard                | A row rendered before the freeze is not evidence after it. Each guard must be re-read independently.                        |

Plan for **N confirmations and N verifications** for N guards. If that is too slow for the risk you
carry, reduce N (retire unused guards) rather than inventing a bulk write.

---

## 2. Preparation (do this on a quiet day)

### 2a. Build the fleet inventory

For every guard, record the following in one place — the incident log, not memory:

| Guard label | Address (`C…`) | Network | Admin key holder / wallet | DMS grace | Policy installed? | Expected state | Freeze priority |
| ----------- | -------------- | ------- | ------------------------- | --------- | ----------------- | -------------- | --------------- |
|             |                |         |                           |           |                   |                |                 |

The **freeze priority** is the order you would work in during a real incident: highest value or
highest exposure first. It is a plan, not an automation.

Capture it from the console:

- [ ] Every guard is present under the correct **network** in the selector (the registry is
      namespaced per network; a Testnet address is not offered under Mainnet).
- [ ] Every label maps to a verified address from an independent source, character-for-character.
- [ ] The fleet view's **Read** column is clean. A guard showing a read error is not a guard whose
      status you know; fix the read before the rehearsal.
- [ ] Registry backup exported (the Fleet screen's cleanup/undo path keeps only an in-session
      restore; export the list if you need it across sessions).
- [ ] Local transaction history exported, because it is the console's own record and does not exist
      on chain as a list.
- [ ] The admin wallet(s) are available, unlocked, and on the matching network — and a backup
      signer is identified for each guard.
- [ ] If a guard has no reachable admin key, write that down now. It cannot be frozen by this
      console, and discovering that during an incident is the failure this rehearsal prevents.
- [ ] The freeze priority is written down and agreed with the on-call who would act if you were
      unavailable. An order only you know is not a plan.

### 2b. Decide what "rehearsal" means for each guard

- **Tabletop / read-only:** walk the identification and confirmation screens, stop **before**
  signing. Nothing changes on chain. This can be done on every production guard.
- **Simulation mode:** the Overview screen's **Incident Simulation (rehearsal)** toggle overlays a
  synthetic dead-man-switch countdown and alerts, render-only, with no write path reachable. It
  trains recognition of DMS states, **not** an admin freeze.
- **Live drill:** actually sign `freeze()` and later `unfreeze()`. Only on a dedicated rehearsal
  guard, or in a planned window where halting the agent is acceptable. Never on a guard whose agent
  is mid-operation unless that is the drill's stated purpose.

Write down which mode each guard will use before you start. A live drill that was meant to be a
tabletop is an outage.

---

## 3. The rehearsal, per guard (repeat for every guard)

Run this loop in freeze-priority order. Do not parallelise it into one wallet session; the point is
that each guard is identified and confirmed on its own.

### Step 1 — Identify the target independently

1. Open `/fleet` and locate the row by **label**, then read its address.
2. Compare that address to your inventory, character-for-character. Two guards can have similar
   labels; only the address identifies the account.
3. Click **Inspect**. The console opens the Overview screen scoped to that address.
4. Confirm the selector's address and the network pill match the inventory. If the wallet is on a
   different network, the mismatch banner appears and every write is disabled — fix the wallet, do
   not edit the address.
5. Confirm the **Artifact identity** reads as the pinned Phase 1 artifact. If it does not, you are
   looking at a different deployment; stop and escalate.

**Do not proceed if any of the five checks is uncertain.** Freezing the wrong instance halts a
different agent and leaves the real one running.

### Step 2 — Read and record the pre-freeze state

On the Overview screen (or with the CLI), record for **this** guard:

- `status()`: `admin_frozen`, `heartbeat_expired`, `last_heartbeat`, `now`;
- `policy()`: installed or absent; caps, allowlists, grace;
- `window()`: current rolling spend;
- the local time and the ledger/latest-ledger reference.

This baseline is how Step 5 proves the freeze did something, and how you tell an admin freeze from
a DMS freeze that was already in effect.

### Step 3 — Require confirmation for this guard

1. Open `/panic` (or the console's **Emergency** panel) **for this guard**.
2. Click **Freeze this account**. The confirmation dialog moves focus into itself, cycles `Tab`
   inside it, and closes on `Escape`; on close, focus returns to the button that opened it.
3. Tick the acknowledgement — the **Sign freeze** button is disabled until you do.
4. In a tabletop, stop here and record "confirmation reached for `<address>`". In a live drill,
   continue to Step 4.

The acknowledgement is per guard because the dialog is per guard. Never reuse a confirmation from a
previous guard, a previous tab, or a copied transaction.

### Step 4 — Sign (live drill only)

1. Click **Sign freeze** and approve in the wallet. Expect up to two prompts: the authorization
   entry and the transaction envelope.
2. Record the transaction hash and the wall-clock time against **this** address.
3. Treat the submission receipt as a submission, not a freeze. Continue to Step 5.

A wallet on the wrong network cannot produce a valid signature for this guard; the console refuses
before submission. If the wallet declined or the write was refused during simulation, nothing was
broadcast and no fee was spent — record that outcome and do not retry blindly.

### Step 5 — Verify this guard independently (required)

The console re-reads the contract's own `status()` and reports **NOT confirmed** when a signed,
included write did not flip the flag. Then verify outside the console:

```bash
export GUARD=C…THIS_GUARD
npm run inspect -- --guard "$GUARD"                 # human-readable
npm run inspect -- --guard "$GUARD" --json          # for the incident log
stellar contract invoke --id "$GUARD" --source "$ADMIN_IDENTITY" --network testnet -- status
```

For this guard, confirm:

- [ ] `admin_frozen = true` **now**, on a fresh read — not a row cached before the write.
- [ ] The transaction hash is included and successful (live drill).
- [ ] The agent is actually blocked: a pre-flight refusal with reason `admin_frozen`, zero fee,
      zero hash (if you can safely trigger one). This is a **diagnostic** row, local to the tab,
      not ledger history — export or screenshot it before closing the tab.
- [ ] The Fleet screen, **after a refresh**, derives this row as frozen. The row is a read, not a
      stored flag; if it does not update, reload the tab rather than assuming the freeze failed.

Only when all four hold is this guard frozen. Move to the next guard and repeat from Step 1.

---

## 4. The confirmation and verification matrix

Keep one row per guard open through the whole exercise. This is what makes "the fleet is frozen" a
checkable statement rather than a feeling.

| Guard | Address verified | Network verified | Artifact verified | Pre-state recorded | Confirmation reached | Hash recorded | Fresh `status()` = frozen | Agent blocked diagnostic | Time |
| ----- | ---------------- | ---------------- | ----------------- | ------------------ | -------------------- | ------------- | ------------------------- | ------------------------ | ---- |
|       | ☐                | ☐                | ☐                 | ☐                  | ☐                    | ☐             | ☐                         | ☐                        |      |

Do not mark the fleet frozen until **every** row's fresh `status()` column is ticked. A guard whose
read failed is **unknown**, not frozen.

---

## 5. Failure and edge cases

| Situation                                                             | What it means                                                                              | Correct response                                                                                                 |
| --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------- |
| One guard's read fails during identification                          | You do not know its status; the address may be wrong or the endpoint unhealthy             | Do not freeze "to be safe" on a guess. Fix the read or use the CLI against that address; record the uncertainty. |
| The guard already reads `admin_frozen = true`                         | Someone froze it already, or a previous drill did                                          | Do not sign a second freeze as proof. Verify the existing state and record who/when; it is already contained.    |
| The guard reads `heartbeat_expired = true` but `admin_frozen = false` | This is a DMS freeze, not an intrusion                                                     | No emergency freeze is needed; follow the DMS path in the [emergency runbook](./emergency-freeze.md).            |
| Freeze signed but the console says **NOT confirmed**                  | The write was submitted but the flag did not flip; or the re-read is stale                 | Re-read `status()` from the CLI before doing anything else. Do not claim success from the receipt.               |
| Wallet on the wrong network                                           | The signature cannot authorize on this guard; the console disables writes and explains why | Switch the wallet's network; never change the guard address or env passphrase to make the banner go away.        |
| Two guards share one admin wallet                                     | Freezing both is possible, but still two prompts and two transactions                      | Keep the per-guard confirmation; do not treat one approval as approval for the next.                             |
| A tab shows another guard frozen                                      | Tabs broadcast confirmed state changes, but each tab's selected guard is its own view      | Reload and re-check the address in that tab. Never infer guard B's state from guard A's screen.                  |
| The fleet bulk action is used during an incident                      | It only removes saved registry entries locally; it freezes nothing                         | Do not use it as an emergency action. It is cleanup, and it is reversible from the same panel.                   |

---

## 6. What the fleet screen can and cannot do

- **Can:** list registered guards, read each one's derived status, spend and DMS countdown, search,
  filter and sort; route to one guard with **Inspect**; retry a failed read; remove or restore
  **saved registry entries** in bulk. Registry removal explicitly states that no contract on chain is
  deleted or changed.
- **Cannot:** freeze, unfreeze, or change a policy for multiple guards. There is no fleet-wide write.
  A row's status is derived from a read, not a control.

Use the fleet screen for **identification and monitoring**, the panic route for **one confirmed
freeze at a time**, and the emergency runbook for **verification and unfreeze**.

---

## 7. After the rehearsal

1. **Restore what you changed.** For a live drill, follow the unfreeze checklist in the
   [emergency freeze runbook](./emergency-freeze.md) — root cause or agent stopped, keys intact,
   policy reviewed — then unfreeze each guard individually and re-verify `admin_frozen = false` and
   an allowed agent call.
2. **Record timings.** Time to identify, time to confirm, time to verify, per guard. These are the
   numbers the next rehearsal should improve.
3. **Record gaps.** Missing admin keys, unreadable guards, unclear labels, stale tabs, unknown
   endpoints. Each is a real incident blocker, not a rehearsal nit.
4. **Update the inventory.** New guards, retired guards, changed wallets, changed DMS grace.
5. **Do not leave a draft freeze open** in a tab, and do not leave a rehearsal guard frozen by
   accident. A frozen rehearsal guard is still a stopped agent.
6. **Keep the evidence**: hashes, `status()` outputs, diagnostics, and this matrix — with timestamps.
   If the drill was on production, say so plainly in the record.

> ⚠️ This is unaudited security tooling that gates real fund access. Rehearse on a dedicated guard
> wherever possible, and do not deploy to mainnet without an independent audit.
