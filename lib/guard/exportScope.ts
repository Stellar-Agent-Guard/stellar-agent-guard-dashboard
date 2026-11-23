/**
 * What an export is about to contain — computed before the operator downloads it.
 *
 * Issue #309. Incident and audit exports leave this console and are read by people
 * who were not in the room, so the two failures worth designing against are
 * over-sharing and under-sharing, both of which look identical from a button:
 *
 *   - A file whose time bounds the operator did not choose, because the scope was
 *     implied by whatever happened to be on screen.
 *   - A preview that counts one thing and a writer that emits another, so the
 *     number the operator confirmed is not the number in the file.
 *
 * The second one is solved structurally rather than by a test that compares two
 * code paths: `buildExportScope()` returns the **rows themselves**, and the caller
 * hands exactly those rows to `eventsToCsv()` / `eventsToJson()`. There is no
 * second selection step that could disagree, so a preview count cannot drift from
 * the file — the preview *is* the exporter's input.
 *
 * On the first: bounds are inclusive at both ends, applied to the event's own
 * authoritative instant (`ledgerClosedAt`, or `observedAt` for a diagnostic row,
 * which has no ledger to close). A row with neither is **undated** and is kept —
 * silently dropping a refused decision from an incident export because it carries
 * no timestamp would be the worse error, and pretending it fell inside the range
 * would be a lie. So undated rows are kept and counted separately, and the preview
 * says so.
 *
 * No secret or wallet material can enter the **CSV or JSON** export, by
 * construction rather than by review: their column list is imported from
 * `eventExport.ts` (so the preview cannot drift from the exporter), and that list
 * has no column fed by `event.data`, which is where an event's decoded payload
 * lives. The NDJSON and audit-log formats *do* write `data` — they are forensic
 * records, and `EXPORT_FORMAT_SCHEMAS` says which is which rather than leaving
 * the operator to infer it from one shared field list. The input to this module
 * is `GuardEvent[]` — nothing reads browser storage, so "unrelated browser-local
 * data" cannot be reached even accidentally.
 */

import type { GuardEvent } from "stellar-agent-guard-sdk";
import { EVENT_EXPORT_COLUMNS } from "./eventExport.ts";
import { TELEMETRY_CSV_COLUMNS } from "./telemetryExport.ts";
import { AUDIT_EVENT_FIELDS } from "./exportFormats.ts";
import type { TimeRange } from "./ledgerTime.ts";

/**
 * The event fields the CSV and JSON exporters deliberately never write.
 *
 * `data` is the decoded contract payload (`{ by }` for admin events, and for an
 * auth decision whatever the caller carried). It is the only field on a
 * `GuardEvent` that can hold operator-relevant but export-sensitive material, so
 * naming the omission in the preview is what makes "those two files carry no
 * secrets" a statement the operator can check rather than one they must trust.
 * The NDJSON and audit-log formats write it, and say so in the same preview.
 */
export const EXPORT_OMITTED_FIELDS = ["data"] as const;

/** The downloads the panel offers, by what they are called in the preview. */
export type ExportFormatId = "csv" | "json" | "ndjson" | "audit";

/**
 * What one export format actually writes.
 *
 * The field lists are imported from the writers rather than retyped, because the
 * preview is the operator's only view of the file before they take it: a list
 * copied by hand goes stale in exactly the way that matters — a field added to
 * an exporter and never named to the person downloading it.
 *
 * `originFields` is the point of #490. A refused simulation was never broadcast,
 * so a diagnostic row must not read as a settled one in any format, and the way
 * a reader tells them apart is named here rather than left to be discovered in a
 * spreadsheet.
 */
export interface ExportFormatSchema {
  id: ExportFormatId;
  /** How the panel's own button names this download. */
  button: string;
  fields: readonly string[];
  originFields: readonly string[];
  /** Whether the decoded event payload (`data`) is written by this format. */
  carriesPayload: boolean;
  /** The one thing the field list cannot say: how the bytes are arranged. */
  note: string;
}

