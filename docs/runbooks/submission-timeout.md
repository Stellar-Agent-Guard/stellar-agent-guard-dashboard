# Runbook — Submission Timeout: Verifying an Ambiguous Transaction

**Audience:** the operator holding the guard account's **admin** key. Every
verification step below is read-only and needs **no key, no signature and no
secret material** — only when you decide to write again does the wallet come
into play.
**Applies to:** any write this dashboard performs — policy installs and
revokes, freeze/unfreeze, initialize, agent-key rotation, and the deploy
flow's upload/create steps — when the browser or the RPC response timed out
before confirmation was observed.
**Related:** [Emergency freeze & incident response](./emergency-freeze.md) ·
[Routine policy updates](./policy-updates.md) ·
[Panic button & freeze](../screens/panic-freeze.md) ·
[Deploy panel](../screens/deploy-panel.md) ·
[Client-side Freighter architecture](../concepts/client-side-freighter-architecture.md)

> **The one rule this runbook exists for:** after a timeout you do not know
> whether the transaction landed. Chain state is the only authority — the
> transaction history row supplies the **hash to check**, never the answer —
> and **an ambiguous write is never replayed automatically.** Classify first
> (section 2), verify with reads (section 3), and only then decide.

---

## 1. Why a timeout is not a failure

A write from this console is a bounded sequence: simulate → sign → broadcast →
watch for inclusion. There are exactly two places a timeout can interrupt it,
and they mean different things:

1. **The send request ended without a response.** The signed envelope may or
   may not have reached the network; only the reply may have been lost.
2. **The inclusion poll gave up** (this console polls a submitted transaction
   for about a minute — 30 attempts, 2 seconds apart — before stopping). The
   transaction was broadcast, but the network never said what happened before
   the console stopped watching.

In both cases the transaction **can still land after the console gave up** —
core will happily include it minutes later, while its timebounds hold. That is
why the console reports these outcomes as **unconfirmed** (the `unknown`
outcome in `lib/guard/submit.ts`), records an **Unconfirmed** row in the
transaction history with the hash, announces _"Transaction submission
unconfirmed — verify the hash on chain before retrying"_, and then **stops**.
Nothing in this codebase re-sends a broadcast transaction.

The unsafe reaction — "it seemed to hang, I'll just click it again" — is what
this runbook exists to prevent: a blind replay can execute an action twice
(two `set_policy` installs, a second transfer-sized effect through a different
path) or pay a second fee for a write that had already landed.

---

## 2. Classify before you act — four distinct cases

