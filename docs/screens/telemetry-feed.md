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

## The chart's non-visual equivalent

The outcomes-and-spend chart is an SVG, so the same data is also available as text:

- The SVG's accessible name is a one-sentence summary of the window — interval count and
  size, allowed and blocked decisions, and exact settled stroops. Arrow keys step through
  intervals and announce the same readout the mouse tooltip shows.
- **Show data table** opens a real `<table>` listing every interval, including empty ones.
  The toggle is a labelled button with `aria-expanded`, and the table region is focusable,
  so the complete data is reachable by keyboard alone.
- A failed read of the guard's on-chain rolling window is reported explicitly: spend is
  shown as **unavailable**, never as zero, and the summary says why. Decision counts from
  the feed are unaffected and stay visible.
- An empty window says so in words, and the table still lists every interval as zero, so
  "no decisions yet" cannot be mistaken for a chart that failed to load.
