# Telemetry Feed Component

`TelemetryFeed` tails contract events from Soroban RPC:

- Queries `getEvents` with `event_auth_checked` topic filter.
- Decodes contract addresses, decision results (`allowed` or `blocked`), reason codes, and timestamps.
- Color-coded badges highlight blocked transactions and policy violations in real-time.

## Row severity tiers

Rows are tiered so a block is findable by looking, not by reading every row. The tier
rides on the `<tr>` as a class and a `data-severity` attribute; `data-stream` carries the
SDK's stream discriminator (`ledger` or `diagnostic`).

| Tier | Row | Marker | Wording already in the row |
| --- | --- | --- | --- |
| `blocked` | The guard refused the call | danger left rule + tinted surface | the reason badge, e.g. `per_tx_cap_exceeded` |
| `allowed` | The guard authorized the call | none — deliberately neutral | the `allowed` badge |
| `diagnostic` | A refused-simulation row with no decision of its own | warn left rule | the `diagnostic` source chip |
| `lifecycle` | Heartbeat / admin event, no decision made | none — deliberately neutral | the event name, and `—` for the decision |

Severity is derived from the fields the decoder already produced — `decision.result` and
`event.source` (`stellar-agent-guard-sdk`, `dist/telemetry.d.ts`) — so no topic or reason
string is parsed per render, and every tier is stated in words as well as in colour.

There is **no sound**. An operator console runs unattended and muted, and a noise that can
only be silenced in the tab that made it is not an alert.

## Pausing and resuming

`Pause stream` freezes the table; it does not freeze the feed.

- What pause protects: the rows on screen, the filters applied to them, and the poll
  cursor. The poll loop keeps running behind the frozen table, so the panel still names
  the last successful poll while paused — "frozen" and "dead" would otherwise look
  identical.
- What arrives during a pause is queued, not shown and not discarded. The notice counts
  the queue, the button reads `Resume (n)`, and resume prepends the queue in arrival
  order. A queued event whose age takes it past the buffer limit is reported as dropped
  in the same notice rather than vanishing.
- Re-clearing with `Clear buffer` empties the list and likewise keeps the cursor, so a
  cleared feed does not re-read history.

Proof: `tests/unit/telemetryControls.test.ts` for the buffer transitions, and
`tests/e2e/telemetryPause.spec.ts` for the operator-visible contract — including that a
pause does not re-fetch the page it already consumed, which the de-duplicated table hides.

## A link to one event

Every row the console can address on chain carries `link to this row`. It focuses that
event in place — the address bar gains an `event` parameter and the feed, the wallet
session and any form draft survive the click — and the same URL is shareable.

- The link carries three parameters and nothing else: `network`, `guard`, and an `event`
  locator of `<ledger>:<transaction hash>:<topic>`. There is no event payload in the URL,
  so a shared link cannot carry a secret key, a signed envelope or transaction contents.
  Codec and validation: `lib/guard/eventLink.ts`.
- Opening a link re-reads the event from Soroban RPC in the browser, through a throwaway
  feed with a bounded number of pages. The live tail's cursor is not touched, and no
  server is involved: the console stays client-only (`npm run check:no-server`).
- An event that cannot be produced is reported by *why*, in four distinct wordings,
  rather than as a blank panel: never committed on chain (a diagnostic refusal has no
  ledger to re-read), pruned past the RPC's retention boundary, not found in the guard's
  stream, or the read failed.
- Rows the console cannot address render no link rather than one that would fail.

Proof: `tests/unit/eventLink.test.ts` for the codec, the parameter whitelist and each
unavailable reason; `tests/unit/eventDetailPanel.test.ts` for focus-without-navigation
and the panel's states.

