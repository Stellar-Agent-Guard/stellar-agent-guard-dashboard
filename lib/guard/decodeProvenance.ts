/**
 * Where each value on a telemetry row came from, and which ones are not known.
 *
 * A feed row mixes two very different kinds of value. `ledger`,
 * `transactionHash` and the event's own XDR are things the chain said.
 * "Authorization decision", `blocked` and `per_tx_cap_exceeded` are things
 * `stellar-agent-guard-sdk` *concluded* from the event's topic symbols
 * (`dist/telemetry.js` `interpret()` and `dist/events.js` `decodeAuthDecision()`).
 * Rendering the second kind with the confidence of the first is how an
 * interface ends up stating something false without ever saying it — so this
 * module splits them per field, from what the event actually holds.
 *
 * Three origins, and one question that decides between them ("could a reviewer
 * get this from the chain bytes without this console?"):
 *
 * - `raw` — yes: the ledger sequence, close time and transaction hash the
 *   `getEvents` page carried, and the retained XDR itself.
 * - `decoded` — no, and a program produced it: the SDK's `kind`, `decision`
 *   and `contractId`, plus this console's own `observedAt` stamp. `source` says
 *   *which* program, because the SDK and this console are not the same
 *   authority over a value.
 * - `unknown` — the value is absent, null, or one of the SDK's placeholders
 *   standing in for a field it did not get. Placeholders never count as
 *   `decoded`: they render like answers, and that is the exact failure this
 *   file exists to make visible.
 *
 * An entry is emitted only for a field the row displays. That is what keeps an
 * *allowed* decision from reporting an unknown reason it legitimately does not
 * have (`decodeAuthDecision` normalises the contract's empty reason symbol to
 * `null`; the live-capture fixture `tests/fixtures/auth-checked-vocabulary.json`
 * documents that shape) while a *blocked* decision with no reason symbol does
 * report one — that cell has to show a reason and cannot.
 */

import { isGuardReason } from "stellar-agent-guard-sdk";
import type { TelemetryEvent } from "./telemetry.ts";

/**
 * The decoder these rows' labels are trusted to.
 *
 * The version is a literal, not an import: the vendored SDK publishes no
 * runtime version constant (nothing in `dist/*.js` carries one) and its
 * `exports` map exposes only `./dist/index.js`, so a browser bundle cannot read
 * the installed package's own `package.json`. That makes this literal the only
 * place the number lives in client code, which is also the only place it can
 * rot: `tests/unit/decodeProvenance.test.ts` pins it against the installed
 * package's manifest, so the version shown to an operator cannot quietly drift
 * away from the code that actually decoded the row.
 */
export const EVENT_DECODER = {
  name: "stellar-agent-guard-sdk",
  version: "0.1.1",
  artifact: "vendor/stellar-agent-guard-sdk-0.1.1.tgz",
} as const;

/** `raw` from the chain, `decoded` by a program, `unknown` because there is no value. */
export type FieldOrigin = "raw" | "decoded" | "unknown";

/** One displayed field on one row, and what can honestly be said about its origin. */
export interface FieldProvenance {
  /** The event field, named as the SDK names it, so a reviewer can look it up. */
  field: string;
  origin: FieldOrigin;
  /** Who produced the value; `NO_SOURCE` when nothing did. */
  source: string;
  /** Set on every `unknown` entry, and wherever a raw/decoded claim needs qualifying. */
  detail?: string;
}

/** How the decoder is named to an operator: name plus the build that ran. */
const DECODER_SOURCE = `${EVENT_DECODER.name} ${EVENT_DECODER.version}`;
/** The RPC is the origin of every `raw` value, committed page or simulation. */
const RPC_SOURCE = "soroban-rpc";
/** `observedAt` is this tab's wall clock, not a chain fact and not the SDK's. */
const CLOCK_SOURCE = "this console's clock";
/** An unknown has no producer, so it names none instead of guessing one. */
const NO_SOURCE = "unknown";

/**
 * Strings the decoder puts in place of a value it does not have. Each one reads
 * like an answer, which is why a field holding one is `unknown`, not `decoded`.
 *
 * - `?` — `describeGuardEvent`'s placeholder for a missing ledger or decision
 *   (`stellar-agent-guard-sdk`, `dist/telemetry.js`).
 * - `unknown contract` — this panel's own fallback text for a guard address the
 *   event did not identify (`components/TelemetryFeed.tsx`).
 * - `Unrecognised guard reason: …` — `explainReason`'s answer for a reason
 *   outside the contract vocabulary, and `unknown_reason_<code>` the same
 *   failure one level earlier (`dist/reasons.js`).
 */
function isPlaceholder(value: string): boolean {
  return (
    value === "?" ||
    value === "unknown contract" ||
    value.startsWith("Unrecognised guard reason:") ||
    value.startsWith("unknown_reason_")
  );
}

function unknown(field: string, detail: string): FieldProvenance {
  return { field, origin: "unknown", source: NO_SOURCE, detail };
}

/**
 * Per-field provenance for one row, computed from the event in front of us.
 *
 * Nothing here is inferred from the event *kind*: a heartbeat and a decision
 * differ in which fields exist, and this reads the fields themselves, so a row
 * that lost its ledger says so even if it arrived as an `auth_checked`.
 */
