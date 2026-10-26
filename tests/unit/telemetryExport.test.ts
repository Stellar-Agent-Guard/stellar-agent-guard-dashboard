import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import type { GuardEvent } from "stellar-agent-guard-sdk";
import {
  TELEMETRY_CSV_COLUMNS,
  telemetryToCsv,
  telemetryToNdjson,
} from "../../lib/guard/telemetryExport.ts";

/**
 * The telemetry feed's own download — `Export NDJSON` in the filter bar, and the
 * CSV serializer that shares its column list. It is a third, deliberately plainer
 * surface than `eventExport.ts`'s documented schema, so the same #318 guarantees
 * are checked here against the cells and keys this module actually writes.
 */

const CONTRACT = "CAPADGEK".padEnd(56, "A");

function feedEvent(overrides: Partial<GuardEvent> = {}): GuardEvent {
  return {
    id: `ledger:${"aa11bb22cc33".padEnd(64, "0")}:event_auth_checked`,
    kind: "auth_checked",
    topic: "event_auth_checked",
    source: "ledger",
    stream: "committed",
    contractId: CONTRACT,
    ledger: 4820001,
    observedAt: null,
    ledgerClosedAt: "2026-09-24T10:00:00Z",
    transactionHash: "aa11bb22cc33".padEnd(64, "0"),
    decision: { result: "allowed", reason: null, source: "ledger" },
    data: { amount: 100_000n },
    ...overrides,
  };
}

/** Split one RFC 4180 line into cells, honouring quoted cells and doubled quotes. */
function parseCsvLine(line: string): string[] {
  const cells: string[] = [];
  let current = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index] ?? "";
    if (quoted) {
      if (char !== '"') current += char;
      else if (line[index + 1] === '"') {
        current += '"';
        index += 1;
      } else quoted = false;
    } else if (char === '"') quoted = true;
    else if (char === ",") {
      cells.push(current);
      current = "";
    } else current += char;
  }
  cells.push(current);
  return cells;
}

/** The feed CSV as `{header, rows}`, with every quoted cell already unescaped. */
function parseCsv(csv: string): { header: string[]; rows: Record<string, string>[] } {
  const [headerLine = "", ...rowLines] = csv.trimEnd().split("\n");
  const header = parseCsvLine(headerLine);
  return {
    header,
    rows: rowLines.map((line) =>
      Object.fromEntries(
        parseCsvLine(line).map(
          (cell, index) => [header[index] ?? `column_${index}`, cell] as const,
        ),
      ),
    ),
  };
}

