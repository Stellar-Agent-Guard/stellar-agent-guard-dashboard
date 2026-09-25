"use client";

import { useMemo, useState } from "react";
import { describeGuardEvent, explainReason } from "stellar-agent-guard-sdk";
import type { GuardEvent } from "stellar-agent-guard-sdk";
import {
  NDJSON_MIME,
  NO_TELEMETRY_FILTER,
  filterTelemetry,
  isFilterActive,
  ndjsonFilename,
  telemetryToNdjson,
  type SourceFilter,
  type TelemetryFilter,
  type VerdictFilter,
} from "../lib/guard/exportFormats.ts";
import { NETWORK } from "../lib/guard/network.ts";
import type { TelemetryEvent } from "../lib/guard/telemetry.ts";
import { useAnnounce } from "../lib/guard/useAnnounce.ts";
import { useDemoMode } from "../lib/guard/useDemoMode.ts";
import { useGuard } from "./GuardProvider.tsx";
import { ErrorBlock, relativeTime, short, starLink } from "./bits.tsx";

/**
 * The live event feed.
 *
 * Two things are stated on the panel rather than glossed over, because both
 * change how the feed should be read:
 *
 *   - Soroban RPC has no push stream, so this polls `getEvents` with a cursor and
 *     the real latency floor is the ledger close interval, not the poll interval.
 *   - A *refused* decision never becomes a transaction: the guard returns `Err`,
 *     which rolls the event back. So the feed can only carry refused decisions
 *     that this console produced itself, decoded from the enforced simulation's
 *     diagnostics and labelled `diagnostic`. Absence of refusals here does not
 *     mean absence of refusals on chain.
 */