export function provenanceForEvent(event: TelemetryEvent): FieldProvenance[] {
  const fields: FieldProvenance[] = [];

  // `kind` is the decoder's label for the topic symbol. `unknown` is the SDK's
  // own verdict that the symbol is not in its `KIND_BY_TOPIC` table, which is
  // why the row then shows the raw symbol as its heading instead.
  if (event.kind === "unknown") {
    fields.push(
      unknown(
        "kind",
        `the decoder has no label for the topic symbol ${event.topic}; the row shows it raw`,
      ),
    );
  } else {
    fields.push({ field: "kind", origin: "decoded", source: DECODER_SOURCE });
  }

  if (isPlaceholder(event.topic)) {
    fields.push(unknown("topic", "the topic symbol is a placeholder, not a chain symbol"));
  } else {
    fields.push({
      field: "topic",
      origin: "decoded",
      source: DECODER_SOURCE,
      detail: "the symbol is taken verbatim from the event's topic XDR",
    });
  }

  const decision = event.decision;
  if (decision === null) {
    fields.push(unknown("decision", "no decision was decoded from this event's topics"));
  } else {
    fields.push({ field: "decision", origin: "decoded", source: DECODER_SOURCE });
    // The reason is only displayed for a refusal, so it is only a displayed
    // field — and only checkable — for one.
    if (decision.result === "blocked") {
      const reason: string | null = decision.reason;
      if (reason === null) {
        fields.push(
          unknown("decision.reason", "the refusal carries no reason symbol, so the why is unknown"),
        );
      } else if (!isGuardReason(reason) || isPlaceholder(reason)) {
        fields.push(
          unknown(
            "decision.reason",
            `${reason} is outside the contract's reason vocabulary, so the explanation shown is the SDK's unrecognised-reason text`,
          ),
        );
      } else {
        fields.push({ field: "decision.reason", origin: "decoded", source: DECODER_SOURCE });
      }
    }
  }

  if (event.contractId === null || isPlaceholder(event.contractId)) {
    fields.push(unknown("contractId", "the event does not identify the guard that emitted it"));
  } else {
    fields.push({
      field: "contractId",
      origin: "decoded",
      source: DECODER_SOURCE,
      detail: "the guard from the decode context, not a value read out of the event body",
    });
  }

  if (event.ledger === null) {
    fields.push(
      unknown(
        "ledger",
        event.source === "diagnostic"
          ? "never broadcast, so there is no ledger to name"
          : "the RPC page carried no ledger sequence",
      ),
    );
  } else {
    fields.push({ field: "ledger", origin: "raw", source: RPC_SOURCE });
  }

  if (event.ledgerClosedAt === null) {
    fields.push(
      unknown(
        "ledgerClosedAt",
        event.source === "diagnostic"
          ? "a refused simulation has no ledger close time"
          : "the RPC page carried no close time",
      ),
    );
  } else {
    fields.push({ field: "ledgerClosedAt", origin: "raw", source: RPC_SOURCE });
  }

  // The Time cell shows `ledgerClosedAt ?? observedAt`, so the instant an
  // operator reads is a chain fact on a committed row and this tab's clock on
  // any other. Both fields are listed because the cell does not say which it is.
  if (event.observedAt === null || event.observedAt === undefined) {
    fields.push(unknown("observedAt", "this console did not stamp when it saw the event"));
  } else {
    fields.push({ field: "observedAt", origin: "decoded", source: CLOCK_SOURCE });
  }

  if (event.transactionHash === null) {
    fields.push(
      unknown(
        "transactionHash",
        event.source === "diagnostic"
          ? "the refusal rolled back before broadcast, so no transaction exists"
          : "the RPC page carried no transaction hash",
      ),
    );
  } else {
    fields.push({ field: "transactionHash", origin: "raw", source: RPC_SOURCE });
  }

  const raw = event.raw;
  if (raw === null || raw === undefined) {
    fields.push(
      unknown(
        "raw",
        "the original event bytes are not on this row, so its decoded fields cannot be re-decoded independently",
      ),
    );
  } else {
    fields.push({
      field: "raw",
      origin: "raw",
      source: RPC_SOURCE,
      detail:
        raw.diagnosticEventXdr !== null
          ? "the refused simulation's `DiagnosticEvent` bytes"
          : "the `getEvents` page bytes, re-decodable independently",
    });
  }

  return fields;
}

/**
 * The one-line provenance a dense row can carry: who decoded it, and how many
 * of its displayed fields split between chain bytes, decoding, and nothing.
 *
 * The unknown count is always rendered, including when it is zero. Omitting it
 * in the clean case would make an uncounted row indistinguishable from a row
 * whose gaps were simply not looked for.
 */
export function summarizeProvenance(list: readonly FieldProvenance[]): string {
  const count = (origin: FieldOrigin): number =>
    list.reduce((seen, entry) => (entry.origin === origin ? seen + 1 : seen), 0);
  return `decoded by ${DECODER_SOURCE} · ${count("raw")} raw · ${count("decoded")} decoded · ${count("unknown")} unknown`;
}

/**
 * The row's `title`: which fields are unknown, and what exactly is missing.
 *
 * The count is in the visible line and the reason is in here, so a row stays
 * one line long while the gap an operator needs to report is still reachable
 * without leaving the table.
 */
export function describeUnknownFields(list: readonly FieldProvenance[]): string {
  const gaps = list.filter((entry) => entry.origin === "unknown");
  if (gaps.length === 0) return "no unknown fields on this row";
  return `unknown: ${gaps.map((entry) => `${entry.field} (${entry.detail ?? "no value"})`).join("; ")}`;
}
