/**
 * Telemetry: the guard's own events, from the two places they can exist.
 *
 * The part that is easy to get wrong, and which this module is shaped around: a
 * refused decision never reaches the ledger. The guard returns `Err`, which rolls
 * the event back, so a listener that only tails committed ledger events sees a
 * contract that appears to approve everything. The two sources are:
 *
 *   1. **ledger events** — allowed decisions, heartbeats, and the admin lifecycle
 *      events, tailed from `getEvents` with a cursor
 *      (`GuardTelemetryListener`, from the SDK).
 *   2. **simulation diagnostics** — refused decisions, which by construction have
 *      no transaction. The only place these arise in this dashboard is a write the
 *      operator attempted and the enforced simulation refused; the SDK's
 *      `guardEventsFromDiagnostics` decodes exactly those, and they are labelled
 *      `diagnostic` in the feed so they are never mistaken for settled history.
 *
 * "Real time" here means cursor-based polling of `getEvents`, because Soroban RPC
 * offers no push stream. The floor on latency is the ledger close interval, so
 * the feed reports the latest ledger it has seen rather than implying it is
 * instantaneous.
 */

import { GuardTelemetryListener, guardEventsFromDiagnostics, topicSymbols } from "stellar-agent-guard-sdk";
import type { GuardEvent } from "stellar-agent-guard-sdk";
import { scValToNative, xdr, type rpc } from "@stellar/stellar-sdk";
import { NETWORK } from "./network.ts";

/**
 * The event exactly as the chain encoded it, kept next to the SDK's decoding.
 *
 * The SDK's `GuardEvent` is a decoded view and drops the XDR. An audit export
 * needs the original bytes, so a reviewer can re-decode them independently
 * instead of trusting this console's decoder. Every field is base64 XDR or an
 * RPC identifier, so it is stored as the RPC returned it.
 */
export interface RawEventXdr {
  /** stellar-rpc's event id (TOID-based, usable as a cursor); null for diagnostics. */
  eventId: string | null;
  /** Each topic as base64 `ScVal` XDR, in order. */
  topicXdr: string[];
  /** The event body as base64 `ScVal` XDR. */
  valueXdr: string | null;
  /** The whole `DiagnosticEvent` as base64 XDR, for refusals decoded from a simulation. */
  diagnosticEventXdr: string | null;
  inSuccessfulContractCall: boolean | null;
}

/** A decoded guard event plus the raw XDR it came from and when this console saw it. */
export type TelemetryEvent = GuardEvent & {
  raw?: RawEventXdr | null;
  /** ISO time this console decoded the event: the only timestamp a diagnostic has. */
  observedAt?: string;
};

export interface TelemetryPage {
  events: TelemetryEvent[];
  cursor: string;
  latestLedger: number;
}

/**
 * A cursor-carrying reader over one guard's event stream.
 *
 * The cursor is held here rather than re-derived from a ledger number on every
 * poll, because `getEvents` pagination is only stable while a cursor is carried
 * forward — re-scanning from a ledger can miss events that fell outside the
 * window between polls.
 */
/**
 * Note the explicit field declarations rather than constructor parameter
 * properties: this module is loaded by `node --test` and by the proof script
 * through Node's type-stripping loader, which rejects parameter properties
 * outright. Keeping the whole library strippable means the browser, the test
 * runner and the proof script execute the same source rather than three builds
 * of it.
 */
export class GuardFeed {
  readonly guard: string;
  private readonly listener: GuardTelemetryListener;
  private cursor: string | null = null;
  private latestLedger: number | null = null;

  /** The raw `getEvents` page behind the most recent poll, captured for `raw`. */
  private lastRawEvents: readonly rpc.Api.EventResponse[] = [];

  constructor(server: rpc.Server, guard: string, rpcUrl: string = NETWORK.rpcUrl) {
    this.guard = guard;
    // The listener decodes and discards the XDR. Hand it a view of the server
    // whose `getEvents` also records the raw page, so the export can carry the
    // original bytes without re-implementing the SDK's decoding here.
    const recording = Object.create(server) as rpc.Server;
    recording.getEvents = async (request) => {
      const response = await server.getEvents(request);
      this.lastRawEvents = response.events;
      return response;
    };
    this.listener = new GuardTelemetryListener({ server: recording, guard, rpcUrl });
  }

  /** One page of committed ledger events. Advances the cursor. */
  async pollOnce(limit = 50): Promise<TelemetryPage> {
    const params: { cursor?: string; limit: number; startLedger?: number } = { limit };
    if (this.cursor) {
      params.cursor = this.cursor;
    } else if (this.latestLedger !== null) {
      params.startLedger = this.latestLedger;
    }
    this.lastRawEvents = [];
    const decoded = await this.listener.poll(params);
    const page = { ...decoded, events: attachLedgerXdr(decoded.events, this.lastRawEvents) };
    // A page with no events still advances the ledger pointer, so the next poll
    // does not re-scan a stretch of empty ledgers.
    this.latestLedger = Math.max(this.latestLedger ?? 0, page.latestLedger);
    if (page.cursor) this.cursor = page.cursor;
    return page;
  }

