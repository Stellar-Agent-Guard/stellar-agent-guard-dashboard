/**
 * A refused simulation must not read as a settled chain event in any export
 * format (#490).
 *
 * The four downloads the feed offers are three writers over two column lists,
 * and an incident file is read by someone who was not in the room. Two failures
 * are worth designing against, and both look like a correct file from here:
 *
 *   - A format that omits the origin, so a diagnostic row sorts into a ledger
 *     analysis as though it had committed.
 *   - A preview that describes one download while sitting above four buttons.
 *     The field list and the claim about the decoded payload were both of that
 *     kind, because CSV/JSON, NDJSON and the audit log do not carry the same
 *     fields — and `data` is in two of them.
 *
 * So the checks here run against the emitted bytes, not against a list copied
 * out of the source: each format's real header (or key set) is compared with
 * what `exportScope` promises, and the payload marker is searched for in the
 * files that say they hold it and in the ones that say they do not.
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { GUARD_EVENT_TOPICS, type GuardEvent } from "stellar-agent-guard-sdk";
import {
  EVENT_EXPORT_COLUMNS,
  eventsToCsv,
  eventsToJson,
  exportFilename,
} from "../../lib/guard/eventExport.ts";
import {
  EMPTY_TELEMETRY_FILTER,
  TELEMETRY_CSV_COLUMNS,
  telemetryToNdjson,
} from "../../lib/guard/telemetryExport.ts";
import {
  AUDIT_EVENT_FIELDS,
  AUDIT_FIELDS_ARE_COMPLETE,
  AUDIT_HEADER_FIELDS,
  telemetryToAuditLog,
} from "../../lib/guard/exportFormats.ts";
import {
  DIAGNOSTIC_ROW_STATEMENT,
  EXPORT_FORMAT_SCHEMAS,
  buildExportScope,
  describeExportScope,
  exportFormatSchema,
  exportFormatTitle,
} from "../../lib/guard/exportScope.ts";
import { withIdentity } from "../mocks/eventFixtures.ts";

const GUARD = "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
const OTHER_GUARD = "CBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB";

/**
 * A payload the exports either carry or do not. `memo` is the marker the
 * presence checks search for, because `data` is the one field whose inclusion
 * differs between the formats.
 */
const PAYLOAD = {
  by: "GSECRETWALLETSEEDS11111111111111111111111111",
  memo: "seed: my secret recovery phrase",
};

/** A row that settled: ledger, close time and hash are all chain facts. */
const committed = withIdentity({
  kind: "auth_checked",
  topic: GUARD_EVENT_TOPICS.authChecked,
  source: "ledger",
  contractId: GUARD,
  ledger: 4820001,
  ledgerClosedAt: "2026-09-25T14:03:07.000Z",
  observedAt: "2026-09-25T14:03:09.000Z",
  transactionHash: "01abc23d",
  decision: { result: "allowed", reason: null, source: "ledger" },
  data: PAYLOAD,
});

/**
 * A refusal that was never broadcast. It carries the same decision shape as the
 * committed row and a payload of its own, and the only facts it can honestly
 * offer are its origin and, at most, when this console decoded it.
 */
const diagnostic = withIdentity({
  kind: "auth_checked",
  topic: GUARD_EVENT_TOPICS.authChecked,
  source: "diagnostic",
  contractId: GUARD,
  ledger: null,
  ledgerClosedAt: null,
  observedAt: "2026-09-25T14:03:08.000Z",
  transactionHash: null,
  decision: { result: "blocked", reason: "per_tx_cap_exceeded", source: "diagnostic" },
  data: PAYLOAD,
});

const EVENTS = [committed, diagnostic];

/** The audit log over these events, with every clock pinned. */
function auditLog(events: readonly GuardEvent[]): string {
  return telemetryToAuditLog({
    events,
    bufferedCount: events.length,
    guard: GUARD,
    network: "testnet",
    filter: EMPTY_TELEMETRY_FILTER,
    latestLedger: 4820002,
    demo: false,
    exportedAt: new Date("2026-09-25T14:03:10Z"),
  });
}

/** A minimal RFC 4180 parser: the payload cell is quoted JSON, commas inside. */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index] as string;
    if (quoted) {
      if (char === '"') {
        if (text[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          quoted = false;
        }
      } else {
        field += char;
      }
    } else if (char === '"') {
      quoted = true;
    } else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (char !== "\r" && char !== "﻿") {
      field += char;
    }
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((entry) => entry.some((cell) => cell.length > 0));
}

/** CSV with a header: the data rows as objects keyed by their own column names. */
function csvObjects(text: string): Record<string, string>[] {
  const [header, ...body] = parseCsv(text);
  const columns = (header ?? []).map((cell) => cell.replace("﻿", "").trim());
  return body.map((cells) =>
    Object.fromEntries(columns.map((column, position) => [column, cells[position] ?? ""])),
  );
}

