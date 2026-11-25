/**
 * Issue #484: the per-field provenance a telemetry row is rendered from.
 *
 * Pure functions over a `TelemetryEvent`, no DOM — what the panel does with the
 * list is pinned in `tests/unit/telemetryProvenancePanel.test.ts`. The cases
 * here are the ones the interface's honesty rests on: a decoded label must
 * never be counted as a chain value, and a value the decoder did not get must
 * be counted as unknown rather than folded into whichever branch is tidier.
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { test } from "node:test";
import * as sdk from "stellar-agent-guard-sdk";
import { GUARD_EVENT_TOPICS, explainReason, type GuardReason } from "stellar-agent-guard-sdk";
import {
  EVENT_DECODER,
  describeUnknownFields,
  provenanceForEvent,
  summarizeProvenance,
  type FieldOrigin,
  type FieldProvenance,
} from "../../lib/guard/decodeProvenance.ts";
import type { RawEventXdr, TelemetryEvent } from "../../lib/guard/telemetry.ts";
import { withIdentity, type BareGuardEvent } from "../mocks/eventFixtures.ts";

const GUARD = "CAYJZT4XH5SWDXNR7MZJCCUBIDAT2KZDDUTZ7OZQEMKCPJGD4P3X4CU7";

/** The bytes `attachLedgerXdr` pairs onto a committed row. */
const LEDGER_XDR: RawEventXdr = {
  eventId: "0000000526843904000-0000000001",
  topicXdr: ["AAAACAAAAAVldmVudA==", "AAAACAAAAAVhbGxvdw=="],
  valueXdr: "AAAAAAAAAAE=",
  diagnosticEventXdr: null,
  inSuccessfulContractCall: true,
};

/** The bytes `refusedEventsFromDiagnostics` pairs onto a pre-broadcast refusal. */
const DIAGNOSTIC_XDR: RawEventXdr = {
  eventId: null,
  topicXdr: ["AAAACAAAAAVldmVudA=="],
  valueXdr: null,
  diagnosticEventXdr: "AAAAQQEAAAAB",
  inSuccessfulContractCall: false,
};

/**
 * An event in the shape the panel actually receives: the SDK's decoded fields
 * plus the identity fields `withIdentity` derives, so the fixture de-duplicates
 * and renders exactly as a live row does.
 */
function event(overrides: Partial<TelemetryEvent> = {}): TelemetryEvent {
  const base: BareGuardEvent = {
    kind: "auth_checked",
    topic: GUARD_EVENT_TOPICS.authChecked,
    source: "ledger",
    contractId: GUARD,
    ledger: 5_268_439,
    ledgerClosedAt: "2026-09-25T10:00:00.000Z",
    transactionHash: "a".repeat(64),
    decision: { result: "allowed", reason: null, source: "ledger" },
    data: {},
  };
  return withIdentity({ ...base, ...overrides });
}

function originOf(list: readonly FieldProvenance[], field: string): FieldOrigin | undefined {
  return list.find((entry) => entry.field === field)?.origin;
}

function unknownFields(list: readonly FieldProvenance[]): string[] {
  return list.filter((entry) => entry.origin === "unknown").map((entry) => entry.field);
}

function detailOf(list: readonly FieldProvenance[], field: string): string | undefined {
  return list.find((entry) => entry.field === field)?.detail;
}

// ── Raw versus decoded ──────────────────────────────────────────────────────

test("a row with everything present separates chain bytes from decoded labels, and has no unknowns", () => {
  const list = provenanceForEvent(event({ raw: LEDGER_XDR }));
  assert.deepEqual(
    unknownFields(list),
    [],
    "nothing is missing, so nothing may be counted unknown",
  );
  for (const field of ["ledger", "ledgerClosedAt", "transactionHash", "raw"]) {
    assert.equal(originOf(list, field), "raw", `${field} is readable off the chain`);
    assert.equal(
      list.find((entry) => entry.field === field)?.source,
      "soroban-rpc",
      `${field} names the RPC as its source`,
    );
  }
  for (const field of ["kind", "topic", "decision", "contractId"]) {
    assert.equal(
      originOf(list, field),
      "decoded",
      `${field} is the SDK's interpretation, not a chain value`,
    );
    assert.equal(
      list.find((entry) => entry.field === field)?.source,
      `${EVENT_DECODER.name} ${EVENT_DECODER.version}`,
      `${field} names the decoder and its version`,
    );
  }
});