  /** Where the feed currently is, for display. */
  position(): { cursor: string | null; latestLedger: number | null } {
    return { cursor: this.cursor, latestLedger: this.latestLedger };
  }

  /** Forget the cursor so the feed re-scans from a given ledger. */
  resetFrom(ledger: number | null): void {
    this.cursor = null;
    this.latestLedger = ledger;
  }
}

/**
 * Decode refused-decision events out of an attempted write's diagnostics.
 *
 * These are the only refused decisions this interface can ever see, and they are
 * returned with `source: "diagnostic"` so the feed can say plainly that they were
 * never committed — a distinction that matters, because a rolled-back event is
 * evidence of a refusal, not of settled state.
 */
export function refusedEventsFromDiagnostics(
  diagnosticEvents: readonly unknown[],
  guard: string,
): TelemetryEvent[] {
  // Some RPC paths hand back base64 strings rather than decoded events; the
  // SDK's decoder only reads decoded ones, so normalise first.
  const normalised = diagnosticEvents.map(decodeIfBase64);
  const decoded = guardEventsFromDiagnostics(normalised, guard);
  const observedAt = new Date().toISOString();
  // The SDK skips events whose topics it does not recognise but keeps the
  // order of the rest, so walk both lists together and pair them by name topic.
  let cursor = 0;
  return decoded.map((event) => {
    while (cursor < normalised.length) {
      const candidate = normalised[cursor++];
      if (topicSymbols(candidate)[0] === event.topic) {
        return { ...event, observedAt, raw: diagnosticXdr(candidate) };
      }
    }
    return { ...event, observedAt, raw: null };
  });
}

/**
 * Pair decoded ledger events with the raw page they came from.
 *
 * The listener drops unrecognised topics but keeps the order of the rest, so a
 * single forward walk matching ledger, transaction and name topic lines the two
 * lists up.
 */
export function attachLedgerXdr(
  decoded: readonly GuardEvent[],
  raw: readonly rpc.Api.EventResponse[],
): TelemetryEvent[] {
  const observedAt = new Date().toISOString();
  let cursor = 0;
  return decoded.map((event) => {
    while (cursor < raw.length) {
      const candidate = raw[cursor++]!;
      if (
        candidate.ledger === event.ledger &&
        (candidate.txHash ?? null) === event.transactionHash &&
        firstTopic(candidate) === event.topic
      ) {
        return {
          ...event,
          observedAt,
          raw: {
            eventId: candidate.id,
            topicXdr: candidate.topic.map((topic) => topic.toXDR("base64")),
            valueXdr: candidate.value.toXDR("base64"),
            diagnosticEventXdr: null,
            inSuccessfulContractCall: candidate.inSuccessfulContractCall ?? null,
          },
        };
      }
    }
    return { ...event, observedAt, raw: null };
  });
}

function firstTopic(event: rpc.Api.EventResponse): string | null {
  const [first] = event.topic;
  if (!first) return null;
  try {
    return String(scValToNative(first));
  } catch {
    return null;
  }
}

function decodeIfBase64(value: unknown): unknown {
  if (typeof value !== "string") return value;
  try {
    return xdr.DiagnosticEvent.fromXDR(value, "base64");
  } catch {
    return value;
  }
}

interface XdrEncodable {
  toXDR(format: "base64"): string;
}

function isXdrEncodable(value: unknown): value is XdrEncodable {
  return typeof (value as XdrEncodable | null)?.toXDR === "function";
}

/** Raw XDR for one diagnostic event, whether it arrived decoded or as base64. */
function diagnosticXdr(value: unknown): RawEventXdr | null {
  try {
    const event =
      typeof value === "string" ? xdr.DiagnosticEvent.fromXDR(value, "base64") : value;
    if (!(event instanceof xdr.DiagnosticEvent)) {
      return isXdrEncodable(value)
        ? { eventId: null, topicXdr: [], valueXdr: null, diagnosticEventXdr: value.toXDR("base64"), inSuccessfulContractCall: null }
        : null;
    }
    const body = event.event.body.v0;
    return {
      eventId: null,
      topicXdr: body.topics.map((topic) => topic.toXDR("base64")),
      valueXdr: body.data.toXDR("base64"),
      diagnosticEventXdr: event.toXDR("base64"),
      inSuccessfulContractCall: event.inSuccessfulContractCall,
    };
  } catch {
    return null;
  }
}