export const EXPORT_FORMAT_SCHEMAS: readonly ExportFormatSchema[] = [
  {
    id: "csv",
    button: "Export CSV",
    fields: EVENT_EXPORT_COLUMNS,
    originFields: ["source"],
    carriesPayload: false,
    note: "BOM-prefixed, so Excel reads it as UTF-8",
  },
  {
    id: "json",
    button: "Export JSON",
    // One writer family: the JSON export is the same rows, plus the version and
    // column list around them.
    fields: EVENT_EXPORT_COLUMNS,
    originFields: ["source"],
    carriesPayload: false,
    note: "one object: schemaVersion, columns, guard, rows",
  },
  {
    id: "ndjson",
    button: "Export NDJSON",
    fields: TELEMETRY_CSV_COLUMNS,
    originFields: ["source"],
    carriesPayload: true,
    note: "one object per line, no header",
  },
  {
    id: "audit",
    button: "Export audit log",
    fields: AUDIT_EVENT_FIELDS,
    // A diagnostic row has no ledger close, so the audit record says which clock
    // its `timestamp` came from as well as where the row came from.
    originFields: ["source", "timestampSource"],
    carriesPayload: true,
    note: "a header line, then one record per event, with the raw event XDR",
  },
];

export function exportFormatSchema(id: ExportFormatId): ExportFormatSchema {
  const schema = EXPORT_FORMAT_SCHEMAS.find((entry) => entry.id === id);
  if (!schema) throw new Error(`no export schema for "${id}"`);
  return schema;
}

/**
 * The tooltip for one export button, built from the same table the preview uses.
 *
 * Written as a function rather than as four strings in the component so the
 * control can never advertise a field list the writer disagrees with.
 */
export function exportFormatTitle(id: ExportFormatId): string {
  const schema = exportFormatSchema(id);
  return (
    `${schema.button} writes ${schema.fields.length} field(s): ` +
    `${schema.fields.join(", ")} — origin in ${schema.originFields.join(" and ")}, ` +
    `${schema.carriesPayload ? "including" : "without"} the decoded event payload. ` +
    `${schema.note}. Fields are documented in docs/export-schema.md.`
  );
}

/**
 * The formats that share one field list, as preview lines.
 *
 * CSV and JSON are the same columns — they share the imported array, so they
 * group by that identity rather than by a re-joined string — and read as one
 * line instead of two that differ only in the name of the button.
 */
function fieldLines(schemas: readonly ExportFormatSchema[]): string[] {
  const groups: { names: string[]; schema: ExportFormatSchema }[] = [];
  for (const schema of schemas) {
    const name = schema.button.replace(/^Export /, "").toLowerCase();
    const existing = groups.find((group) => group.schema.fields === schema.fields);
    if (existing) existing.names.push(name);
    else groups.push({ names: [name], schema });
  }
  return groups.map((group) => {
    const origin = group.schema.originFields.map((field) => `"${field}"`).join(" and ");
    const payload = group.schema.carriesPayload ? "and the decoded payload" : "no decoded payload";
    return `Fields (${group.names.join(", ")}): ${group.schema.fields.join(", ")} — origin in ${origin}, ${payload}`;
  });
}

/**
 * How a diagnostic row distinguishes itself, in the words of the format that
 * carries it — the claim #490 asks every export to be able to support.
 */
export const DIAGNOSTIC_ROW_STATEMENT =
  'A refused simulation reads as one: its origin field is "diagnostic", and it has no ledger, ' +
  "no ledger close time and no transaction hash, because it was never broadcast.";

export interface ExportScope<T extends GuardEvent = GuardEvent> {
  /** Inclusive lower bound actually applied, ISO, or null when unbounded. */
  fromIso: string | null;
  /** Inclusive upper bound actually applied, ISO, or null when unbounded. */
  toIso: string | null;
  /** One-line description of the range in force, for the preview. */
  rangeLabel: string;
  /** True when neither bound was supplied, i.e. the live tail as displayed. */
  unbounded: boolean;
  /**
   * The exact rows the export will be built from. Give these to
   * `eventsToCsv()` / `eventsToJson()` and the counts above are the file's.
   */
  rows: T[];
  rowCount: number;
  /** Every event offered to the scope, before the range was applied. */
  considered: number;
  /** Dated rows that fell outside the range and were therefore dropped. */
  excludedByRange: number;
  /** Rows kept despite carrying no timestamp at all (diagnostics, mostly). */
  undatedIncluded: number;
  /** Rows produced by a refused write rather than a committed event. */
  diagnosticRows: number;
  /** Rows settled on the ledger. */
  committedRows: number;
  includesDiagnostics: boolean;
  /** The columns the file will carry, imported from the exporter itself. */
  fields: readonly string[];
  omittedFields: readonly string[];
}

