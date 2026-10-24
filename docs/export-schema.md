# Telemetry export schema

The telemetry feed's **Export CSV** and **Export JSON** buttons write the feed's
visible events to a file. Both formats share one column schema; this document is
the contract for anything that parses those exports, and
`tests/unit/eventExport.test.ts` syncs the implementation against it.

## Compatibility rule: append-only

**Columns are append-only.** A schema change may _add_ a column at the end of
the list; it must never rename, reorder, or remove an existing column. The
`schema_version` cell lets a script assert which schema it is reading, and a
parser that ignores unknown trailing columns stays compatible with every future
version of this export.

## Columns (in order)

| #   | Column             | Meaning                                                                             | Empty when                                                          |
| --- | ------------------ | ----------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| 1   | `schema_version`   | Export schema version — currently `1`.                                              | Never.                                                              |
| 2   | `guard`            | The guard contract id the export was taken from; stamped on every row.              | Never.                                                              |
| 3   | `topic`            | The event's topic symbol, e.g. `event_auth_checked`.                                | Never.                                                              |
| 4   | `kind`             | Classified event kind (`auth_checked`, `heartbeat`, `frozen`, …).                   | Never.                                                              |
| 5   | `source`           | Where the event was observed: `ledger` (committed) or `diagnostic` (pre-broadcast). | Never.                                                              |
| 6   | `decision`         | `allowed` or `blocked` for auth-check events.                                       | Non-auth events carry no decision.                                  |
| 7   | `reason`           | The raw contract block reason symbol, e.g. `per_tx_cap_exceeded`.                   | Allowed decisions and non-auth events.                              |
| 8   | `reason_label`     | The SDK's human explanation of `reason` (via `explainReason`).                      | Same rows as `reason`.                                              |
| 9   | `ledger`           | Ledger sequence the event was committed in.                                         | Diagnostic events — a blocked transaction never reaches the ledger. |
| 10  | `ledger_closed_at` | ISO-8601 close time of that ledger.                                                 | Diagnostic events.                                                  |
| 11  | `transaction_hash` | Hash of the committed transaction.                                                  | Diagnostic events.                                                  |
| 12  | `observed_at`      | ISO-8601 time this console first saw the event, committed or diagnostic.            | An event the feed carried before this field existed.                |

### Practical ceiling

The feed keeps the **250 most recent events** (newest first), so an export
contains at most 250 data rows and always reflects what the operator can see.
Export earlier if you need more history; the feed is a console, not an archive.

## Timestamps are UTC, in every machine-readable file

Both time columns above — and every event time in the NDJSON audit log below —
are written by `canonicalUtc` in `lib/guard/time.ts` as **ISO-8601 UTC at second
precision with a `Z` suffix** (`2026-03-08T06:59:59Z`), which is byte-identical
to the UTC rendering the on-screen feed shows.

- An explicit offset is folded into the same instant, so `01:59:59-05:00` and
  `06:59:59Z` export as one value.
- A value that carries **no** zone or offset is read as UTC, never as the
  operator's local time. A zone-less wall time means a different instant in
  every zone — and around a daylight-saving transition it can mean an instant
  that never existed in that zone at all, which is how two incident reports
  come to disagree about the same event.
- Sub-second precision is dropped: it is not meaningful for a ledger close time,
  and rows keep the feed's own newest-first order, so ordering never depends on
  the fraction.
- A value that does not parse as an instant is exported **verbatim** rather than
  blanked. An export must not delete the only time a row carries; the anomaly
  stays visible and attributable to whatever produced it.

Localized rendering exists only on screen (`formatEventTimestamp`), never in a
file. The one exception in the machine-readable set is the audit log's header
`exportedAt`, which keeps its milliseconds: it stamps when this export ran, not
when something happened on chain.

## NDJSON audit log schema

**Export NDJSON** writes the same feed for `jq`, log shippers and SIEM
ingesters: one JSON object per line, the first line a header, the rest one line
per event in feed order. The schema id is `stellar-agent-guard/telemetry-audit@1`
(`AUDIT_LOG_SCHEMA` in `lib/guard/exportFormats.ts`), and the field names below
follow the **same append-only rule as the columns above**: a change may add a
field, never rename, reorder or remove one.

The header line (`record: "audit_header"`) carries `schema`, `exportedAt`,
`guard`, `network`, `scope` (`full`, or `filtered` when a filter narrowed the
export), the exact `filter` applied, `eventCount`, `bufferedCount` (what the
buffer held, so a filtered export can be checked for completeness),
`latestLedger` and `demo`.