| Case                   | What you observe                                                                                                                                                                                                                                                                    | What is true on chain                                                                                      | What you may do next                                                                                                                                   |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Not submitted**      | An outcome banner reading _"Refused during \<stage\> — nothing was broadcast"_, or _"the RPC did not accept the transaction (TRY_AGAIN_LATER)"_ — **no history row, no fee**; or a history row whose detail says the transaction **expired** during or after wallet-signature delay | Nothing from this attempt was ever queued. An expired envelope can never land — its timebounds have passed | Fix the cause and submit normally. A refusal is free and leaves no trace on the ledger                                                                 |
| **Submission unknown** | A history row with the amber **Unconfirmed** pill and its hash; the assertive announcement _"Transaction submission unconfirmed — verify the hash on chain before retrying"_; an outcome banner reading _"Submission unconfirmed — tx/\<hash\>"_                                    | **Unknown.** The transaction may land after the console stopped watching — only a read can tell            | Read-only verification (section 3). **No replay** until section 5's conditions are met                                                                 |
| **Pending**            | The row's Verify reports **Pending on network**; or the write is still inside its inclusion window and the console is still polling                                                                                                                                                 | Queued and in flight; not yet included                                                                     | Wait, then re-verify. A second submission buys nothing — the network deduplicates identical envelopes and rejects differing ones for the same sequence |
| **Confirmed**          | The row reads **Confirmed**; Verify reports **Confirmed on chain` with a ledger                                                                                                                                                                                                     | Included and successful                                                                                    | Verify the _effect_ (section 6). A confirmed write can still have done nothing you wanted                                                              |

Decision rule: **if you cannot prove it was not submitted, treat it as
submission unknown.** The conservative reading costs one verification; the
optimistic reading can cost a double execution.

How each case gets its evidence:

- **Not submitted** is proven by the console itself: a refusal happens
  _before_ broadcast (the enforced simulation refused, or the RPC answered
  `ERROR`/`TRY_AGAIN_LATER`), so there is nothing to look up. A history row
  whose detail reads _"Transaction expired during/after wallet signature
  delay"_ is also not submitted — those checks run before `sendTransaction`,
  so that envelope never left the browser; the fee column will show what the
  envelope _would_ have paid only if it was broadcast, which it was not.
- **Submission unknown** is what the console says when it lacks evidence. The
  hash in the row is either the hash the RPC acknowledged or — when the send
  request itself timed out — the hash computed locally from the signed
  envelope. Either way it is the handle you verify with.
- **Pending** is a live read, not a memory: it only ever comes from
  `getTransaction` answering while the transaction is still in flight.
- **Confirmed** is a live read too, and it is the only status that means the
  network executed the transaction.

---

## 3. Verify read-only (no secrets, no signatures)

Every step here is a pure read. You do not connect a wallet, unlock Freighter,
or handle any secret to complete this section.

### 3a. The hash: the console's own verification column

1. Open the console home page (`/`) and scroll to **Transaction history**.
2. Find the row (search by hash prefix or operation). The amber
   **Unconfirmed** pill marks the ambiguous write; the row carries the hash,
   fee, network name and recorded passphrase.
3. Click **Verify** on that row. It performs a live `getTransaction` against
   `NETWORK.rpcUrl` — **only** for a row recorded on the exact currently
   selected network (otherwise the button reads _Unavailable_, which is the
   console refusing to compare across networks, not a verification result).

Read the result next to the row:

| Verification result    | Meaning                                                                                                                       | Next                                                  |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| **Not found**          | The RPC has no record of the hash _yet_ — it never reached the network, or it has not been included (and may still be queued) | Continue to 3b, then apply section 5 before any retry |
| **Pending on network** | Known to the RPC, not yet included                                                                                            | Wait. Re-verify in a minute. **Do not resubmit**      |
| **Confirmed on chain** | Included and successful, with a ledger number                                                                                 | Go to section 6 and verify the _effect_               |
| **Failed on chain**    | Included and rejected — the fee was spent, the state change did not happen                                                    | Read the detail, fix the cause, then submit fresh     |
| **Unavailable**        | Wrong network for this row, or the RPC could not be reached                                                                   | Fix the network/RPC and repeat                        |

The row keeps its locally recorded status afterwards — verification displays
beside it rather than rewriting it. The **live read wins for every decision**;
the row is your notebook, not the chain.

### 3b. Independently: the block explorer

Confirm the console's claim against a second reader — no key required:

- Transaction:
  `https://stellar.expert/explorer/testnet/tx/<HASH>` (swap `testnet` for
  `mainnet` when the row's network says so). Success/failure, ledger, fee, and
  the operations it carried.
- If the send timed out before you ever saw a hash: open the **admin account**
  page on the explorer
  (`…/explorer/testnet/account/G…ADMIN…`) and read its recent transactions —
  a landed write appears there with its own hash and sequence number. Compare
  against the console's history rows to pick out the one you were waiting on.

### 3c. The guard's own state

The transaction proves execution; the contract's reads prove the _effect_.
Both are read-only:

```bash
npm run inspect -- --guard C…YOUR_GUARD          # human-readable
npm run inspect -- --guard C…YOUR_GUARD --json   # machine-readable for a ticket
```

This prints the live `status()`, installed `policy`, `window`, and artifact
identity straight from the chain — no wallet, no key, no signing.

### 3d. Optional: CLI reads (still read-only)