function ndjsonLines(events: GuardEvent[]): Record<string, unknown>[] {
  return telemetryToNdjson(events)
    .trimEnd()
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

test("the header and every data row carry the same cells, in the documented order", () => {
  const { header, rows } = parseCsv(
    telemetryToCsv([feedEvent(), feedEvent({ topic: "event_frozen" })]),
  );
  assert.deepEqual(header, [...TELEMETRY_CSV_COLUMNS]);
  assert.equal(rows.length, 2, "one line in, one line out");
  for (const row of rows) assert.deepEqual(Object.keys(row), [...TELEMETRY_CSV_COLUMNS]);
});

test("the feed's column list is append-only: the original ten keep their names and order", () => {
  const ORIGINAL_COLUMNS = [
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
  ] as const;
  assert.deepEqual(
    TELEMETRY_CSV_COLUMNS.slice(0, ORIGINAL_COLUMNS.length),
    [...ORIGINAL_COLUMNS],
    "a script written against the older file still parses every field it knew",
  );
  assert.equal(TELEMETRY_CSV_COLUMNS[TELEMETRY_CSV_COLUMNS.length - 1], "observed_at");
});

test("a refusal that never reached a ledger still lands in the file with a time", () => {
  const blocked = feedEvent({
    source: "diagnostic",
    ledger: null,
    ledgerClosedAt: null,
    observedAt: "2026-09-25T14:05:00.412Z",
    transactionHash: null,
    decision: { result: "blocked", reason: "admin_frozen", source: "diagnostic" },
  });

  const [row] = parseCsv(telemetryToCsv([blocked])).rows;
  assert.equal(row?.ledger_closed_at, "", "a diagnostic has no ledger close time to report");
  assert.equal(row?.observed_at, "2026-09-25T14:05:00Z", "canonical UTC, second precision");

  const [line] = ndjsonLines([blocked]);
  assert.equal(line?.observed_at, "2026-09-25T14:05:00Z");
  assert.equal(line?.ledger_closed_at, "");
});

test("every time in the download is the same instant in UTC, whatever zone it arrived in", () => {
  const cases: readonly [input: string, expected: string][] = [
    ["2026-09-24T10:00:00Z", "2026-09-24T10:00:00Z"],
    ["2026-09-24T10:00:00.000Z", "2026-09-24T10:00:00Z"],
    ["2026-09-24T12:00:00+02:00", "2026-09-24T10:00:00Z"],
    ["2026-09-24T05:00:00-05:00", "2026-09-24T10:00:00Z"],
    // Zone-less text is read as UTC, never as the host's local time.
    ["2026-09-24T10:00:00", "2026-09-24T10:00:00Z"],
    ["2026-09-24 10:00:00", "2026-09-24T10:00:00Z"],
    // Around the US spring-forward, a zone-less 02:30 names no real local instant.
    ["2026-03-08T02:30:00", "2026-03-08T02:30:00Z"],
    ["yesterday", "yesterday"],
  ];
  for (const [input, expected] of cases) {
    const event = feedEvent({ ledgerClosedAt: input });
    assert.equal(
      parseCsv(telemetryToCsv([event])).rows[0]?.ledger_closed_at,
      expected,
      `the CSV writes "${input}" as "${expected}"`,
    );
    assert.equal(
      ndjsonLines([event])[0]?.ledger_closed_at,
      expected,
      `and the NDJSON line agrees with it, cell for cell`,
    );
  }
});

test("the NDJSON line's keys are exactly the documented columns", () => {
  const [line] = ndjsonLines([feedEvent()]);
  assert.deepEqual(Object.keys(line ?? {}), [...TELEMETRY_CSV_COLUMNS]);
  assert.equal(line?.ledger, "4820001", "a ledger sequence is a string, never a JSON number");
  assert.deepEqual(
    line?.data,
    { amount: "100000" },
    "and a u64 payload survives as a decimal string",
  );
});

test("an empty feed writes a header and nothing else, or no lines at all", () => {
  assert.equal(telemetryToCsv([]), `${[...TELEMETRY_CSV_COLUMNS].join(",")}\n`);
  assert.equal(telemetryToNdjson([]), "", "a pipeline must not choke on a blank line");
});

test("two operators in two zones download byte-identical feeds", () => {
  const events = [
    feedEvent({ observedAt: "2026-09-24T10:00:00Z" }),
    feedEvent({
      source: "diagnostic",
      ledger: null,
      ledgerClosedAt: null,
      observedAt: "2026-10-25T01:30:00+01:00",
      transactionHash: null,
      decision: { result: "blocked", reason: "per_tx_cap_exceeded", source: "diagnostic" },
    }),
  ];
  const realTz = process.env.TZ;
  let reference: { csv: string; ndjson: string } | null = null;
  try {
    for (const zone of ["UTC", "America/New_York", "Asia/Kolkata", "Europe/London"]) {
      process.env.TZ = zone;
      const csv = telemetryToCsv(events);
      const ndjson = telemetryToNdjson(events);
      if (reference === null) reference = { csv, ndjson };
      else {
        assert.equal(csv, reference.csv, `the CSV run under TZ=${zone} matches the UTC run`);
        assert.equal(ndjson, reference.ndjson, `and so does the NDJSON run under TZ=${zone}`);
      }
    }
  } finally {
    if (realTz === undefined) delete process.env.TZ;
    else process.env.TZ = realTz;
  }
  assert.ok(reference !== null);
  assert.match(
    reference.ndjson,
    /2026-10-25T00:30:00Z/,
    "the fallback-hour instant is the UTC one",
  );
});

test("docs/export-schema.md documents this feed's fields and their UTC form", () => {
  const doc = readFileSync("docs/export-schema.md", "utf8");
  assert.match(
    doc,
    /guard-telemetry\.ndjson/,
    "the file the button writes is named in the schema doc",
  );
  for (const column of TELEMETRY_CSV_COLUMNS) {
    assert.ok(
      doc.includes(`\`${column}\``),
      `every field of the download is documented in backticks, including "${column}"`,
    );
  }
});
