/**
 * The telemetry feed's filter and export logic, kept out of the component so
 * the exact predicate and serializers the UI uses are unit-testable — and so a
 * CSV/NDJSON download is provably the *filtered* view, not a hidden superset.
 *
 * Column order is fixed and documented (it is a small public format: spreadsheets
 * and log shippers consume these files), and every row is derived from the same
 * `GuardEvent` the table renders — one row in, one line out.
 *
 * Both time cells are canonical ISO-8601 UTC (`canonicalUtc` in `time.ts`), the
 * same form the CSV/JSON telemetry export and the audit log write, so a file
 * downloaded in one zone sorts identically to one downloaded in another
 * (issue #318).
 */

import type { GuardEvent } from "stellar-agent-guard-sdk";
import { canonicalUtc } from "./time.ts";
import { neutralizeFormulaCell } from "./csv.ts";

export type VerdictFilter = "all" | "allowed" | "blocked";

export interface TelemetryFilter {
  verdict: VerdictFilter;
  /** Topic symbol (`event_heartbeat`, …) or `"all"`. */
  topic: string;
  /** Case-insensitive substring of the event's contract id; `""` disables it. */
  contract: string;
}

export const ALL_TOPICS = "all";

export const EMPTY_TELEMETRY_FILTER: TelemetryFilter = {
  verdict: "all",
  topic: ALL_TOPICS,
  contract: "",
};

/**
 * Apply the feed's three controls.
 *
 * The verdict filter only constrains events that *have* a decision: a
 * heartbeat neither was allowed nor was blocked, so "Allowed Only" and
 * "Blocked Only" both exclude it rather than pretending it carries a verdict.
 */
// Generic so a richer event (one carrying its raw XDR) survives filtering intact.
export function filterGuardEvents<T extends GuardEvent>(
  events: readonly T[],
  filter: TelemetryFilter,
): T[] {
  const contract = filter.contract.trim().toLowerCase();
  return events.filter((event) => {
    if (filter.verdict !== "all" && event.decision?.result !== filter.verdict) return false;
    if (filter.topic !== ALL_TOPICS && event.topic !== filter.topic) return false;
    if (contract.length > 0 && !(event.contractId ?? "").toLowerCase().includes(contract)) {
      return false;
    }
    return true;
  });
}

/**
 * The CSV header, in order. `data` is the event body as compact JSON — it is
 * quoted like any other field, so a body containing commas or newlines stays
 * one cell.
 *
 * Append-only, like the schema in `docs/export-schema.md`: a new column joins
 * the end, and nothing before it is renamed, reordered or removed, so a script
 * written against an older file keeps parsing.
 */
export const TELEMETRY_CSV_COLUMNS = [
  "kind",
  "topic",
  "decision",
  "reason",
  "source",
  "ledger",
  "ledger_closed_at",
  "transaction_hash",
  "contract_id",
  "data",
  "observed_at",
] as const;

/** One of this format's columns; the row map below is keyed by it. */
export type TelemetryExportColumn = (typeof TELEMETRY_CSV_COLUMNS)[number];

/** Compact JSON that survives `bigint` (ScVal decoding produces them). */
function dataJson(data: unknown): string {
  // `data` is `unknown`, and `JSON.stringify(undefined)` returns `undefined`
  // rather than text. Written as `null`, both because that is what the payload
  // is — absent — and because the alternative is a cell reading `undefined`.
  return (
    JSON.stringify(data, (_key, value: unknown) =>
      typeof value === "bigint" ? value.toString() : value,
    ) ?? "null"
  );
}

function csvCell(value: string): string {
  if (/[",\n\r]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

function csvRow(cells: string[]): string {
  return cells.map(csvCell).join(",");
}

/**
 * One event as this format's own field map.
 *
 * Keyed by the column list rather than positional, so a writer cannot emit a
 * row that is missing a column, and so `source` — the origin discriminator
 * issue #490 is about — has to be supplied for the file to compile at all.
 */
function rowFields(event: GuardEvent): Record<TelemetryExportColumn, string> {
  return {
    kind: event.kind,
    topic: event.topic,
    decision: event.decision?.result ?? "",
    reason: event.decision?.reason ?? "",
    source: event.source,
    ledger: event.ledger === null || event.ledger === undefined ? "" : String(event.ledger),
    ledger_closed_at: canonicalUtc(event.ledgerClosedAt),
    transaction_hash: event.transactionHash ?? "",
    contract_id: event.contractId ?? "",
    data: dataJson(event.data),
    observed_at: canonicalUtc(event.observedAt),
  };
}

function rowCells(event: GuardEvent): string[] {
  const fields = rowFields(event);
  return TELEMETRY_CSV_COLUMNS.map((column) => fields[column]);
}

/** The events as CSV: fixed header, one row per event, trailing newline. */
export function telemetryToCsv(events: GuardEvent[]): string {
  const lines = [csvRow([...TELEMETRY_CSV_COLUMNS])];
  for (const event of events) {
    const cells = rowCells(event).map(neutralizeFormulaCell);
    lines.push(csvRow(cells));
  }
  return `${lines.join("\n")}\n`;
}

/**
 * One JSON document per line (trailing newline), for log pipelines.
 *
 * The keys come from `TELEMETRY_CSV_COLUMNS` in column order, and both writers
 * read the same `rowFields()` map, so appending a column extends this output
 * too rather than silently leaving the new field out of the machine-readable
 * format that a SIEM is already reading.
 *
 * `source` is the origin discriminator and is never omitted or guessed: a
 * refused simulation has `source: "diagnostic"` with an empty `ledger`,
 * `ledger_closed_at` and `transaction_hash`, which is what keeps it from
 * parsing as a settled chain event.
 */
export function telemetryToNdjson(events: GuardEvent[]): string {
  const lines = events.map((event) => {
    const fields = rowFields(event);
    const record: Record<string, unknown> = {};
    for (const column of TELEMETRY_CSV_COLUMNS) {
      // The payload cell is compact JSON; keeping it structured is the whole
      // reason a pipeline reads this format rather than the CSV.
      record[column] =
        column === "data" ? (JSON.parse(fields[column] || "null") as unknown) : fields[column];
    }
    return JSON.stringify(record);
  });
  return lines.length > 0 ? `${lines.join("\n")}\n` : "";
}
