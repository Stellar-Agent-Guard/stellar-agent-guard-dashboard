# Telemetry Feed Component

`TelemetryFeed` tails contract events from Soroban RPC:

- Queries `getEvents` with `event_auth_checked` topic filter.
- Decodes contract addresses, decision results (`allowed` or `blocked`), reason codes, and timestamps.
- Color-coded badges highlight blocked transactions and policy violations in real-time.

## Visual Grouping

The feed supports optional visual grouping without concealing individual decisions or mutating export data:

- **Grouping Options**: Operators can group events by **Event Type** (`auth_checked`, `heartbeat`, `frozen`, `policy_set`), **Guard** (by contract attribution chip), or **Verdict** (`Allowed`, `Blocked`, `Lifecycle`).
- **Individual Record Preservation**: Every event row remains fully rendered, accessible, and interactive within its group header.
- **Export Semantics Preserved**: CSV, JSON, NDJSON, and Audit Log exports continue to include the complete flat, filtered list of events with exact schemas.
- **Accessible Group Counts**: Group count announcements are broadcast via screen reader live regions whenever grouping changes.

## Incident Alert Acknowledgement

- **Operator Acknowledgement**: Security-critical alerts (blocks, emergency freezes, policy revocations) support local operator acknowledgement per alert identity.
- **Evidence Retention**: Acknowledging an alert marks it reviewed in local storage without clearing or mutating underlying on-chain evidence in the feed.
- **Accessible State**: Includes accessible action controls to acknowledge or reopen alerts for operator review.

## Row Severity Tiers

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
