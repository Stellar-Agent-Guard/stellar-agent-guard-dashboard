import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  EVENT_EXPORT_COLUMNS,
  EVENT_EXPORT_SCHEMA_VERSION,
  eventToExportRow,
  eventsToCsv,
  eventsToJson,
  exportFilename,
} from "../../lib/guard/eventExport.ts";
import { explainReason } from "stellar-agent-guard-sdk";
import type { GuardEvent } from "stellar-agent-guard-sdk";

/** A 56-character Stellar contract id starting with the test's prefix. */
const GUARD = "CAPADGEK".padEnd(56, "A");

function ledgerEvent(overrides: Partial<GuardEvent> = {}): GuardEvent {
  return {
    id: `ledger:${"aa11bb22cc33".padEnd(64, "0")}:event_auth_checked`,
    kind: "auth_checked",
    topic: "event_auth_checked",
    source: "ledger",
    stream: "committed",
    contractId: GUARD,
    ledger: 4820001,
    observedAt: null,
    ledgerClosedAt: "2026-09-24T10:00:00Z",
    transactionHash: "aa11bb22cc33".padEnd(64, "0"),
    decision: { result: "allowed", reason: null, source: "ledger" },
    data: { at: "2026-09-24T10:00:00Z" },
    ...overrides,
  };
}

test("rows flatten guard events: every cell is a string, missing values are empty", () => {
  const row = eventToExportRow(ledgerEvent(), GUARD);
  assert.deepEqual(Object.keys(row), [...EVENT_EXPORT_COLUMNS]);
  for (const value of Object.values(row)) assert.equal(typeof value, "string");
  assert.equal(row.schema_version, String(EVENT_EXPORT_SCHEMA_VERSION));
  assert.equal(row.guard, GUARD);
  assert.equal(row.ledger, "4820001"); // number in, string out — no coercion
  assert.equal(row.ledger_closed_at, "2026-09-24T10:00:00Z");
  assert.equal(row.decision, "allowed");
  assert.equal(row.reason, ""); // allowed decisions carry no reason
  assert.equal(row.reason_label, "");
});

test("blocked decisions carry the raw reason symbol and the SDK's human label", () => {
  const blocked = ledgerEvent({
    source: "diagnostic",
    ledger: null,
    ledgerClosedAt: null,
    transactionHash: null,
    decision: { result: "blocked", reason: "per_tx_cap_exceeded", source: "diagnostic" },
  });
  const row = eventToExportRow(blocked, GUARD);
  assert.equal(row.decision, "blocked");
  assert.equal(row.reason, "per_tx_cap_exceeded");
  assert.equal(row.reason_label, explainReason("per_tx_cap_exceeded"));
  assert.ok(row.reason_label.length > 0, "the SDK supplies a non-empty explanation");
  assert.equal(row.ledger, ""); // diagnostic events have no ledger commitment
  assert.equal(row.transaction_hash, "");
});

test("non-auth events export with an empty decision pair", () => {
  const heartbeat = ledgerEvent({ kind: "heartbeat", topic: "heartbeat", decision: null });
  const row = eventToExportRow(heartbeat, GUARD);
  assert.equal(row.decision, "");
  assert.equal(row.reason, "");
  assert.equal(row.reason_label, "");
  assert.equal(row.kind, "heartbeat");
});

test("doc-sync: docs/export-schema.md documents every column, append-only, and the version", () => {
  const doc = readFileSync("docs/export-schema.md", "utf8");
  for (const column of EVENT_EXPORT_COLUMNS) {
    assert.ok(doc.includes(`\`${column}\``), `the doc documents \`${column}\` in backticks`);
  }
  assert.match(doc, /append-only/i, "the doc states the append-only compatibility rule");
  assert.match(doc, /schema_version/i, "the doc mentions the schema_version column");
  assert.ok(
    doc.includes(String(EVENT_EXPORT_SCHEMA_VERSION)),
    "the doc states the current schema version",
  );
});

test("CSV: header row is the column list, rows follow the feed's order", () => {
  const events = [
    ledgerEvent({ kind: "heartbeat", topic: "heartbeat", decision: null }),
    ledgerEvent({
      source: "diagnostic",
      decision: { result: "blocked", reason: "per_tx_cap_exceeded", source: "diagnostic" },
    }),
    ledgerEvent({
      source: "diagnostic",
      decision: { result: "blocked", reason: "admin_frozen", source: "diagnostic" },
    }),
  ];
  const csv = eventsToCsv(events, GUARD);
  assert.equal(csv.charCodeAt(0), 0xfeff, "BOM first, then the header row");
  const lines = csv.slice(1).split("\n");
  assert.equal(lines[0], EVENT_EXPORT_COLUMNS.join(","));
  assert.match(lines[2]!, /per_tx_cap_exceeded/);
  assert.match(lines[3]!, /admin_frozen/);
});

