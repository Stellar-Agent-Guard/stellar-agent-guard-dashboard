# Runbook — Reading a Dashboard Error Without Guessing

**Audience:** any operator using this dashboard.
**Applies to:** errors the console surfaces during wallet connection, read
refreshes, simulation, submission, and post-submission verification.
**Related:** [Emergency freeze runbook](./emergency-freeze.md) ·
[FAQ](../faq.md) · [No Mock State](../concepts/no-mock-state.md)

The rule behind every row of this document: **the chain is authoritative, the
browser is not.** Local storage, cached panels and last-seen values are inputs,
never evidence. So every failure below gets three answers, in this order:

- **What you know** — what the console can prove about what did or did not
  reach the network.
- **What stays uncertain** — what this error cannot tell you (and usually: 
  whether a write did or did not land).
- **The safe next step** — a read-only check performed against the chain
  itself, before any repeat of a write.

Two things this document deliberately will not do:

- **It never advises "just retry."** A retry is safe only for reads. A refused
  or failed *write* must be checked against the ledger first, because the
  failure may have happened after the transaction was included.
- **It never treats a failed read as information about the chain.** A failed
  `policy()` read does not mean "no policy is installed"; a failed read is an
  absence of data, not a state. The console's failed-read copy says exactly
  that ("the guard's state could not be read — no values are shown"), and this
  runbook agrees with it.

## Where these labels come from

Every label below is one the console or its libraries actually produce:
`TIMEOUT`, `429`, `NOT_FOUND` and `TRY_AGAIN_LATER` are the retryable
signals in `lib/guard/retry.ts`;
"Read timed out after Nms" is `DashboardReadError` in `lib/guard/timeout.ts`;
"the guard's state could not be read" is the snapshot-failure block in
`components/StatusPanel.tsx`; `NOT confirmed` is the post-freeze verdict in
`components/PanicPanel.tsx`; "Wallet connection" is the connect-failure panel
in `components/WalletBar.tsx`; `refused` / `failed` are the two non-success
write outcomes in `lib/guard/submit.ts`; `blocked` / `diagnostic` are the
telemetry severity tiers. If the console's wording drifts from this table, fix
one of them — they are meant to agree.

---

## 1. Wallet connection failure (`Wallet connection — <detail>`)

- **What you know:** no signature happened, and nothing signed by this session
  was broadcast. Read panels may be empty because identity reads need a wallet,
  *not* because the guard on chain is missing or unprotected.
- **What stays uncertain:** everything on chain. Nothing here says anything
  about the guard's state.
- **Safe next step:** read the contract without a wallet:
  `npm run inspect -- --guard C…` (read-only, self-contained). Reconnect the
  wallet afterwards; if Freighter keeps failing, check that its network setting
  matches the console's (Testnet) and retry the *connection*, which is the only
  thing that failed.

## 2. Read timeout (`Read timed out after Nms`, `TIMEOUT`)

- **What you know:** this *read* did not return in time. Reads cannot change
  state, so there is nothing to undo.
- **What stays uncertain:** the chain state itself — the read neither proved
  nor disproved anything. Do **not** interpret a timed-out `policy()` read as
  "policy removed" or a timed-out `status()` as "frozen" or "clear".
- **Safe next step:** refresh (the panel's own retry, same as the read path's
  `withBackoff`) or read from the CLI (`stellar contract invoke … -- status`).
  Reads are the one thing that may be retried freely.

## 3. Rate limited (`429`, `TRY_AGAIN_LATER`)

- **What you know:** the endpoint asked the console to slow down. The read path
  already waits out the provider's `Retry-After` hint (capped) before the next
  attempt, so no manual action is needed for reads.
- **What stays uncertain:** whether the request that was throttled was a poll
  only. Throttling says nothing about transaction status.
- **Safe next step:** for reads, wait for the backoff to finish — do not hammer
  refresh, which only extends the throttle. If a *write* was in flight when the
  throttle appeared, still verify it by hash (section 6) before another signed
  attempt.

## 4. Simulation refusal (`refused` + stage `enforcement`, pre-flight)

- **What you know:** the transaction never left the browser. Refusal happens at
  simulation, before sign or broadcast, with zero fees spent.
- **What stays uncertain:** only whether your *intent* matched the policy — the
  refusal itself is the answer about this attempt.
- **Safe next step:** do **not** retry the same transaction blind. Read the
  live policy (`npm run inspect …`, or the console's policy panel after
  refresh) and reconcile why the policy refused the operation. Adjust the draft
  or the policy deliberately, through the policy runbook, then simulate again.
  A blind retry that "fixes itself" means either you did not understand the
  refusal or something changed underneath — both demand a read first.