If you prefer the [Stellar CLI](https://developers.stellar.org/docs/tools/developer-tools),
these invocations only simulate — they never sign or broadcast:

```bash
export GUARD=C…YOUR_GUARD
export ANY_IDENTITY=your-local-keys-entry   # any local keypair is the source; the admin key is not needed

stellar contract invoke --id "$GUARD" --source "$ANY_IDENTITY" --network testnet -- status
stellar contract invoke --id "$GUARD" --source "$ANY_IDENTITY" --network testnet -- policy
stellar contract invoke --id "$GUARD" --source "$ANY_IDENTITY" --network testnet -- window
```

No step in this runbook requires the admin secret anywhere. Verification is
reads all the way down; the wallet is only involved when — and only after —
you decide a new write is warranted.

---

## 4. The prohibition: no automatic write replay

**After a timeout, never replay the write automatically — not in the console,
not in a script, not by re-clicking while unsure.** Specifically:

- **The console never retries.** One signature produces at most one
  `sendTransaction`; if the outcome is ambiguous the console records
  _Unconfirmed_, tells you to verify, and stops. No code path re-sends a
  broadcast transaction, and none should be added. (Bounded retries exist
  only for _reads_ — simulation and inclusion polling — never for the write
  itself.)
- **Do not re-broadcast a stored envelope.** The history keeps hashes and
  metadata, not signed XDR; an exported envelope from a policy/panic flow is
  _unsigned_ and timebounded. Never treat either as a replay token.
- **Do not script "submit until success."** Any tool that drives this
  dashboard's flows must gate a retry on a read-only `NOT_FOUND` **after**
  the original's timebounds have passed (section 5) — and on a re-read of the
  account sequence showing the original never consumed it.
- **Do not resubmit because the UI "looked stuck."** A slow RPC and a landed
  transaction look identical from the browser. Only section 3 tells them
  apart.

This is not a UX preference; it is the same discipline as the pre-flight
enforcement path: an ambiguous write must be resolved by a read before another
write is considered ([enforcement scope](../enforcement-scope.md)).

---

## 5. When a replay is actually safe — the conditions, in order

A _manual_ resubmission of the same intent is legitimate only when **every**
condition below holds. Skip none.

1. **The hash verifies `NOT_FOUND`** on the recorded network (section 3a),
   and still reads `NOT_FOUND` on a second check a little later. `PENDING`
   means wait; `SUCCESS`/`FAILED` mean it landed — neither permits a replay.
2. **The original's timebounds have expired.** Envelopes built by this
   console carry `maxTime = now + 300s` for contract calls, and the deploy
   flow's host-function operations set a 60-second timeout. Once the ledger
   clock passes `maxTime`, core rejects the original with `txTooLate` — it
   can never land, so the ambiguity is gone. Wait out the window rather than
   racing it.
3. **The account sequence has not moved past the original's.** Re-read the
   admin account (explorer, or any `getAccount`). If the sequence advanced,
   the original (or some other write) landed after all — return to section 3
   instead of replaying.
4. **The intent has not already happened.** Re-read the effect first:
   `policy()` for a policy write, `status()` for a freeze, the predicted
   address for a deploy step. If the world already reflects your intent, the
   correct action is to record it, not to repeat it.
5. **The replay is a fresh write.** New simulation, new signature, new
   timebounds — the normal path from the panel you started in. Never
   re-transmit an old envelope; a differing envelope for a consumed sequence
   is rejected pre-inclusion, and re-using the old bytes is exactly what
   section 4 forbids.

If any condition cannot be established — for example the RPC is unreachable —
the answer is to wait and re-read, not to write.

---

## 6. Recovery guidance by flow

All of these start from section 2's classification. Nothing here needs secret
material to _decide_; signing happens only in the "write again" branches.

### 6a. Policy flows (`set_policy`, `revoke_policy`)

1. Classify the `set_policy`/`revoke_policy` submission (section 2).
2. Read what is actually installed: the Overview screen's **Policy in force**
   card, `npm run inspect`, or `policy()` from the CLI (section 3).
3. **Not submitted** — fix the draft in `/configure` and submit normally; a
   refusal cost nothing and changed nothing.
4. **Submission unknown** — apply section 5, then reopen `/configure`, click
   **Load installed** so the form matches what is live, re-check the
   **Review** line, and submit **once**. Recall the two consequences of an
   install: the rolling window resets and the DMS clock restarts
   ([policy runbook](./policy-updates.md)) — a blind second attempt would
   apply them twice, handing the agent a fresh full allowance a second time.
5. **Confirmed** — compare `policy()` against your intended draft field by
   field (policy runbook, section 8). A confirmed write with the wrong
   contents is a _new_ change to make deliberately, not a replay.
6. `revoke_policy` specifically: if unknown, read `policy()` — either the
   account is back to default-deny (done) or the old policy still stands
   (retry under section 5). Do not assume.

### 6b. Panic flows (`freeze`, `unfreeze`)

The panic panel re-reads the contract's `status()` after every write — that
re-read, not the submission label, is the verdict.

1. Classify the submission (section 2).
2. Read `status()` yourself if in doubt: `admin_frozen` is the answer, on
   chain, regardless of what the browser saw. Distinguish it from
   `heartbeat_expired` — a dead-man-switch freeze is a different event
   ([emergency freeze runbook](./emergency-freeze.md)).
3. **Submission unknown + `admin_frozen` already reads what you wanted** —
   the freeze (or unfreeze) is done. Record the hash; no further write.
4. **Submission unknown + state unchanged** — apply section 5 (the freeze
   envelope's timebounds are the same 300 seconds), then sign **one**
   freeze/unfreeze from the panic panel. Do not click repeatedly while the
   dialog is open: each click is a fresh signature request, and "the UI
   seemed stuck" is not evidence.
5. **Not submitted** — the enforced simulation refused (nothing broadcast,
   zero fee). Read the refusal reason; a freeze refused because the wallet
   was on the wrong network, or a call refused while already frozen, is
   diagnosed exactly as the [emergency freeze runbook](./emergency-freeze.md)
   describes, then retried normally.
6. **Confirmed but the state disagrees** — a rare but real case: the
   transaction executed and `status()` still reads the old value. Follow the
   emergency runbook's verification section rather than resubmitting; the
   panel's own report says _"NOT confirmed"_ and names the mismatch.
7. After _any_ recovery, confirm the agent-blocking effect the freeze runbook
   requires (a refused diagnostic call with zero fees) before standing down.

### 6c. Deployment flows (`upload_contract_wasm`, `create_custom_contract`, initialize)

A deploy is **three independent writes**, each with its own hash, step row and
outcome — classify **per step**, never as one blob.

1. Re-open the deploy panel and run the plan/preview (artifact check, code
   presence, predicted address). Planning **signs nothing** — it is a
   read-only re-assessment and the correct first move after any ambiguity.
2. **Upload unknown** — ask one question: is the wasm code entry live? The
   plan reports it (and `artifactCodePresent` answers it directly). If the
   entry is live, the upload happened — proceed to create, do **not** upload
   again. If it reads absent _and_ section 5's conditions hold, upload once.
3. **Create unknown** — check the **predicted address** on the explorer or
   with `npm run inspect -- --guard <predicted>`:
   - Instance exists and runs the pinned hash → the create landed; continue
     with **Sign and initialize**. Do not create again — a second create for
     the same address is a wasted, fee-costing rejection.
   - Nothing at the address → apply section 5, then re-plan (the same salt
     predicts the same address, which is still free) and create once.
4. **Initialize unknown** — read the instance: an initialized guard reports
   its admin and agent key through `status()`. Already initialized → skip to
   verification; not initialized → section 5, then initialize once.
5. **Confirmed steps** — verify the post-deploy identity matches the pinned
   artifact (the receipt's `verified` flag comes from a live read, and the
   receipt itself says so in its disclaimer: a client-generated record, not
   proof of chain state).
6. Never restart the whole flow from scratch because one step timed out —
   each step's outcome (including `unknown`, with its hash) is recorded in
   the deploy receipt and in the transaction history precisely so you can
   resume from evidence.

### 6d. If another operator or tab is involved

History rows are **per browser profile**; the chain is shared. A write signed
from another machine or tab will not appear in your history but can absolutely
appear on chain — which is one more reason section 3's live reads, not any
console's local record, decide what happened.

---

## 7. Preserve evidence

Before retrying anything, capture what you know:

1. The **hashes** and timestamps from the transaction history — export CSV
   from the panel (and use **Download history backup** if a save warning is
   showing). The record is local to the browser profile; export it to durable
   storage if it must survive.
2. The **verification outputs** from section 3: result, ledger, RPC URL, and
   the wall-clock time you checked. Screenshot or `--json` into the ticket.
3. The **state reads** (`status()`/`policy()`/`window()`) before and after
   any recovery write.
4. For incidents, follow the evidence checklist in the
   [emergency freeze runbook](./emergency-freeze.md) — this runbook's writes
   slot straight into its timeline.

---

## 8. Why the console behaves this way (architecture invariants)

These are documented guarantees, not implementation accidents — keep them
intact when changing this code:

- **Client-only, non-custodial.** Signing happens in the operator's browser
  through Freighter. There is no API route, no server-side signer, and no
  secret-key persistence anywhere in this repository
  ([architecture](../architecture.md), [client-side
  Freighter](../concepts/client-side-freighter-architecture.md)).
- **Chain state is authoritative.** localStorage holds inputs — hashes,
  network passphrase, operator preferences — and never stands in for a live
  read ([no mock state](../concepts/no-mock-state.md)).
- **Pre-flight enforcement before broadcast.** A refused call costs nothing
  and leaves no ledger trace, which is what makes "not submitted" a real,
  provable case rather than a guess.
- **One broadcast per signature.** Retries exist only for reads; ambiguous
  outcomes are recorded as `unknown` and announced with the verify-first
  instruction. The separation of `refused` / `unknown` / `failed` /
  `submitted` in `lib/guard/submit.ts` — and `confirmed` / `failed` /
  `unknown` in the history — is the code form of section 2's table; keep the
  four cases distinct when extending it.

---

## 9. Escalation

- **A verification that contradicts itself, a wrong Unconfirmed label, or any
  replay-like behaviour:** open a GitHub issue on this repository with the
  hash, the row's recorded network, and the verification output. No secrets,
  no signed envelopes.
- **Contract semantics** (what `status()`/`policy()` mean after a partial
  sequence): `stellar-agent-guard-contracts`.
- **SDK / agent-runtime write paths:** `stellar-agent-guard-sdk`.
- **Wrong network or wrong guard address suspected:** stop and follow the
  [emergency freeze runbook](./emergency-freeze.md) — an ambiguous write on
  the wrong account is an incident, not a retry.

> ⚠️ This is unaudited security tooling that gates real fund access. Do not
> deploy to mainnet without an independent audit.