test("the timestamp the Time cell shows is reported apart from the clock that stamped it", () => {
  // Both fields are listed because the cell renders `ledgerClosedAt ??
  // observedAt` and says nothing about which one an operator is looking at.
  const closed = provenanceForEvent(event({ raw: LEDGER_XDR }));
  assert.equal(originOf(closed, "ledgerClosedAt"), "raw");
  assert.equal(originOf(closed, "observedAt"), "decoded");
  assert.equal(
    closed.find((entry) => entry.field === "observedAt")?.source,
    "this console's clock",
  );

  const observedOnly = provenanceForEvent(event({ ledgerClosedAt: null, raw: DIAGNOSTIC_XDR }));
  assert.equal(originOf(observedOnly, "ledgerClosedAt"), "unknown");
  assert.equal(originOf(observedOnly, "observedAt"), "decoded");
});

test("event.raw present versus absent changes which fields count as raw", () => {
  const withRaw = provenanceForEvent(event({ raw: LEDGER_XDR }));
  const withoutRaw = provenanceForEvent(event());
  assert.equal(originOf(withRaw, "raw"), "raw");
  assert.equal(originOf(withoutRaw, "raw"), "unknown");
  assert.match(
    detailOf(withoutRaw, "raw") ?? "",
    /cannot be re-decoded/,
    "the detail says what the absence costs, not just that it is absent",
  );
  // The decoded fields do not change origin with the bytes: they were never raw.
  assert.equal(originOf(withoutRaw, "decision"), originOf(withRaw, "decision"));
  assert.equal(originOf(withoutRaw, "ledger"), "raw", "the ledger came from the page either way");
});

test("the XDR of a pre-broadcast refusal is named as a diagnostic, not as a ledger page", () => {
  const list = provenanceForEvent(event({ raw: DIAGNOSTIC_XDR }));
  assert.equal(originOf(list, "raw"), "raw");
  assert.match(detailOf(list, "raw") ?? "", /DiagnosticEvent/);
  assert.doesNotMatch(detailOf(list, "raw") ?? "", /getEvents/);
});

// ── Unknowns, including the ones the renderer used to hide ──────────────────

test("a refusal with no decoded reason names decision.reason as unknown", () => {
  // The shape behind the `?? "blocked"` the row used to render: the badge had
  // text, the decoder had nothing.
  const list = provenanceForEvent(
    event({
      source: "diagnostic",
      ledger: null,
      ledgerClosedAt: null,
      transactionHash: null,
      raw: DIAGNOSTIC_XDR,
      decision: { result: "blocked", reason: null, source: "diagnostic" },
    }),
  );
  assert.equal(originOf(list, "decision.reason"), "unknown");
  assert.match(detailOf(list, "decision.reason") ?? "", /reason/);
  assert.deepEqual(unknownFields(list), [
    "decision.reason",
    "ledger",
    "ledgerClosedAt",
    "transactionHash",
  ]);
});

test("an allowed decision is not reported as missing a reason it legitimately has not got", () => {
  // `decodeAuthDecision` normalises the contract's empty reason symbol to null,
  // and the row renders no reason for an allow. A field that is not displayed
  // gets no entry, so an allow does not arrive at a reviewer as a gap.
  const list = provenanceForEvent(event({ raw: LEDGER_XDR }));
  assert.equal(
    list.find((entry) => entry.field === "decision.reason"),
    undefined,
  );
});

test("a decision the decoder did not produce is unknown, while its reason is not invented", () => {
  const list = provenanceForEvent(event({ decision: null, raw: LEDGER_XDR }));
  assert.equal(originOf(list, "decision"), "unknown");
  assert.equal(
    list.find((entry) => entry.field === "decision.reason"),
    undefined,
    "no reason is claimed for an event with no decision",
  );
});

test("a topic outside the decoder's kind table is unknown and shown as the raw symbol", () => {
  const list = provenanceForEvent(event({ kind: "unknown", topic: "event_something_new" }));
  assert.equal(originOf(list, "kind"), "unknown");
  assert.match(
    detailOf(list, "kind") ?? "",
    /event_something_new/,
    "the detail names the symbol the row falls back to",
  );
});

test("the SDK's `?` placeholder is classified unknown, not decoded", () => {
  // `describeGuardEvent` renders `?` for a field it does not have; a field that
  // carries one must not be tallied as an answer anywhere else either.
  const list = provenanceForEvent(event({ topic: "?" }));
  assert.equal(originOf(list, "topic"), "unknown");
});