function ndjsonObjects(text: string): Record<string, unknown>[] {
  return text
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

/** The `guard_event` records only: line 1 is the header. */
function auditRecords(events: readonly GuardEvent[]): Record<string, unknown>[] {
  return ndjsonObjects(auditLog(events)).filter((entry) => entry.record === "guard_event");
}

describe("every format names the row's origin (issue #490)", () => {
  test("Export CSV keeps a refusal out of the settled rows", () => {
    const rows = csvObjects(eventsToCsv(EVENTS, GUARD));
    assert.equal(rows[0]?.source, "ledger");
    assert.equal(rows[1]?.source, "diagnostic");
    // Origin is not the only tell: a refusal has no ledger facts to be mistaken
    // for, and an empty cell is honest where a fabricated one would not be.
    assert.deepEqual(
      [rows[1]?.ledger, rows[1]?.ledger_closed_at, rows[1]?.transaction_hash],
      ["", "", ""],
    );
    assert.equal(rows[0]?.ledger, "4820001");
    assert.equal(rows[0]?.transaction_hash, "01abc23d");
  });

  test("Export JSON keeps it, and keeps the column list alongside the rows", () => {
    const json = eventsToJson(EVENTS, GUARD);
    assert.deepEqual([...json.columns], [...EVENT_EXPORT_COLUMNS]);
    assert.equal(json.rows[1]?.source, "diagnostic");
    assert.equal(json.rows[0]?.source, "ledger");
    assert.equal(json.rows[1]?.ledger, "");
    assert.equal(json.rows[1]?.transaction_hash, "");
    assert.equal(json.rows[1]?.reason, "per_tx_cap_exceeded");
  });

  test("Export NDJSON keeps it, with the same keys as its own column list", () => {
    const objects = ndjsonObjects(telemetryToNdjson(EVENTS));
    assert.equal(objects.length, 2);
    // The keys are the writer's column list, in order: the JSON path cannot
    // silently drop a field the CSV path carries, or invent one it does not.
    assert.deepEqual(Object.keys(objects[0] as object), [...TELEMETRY_CSV_COLUMNS]);
    assert.equal(objects[0]?.source, "ledger");
    assert.equal(objects[1]?.source, "diagnostic");
    assert.deepEqual(
      [objects[1]?.ledger, objects[1]?.ledger_closed_at, objects[1]?.transaction_hash],
      ["", "", ""],
    );
    assert.deepEqual(objects[1]?.data, PAYLOAD, "the payload travels as data, not as text");
  });

  test("the audit log names both the origin and the clock its timestamp came from", () => {
    const [headerRow, ...recordRows] = ndjsonObjects(auditLog(EVENTS));
    assert.equal(headerRow?.record, "audit_header");
    assert.deepEqual(Object.keys(headerRow as object), [...AUDIT_HEADER_FIELDS]);
    assert.deepEqual(Object.keys(recordRows[0] as object), [...AUDIT_EVENT_FIELDS]);
    assert.equal(AUDIT_FIELDS_ARE_COMPLETE, true, "the field lists match the record types");

    const [settled, refused] = recordRows;
    assert.equal(settled?.source, "ledger");
    assert.equal(settled?.timestampSource, "ledger_close");
    assert.equal(settled?.timestamp, "2026-09-25T14:03:07Z");
    assert.equal(refused?.source, "diagnostic");
    assert.equal(refused?.ledger, null);
    assert.equal(refused?.transactionHash, null);
    // The distinction this issue is about, in the strongest form the format
    // offers: the refusal's `timestamp` is present but labelled as this
    // console's time, so no reader can take it for a ledger close.
    assert.equal(refused?.timestampSource, "observed");
    assert.equal(refused?.ledgerClosedAt, null);
  });

  test("a refusal with no time at all is undated in every format, never dated by luck", () => {
    // `withIdentity` stands in for the SDK's own stamping, so it cannot produce
    // the one row this check needs: a diagnostic that carries neither a ledger
    // close time nor an observation time. `observedAt` is nullable on the event
    // type, so saying so here is the shape, not a cast around the helper.
    const undated: GuardEvent = { ...diagnostic, observedAt: null };
    assert.equal(undated.ledgerClosedAt, null);
    const csv = csvObjects(eventsToCsv([undated], GUARD));
    assert.equal(csv[0]?.source, "diagnostic");
    assert.equal(csv[0]?.ledger_closed_at, "");
    const [record] = auditRecords([undated]);
    assert.equal(record?.timestamp, null);
    assert.equal(record?.timestampSource, null, "no clock is claimed for a row with no time");
    assert.equal(record?.source, "diagnostic");
  });
});

describe("the preview says what each download actually holds", () => {
  const scope = buildExportScope({ events: EVENTS, range: null });
  const lines = describeExportScope(scope);
  const preview = lines.join("\n");

  test("one field list per format, taken from the file rather than from memory", () => {
    const emitted: Record<string, readonly string[]> = {
      csv:
        parseCsv(eventsToCsv(scope.rows, GUARD))[0]?.map((cell) => cell.replace("﻿", "").trim()) ??
        [],
      json: [...eventsToJson(scope.rows, GUARD).columns],
      ndjson: Object.keys(ndjsonObjects(telemetryToNdjson(scope.rows))[0] as object),
      audit: Object.keys(auditRecords(scope.rows)[0] as object),
    };
    for (const schema of EXPORT_FORMAT_SCHEMAS) {
      assert.deepEqual(
        [...(emitted[schema.id] ?? [])],
        [...schema.fields],
        `${schema.button} advertises ${schema.fields.join(", ")} and writes something else`,
      );
    }
  });

  test("the payload claim is true in both directions", () => {
    // Not a review of a column list: the marker is searched for in each file, and
    // the schema's own claim has to agree with what the bytes did.
    const bodies: Record<string, string> = {
      csv: eventsToCsv(scope.rows, GUARD),
      json: JSON.stringify(eventsToJson(scope.rows, GUARD)),
      ndjson: telemetryToNdjson(scope.rows),
      audit: auditLog(scope.rows),
    };
    for (const schema of EXPORT_FORMAT_SCHEMAS) {
      const carries = (bodies[schema.id] ?? "").includes(PAYLOAD.memo);
      assert.equal(
        carries,
        schema.carriesPayload,
        `${schema.button} claims ${schema.carriesPayload ? "to carry" : "not to carry"} the payload`,
      );
    }
  });

  test("every format's line names its origin field, and none is left out", () => {
    for (const schema of EXPORT_FORMAT_SCHEMAS) {
      const name = schema.button.replace(/^Export /, "").toLowerCase();
      assert.ok(
        preview.includes(name),
        `the preview never mentions ${schema.button}, so its fields are unadvertised`,
      );
    }
    assert.match(
      preview,
      /Fields \(csv, json\): schema_version,[^\n]*— origin in "source", no decoded payload/,
    );
    assert.match(preview, /Fields \(ndjson\):[^\n]*— origin in "source", and the decoded payload/);
    assert.match(
      preview,
      /Fields \(audit log\):[^\n]*— origin in "source" and "timestampSource", and the decoded payload/,
    );
    assert.ok(
      preview.includes(DIAGNOSTIC_ROW_STATEMENT),
      "the preview states, in one sentence, how a refusal is told apart",
    );
  });

  test("the payload is named as omitted by the two formats that omit it", () => {
    const last = lines[lines.length - 1] ?? "";
    assert.match(last, /Not exported by CSV or JSON: data/);
    assert.match(last, /NDJSON and audit log carry it/);
    assert.doesNotMatch(
      last,
      /no wallet material or secrets can appear/,
      "that claim was never true of the two formats that write `data`",
    );
  });

  test("each button's tooltip is generated from the same table as the preview", () => {
    for (const schema of EXPORT_FORMAT_SCHEMAS) {
      const title = exportFormatTitle(schema.id);
      assert.ok(title.includes(schema.fields.join(", ")), schema.button);
      assert.equal(title.includes("docs/export-schema.md"), true, "and it points at the schema");
      for (const field of schema.originFields) {
        assert.ok(title.includes(field), `${schema.button} hides its origin field ${field}`);
      }
    }
    assert.equal(exportFormatSchema("audit").originFields.length, 2);
    assert.equal(exportFormatSchema("csv").carriesPayload, false);
  });
});

describe("the NDJSON download is attributable (issue #490)", () => {
  test("its name carries the guard, the day and the row count", () => {
    const at = Date.UTC(2026, 8, 25, 14, 3, 7);
    assert.equal(
      exportFilename(GUARD, "ndjson", 12, at),
      "guard-events-CAAAAAAA-2026-09-25-12.ndjson",
    );
    assert.notEqual(
      exportFilename(OTHER_GUARD, "ndjson", 12, at),
      exportFilename(GUARD, "ndjson", 12, at),
      "two guards' NDJSON exports used to land on one fixed name and overwrite each other",
    );
    assert.notEqual(
      exportFilename(GUARD, "ndjson", 13, at),
      exportFilename(GUARD, "ndjson", 12, at),
      "a re-export with a different count is not the same file",
    );
  });

  test("the names the panel already used for CSV and JSON are unchanged", () => {
    // Append-only applies to filenames too: a script that globbed
    // `guard-events-*-2026-09-25-*.csv` must keep working.
    const at = Date.UTC(2026, 8, 25);
    assert.equal(exportFilename(GUARD, "csv", 3, at), "guard-events-CAAAAAAA-2026-09-25-3.csv");
    assert.equal(exportFilename(GUARD, "json", 3, at), "guard-events-CAAAAAAA-2026-09-25-3.json");
  });
});