test("CSV is BOM-prefixed (UTF-8 bytes EF BB BF) so Excel opens it as UTF-8", () => {
  const csv = eventsToCsv([ledgerEvent()], GUARD);
  assert.equal(csv.charCodeAt(0), 0xfeff, "the string starts with U+FEFF");
  const bytes = new TextEncoder().encode(csv);
  assert.deepEqual([...bytes.slice(0, 3)], [0xef, 0xbb, 0xbf]);
});

test("CSV quotes cells per RFC 4180 (commas, quotes, newlines) and doubles quotes", () => {
  // The reason column is a closed union of contract symbols (sdk 0.1.1), so
  // the hostile string lives in `topic`, the one free-text column, to pin the
  // same RFC 4180 quoting rule.
  const chatty = ledgerEvent({ topic: 'paused, "test"' });
  const csv = eventsToCsv([chatty], GUARD);
  const topicCell = csv.slice(1).split("\n")[1]!.split(",").slice(2, 4).join(",");
  assert.ok(
    topicCell.includes('"paused, ""test"""'),
    `the topic cell is quoted with doubled inner quotes, got: ${topicCell}`,
  );
});

test("JSON export serialises with insertion-ordered keys (schemaVersion → columns → guard → rows)", () => {
  const json = JSON.stringify(eventsToJson([ledgerEvent()], GUARD));
  const at = (needle: string) => json.indexOf(needle);
  const order = ["schemaVersion", "columns", "guard", "rows"];
  for (let i = 1; i < order.length; i += 1) {
    assert.ok(
      at(`"${order[i - 1]}"`) < at(`"${order[i]}"`),
      `${order[i - 1]} precedes ${order[i]}`,
    );
  }
  const parsed = JSON.parse(json) as {
    schemaVersion: number;
    columns: string[];
    guard: string;
    rows: { schema_version: string }[];
  };
  assert.equal(parsed.schemaVersion, EVENT_EXPORT_SCHEMA_VERSION);
  assert.deepEqual(parsed.columns, [...EVENT_EXPORT_COLUMNS]);
  assert.equal(parsed.guard, GUARD);
  assert.equal(parsed.rows.length, 1);
  assert.equal(parsed.rows[0]!.schema_version, String(EVENT_EXPORT_SCHEMA_VERSION));
});

test("filename is deterministic: guard prefix, UTC day, row count, extension", () => {
  const name = exportFilename(GUARD, "csv", 42, Date.parse("2026-09-24T10:00:00Z"));
  assert.match(name, /^guard-events-CAPADGEK-2026-09-24-42\.csv$/);
  assert.match(exportFilename(GUARD, "json", 42, Date.parse("2026-09-24T10:00:00Z")), /\.json$/);
});

test("an empty feed exports a header-only CSV and an empty-rows JSON", () => {
  const csv = eventsToCsv([], GUARD);
  assert.equal(csv, `\uFEFF${EVENT_EXPORT_COLUMNS.join(",")}\n`);
  const json = eventsToJson([], GUARD);
  assert.deepEqual(json.rows, []);
  assert.equal(json.columns.length, EVENT_EXPORT_COLUMNS.length);
});

// ── Stable UTC timestamps (#318) ───────────────────────────────────────────

/** The eleven columns this export shipped with, frozen so an append cannot disturb them. */
const ORIGINAL_COLUMNS = [
  "schema_version",
  "guard",
  "topic",
  "kind",
  "source",
  "decision",
  "reason",
  "reason_label",
  "ledger",
  "ledger_closed_at",
  "transaction_hash",
] as const;

test("the column list is append-only: the original eleven keep their names and order", () => {
  assert.deepEqual(EVENT_EXPORT_COLUMNS.slice(0, ORIGINAL_COLUMNS.length), [...ORIGINAL_COLUMNS]);
  assert.equal(
    EVENT_EXPORT_COLUMNS[EVENT_EXPORT_COLUMNS.length - 1],
    "observed_at",
    "the new column is last, which is where an append-only list puts it",
  );
});

