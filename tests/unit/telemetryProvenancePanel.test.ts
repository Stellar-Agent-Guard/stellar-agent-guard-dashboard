/**
 * Issue #484 at the row level: what an operator can read about a value's origin
 * without leaving the table.
 *
 * The split itself is tested as pure logic in `tests/unit/decodeProvenance.test.ts`;
 * these cases pin that the feed actually renders it, and that the two places a
 * missing value used to hide behind another word (`?? "blocked"`, a bare topic
 * symbol as a label) now say what they are.
 */
import assert from "node:assert/strict";
import { afterEach, before, test } from "node:test";
import type { ContextType } from "react";
import { GUARD_EVENT_TOPICS } from "stellar-agent-guard-sdk";
import { installDom, loadReact, sleep, type Act } from "./domHarness.ts";
import { withIdentity } from "../mocks/eventFixtures.ts";
import { TelemetryFeed } from "../../components/TelemetryFeed.tsx";
import { GuardContext, GuardEventsContext } from "../../components/GuardProvider.tsx";
import { POLL_OFF } from "../../lib/guard/feedHealth.ts";
import { EVENT_DECODER } from "../../lib/guard/decodeProvenance.ts";
import type { RawEventXdr, TelemetryEvent } from "../../lib/guard/telemetry.ts";

installDom();

const GUARD = "CAYJZT4XH5SWDXNR7MZJCCUBIDAT2KZDDUTZ7OZQEMKCPJGD4P3X4CU7";

let react: typeof import("react");
let createRoot: typeof import("react-dom/client").createRoot;
let act: Act;

before(async () => {
  const loaded = await loadReact();
  react = loaded.react;
  createRoot = loaded.createRoot;
  act = loaded.act;
});

afterEach(() => {
  document.body.innerHTML = "";
});

/** The committed-page bytes, as `attachLedgerXdr` would pair them onto a row. */
const LEDGER_XDR: RawEventXdr = {
  eventId: "0000000526843904000-0000000001",
  topicXdr: ["AAAACAAAAAVldmVudA=="],
  valueXdr: "AAAAAAAAAAE=",
  diagnosticEventXdr: null,
  inSuccessfulContractCall: true,
};

/** The refused-simulation bytes, as `refusedEventsFromDiagnostics` would. */
const DIAGNOSTIC_XDR: RawEventXdr = {
  eventId: null,
  topicXdr: ["AAAACAAAAAVldmVudA=="],
  valueXdr: null,
  diagnosticEventXdr: "AAAAQQEAAAAB",
  inSuccessfulContractCall: false,
};

/**
 * Rows in the shape the live feed hands the panel — identity fields derived by
 * `withIdentity`, so these de-duplicate and key the same way real events do.
 */
function committed(ledger: number): TelemetryEvent {
  return withIdentity({
    kind: "auth_checked",
    topic: GUARD_EVENT_TOPICS.authChecked,
    source: "ledger",
    contractId: GUARD,
    ledger,
    ledgerClosedAt: "2026-09-25T10:00:00.000Z",
    transactionHash: `${"a".repeat(62)}${String(ledger % 100).padStart(2, "0")}`,
    decision: { result: "allowed", reason: null, source: "ledger" },
    data: {},
    raw: LEDGER_XDR,
  });
}

/** A refusal whose reason the decoder never got: the row used to call it "blocked". */
function unexplainedRefusal(): TelemetryEvent {
  return withIdentity({
    kind: "auth_checked",
    topic: GUARD_EVENT_TOPICS.authChecked,
    source: "diagnostic",
    contractId: GUARD,
    ledger: null,
    ledgerClosedAt: null,
    transactionHash: null,
    decision: { result: "blocked", reason: null, source: "diagnostic" },
    data: {},
    raw: DIAGNOSTIC_XDR,
  });
}

/** A refusal the feed could not pair with the bytes it came from. */
function withoutBytes(): TelemetryEvent {
  const row = committed(5_268_500);
  return { ...row, raw: null };
}

/** A topic outside the decoder's kind table, so the row has no label for it. */
function unrecognisedTopic(): TelemetryEvent {
  return withIdentity({
    kind: "unknown",
    topic: "event_something_new",
    source: "ledger",
    contractId: GUARD,
    ledger: 5_268_600,
    ledgerClosedAt: "2026-09-25T10:01:00.000Z",
    transactionHash: "b".repeat(64),
    decision: null,
    data: {},
    raw: LEDGER_XDR,
  });
}

type GuardContextValue = NonNullable<ContextType<typeof GuardContext>>;

/** The session half of the context, with no network behind it. Rows come from
 * `GuardEventsContext`, which the provider keeps separate. */
function contextFor() {
  return {
    guard: GUARD,
    instances: [],
    feed: {
      watching: true,
      latestLedger: 5_268_700,
      error: null,
      lastPolledAt: null,
      guards: [],
      capped: 0,
      cappedLabels: [],
      health: POLL_OFF,
      gaps: [],
    },
    stream: { paused: false, pendingCount: 0, dropped: 0 },
    startWatching: () => {},
    stopWatching: () => {},
    tailSelection: [],
    toggleTailedGuard: () => {},
    exportRange: null,
    clearEvents: () => {},
    pauseStream: () => {},
    resumeStream: () => {},
    queryRange: async () => {},
    rangeLabel: null,
  } as unknown as GuardContextValue;
}