Each event line (`record: "guard_event"`) carries:

| Field               | Meaning                                                                                              |
| ------------------- | ---------------------------------------------------------------------------------------------------- |
| `record`            | Which kind of line this is — `guard_event` for every event line.                                     |
| `kind`, `topic`     | Classified event kind and the event's topic symbol.                                                  |
| `verdict`, `reason` | `allowed` / `blocked`, and the raw contract block reason symbol.                                     |
| `source`            | `ledger` or `diagnostic`.                                                                            |
| `contractId`        | The emitting contract, when the stream identifies one.                                               |
| `ledger`            | Decimal string ledger sequence, or `null` for a diagnostic.                                          |
| `timestamp`         | `ledgerClosedAt` when present, otherwise `observedAt`. Canonical UTC.                                |
| `timestampSource`   | Which of the two it is: `ledger_close`, `observed`, or `null`.                                       |
| `ledgerClosedAt`    | Canonical UTC close time, or `null`.                                                                 |
| `observedAt`        | Canonical UTC time this console saw the event, or `null`.                                            |
| `transactionHash`   | Committed transaction hash, or `null`.                                                               |
| `data`              | The decoded event payload, big integers as decimal strings.                                          |
| `raw`               | The original XDR the console received (event id, topic and value base64, diagnostic XDR), or `null`. |

Integers that can exceed 2^53 — ledger sequences and every decoded `u64`/`i128`
— are written as decimal strings, never as JSON numbers, so an audit log cannot
silently round the figures it records. U+2028 and U+2029 are escaped inside
strings so that "one line is one record" holds for every consumer.

Filename: `guard-audit-log-[filtered-]<YYYY-MM-DDTHH-MM-SSZ>.ndjson` — the UTC
export instant, colons swapped for hyphens so the name is filesystem-safe.

## Feed NDJSON schema (`guard-telemetry.ndjson`)

**Export NDJSON** on the filter bar is a separate, deliberately plainer file from
the audit log above: `telemetryToNdjson` in `lib/guard/telemetryExport.ts` writes
**one object per event and no header line**, in feed order, so `jq -c` and line
oriented shippers can consume it without skipping a first record. It is filtered
by the feed's verdict/topic/contract controls — the same projection the table
renders, one line in, one line out.

Each line's keys, in order (`TELEMETRY_CSV_COLUMNS`, which is also the CSV
export in that module's header row):

| Key                  | Meaning                                                                        |
| -------------------- | ------------------------------------------------------------------------------ |
| `kind`, `topic`      | Classified event kind and the event's topic symbol.                            |
| `decision`, `reason` | `allowed` / `blocked` and the raw block reason symbol, or `""` for neither.    |
| `source`             | `ledger` or `diagnostic`.                                                      |
| `ledger`             | Decimal string ledger sequence, or `""` for a diagnostic.                      |
| `ledger_closed_at`   | Canonical UTC close time (see above), or `""`.                                 |
| `transaction_hash`   | Committed transaction hash, or `""`.                                           |
| `contract_id`        | The emitting guard contract, or `""`.                                          |
| `data`               | The decoded event payload as a nested object; big integers as decimal strings. |
| `observed_at`        | Canonical UTC time this console saw the event, or `""`.                        |

The append-only rule applies exactly as it does to the columns above: `observed_at`
was added as field 11, and nothing before it was renamed, reordered or removed.
Two differences from the audit log are intentional, and a parser must not assume
them: this file writes the **empty string** where the audit log writes `null`, and
it carries no header line and no `raw` XDR.

## Cell conventions

- **Every cell is a string.** Ledger sequences and the schema version are
  decimal strings (`"4820001"`), and timestamps are ISO-8601 UTC strings (see
  [Timestamps are UTC](#timestamps-are-utc-in-every-machine-readable-file)) —
  nothing is coerced to a number, so i128 amounts survive round-trips.
- **CSV** follows RFC 4180: cells containing commas, quotes or newlines are
  quoted, embedded quotes are doubled. The file is **BOM-prefixed** (U+FEFF /
  `EF BB BF`) so Excel opens it as UTF-8. The first row is the column list
  verbatim; data rows follow in feed order.
- **JSON** is one object: `schemaVersion`, then `columns` (the same list), then
  `guard`, then `rows` — each row an object keyed by column name, values
  stringified exactly like the CSV cells.
- **Filename**: `guard-events-<guard[:8]>-<YYYY-MM-DD>-<rowCount>.<ext>` — UTC
  ISO date, deterministic for a given day and row count, so two exports of the
  same feed on the same day differ only when the row count differs.