test("a refusal that never reached a ledger still exports the instant this console observed it", () => {
  const blocked = ledgerEvent({
    source: "diagnostic",
    ledger: null,
    ledgerClosedAt: null,
    observedAt: "2026-09-25T14:05:00.412Z",
    transactionHash: null,
    decision: { result: "blocked", reason: "admin_frozen", source: "diagnostic" },
  });
  const row = eventToExportRow(blocked, GUARD);
  assert.equal(row.ledger_closed_at, "", "a diagnostic has no ledger close time to report");
  assert.equal(row.observed_at, "2026-09-25T14:05:00Z", "canonical UTC, second precision");

  // The reason the column exists: before it, a blocked call left the file with
  // no time at all, so an incident review could not put the refusal in order.
  const csv = eventsToCsv([blocked], GUARD);
  assert.match(csv, /2026-09-25T14:05:00Z/, "the refusal is time-ordered in the CSV");
});

test("every exported time is the same instant in UTC, whatever zone it arrived in", () => {
  const cases: readonly [input: string, expected: string][] = [
    ["2026-09-24T10:00:00Z", "2026-09-24T10:00:00Z"],
    ["2026-09-24T10:00:00.000Z", "2026-09-24T10:00:00Z"],
    ["2026-09-24T12:00:00+02:00", "2026-09-24T10:00:00Z"],
    ["2026-09-24T05:00:00-05:00", "2026-09-24T10:00:00Z"],
    // Zone-less text is read as UTC, never as the host's local time.
    ["2026-09-24T10:00:00", "2026-09-24T10:00:00Z"],
    ["2026-09-24 10:00:00", "2026-09-24T10:00:00Z"],
  ];
  for (const [input, expected] of cases) {
    const row = eventToExportRow(ledgerEvent({ ledgerClosedAt: input }), GUARD);
    assert.equal(row.ledger_closed_at, expected, `"${input}" exports as "${expected}"`);
  }
});

test("daylight-saving boundaries export as the instant they are, not as a local wall time", () => {
  // US spring-forward runs 2026-03-08 at 02:00 Eastern, so a zone-less 02:30
  // that day names no real instant in that zone. Read as UTC it is one instant
  // for every operator; read locally it is a different one, or none.
  const impossible = eventToExportRow(
    ledgerEvent({ ledgerClosedAt: "2026-03-08T02:30:00" }),
    GUARD,
  );
  assert.equal(impossible.ledger_closed_at, "2026-03-08T02:30:00Z");

  // Europe/London springs forward on 2026-03-29 at 01:00 UTC and falls back on
  // 2026-10-25 at 02:00 UTC: the same instants written from either side of the
  // shift must still meet in the middle.
  assert.equal(
    eventToExportRow(ledgerEvent({ ledgerClosedAt: "2026-03-29T00:30:00-05:00" }), GUARD)
      .ledger_closed_at,
    "2026-03-29T05:30:00Z",
  );
  assert.equal(
    eventToExportRow(ledgerEvent({ ledgerClosedAt: "2026-10-25T01:30:00+01:00" }), GUARD)
      .ledger_closed_at,
    "2026-10-25T00:30:00Z",
  );
});

test("a time that names no instant is exported verbatim rather than blanked", () => {
  const row = eventToExportRow(ledgerEvent({ ledgerClosedAt: "yesterday" }), GUARD);
  assert.equal(row.ledger_closed_at, "yesterday", "dropping it would erase the row's only time");
});

test("two operators in two zones export byte-identical files for the same feed", () => {
  const events = [
    ledgerEvent({ observedAt: "2026-09-24T10:00:00Z" }),
    ledgerEvent({
      source: "diagnostic",
      ledger: null,
      ledgerClosedAt: null,
      observedAt: "2026-03-08T02:30:00",
      transactionHash: null,
      decision: { result: "blocked", reason: "per_tx_cap_exceeded", source: "diagnostic" },
    }),
  ];
  const realTz = process.env.TZ;
  let reference: string | null = null;
  try {
    for (const zone of ["UTC", "America/New_York", "Asia/Kolkata", "Europe/London"]) {
      process.env.TZ = zone;
      const csv = eventsToCsv(events, GUARD);
      if (reference === null) reference = csv;
      else assert.equal(csv, reference, `the CSV run under TZ=${zone} matches the UTC run`);
    }
  } finally {
    if (realTz === undefined) delete process.env.TZ;
    else process.env.TZ = realTz;
  }
  assert.ok(reference!.includes("2026-03-08T02:30:00Z"), "and that instant is the UTC one");
});

test("docs/export-schema.md documents the observed_at column with the rest of the schema", () => {
  const doc = readFileSync("docs/export-schema.md", "utf8");
  assert.ok(doc.includes("`observed_at`"), "the new column is documented in backticks");
  assert.match(doc, /ISO-8601 UTC/i, "the doc states the UTC rule for exported times");
  assert.match(doc, /second precision/i, "and the precision those times are written at");
});
