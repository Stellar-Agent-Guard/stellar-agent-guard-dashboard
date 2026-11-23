# Telemetry export schema

The telemetry feed's four **Export** buttons write the events the operator can
see to a file. They are not one format with two spellings: three writers back
four downloads, and their field lists differ. This document is the contract for
anything that parses those files.

| Button               | Writer                      | Shape                                                   | Fields                                      | Carries `data` |
| -------------------- | --------------------------- | ------------------------------------------------------- | ------------------------------------------- | -------------- |
| **Export CSV**       | `lib/guard/eventExport`     | BOM-prefixed RFC 4180, header row first                 | `EVENT_EXPORT_COLUMNS` (11)                 | No             |
| **Export JSON**      | `lib/guard/eventExport`     | one object: `schemaVersion`, `columns`, `guard`, `rows` | the same 11, as row keys                    | No             |
| **Export NDJSON**    | `lib/guard/telemetryExport` | one object per line, no header line                     | `TELEMETRY_CSV_COLUMNS` (10)                | **Yes**        |
| **Export audit log** | `lib/guard/exportFormats`   | NDJSON: a header line, then one record per event        | `AUDIT_HEADER_FIELDS`, `AUDIT_EVENT_FIELDS` | **Yes**        |

Each list is a single source of truth rather than a copy: the export preview
(`lib/guard/exportScope.ts`) imports the arrays above, so the field list shown
beside the buttons cannot drift from what the writers emit.
`tests/unit/eventExport.test.ts` syncs this document against the CSV/JSON
columns, and `tests/unit/exportDiagnosticOrigin.test.ts` reads each format's
field list back out of the bytes it emits — a header row, a key set — and
compares it with what the preview advertises, in both directions.

## Compatibility rule: append-only

**Columns are append-only, per format.** A schema change may _add_ a field at
the end of one list; it must never rename, reorder, or remove an existing one,
so a script written against today's export keeps parsing tomorrow's. A parser
that ignores unknown trailing columns stays compatible with every future
version.

The version marker depends on the format:

- CSV and JSON: the `schema_version` cell on every row — currently `1`.
- Audit log: the header line's `schema`, currently
  `stellar-agent-guard/telemetry-audit@1`.
- NDJSON: no version field. Read it as `TELEMETRY_CSV_COLUMNS` plus whatever
  trailing keys appear, which is all the append-only rule can promise.

## Telling a refused transaction from a settled one

A blocked decision comes from a simulation that was never broadcast, so an export
row for it must not read as a chain event. Every format names the origin
explicitly instead of leaving it to be inferred from an empty column:

| Format    | Where the origin lives      | A refusal                                                                        |
| --------- | --------------------------- | -------------------------------------------------------------------------------- |
| CSV, JSON | `source`                    | `source=diagnostic`, with `ledger`, `ledger_closed_at`, `transaction_hash` empty |
| NDJSON    | `source`                    | `"source": "diagnostic"`, the same three fields empty                            |
| Audit log | `source`, `timestampSource` | `"source": "diagnostic"`, `"timestampSource": "observed"`                        |

`source` is `ledger` for a row the chain committed and `diagnostic` for one this
console decoded from simulation diagnostics. The audit log adds
`timestampSource`, because it merges two different clocks into one `timestamp`
field and a reader has to know which clock they are sorting by:

- `ledger_close` — `timestamp` is the ledger close time (a committed row).
- `observed` — `timestamp` is when this console decoded the row (a diagnostic).
  That is a browser clock, not a chain fact.
- `null` — the row carries no time at all.

Two rules follow from this, and both are checked against emitted bytes rather
than reviewed in a column list:

1. **A refusal never borrows ledger facts.** Its `ledger`, `ledger_closed_at`
   and `transaction_hash` are empty (CSV, JSON, NDJSON) or `null` (audit log)
   even though the rest of the row is complete. A hash on a blocked row would be
   a fabrication, and so would a close time copied from whichever ledger
   happened to be current. For the same reason no format substitutes a plausible
   timestamp for a missing one: an undated refusal stays undated.
2. **`data` is in the two forensic formats only.** The decoded payload carries
   whatever a caller brought with it. CSV and JSON omit it by construction — no
   column is fed from `event.data` — while NDJSON and the audit log write it,
   because an incident file that cannot show _what_ was refused is of little
   use. The preview states which is which per format, so the operator reads the
   difference before downloading rather than after opening the file.

## Export CSV / Export JSON columns (in order)

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

## Export NDJSON fields (in order)

| #   | Field              | Meaning                                                            | Empty when                              |
| --- | ------------------ | ------------------------------------------------------------------ | --------------------------------------- |
| 1   | `kind`             | Classified event kind.                                             | Never.                                  |
| 2   | `topic`            | The event's topic symbol.                                          | Never.                                  |
| 3   | `decision`         | `allowed` or `blocked`.                                            | Non-auth events.                        |
| 4   | `reason`           | Raw contract block reason symbol.                                  | Allowed decisions and non-auth events.  |
| 5   | `source`           | `ledger` or `diagnostic`.                                          | Never.                                  |
| 6   | `ledger`           | Decimal string ledger sequence.                                    | Diagnostic events.                      |
| 7   | `ledger_closed_at` | ISO-8601 close time.                                               | Diagnostic events.                      |
| 8   | `transaction_hash` | Committed transaction hash.                                        | Diagnostic events.                      |
| 9   | `contract_id`      | The contract the row was observed on, as the stream reported it.   | The stream could not attribute the row. |
| 10  | `data`             | The decoded payload, as a JSON value, not as a quoted string cell. | `""` when the event carried no payload. |