/**
 * The instant an event can be placed on a timeline, or null when it cannot.
 *
 * `ledgerClosedAt` is authoritative for committed rows. `observedAt` is the SDK's
 * stamp for a diagnostic row seen through `watchAll()`; a diagnostic decoded
 * straight off simulation diagnostics has neither, and is therefore undated.
 */
export function eventInstant(event: GuardEvent): string | null {
  return event.ledgerClosedAt ?? event.observedAt ?? null;
}

function toMs(iso: string): number | null {
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? null : ms;
}

/** `null` bounds mean "no constraint on that side", matching `TimeRange`. */
function isWithin(iso: string | null, fromBound: number | null, toBound: number | null): boolean {
  if (iso === null) return true;
  const ms = toMs(iso);
  if (ms === null) return true;
  if (fromBound !== null && ms < fromBound) return false;
  if (toBound !== null && ms > toBound) return false;
  return true;
}

function isoOf(unixSecs: number | null): string | null {
  return unixSecs === null ? null : new Date(unixSecs * 1000).toISOString();
}

/**
 * Resolve the range into the rows and the numbers to show alongside them.
 *
 * Order is preserved: the export keeps whatever order the feed displayed, so the
 * preview and the file agree on sequence as well as on count.
 */
export function buildExportScope<T extends GuardEvent>(input: {
  events: readonly T[];
  range?: TimeRange | null;
  /** Overrides the range entirely when only a label is known (live tail). */
  rangeLabel?: string | null;
}): ExportScope<T> {
  const range = input.range ?? null;
  const fromSecs = range?.fromUnixSecs ?? null;
  const toSecs = range?.toUnixSecs ?? null;
  const fromMs = fromSecs === null ? null : fromSecs * 1000;
  const toMsBound = toSecs === null ? null : toSecs * 1000;

  const rows: T[] = [];
  let undatedIncluded = 0;
  for (const event of input.events) {
    const instant = eventInstant(event);
    if (instant === null) {
      undatedIncluded += 1;
      rows.push(event);
      continue;
    }
    if (isWithin(instant, fromMs, toMsBound)) rows.push(event);
  }

  const diagnosticRows = rows.filter((event) => event.source === "diagnostic").length;
  const excludedByRange = input.events.length - rows.length;

  return {
    fromIso: isoOf(fromSecs),
    toIso: isoOf(toSecs),
    unbounded: range === null || (fromSecs === null && toSecs === null),
    rangeLabel:
      input.rangeLabel ??
      (range === null
        ? "Live tail — no time bound"
        : `${isoOf(fromSecs) ?? "the beginning"} → ${isoOf(toSecs) ?? "now"}`),
    rows,
    rowCount: rows.length,
    considered: input.events.length,
    excludedByRange,
    undatedIncluded,
    diagnosticRows,
    committedRows: rows.length - diagnosticRows,
    includesDiagnostics: diagnosticRows > 0,
    fields: EVENT_EXPORT_COLUMNS,
    omittedFields: EXPORT_OMITTED_FIELDS,
  };
}

/**
 * The preview's lines, in reading order, phrased so each is checkable.
 *
 * Returned as data rather than markup so the component can label it and the unit
 * test can assert the wording without a DOM.
 */
export function describeExportScope(scope: ExportScope): string[] {
  const lines = [
    `Time range: ${scope.rangeLabel}`,
    `${scope.rowCount} of ${scope.considered} event(s) in scope` +
      (scope.excludedByRange > 0 ? `; ${scope.excludedByRange} outside the range excluded` : ""),
    `Diagnostics: ${scope.includesDiagnostics ? "included" : "none in range"}` +
      (scope.diagnosticRows > 0 ? ` (${scope.diagnosticRows} row(s))` : ""),
  ];
  if (scope.undatedIncluded > 0) {
    lines.push(
      `${scope.undatedIncluded} undated row(s) included regardless of range — a refused decision has no ledger close time`,
    );
  }
  // #490: the field list belongs to each format, not to the panel. One shared
  // list would describe one download and misdescribe three — including the
  // claim about the decoded payload, which is true of CSV and JSON only.
  lines.push(...fieldLines(EXPORT_FORMAT_SCHEMAS));
  lines.push(DIAGNOSTIC_ROW_STATEMENT);
  lines.push(
    `Not exported by CSV or JSON: ${scope.omittedFields.join(", ")} — the decoded event payload; ` +
      "the NDJSON and audit log carry it, as their field lists above say.",
  );
  return lines;
}