export function TelemetryFeed() {
  const { events, feed, startWatching, stopWatching, clearEvents, guard } = useGuard();
  const announce = useAnnounce();
  const demo = useDemoMode();
  const [filter, setFilter] = useState<TelemetryFilter>(NO_TELEMETRY_FILTER);
  const filtered = useMemo(() => filterTelemetry(events, filter), [events, filter]);
  const filterActive = isFilterActive(filter);

  /**
   * Download the feed as an NDJSON audit log. With a filter active, the default
   * export is what is on screen; "full buffer" ignores the filter.
   */
  function exportNdjson(scope: "view" | "full") {
    const selected: TelemetryEvent[] = scope === "full" ? events : filtered;
    const appliedFilter = scope === "full" ? NO_TELEMETRY_FILTER : filter;
    const exportedAt = new Date();
    const body = telemetryToNdjson({
      events: selected,
      bufferedCount: events.length,
      guard,
      network: NETWORK.name,
      filter: appliedFilter,
      latestLedger: feed.latestLedger,
      demo,
      exportedAt,
    });
    const blob = new Blob([body], { type: `${NDJSON_MIME};charset=utf-8` });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = ndjsonFilename(exportedAt, isFilterActive(appliedFilter) ? "filtered" : "full");
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    announce(`Exported ${selected.length} event${selected.length === 1 ? "" : "s"} as NDJSON`);
  }

  return (
    <div className="panel">
      <div className="row" style={{ justifyContent: "space-between" }}>
        <h2 style={{ margin: 0 }}>Telemetry</h2>
        <div className="row">
          {feed.watching && <span className="pill ok">polling</span>}
          {feed.latestLedger !== null && <span className="tiny muted">ledger {feed.latestLedger}</span>}
          {feed.watching ? (
            <button className="secondary" onClick={stopWatching}>
              Stop
            </button>
          ) : (
            <button onClick={startWatching}>Start watching</button>
          )}
          <button className="secondary" onClick={clearEvents} disabled={events.length === 0}>
            Clear
          </button>
        </div>
      </div>

      <div className="row" style={{ marginTop: 12, flexWrap: "wrap", gap: 8 }}>
        <label className="tiny">
          Decision{" "}
          <select
            value={filter.verdict}
            onChange={(event) => setFilter((current) => ({ ...current, verdict: event.target.value as VerdictFilter }))}
          >
            <option value="all">All events</option>
            <option value="allowed">Allowed</option>
            <option value="blocked">Blocked</option>
            <option value="none">No decision (lifecycle)</option>
          </select>
        </label>
        <label className="tiny">
          Source{" "}
          <select
            value={filter.source}
            onChange={(event) => setFilter((current) => ({ ...current, source: event.target.value as SourceFilter }))}
          >
            <option value="all">Ledger and diagnostic</option>
            <option value="ledger">Ledger only</option>
            <option value="diagnostic">Diagnostic only</option>
          </select>
        </label>
        <button
          className="secondary"
          onClick={() => exportNdjson("view")}
          disabled={filtered.length === 0}
          title="One JSON object per line: decoded fields, verdict, ledger, transaction hash and the raw event XDR"
        >
          Export NDJSON{filterActive ? ` (${filtered.length} shown)` : ""}
        </button>
        {filterActive && (
          <button className="secondary" onClick={() => exportNdjson("full")} disabled={events.length === 0}>
            Export full buffer ({events.length})
          </button>
        )}
      </div>

      <p className="tiny muted" style={{ marginTop: 8 }}>
        Tailed from Soroban RPC&apos;s <code>getEvents</code> with a cursor, so no event is delivered
        twice and none is skipped between polls. Soroban has no push stream — the floor on latency is
        the ledger close interval (roughly 5s), not the 5s poll.
        {feed.lastPolledAt && ` Last poll ${relativeTime(feed.lastPolledAt)}.`}
      </p>

      <div className="notice info">
        <strong>Refused decisions cannot reach this feed from the ledger</strong>
        <span className="tiny">
          When the guard refuses a call it returns an error, which rolls the event back — so a
          refused decision has no transaction and no committed event. Rows marked{" "}
          <em>diagnostic</em> are the refusals this console produced itself, decoded from the failed
          enforced simulation before broadcast. An empty feed is not evidence that nothing was
          refused on chain.
        </span>
      </div>

      {feed.error && <ErrorBlock title="The event feed could not poll" detail={feed.error} />}

      {events.length > 0 && filtered.length === 0 ? (
        <p className="tiny muted">No buffered events match this filter.</p>
      ) : events.length === 0 ? (
        <p className="tiny muted">
          {feed.watching
            ? "No events from this guard yet. Lifecycle events (policy set, frozen, heartbeat) and allowed decisions appear here as they settle."
            : "Start watching to tail this guard's events."}
        </p>
      ) : (
        <div className="scrolly">
          <table className="events">
            <thead>
              <tr>
                <th>Event</th>
                <th>Decision</th>
                <th>Source</th>
                <th>Ledger</th>
                <th>Transaction</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((event, index) => (
                <tr key={`${event.topic}-${event.transactionHash ?? "-"}-${event.ledger ?? "-"}-${index}`}>
                  <td>
                    <div>{labelFor(event)}</div>
                    <div className="tiny muted mono">{describeGuardEvent(event)}</div>
                  </td>
                  <td>
                    {event.decision ? (
                      event.decision.result === "blocked" ? (
                        <span className="pill danger">{event.decision.reason ?? "blocked"}</span>
                      ) : (
                        <span className="pill ok">allowed</span>
                      )
                    ) : (
                      <span className="muted tiny">—</span>
                    )}
                    {event.decision?.result === "blocked" && event.decision.reason && (
                      <div className="tiny muted">{explainReason(event.decision.reason)}</div>
                    )}
                  </td>
                  <td>
                    <span className={`pill${event.source === "diagnostic" ? " warn" : ""}`}>
                      {event.source}
                    </span>
                  </td>
                  <td className="mono tiny">{event.ledger ?? "—"}</td>
                  <td>{event.transactionHash ? starLink(event.transactionHash) : <span className="tiny muted">none — never broadcast</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="tiny muted" style={{ marginTop: 8 }}>
        Feed holds the most recent {events.length} event(s) from{" "}
        <span className="mono">{short(guard, 8, 6)}</span>
        {filterActive && `, ${filtered.length} shown`}. NDJSON exports keep 64-bit values (ledgers,
        stroop amounts, timestamps) as strings so no precision is lost.
      </p>
    </div>
  );
}

function labelFor(event: GuardEvent): string {
  switch (event.kind) {
    case "auth_checked":
      return "Authorization decision";
    case "heartbeat":
      return "Agent heartbeat";
    case "initialized":
      return "Account initialized";
    case "frozen":
      return "Admin freeze";
    case "unfrozen":
      return "Admin unfreeze";
    case "policy_set":
      return "Policy installed";
    case "policy_revoked":
      return "Policy revoked";
    default:
      return event.topic;
  }
}
