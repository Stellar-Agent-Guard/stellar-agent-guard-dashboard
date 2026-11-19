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

## Row action menu

Every row ends in an **Actions** button, named for its row (for example "Actions for
Authorization decision, blocked, ledger 100"). It is a menu button: Enter, Space or
ArrowDown opens it (ArrowUp opens on the last item), ArrowUp/ArrowDown/Home/End move
between items, Escape closes it and returns focus to the button, and Tab closes it and
carries on to the next control, so the feed is never a keyboard trap. Items: **Copy
contract address**, **Copy transaction hash** (only when the row has one; a diagnostic row
was never broadcast) and **Show/Hide details**. A failed copy, for example in an insecure
context, is reported in a visible status line and announced, never swallowed.

## Date-range picker

The preset group is a radio group with one tab stop; arrow keys move the selection.
Choosing a preset applies it and announces it. **Custom Range** opens two date-time inputs
whose `max` is the current time, so future dates are disabled, and a hint tied to both
inputs says so. An invalid range (missing, inverted or in the future) is announced, linked
to the inputs with `aria-describedby`, and focus moves to the first input. Applying a valid
range announces it and keeps focus on **Apply range**. Escape closes the custom panel, goes
back to the previous preset and returns focus to the **Custom Range** radio.