## 5. Submission failure (`failed` write, transaction included and rejected)

- **What you know:** the transaction *was* included in a ledger and the
  contract rejected it. `lib/guard/submit.ts` reports the host's own reason
  (`describeRejectedResult`) instead of a bare "trapped". Fee was spent.
- **What stays uncertain:** why the host rejected it — the rejection is
  contract-level, and this console's simulation cannot fully predict the host.
- **Safe next step:** read the result via the stellar.expert or
  Laboratory explorer by the transaction hash shown in the panel and the
  transaction history table, then take the on-chain state that the rejection
  happened as read-only evidence. Re-read `status()` before composing another
  attempt.

## 6. Post-submit uncertainty ("NOT confirmed", throttled confirmations)

This is the dangerous one, because the write may have landed anyway.

- **What you know:** the console's *verification read* did not observe the
  expected effect yet. That is all it knows.
- **What stays uncertain:** whether the write landed and the verification read
  is early, throttled or raced, or whether the write genuinely failed. The
  console says "NOT confirmed" rather than "failed" for exactly that reason.
- **Safe next step (read-only, by hash):** wait one ledger close (~5s), then:
  1. Look up **the transaction hash** shown by the panel (or transaction
     history export) in an explorer — inclusion is the fact the console cannot
     prove on its own.
  2. Re-read the contract directly: `npm run inspect -- --guard C… --json`
     or `stellar contract invoke … -- status`.
  3. Only decide from the contract's own answer: `admin_frozen = true` is the
     freeze; everything else is "not yet observable".
- **Never** re-broadcast the same write because the badge said "NOT
  confirmed". Freeze is idempotent, but a submit that already included costs a
  second fee and muddies the evidence trail. Retry-after-write belongs to
  section 5 rejection semantics, not here.

## 7. Bytecode inspection failure (`UNRECOGNIZED BYTECODE`, `malformed` verdict)

- **What you know:** the fetched artifact bytes failed the bounded parser —
  too short, wrong magic, a section running past the buffer, or larger than the
  documented inspection ceiling. See
  [`lib/guard/wasmInspector.ts`](../../lib/guard/wasmInspector.ts) for the
  exact reasons and [`MAX_WASM_INSPECTION_BYTES`](../../lib/guard/wasmInspector.ts)
  for the ceiling.
- **What stays uncertain:** what the artifact actually is. A parse failure is
  **not** evidence of tampering and **not** evidence of a match — it is an
  unreadable input, and the console refuses to produce a hash verdict from
  bytes it cannot read (no "verified" badge is possible from a parse failure).
- **Safe next step:** re-fetch once (a truncated transfer is the common cause);
  if it fails again with the same byte length, compare the reported size with
  the pinned `PHASE1_ARTIFACT.wasmBytes`, record the diagnostic from the
  drawer, and treat the instance as unverified until the artifact re-reads
  cleanly. Never sign anything whose artifact could not be verified.

## 8. Snapshot / aggregate failure (`the guard's state could not be read`)

- **What you know:** one or more of the panel's reads (`status()`, `policy()`,
  window, wasm identity) failed this refresh. Per-field read outcomes are kept
  explicitly in the snapshot and in the printed compliance report, so a failure
  is labelled per field rather than flattened.
- **What stays uncertain:** every field whose read failed. The console shows
  no values where it has none, and the print report marks those fields
  `unavailable` — most importantly, a failed `policy()` read is rendered as
  unavailable, never as "No policy installed", because "no policy" is a state
  only a successful read can establish.
- **Safe next step:** use the per-field retry buttons, then the CLI read in
  section 2 if the panel keeps failing. Do not act (freeze, unfreeze, edit the
  policy) on a panel whose reads are incomplete — complete the read first.

---

## A note on what is *not* an error

- `blocked` rows in the telemetry feed are the guard working, not the console
  failing: the account refused something the policy forbids, before broadcast,
  at zero fee. `diagnostic` rows are self-inflicted probes run by your own tab;
  they exist only on your machine and never reach the ledger.
- A `heartbeat_expired` state is a dead-man-switch trip, not a failure of the
  dashboard; see the [freeze runbook](./emergency-freeze.md) for the two
  distinct freeze mechanisms.

## Out of scope here

Contract-level enforcement behaviour and SDK/agent-runtime errors are tracked
in their own repositories (see [Enforcement scope](../enforcement-scope.md) for
the boundary). This runbook only covers what this console can observe and do.