async function renderFeed(events: TelemetryEvent[]): Promise<{
  rows: () => HTMLTableRowElement[];
  unmount: () => Promise<void>;
}> {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(
      react.createElement(
        GuardContext.Provider,
        { value: contextFor() },
        react.createElement(
          GuardEventsContext.Provider,
          { value: events },
          react.createElement(TelemetryFeed),
        ),
      ),
    );
  });
  await act(async () => {
    await sleep(10);
  });
  return {
    rows: () =>
      Array.from(container.querySelectorAll<HTMLTableRowElement>("table.events tbody tr")),
    unmount: async () => {
      await act(async () => {
        root.unmount();
      });
      container.remove();
    },
  };
}

/** The Event cell's own text — the label, the SDK's one-line rendering, provenance. */
function eventCell(row: HTMLTableRowElement): HTMLElement {
  const cell = row.querySelector<HTMLElement>("td[data-label='Event']");
  assert.ok(cell, "the Event cell renders");
  return cell;
}

function provenanceCell(row: HTMLTableRowElement): HTMLElement {
  const line = row.querySelector<HTMLElement>("[data-testid='event-decode-provenance']");
  assert.ok(line, "the row states where its fields came from");
  return line;
}

test("a decoded row attributes its label to the decoder, in the cell that shows it", async () => {
  const rendered = await renderFeed([committed(5_268_439)]);
  try {
    const row = rendered.rows()[0]!;
    const line = provenanceCell(row);
    // The label is the SDK's wording, and the same cell says who produced it:
    // reading the label alone cannot leave an operator thinking it is a chain
    // value the event carried.
    assert.match(eventCell(row).textContent ?? "", /Authorization decision/);
    assert.match(
      line.textContent ?? "",
      new RegExp(`decoded by ${EVENT_DECODER.name} ${EVENT_DECODER.version}`),
    );
    // Chain bytes and interpretation are counted apart, and the gap count is
    // rendered even when it is zero — an uncounted row is not a clean row.
    assert.match(line.textContent ?? "", /4 raw · 5 decoded · 0 unknown/);
    assert.doesNotMatch(
      line.textContent ?? "",
      /soroban-rpc/,
      "the line names the decoder; each field's own source stays in the entries",
    );
  } finally {
    await rendered.unmount();
  }
});

test("a row with an unknown field says so in its text, and stops naming a fake reason", async () => {
  const rendered = await renderFeed([unexplainedRefusal()]);
  try {
    const row = rendered.rows()[0]!;
    const line = provenanceCell(row);
    assert.match(line.textContent ?? "", /· 4 unknown$/, "the count is in the visible text");
    assert.match(line.title, /decision\.reason/, "and the title names the field");
    assert.match(line.title, /ledger/);
    // The badge that used to read `blocked` — a word shaped like a reason code —
    // now says there is no reason, in the same place a reason belongs.
    const badge = row.querySelector(".pill.danger");
    assert.ok(badge, "a refusal keeps its danger badge");
    assert.equal(badge.textContent, "reason unknown");
    assert.doesNotMatch(eventCell(row).textContent ?? "", /per_tx_cap_exceeded/);
  } finally {
    await rendered.unmount();
  }
});

test("a row the feed could not pair with its bytes counts that as an unknown", async () => {
  const rendered = await renderFeed([withoutBytes()]);
  try {
    const line = provenanceCell(rendered.rows()[0]!);
    assert.match(line.textContent ?? "", /· 1 unknown$/);
    assert.match(line.title, /raw \(/);
  } finally {
    await rendered.unmount();
  }
});

test("an unrecognised topic is still shown, and marked as the raw symbol it is", async () => {
  const rendered = await renderFeed([unrecognisedTopic()]);
  try {
    const row = rendered.rows()[0]!;
    const line = provenanceCell(row);
    assert.match(eventCell(row).textContent ?? "", /event_something_new \(raw topic\)/);
    // Two unknowns, both of them things the row cannot answer: no decoded label
    // for the symbol, and no decision in an event the decoder did not classify.
    assert.match(line.textContent ?? "", /· 2 unknown$/);
    assert.match(line.title, /kind \(/);
    assert.match(line.title, /decision \(/);
  } finally {
    await rendered.unmount();
  }
});

test("provenance is on every row, so a decoded row is never the only one labelled", async () => {
  const rendered = await renderFeed([committed(5_268_439), unexplainedRefusal(), withoutBytes()]);
  try {
    assert.equal(rendered.rows().length, 3, "three distinct rows render");
    for (const row of rendered.rows()) {
      assert.match(
        provenanceCell(row).textContent ?? "",
        /decoded by stellar-agent-guard-sdk/,
        "each row states its own provenance",
      );
    }
  } finally {
    await rendered.unmount();
  }
});
