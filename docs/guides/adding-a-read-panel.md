# Adding a Dashboard Read Panel

This is the contract a new **read panel** — any card or widget that shows a value it got from the
chain (Soroban RPC or Horizon) — must meet before it is merged. It exists because a new panel can
otherwise invent a default for a failed read, or keep painting a value that belongs to a guard the
operator has already left, without either mistake being visible in review.

The rules below are not new. Each one is already how `StatusPanel`, `SetupWizard`,
`ProtocolFunctionSelector`, `MultisigTracker` and `GuardProvider` behave; this page names them in
one place and points at the code that is the reference implementation, so a new panel copies an
existing pattern instead of reinventing it.

The boundaries are unchanged: the dashboard is **client-only and non-custodial**. A read panel adds
no API route, server action or middleware (`npm run check:no-server` fails the build if it does),
signs nothing, and persists no key. Live chain reads are authoritative; anything the panel shows
that did not come from a successful read is either a placeholder that says so, or an error that
names the read.

For styling, tokens and the general widget walkthrough see
[Contributing Widgets and Panels](./contributing-widgets.md). For why fabricated state is the most
dangerous thing this interface can display, see [No Mock State](../concepts/no-mock-state.md) and
[`SPEC.md` §4 Read path](../../SPEC.md#4-read-path).

---

## The five obligations

| #   | Obligation                                   | One-line rule                                                                             | Reference code                                                                        |
| --- | -------------------------------------------- | ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| 1   | [Typed outcomes](#1-typed-outcomes)          | A read returns `ReadResult<T>`; pending, failed and resolved are three different renders. | `lib/guard/chain.ts` (`ReadResult`), `lib/guard/statusReadState.ts` (`readPhase`)     |
| 2   | [Freshness](#2-freshness)                    | A resolved value carries when it was read, and the panel shows it.                        | `ReadResult.readAt`, `GuardSnapshot.fetchedAt`, `StatusPanel`'s `<TimeAgo>`           |
| 3   | [Cancellation](#3-cancellation-and-identity) | A response for a guard, network or server the operator has left is dropped, not painted.  | `GuardProvider`'s `readEpochRef`, `SetupWizard`'s guard-keyed state, `guardScoped.ts` |
| 4   | [Accessible errors](#4-accessible-errors)    | A failure is an `ErrorBlock` that names the read, with a retry and a live-region notice.  | `components/bits.tsx` (`Read`, `ReadWithRetry`, `ErrorBlock`)                         |
| 5   | [Tests](#5-tests)                            | Every branch above has a test, including the race and the failure that must not be `0`.   | `tests/unit/skeletonReads.test.ts`, `identityRace.test.ts`, `retryableRead.test.ts`   |

---

## 1. Typed outcomes

Every read function returns the discriminated union from `lib/guard/chain.ts`:

```ts
export type ReadResult<T> =
  { ok: true; value: T; readAt?: string } | { ok: false; error: string; diagnostic?: string };
```

There is deliberately **no third case**, and a panel adds three states on top of it — never more:

| Phase      | Panel input            | What renders                                                |
| ---------- | ---------------------- | ----------------------------------------------------------- |
| `pending`  | `null` / `undefined`   | a skeleton that reserves the resolved layout (`aria-busy`)  |
| `failed`   | `{ ok: false, error }` | an `ErrorBlock` naming the read and carrying its error text |
| `resolved` | `{ ok: true, value }`  | the value — which may legitimately be empty, zero or `null` |

`readPhase()` in `lib/guard/statusReadState.ts` is the single decision for that mapping; use it (or
`<Read>`, which is built on the same rule) instead of re-deriving it in a component.

Rules that follow from the type:

- **Read functions do not throw for an expected failure.** Catch the transport or simulation error
  and return `{ ok: false, error }`, as `readContract` does through `readFailure()` in
  `lib/guard/chain.ts`. The error text there is passed through `redactDiagnosticText`, because a
  panel will display it.
- **Never default a failure.** `value ?? 0`, `result.ok ? result.value : 0`, `|| defaultStatus` and
  `catch { setX("0") }` all turn an outage into a believable empty account. If a panel cannot show a
  value it shows a placeholder or an error.
- **Empty is a resolved value, not a failure.** `readPolicy()` returns `ReadResult<PolicyConfig | null>`:
  `{ ok: true, value: null }` means "no policy is installed" (default deny), which is a fact about the
  chain and renders as such. A failed `policy()` read is a different render with different guidance.
- **Partial data is said out loud.** When a source answers but omits fields, return the part you can
  trust and the reasons it is incomplete — `readAccountSigners()` in `lib/guard/multisigRead.ts`
  returns `incompleteReasons` instead of silently dropping a malformed signer or inventing a
  threshold.
- **Amounts are `bigint` stroops** end to end (see
  [No Floating-Point Amounts](./contributing-widgets.md#2-no-floating-point-amounts)).

## 2. Freshness

A value on screen is a claim about the chain _at some ledger and time_. The panel has to let the
operator see which.

- **Stamp the read.** `ReadResult` success carries an optional `readAt`; the snapshot carries
  `fetchedAt`; `readAccountSigners` carries `observedAt`. A new read records its own completion time
  with an injectable clock (`now: () => Date`) so tests can pin it.
- **Show the stamp.** `StatusPanel` renders `read <TimeAgo iso={snapshot.fetchedAt} />` next to its
  heading, and labels a failed refresh as `error state` / `stale since …` rather than leaving the old
  numbers looking live.
- **A failed refresh does not keep old numbers as if they were current.** `GuardProvider.refresh()`
  sets the snapshot to `null` and records `snapshotError` on a transport failure. If your panel has a
  good reason to keep a previous value visible, it must be visibly marked stale with its original
  timestamp — never silently carried forward.
- **An attempt is not a success.** Telemetry keeps `lastAttemptAt` and `lastSuccessAt` as separate
  fields (`lib/guard/feedHealth.ts`, issue #311), so a loop that keeps failing cannot look recently
  healthy. A polled panel follows the same split.
- **Reuse the shared reads.** If `readGuardSnapshot` already provides the field, consume it through
  `useGuard()` instead of issuing a second read on a second schedule; two clocks for one fact is how a
  panel ends up disagreeing with the panel beside it. Polling cadences live in `lib/guard/polling.ts`.
- **The chain is the source of truth, not storage.** Do not cache chain state in `localStorage` and
  render it as current. A new persisted key is a state-model change and updates
  [`SPEC.md` §8](../../SPEC.md#8-state-model--derived-vs-stored) in the same PR.

## 3. Cancellation and identity

The active guard, the network and the RPC server are shared context. Any of them can change while a
read is in flight — the operator switches guard, another tab does, a deep link does. A response that
arrives afterwards belongs to a world the operator has left, and **painting it is a bug even if the
value is correct for the guard it was read from.** Pick the lightest tool that covers your panel:

| Situation                                                    | Pattern                                                                             | Reference                                                         |
| ------------------------------------------------------------ | ----------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| A read started by an effect                                  | a `cancelled` flag set in the effect cleanup; check it before every `setState`      | `ProtocolFunctionSelector.tsx` spec load, `SetupWizard.tsx`       |
| Local state that must only be shown for the guard it was for | store `{ guard, value }`, derive `state.guard === guard ? state.value : null`       | `SetupWizard.tsx` (`verification`, `initializedState`)            |
| A read that outlives an effect (manual refresh, retry)       | capture a monotonic epoch before the call, compare after; bump it on context change | `GuardProvider.tsx` (`readEpochRef` in `refresh` and `retryRead`) |
| In-memory work bound to a guard and network                  | `bindToScope` / `valueInScope` / `runScopedWrite`                                   | `lib/guard/guardScoped.ts`                                        |
| A read with no natural end                                   | `withTimeout()` so it fails with a named `DashboardReadError` instead of hanging    | `lib/guard/timeout.ts`                                            |

The existing-code example the other panels copy is `GuardProvider.refresh()`:

```tsx
const refresh = useCallback(async () => {
  if (!guard) return;
  // Capture the epoch this read belongs to. If the operator switches guard
  // while it is in flight, `readEpochRef` moves on and the result below is
  // discarded — guard A's status must never paint over guard B's view.
  const epoch = readEpochRef.current;
  setRefreshing(true);
  try {
    const next = demo
      ? demoSnapshot()
      : await readGuardSnapshot(server, guard, readSourceFor(wallet));
    if (epoch !== readEpochRef.current) return;
    setSnapshot(next);
    setSnapshotError(null);
    setLastRefresh(Date.now());
  } catch (error) {
    if (epoch !== readEpochRef.current) return;
    // A transport failure is not the guard's state: report it as a failure and
    // drop the previous snapshot rather than leaving stale numbers on screen.
    setSnapshot(null);
    setSnapshotError(error instanceof Error ? error.message : String(error));
  } finally {
    if (epoch === readEpochRef.current) setRefreshing(false);
  }
}, [guard, server, wallet, demo]);
```

And the smaller, effect-scoped version a panel-local read uses (`SetupWizard.tsx`):

```tsx
// Held in component state (keyed by guard), never persisted.
const [verification, setVerification] = useState<{
  guard: string;
  value: ReadResult<{ hasPolicy: boolean }> | null;
}>({ guard, value: null });
const verified = verification.guard === guard ? verification.value : null;

useEffect(() => {
  let cancelled = false;
  void fetchInitialized(guard).then((value) => {
    if (!cancelled) setInitializedState({ guard, value });
  });
  return () => {
    cancelled = true;
  };
}, [guard, fetchInitialized]);

// A snapshot for a different guard is treated as "not read yet", not as data.
const activeSnapshot = snapshot?.guard === guard ? snapshot : null;
```

Two consequences worth stating:

- **A stale response is not an error.** It is simply not available; the panel shows the pending state
  for the new guard. Do not surface "read discarded" to the operator.
- **A stale response is not announced either.** `retryRead` returns before `announce()` when the epoch
  moved — "policy read recovered" about a guard nobody is looking at is a false statement about the
  current view.

## 4. Accessible errors

Use the shared components in `components/bits.tsx` rather than hand-rolling a failure state:

- **`<Read result label render pendingLines>`** — pending renders `<span aria-busy="true">` with
  `aria-hidden` skeleton bars sized in `em`, so nothing below the slot moves when the value lands;
  failure renders `<ErrorBlock title="<label>: read failed" detail={error} />`; success calls
  `render(value)`.
- **`<ReadWithRetry>`** (alias `RetryableRead`) — the failed branch is a `role="alert"` container with
  the read's label, its error text, and a `Retry` button whose `aria-label` is
  `Retry <label> fetch`. While the retry is in flight the button is replaced by a `role="status"`
  `Retrying…` line, and a failing retry brings the button back — never a dead end. Retry exactly
  the one read that failed (`retryRead(field)`), not the whole panel.
- **`<ErrorBlock>`** — names _which_ read failed and _why_, and attaches `RecoveryGuidanceBlock`
  guidance classified from the message (`context="read"`: reads are safe to repeat).

Rules:

- **The label is the read, not the widget.** `status()`, `policy()`, `window` — the operator copies it
  into a report, and the retry's accessible name is built from it.
- **Errors are text, not colour.** A red border alone is invisible to some operators; the `t` title and
  `mono` detail carry the meaning (see
  [Color-Independent Communication](./contributing-widgets.md#4-color-independent-communication)).
- **Announce transitions only.** A poll that re-reads the same value says nothing. A flag flipping is
  news, and goes through `announce()` (`lib/guard/statusTransitions.ts`). A failed read is reported as
  `null`, never as a change in either direction.
- **No secrets in error text.** Errors pass through `redactDiagnosticText`; copyable diagnostics are
  built by `buildReadDiagnostic` (`lib/rpc/timeouts.ts`) and carry only the operation, endpoint
  origin, network and time.

## 5. Tests

A read panel PR includes focused unit tests (`tests/unit/*.test.ts`, Node's test runner, the jsdom
harness in `tests/unit/domHarness.ts`) for at least:

| Case                          | What the test asserts                                                                                   | Model to copy                                                       |
| ----------------------------- | ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| Pending                       | the slot is `aria-busy` and shows a skeleton — no digit, no `0`                                         | `tests/unit/skeletonReads.test.ts`                                  |
| Failed                        | the error names the read and carries its message; the rendered text is not `0`/empty-looking            | `tests/unit/skeletonReads.test.ts`                                  |
| Resolved, including empty     | a genuine `0n` / `null` / `[]` renders as that fact, distinct from the failure text                     | `tests/unit/noPolicyStatus.test.ts`                                 |
| Partial data                  | incomplete source data is reported, not dropped or defaulted                                            | `tests/unit/multisig.test.ts`                                       |
| Stale response after a switch | a response held open for guard A and released after switching to B is never painted (no sleeps to race) | `tests/unit/identityRace.test.ts` + `tests/helpers/identityRace.ts` |
| Retry                         | retry re-runs only that read, shows `Retrying…`, and recovers or fails again with the button back       | `tests/unit/retryableRead.test.ts`, `panelRetry.test.ts`            |
| Timeout                       | a hung read fails with a named error rather than staying pending forever                                | `tests/unit/timeout.test.ts`                                        |

Pure decisions (phase, text, freshness labels) belong in `lib/guard/*.ts` so they are testable
without a DOM; the component stays a thin renderer over them. If the panel adds a browser flow,
extend the Playwright suites in `tests/e2e` (they run against a mocked chain).

`tests/unit/readPanelContract.test.ts` pins this page to the code: it fails when an obligation
section is removed, or when a file or exported symbol this page cites as the reference no longer
exists, and it re-asserts the behaviours above against the shared primitives.

---

## Anti-patterns

| Don't                                                             | Do                                                                                                                     |
| ----------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `catch { setBalance("0") }`                                       | keep a `ReadResult<bigint>` and render `balanceText()`'s failure branch                                                |
| `snapshot?.policy.ok ? … : defaultPolicy`                         | `<Read result={snapshot?.policy} … />`                                                                                 |
| `setState(await read())` with no cancellation                     | a `cancelled` flag, an epoch check, or guard-keyed state                                                               |
| keep showing the last good value after a failed refresh, unmarked | drop it, or mark it `stale since <time>` with its original stamp                                                       |
| one `Refresh all` button for one failed read                      | `ReadWithRetry` + `retryRead(field)`                                                                                   |
| fetching `status()` again inside a widget                         | read it from `useGuard().snapshot`                                                                                     |
| an API route or server action to "proxy" a read                   | call Soroban RPC / Horizon from the browser; the zero-server rule is [ADR 001](../adr/001-zero-server-architecture.md) |

## Checklist for the PR description

- [ ] Every read returns `ReadResult<T>` (or the same shape), and no branch renders a default for a failure.
- [ ] Pending, failed, resolved — and resolved-but-empty — each render distinctly.
- [ ] The resolved value shows when it was read; a failed refresh is labelled, not silently stale.
- [ ] A response for a guard/network/server the operator has left is dropped and not announced.
- [ ] Failures use `Read` / `ReadWithRetry` / `ErrorBlock`, name the read, and retry only that read.
- [ ] Tests cover the cases in [§5](#5-tests), including the switch race and "failure is not `0`".
- [ ] No server code, no signing outside the wallet, no new persisted key without a `SPEC.md` §8 update.