test("`unknown contract` is classified unknown, not decoded", () => {
  const list = provenanceForEvent(event({ contractId: "unknown contract" }));
  assert.equal(originOf(list, "contractId"), "unknown");
  const missing = provenanceForEvent(event({ contractId: null }));
  assert.equal(originOf(missing, "contractId"), "unknown");
});

test("a reason outside the contract vocabulary is unknown even though it renders as text", () => {
  // Both forms the SDK produces for this failure: `explainReason`'s sentence and
  // `reasonName`'s `unknown_reason_<code>` stand-in.
  const drifted = "not_a_real_reason" as GuardReason;
  const list = provenanceForEvent(
    event({
      raw: DIAGNOSTIC_XDR,
      decision: { result: "blocked", reason: drifted, source: "diagnostic" },
    }),
  );
  assert.equal(originOf(list, "decision.reason"), "unknown");
  assert.match(
    detailOf(list, "decision.reason") ?? "",
    /vocabulary/,
    "the detail says why the shown explanation is not an answer",
  );
  const placeholder = provenanceForEvent(
    event({
      raw: DIAGNOSTIC_XDR,
      decision: {
        result: "blocked",
        reason: "unknown_reason_99" as GuardReason,
        source: "diagnostic",
      },
    }),
  );
  assert.equal(originOf(placeholder, "decision.reason"), "unknown");
  // Proof the text really is the SDK's unrecognised-reason rendering.
  assert.match(explainReason(drifted), /^Unrecognised guard reason:/);
});

// ── The two renderings the row uses ────────────────────────────────────────

test("the summary names the decoder build and counts every origin, including zero unknowns", () => {
  assert.equal(
    summarizeProvenance(provenanceForEvent(event({ raw: LEDGER_XDR }))),
    `decoded by ${EVENT_DECODER.name} ${EVENT_DECODER.version} · 4 raw · 5 decoded · 0 unknown`,
  );
});

test("the summary renders the unknown count instead of dropping it when a field is missing", () => {
  const line = summarizeProvenance(provenanceForEvent(event()));
  assert.match(line, /· 1 unknown$/, "the missing XDR is counted out loud");
  assert.match(line, /stellar-agent-guard-sdk/, "and the decoder is still named");
});

test("the title names the unknown fields, and says so when there are none", () => {
  assert.equal(
    describeUnknownFields(provenanceForEvent(event({ raw: LEDGER_XDR }))),
    "no unknown fields on this row",
  );
  const title = describeUnknownFields(
    provenanceForEvent(
      event({
        source: "diagnostic",
        ledger: null,
        transactionHash: null,
        raw: DIAGNOSTIC_XDR,
        decision: { result: "blocked", reason: null, source: "diagnostic" },
      }),
    ),
  );
  assert.match(title, /^unknown: /);
  assert.match(title, /decision\.reason \(/);
  assert.match(title, /ledger \(/);
});

// ── The anti-rot pins on EVENT_DECODER ─────────────────────────────────────

test("the displayed decoder version is the version of the package that is actually installed", () => {
  // The bundle cannot read this manifest (it is not in the SDK's `exports` map),
  // which is exactly why the literal in `decodeProvenance.ts` needs pinning:
  // without it, an SDK bump would keep showing the old version as fact.
  const manifest = JSON.parse(
    readFileSync(
      new URL("../../node_modules/stellar-agent-guard-sdk/package.json", import.meta.url),
      "utf8",
    ),
  ) as { name: string; version: string };
  assert.equal(EVENT_DECODER.name, manifest.name);
  assert.equal(
    EVENT_DECODER.version,
    manifest.version,
    `the row claims ${EVENT_DECODER.version} but node_modules holds ${manifest.version}`,
  );
});

test("the named decoder artifact exists and carries the same version", () => {
  assert.match(EVENT_DECODER.artifact, new RegExp(`-${EVENT_DECODER.version}\\.tgz$`));
  assert.ok(
    existsSync(new URL(`../../${EVENT_DECODER.artifact}`, import.meta.url)),
    `${EVENT_DECODER.artifact} is what package.json installs the SDK from`,
  );
});

test("the SDK still exposes no runtime version, which is why the literal is needed", () => {
  // If an upstream release adds one, this fails and the fix is to import it here
  // and delete the constant's pin — not to leave two version numbers in the tree.
  assert.deepEqual(
    Object.keys(sdk).filter((name) => /version/i.test(name)),
    [],
    "a runtime version would make the literal rot silently instead of loudly",
  );
});
