# Historical Event Availability

The telemetry feed is a live tail, not an archive. Everything it shows was read from one
Soroban RPC endpoint, on a timer, into a fixed-size list in this browser tab. Each of those
three facts puts a ceiling on how much history the console can display, and none of them is
visible from the table itself — a missing event looks exactly like an event that never
happened.

This page states the ceilings, says which ones the dashboard can detect and announce, and
shows how to check the same question against the RPC directly.

## The two sources, and the one that is not on chain

A guard event reaches the feed by exactly one of two routes:

| Route                   | What it holds                                                                            | Where it comes from                                                   |
| ----------------------- | ---------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| Committed ledger events | Allowed decisions, heartbeats, and admin lifecycle events (policy set, frozen, unpaused) | `getEvents` against the configured RPC endpoint, tailed with a cursor |
| Simulation diagnostics  | Refused decisions that **this console** produced                                         | The enforced simulation that ran before broadcast, decoded in the tab |

A refused call returns an error, which rolls its events back, so it has no transaction and no
committed ledger event. That means refusals are not missing from the RPC's history — they were
never written to it. Rows marked `diagnostic` exist only because a simulation ran in this tab
a few seconds ago, and they carry `source: "diagnostic"` so they are never mistaken for
settled chain history. See [Telling a refused transaction from a settled one](../export-schema.md#telling-a-refused-transaction-from-a-settled-one).

## Four ceilings

| Ceiling               | Value                                                                                     | Where it is set                                     | What you see when you hit it                                                          |
| --------------------- | ----------------------------------------------------------------------------------------- | --------------------------------------------------- | ------------------------------------------------------------------------------------- |
| RPC retention window  | Decided by the endpoint, reported per response as `oldestLedger`                          | The RPC at `NETWORK.rpcUrl` (`NEXT_PUBLIC_RPC_URL`) | A `history_pruned` gap notice naming the ledger range that can no longer be fetched   |
| Events per poll       | 50 (`pollOnce(limit = 50)`); 200 for a time-range query (`pollRange(range, limit = 200)`) | `lib/guard/telemetry.ts`                            | More events waiting than one round delivers; the next round continues from the cursor |
| Rows held in the tab  | 250 (`STREAM_BUFFER_LIMIT`)                                                               | `lib/guard/telemetry.ts`                            | The oldest rows leave the table. The feed says "live view, not archive"               |
| Guards tailed at once | 5 (`FEED_GUARD_CAP`)                                                                      | `lib/guard/feedSubscriptions.ts`                    | A notice naming how many guards are **not** being tailed, with their labels           |

There is a fifth, quieter one: the tab itself. Nothing here runs a server-side collector. When
the tab is closed, refreshed, or the operator session auto-locks, the event list is gone; the
only feed state written to storage is the filter, the density choice, and bookmarks.

## How the live tail advances

- **Cadence.** The feed polls every `POLLING.feedMs` = 5 000 ms, jittered once when the timer
  is created into `[4000, 5000)` ms so two pollers sharing an endpoint do not fire on the same
  tick (`jitteredInterval`, `lib/guard/polling.ts`). Polling faster cannot reveal an event
  sooner: Soroban RPC has no push stream, and the floor on latency is the ledger close
  interval, about 5 seconds (`AVERAGE_LEDGER_CLOSE_SECS`).
- **One page per round.** Each round asks for up to 50 events and returns a `cursor` plus
  `latestLedger` and `oldestLedger`. The cursor is carried forward, not re-derived from a
  ledger number, because `getEvents` pagination is only stable while a cursor is held;
  re-scanning from a ledger can miss events that fell outside the window between polls.
- **What a round proves.** A page that reaches the head of the chain confirms everything up to
  `latestLedger`. A full page confirms only through its own last event, because more is still
  to come. That boundary (`expectedFrom`) is what the retention check below compares against.
- **Manual refresh.** _Refresh now_ starts a round immediately and resumes the same feed, so it
  keeps the cursor. It never rebuilds the position, which would either re-read a stretch of
  chain or, in the bug this fixed, silently resume nothing.
- **Guard switches.** Changing the guard on screen builds a new feed with a null cursor; the old
  one is abandoned and never resumed, because a cursor from guard A's stream means nothing on
  guard B. A genuinely fresh feed is primed to `latestKnown − 60` ledgers
  (`FEED_SWITCH_HISTORY_LEDGERS`, roughly the last five minutes) so you arrive with context
  instead of a blank page — and instead of a replay of a year of history.

## Retention is the endpoint's decision

`oldestLedger` in each response is the earliest ledger that endpoint will still serve. It is a
property of the RPC's configuration, not of this dashboard, and it is not something a client
can negotiate. Three consequences worth stating plainly:

1. **Stopping is how history is lost.** A feed that is stopped, a tab that is closed, or a guard
   beyond the tailing cap all leave ledgers unread. Once the retention window slides past them,
   nothing in this console can fetch them back.
2. **The endpoint is configurable, so the window is too.** A build pointed at a local standalone
   network by `scripts/start-local-sandbox.sh` has different retention than public testnet. The
   notice says which ledgers are gone; only the operator's RPC configuration says why.
3. **A too-old query fails, and says so.** A time-range start ledger older than the window is
   rejected by the RPC. The feed renders that as a poll error rather than as an empty result —
   an error you can read is not the same as a table with no rows.

## What a time-range query actually asks for

The range picker (Last 1 Hour / Last 24 Hours / Last 7 Days / Custom) does not page through a
week of events. `pollRange` does this:

1. Reads the current ledger and close time (`getLatestLedger`) as an anchor.
2. **Estimates** the start ledger from the wall-clock bound: `ledger ≈ anchor.ledger + (t − anchor.closeTime) / 5`. Ledger numbers are not stored against timestamps anywhere the client can read, so the boundary is arithmetic, not a lookup.
3. Issues **one** `getEvents` for up to 200 events at or after that start ledger.
4. Applies the range's end bound locally, by each event's ledger close time.

So a range query returns at most 200 events, taken from the start of the window. A busy 24
hours is truncated, and it is truncated at the oldest end: you see the beginning of the range
and not the recent part of it. An empty result from a range whose start was estimated from a
stale anchor is likewise weak evidence. Two checks make it readable:

- The row count. If it equals the page size, treat the rest of the window as unproven.
- The last row's ledger. A window that ends near "now" and shows a first round far older than
  that means the page filled before the query reached the head.

Widening or narrowing the range and re-querying is the fix; neither is an archive.

## Gap indicators, and what they can prove

The feed compares what it still owed against what the RPC says it still holds. Two
discontinuities are reported, and only those two:

| Reason             | Detected when                                               | What the notice says                                                                                                                                                                             |
| ------------------ | ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `history_pruned`   | The earliest ledger still owed is older than `oldestLedger` | "Events were missed and cannot be recovered from this RPC", with the exact ledger range and an approximate duration                                                                              |
| `cursor_regressed` | A response's cursor is earlier than the cursor already held | "The RPC returned an earlier position than this feed had already reached"; the affected range is unknown, and the feed keeps its last known-good position rather than adopting the regressed one |

A `history_pruned` notice is **lost** coverage: it stays for the life of the feed, oldest
first, up to `FEED_GAP_LIMIT` = 20 ranges, and clears only when the feed is restarted from a
new ledger. A cursor regression shows as **unsettled** — it is a finding about the last poll,
and one consistent round afterwards it is gone.

Deliberately, whether the page contained any events is not an input to gap detection. An empty
page is not a gap, and filling a hole with invented events would be worse than announcing it.

## What no indicator can see

The gap notices are proved by the retention window and the cursor. Everything else stays
invisible, and an operator has to reason about it from the setup rather than from the table:

- Refusals produced elsewhere. Only this console's own simulations yield diagnostics. A call
  the agent refused somewhere else has no trace on chain and none here.
- Events from before this tab started watching, other than the ~60-ledger priming window.
- Events from guards beyond the five tailed slots, and everything from a stopped watch.
- Events from a ledger the endpoint already dropped while the tab was closed.
- Anything the endpoint chose not to return without also moving `oldestLedger`. A short page
  with a consistent cursor is indistinguishable from a quiet chain, because a quiet chain looks
  exactly like it.

## Reading the health line

The health pill answers "is this feed talking to the RPC", never "is this feed busy":

| Phase     | Meaning                                                                                |
| --------- | -------------------------------------------------------------------------------------- |
| `off`     | Not watching. Nothing is being polled.                                                 |
| `pending` | Watching, and no round has completed successfully yet.                                 |
| `healthy` | A round completed within the overdue window — including one that returned zero events. |
| `overdue` | Watching, but no successful round has landed inside the window.                        |
| `failing` | The most recent round failed, and nothing has succeeded since.                         |

The overdue window is `OVERDUE_INTERVALS` = 3 poll intervals (about 15 seconds at the default
cadence). The distinction the panel exists to make: a healthy poll of a quiet guard
legitimately shows an empty table, and an unreachable endpoint shows an empty table too. Only
one of those is marked as a fault (`emptyIsFault`), so a quiet guard never reads as an outage
and an outage never reads as a quiet guard. Two timestamps appear because they answer different
questions — the last round that _returned_ and the last one that was _attempted_ — and the
second is never used to claim success.

Per-guard poll failures are listed separately, with the count of guards that did answer, so a
partial failure is never read as a dead endpoint and never read as a healthy one.

## Checking independently

The dashboard is a reader, so every claim above can be tested against the same endpoint
without it:

```bash
# Where the endpoint is, and how far back it will go.
curl -s -X POST "$RPC_URL" -H 'Content-Type: application/json' -d '{
  "jsonrpc": "2.0", "id": 1, "method": "getLatestLedger"
}'

# Events for one guard over a ledger window. `startLedger` must be inside retention.
curl -s -X POST "$RPC_URL" -H 'Content-Type: application/json' -d '{
  "jsonrpc": "2.0", "id": 2, "method": "getEvents",
  "params": { "startLedger": 1234567, "endLedger": 1234627,
              "filters": [{ "type": "contract", "contractIds": ["<guard-id>" ] }] }
}'
```

The response carries `latestLedger`, `oldestLedger` and a `cursor`. Page forward by passing that
`cursor` back until `responseEvents` stops filling out, and treat the retention boundary as the
real answer to "how far back can anyone get this". A Stellar CLI or Horizon archive query is a
stronger check for older history than any retry against this endpoint.

## Keeping evidence past the window

What the feed holds is capped; what you export is not.

- **Exports.** CSV and JSON carry the 11 display columns and no payload. NDJSON adds the
  decoded `data` payload; the audit log adds the raw XDR, so a reviewer can re-decode an event
  without trusting this console's decoder. Formats and fields:
  [Telemetry export schema](../export-schema.md).
- **Bookmarks.** Up to `BOOKMARK_CAP` = 50 per guard, per network, in this browser. They are the
  only rows that survive eviction from the 250-row buffer, which is why the investigation
  timeline reads from the bookmark records rather than the table. Details:
  [Investigation timeline (bookmarks)](../screens/telemetry-feed.md#investigation-timeline-bookmarks).
- **A long incident.** Export early and often rather than expecting the buffer to hold a whole
  incident; the buffer is sized for reading, not for evidence.

## Boundaries

The dashboard stays client-only and non-custodial while answering this question: no API route
fetches events on your behalf, no server-side collector keeps a copy, and nothing here stores
key material. Live chain reads are the authority, and where a live read cannot be made —
pruned, refused, unreachable, or simply never attempted — the feed says so instead of showing
you a clean table.