The guard on an NDJSON line is `contract_id`; the CSV/JSON formats call the same
idea `guard`, because theirs is stamped from the console's watched guard on every
row rather than read off the event. The two lists answer different questions and
neither was renamed to suit the other — append-only applies to names as well as
to order.

## Export audit log

Line 1 is the header (`"record": "audit_header"`), then one
`"record": "guard_event"` line per event, in feed order. Header fields:

| Field           | Meaning                                                                               |
| --------------- | ------------------------------------------------------------------------------------- |
| `schema`        | `stellar-agent-guard/telemetry-audit@1`.                                              |
| `exportedAt`    | ISO-8601 instant of the download — this console's clock, not the chain's.             |
| `guard`         | The watched guard contract id.                                                        |
| `network`       | Network name in force, e.g. `testnet`.                                                |
| `scope`         | `filtered` when a filter narrowed the file, `full` for the whole buffer.              |
| `filter`        | The exact filter (`verdict`, `topic`, `contract`) that produced these rows.           |
| `eventCount`    | Records written by this export.                                                       |
| `bufferedCount` | Events the in-memory buffer held, so a filtered file can be checked for completeness. |
| `latestLedger`  | Decimal string, or `null` when no ledger has been read yet.                           |
| `demo`          | `true` when the feed is demo data rather than chain reads.                            |

Event record fields, in the order the writer emits them:

| Field             | Meaning                                                                                |
| ----------------- | -------------------------------------------------------------------------------------- |
| `record`          | `guard_event`.                                                                         |
| `kind`, `topic`   | As above.                                                                              |
| `verdict`         | `allowed` / `blocked`, or `null` for an event that carries no decision.                |
| `reason`          | Raw contract block reason symbol, or `null`.                                           |
| `source`          | `ledger` or `diagnostic`.                                                              |
| `contractId`      | Emitting contract, or `null`.                                                          |
| `ledger`          | Decimal string, or `null` for a refusal.                                               |
| `timestamp`       | The row's one place on a timeline: close time, else observation time, else `null`.     |
| `timestampSource` | Which clock `timestamp` came from — the list in the section above.                     |
| `ledgerClosedAt`  | Chain close time, or `null`.                                                           |
| `observedAt`      | When this console decoded the row, or `null`.                                          |
| `transactionHash` | Committed hash, or `null` for a refusal.                                               |
| `data`            | The decoded payload, made JSON-safe (conventions below).                               |
| `raw`             | The original XDR the row was decoded from, or `null` when the console did not keep it. |

`raw` carries `eventId`, `topicXdr`, `valueXdr`, `diagnosticEventXdr` and
`inSuccessfulContractCall` — the bytes, so a reviewer can re-decode a row instead
of trusting this console's decoder.

## Practical ceiling

The feed keeps the **250 most recent events** (newest first), so an export
contains at most 250 data rows and always reflects what the operator can see.
Export earlier if you need more history; the feed is a console, not an archive.
How far back those rows can reach at all, and what a gap among them means, is a
property of the RPC and the poll cadence rather than of this file format, so it
is documented in
[Historical Event Availability](./concepts/historical-event-availability.md).

## Cell conventions

- **Every scalar cell is a string.** Ledger sequences and the schema version are
  decimal strings (`"4820001"`), timestamps are ISO-8601 strings — nothing is
  coerced to a number, so i128 amounts and ISO precision survive round-trips.
- **Integers beyond 2^53 stay decimal strings** in the JSON formats too (`data`,
  `ledger`, `latestLedger`). JSON numbers are IEEE doubles, and an audit log must
  not change the figures it records.
- **Bytes are `{"hex": "…"}`** where a decoded payload contains a `Uint8Array`; a
  `Map` becomes an object, a `Date` an ISO string, and values that know how to
  render themselves (an SDK `Address`, a `Contract`) are recorded as their
  canonical string rather than as their internals.
- **CSV** follows RFC 4180: cells containing commas, quotes or newlines are
  quoted, embedded quotes are doubled. The file is **BOM-prefixed** (U+FEFF /
  `EF BB BF`) so Excel opens it as UTF-8. The first row is the column list
  verbatim; data rows follow in feed order.
- **Formula-leading cells.** The `telemetryExport` writer prefixes an apostrophe
  to any cell starting with `=`, `+`, `-` or `@`, so a hostile payload cannot
  become a formula when the file is opened in a spreadsheet. That is the one
  place the two CSV writers differ; the `eventExport` columns are a closed set of
  symbols and ids and are written verbatim.
- **JSON** is one object: `schemaVersion`, then `columns` (the same list), then
  `guard`, then `rows` — each row an object keyed by column name, values
  stringified exactly like the CSV cells.
- **NDJSON** is one object per line, each line `\n`-terminated, and no header
  line. U+2028 and U+2029 are escaped so that "one line is one record" holds for
  every consumer, including ones that split on JavaScript line terminators.
- **Filenames**:
  - CSV, JSON and NDJSON: `guard-events-<guard[:8]>-<YYYY-MM-DD>-<rowCount>.<ext>`
    — UTC ISO date, deterministic for a given day and row count. Two exports of
    the same feed on the same day differ only when the row count differs, and
    files from different guards never land on the same name.
  - Audit log: `guard-audit-log-[filtered-]<UTC timestamp>.ndjson`, timestamped
    to the second, with `filtered-` when a filter narrowed the file.
