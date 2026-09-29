"use client";

import { useMemo, useState } from "react";
import { describeGuardEvent, explainReason } from "stellar-agent-guard-sdk";
import type { GuardEvent } from "stellar-agent-guard-sdk";
import { STREAM_BUFFER_LIMIT } from "../lib/guard/telemetry.ts";
import { eventKey, useGuard, useGuardEvents } from "./GuardProvider.tsx";
import { TelemetryAlerts } from "./TelemetryAlerts.tsx";
import { TelemetryChart } from "./TelemetryChart.tsx";
import { ErrorBlock, relativeTime, short, starLink } from "./bits.tsx";
import {
  FEED_GUARD_CAP,
  attributionLabel,
  matchesGuardFilter,
  toggleGuardFilter,
} from "../lib/guard/feedSubscriptions.ts";

/**
 * The live event feed.
 *
 * Since issue #23 the feed tails *several* guards at once (option a: one merged
 * feed with a guard-attribution chip per row). Three things are stated on the
 * panel rather than glossed over, because each changes how the feed should be
 * read:
 *
 *   - Soroban RPC has no push stream, so this polls `getEvents` with a cursor and
 *     the real latency floor is the ledger close interval, not the poll interval.
 *   - A *refused* decision never becomes a transaction: the guard returns `Err`,
 *     which rolls the event back. So the feed can only carry refused decisions
 *     that this console produced itself, decoded from the enforced simulation's
 *     diagnostics and labelled `diagnostic`. Absence of refusals here does not
 *     mean absence of refusals on chain.
 *   - Each tailed guard is one more poll loop, so only the first `FEED_GUARD_CAP`
 *     are watched and the rest are named as not tailed. Poll load scales with the
 *     tailed count; the cap and rationale are documented in the README.
 */
export function TelemetryFeed() {
  const { events, feed, startWatching, stopWatching, clearEvents, guard, instances } = useGuard();
  // The guard-chip filter composes as another feed criterion: an empty set means
  // "show every guard", which is the state the panel opens in.
  const [selectedGuards, setSelectedGuards] = useState<Set<string>>(() => new Set());

  const visibleEvents = useMemo(
    () => events.filter((event) => matchesGuardFilter(event.contractId, selectedGuards)),
    [events, selectedGuards],
  );

  // Chips come from the live tail when watching (the capped subset), and from the
  // registry otherwise, so the controls always describe what is actually tailed.
  const chipSources = feed.guards.length > 0 ? feed.guards : instances.map((i) => ({ guard: i.guard, label: i.label }));

  return (
    <div className="panel">
      <div className="row" style={{ justifyContent: "space-between" }}>
        <h2 style={{ margin: 0 }}>Telemetry</h2>
        <div className="row">
          {feed.watching && <span className="pill ok">polling</span>}
          {stream.paused && <span className="pill warn">paused</span>}
          {feed.latestLedger !== null && <span className="tiny muted">ledger {feed.latestLedger}</span>}
          {feed.watching ? (
            <button className="secondary" onClick={stopWatching}>
              Stop
            </button>
          ) : (
            <button onClick={startWatching}>Start watching</button>
          )}
          {stream.paused ? (
            <button onClick={resumeStream}>
              Resume{stream.pendingCount > 0 ? ` (${stream.pendingCount})` : ""}
            </button>
          ) : (
            <button
              className="secondary"
              onClick={pauseStream}
              disabled={!feed.watching}
              title="Freeze the table so rows stop moving. Polling continues; new events queue until you resume."
            >
              Pause stream
            </button>
          )}
          <button
            className="secondary"
            onClick={clearEvents}
            disabled={events.length === 0}
            title="Empty the list. The poll cursor is kept, so nothing is re-fetched and nothing is skipped."
          >
            Clear buffer
          </button>
        </div>
      </div>

      <div style={{ marginTop: 10 }}>
        <DateRangePicker onApply={applyRange} />
        {rangeLabel && (
          <div className="row" style={{ marginTop: 8 }}>
            <span className="pill warn">historical: {rangeLabel}</span>
            <button className="secondary" onClick={backToLive}>
              Back to live tail
            </button>
          </div>
        )}
      </div>

      {/* Announced politely so a screen reader hears the queue grow without being interrupted. */}
      <div role="status" aria-live="polite">
        {stream.paused && (
          <div className="notice" style={{ marginTop: 12 }}>
            <strong>
              Stream paused ({stream.pendingCount} new event{stream.pendingCount === 1 ? "" : "s"} pending)
            </strong>
            <span className="tiny">
              The table is frozen so you can read it. Polling carries on in the background and new
              events queue here; resume to add them in order, with no duplicates and none skipped.
              {stream.dropped > 0 &&
                ` ${stream.dropped} older queued event${stream.dropped === 1 ? "" : "s"} fell past the ${STREAM_BUFFER_LIMIT}-event buffer and will not be shown.`}
            </span>
          </div>
        )}
      </div>

      <div className="row" style={{ marginTop: 10, flexWrap: "wrap", gap: 8 }}>
        <label className="tiny muted" style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
          Verdict
          <select
            aria-label="Verdict filter"
            value={filter.verdict}
            onChange={(event) =>
              setFilter((current) => ({ ...current, verdict: event.target.value as VerdictFilter }))
            }
          >
            <option value="all">All verdicts</option>
            <option value="allowed">Allowed Only</option>
            <option value="blocked">Blocked Only</option>
          </select>
        </label>
        <label className="tiny muted" style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
          Topic
          <select
            aria-label="Topic filter"
            value={filter.topic}
            onChange={(event) => setFilter((current) => ({ ...current, topic: event.target.value }))}
          >
            <option value="all">All topics</option>
            {Object.entries(TOPIC_LABELS).map(([topic, label]) => (
              <option key={topic} value={topic}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <input
          aria-label="Contract address search"
          placeholder="Contract address contains…"
          value={filter.contract}
          onChange={(event) => setFilter((current) => ({ ...current, contract: event.target.value }))}
          style={{ maxWidth: 240 }}
        />
        <button
          className="secondary"
          onClick={() => downloadText("guard-telemetry.csv", telemetryToCsv(rows), "text/csv;charset=utf-8")}
          disabled={rows.length === 0}
        >
          Export CSV
        </button>
        <button
          className="secondary"
          onClick={() =>
            downloadText("guard-telemetry.ndjson", telemetryToNdjson(rows), "application/x-ndjson")
          }
          disabled={rows.length === 0}
        >
          Export NDJSON
        </button>
        <button
          className="secondary"
          onClick={exportAuditLog}
          disabled={rows.length === 0}
          title="NDJSON audit log: a header line, then decoded fields, verdict, ledger, transaction hash and the raw event XDR per event"
        >
          Export audit log
        </button>
        {filterActive && (
          <button className="secondary" onClick={() => setFilter(EMPTY_TELEMETRY_FILTER)}>
            Clear filters
          </button>
        )}
      </div>

      <p className="tiny muted" style={{ marginTop: 8 }}>
        Tailed from Soroban RPC&apos;s <code>getEvents</code> with a cursor, so no event is delivered
        twice and none is skipped between polls. Soroban has no push stream — the floor on latency is
        the ledger close interval (roughly 5s), not the 5s poll.
        {feed.lastPolledAt && ` Last poll ${relativeTime(feed.lastPolledAt)}.`}
      </p>

      {feed.guards.length > 0 && (
        <p className="tiny muted" style={{ marginTop: 4 }}>
          Tailing {feed.guards.length} guard(s) simultaneously, up to the {FEED_GUARD_CAP}-guard cap.
          Each tailed guard is its own poll loop, so RPC load scales with the number watched.
        </p>
      )}

      {feed.capped > 0 && (
        <div className="notice info" role="status">
          <strong>
            {feed.capped} guard(s) beyond the {FEED_GUARD_CAP}-guard cap are not being tailed
          </strong>
          <span className="tiny">
            {feed.cappedLabels.join(", ")}. Their events will not appear in this feed. Stop watching,
            or remove a guard from the registry, to tail a different set — the cap keeps the poll
            load bounded rather than silently multiplying RPC traffic.
          </span>
        </div>
      )}

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

      {chipSources.length > 1 && (
        <div className="row" style={{ marginTop: 8, flexWrap: "wrap" }} role="group" aria-label="Filter events by guard">
          <span className="tiny muted">Filter by guard:</span>
          {chipSources.map((source) => {
            const active = selectedGuards.has(source.guard);
            return (
              <button
                key={source.guard}
                className={active ? "pill ok" : "pill"}
                aria-pressed={active}
                title={source.guard}
                onClick={() => setSelectedGuards((current) => toggleGuardFilter(current, source.guard))}
              >
                {source.label}
              </button>
            );
          })}
          {selectedGuards.size > 0 && (
            <button className="secondary" onClick={() => setSelectedGuards(new Set())}>
              All guards
            </button>
          )}
        </div>
      )}

      {visibleEvents.length === 0 ? (
        <p className="tiny muted">
          {events.length > 0
            ? "No events match the selected guard filter."
            : feed.watching
              ? "No events from these guards yet. Lifecycle events (policy set, frozen, heartbeat) and allowed decisions appear here as they settle."
              : "Start watching to tail these guards' events."}
        </p>
      ) : rows.length === 0 ? (
        <p className="tiny muted">
          No events match the current filter. The feed still holds {events.length} event(s);
          widen the verdict, topic or contract filter to see them.
        </p>
      ) : (
        <div className="scrolly">
          <table className="events">
            <thead>
              <tr>
                <th>Event</th>
                <th>Decision</th>
                <th>Guard</th>
                <th>Source</th>
                <th>Ledger</th>
                <th>Transaction</th>
              </tr>
            </thead>
            <tbody>
              {visibleEvents.map((event, index) => (
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
                    <span className="pill" title={event.contractId ?? "unknown contract"}>
                      {attributionLabel(event.contractId, instances) ?? "unknown guard"}
                    </span>
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
        Feed holds the most recent {visibleEvents.length} of {events.length} event(s)
        {feed.guards.length > 0 ? ` from ${feed.guards.length} guard(s)` : ` from `}
        {feed.guards.length === 0 && <span className="mono">{short(guard, 8, 6)}</span>}.
      </p>
    </div>
  );
}

/**
 * One feed row, memoised.
 *
 * The feed re-renders on every poll batch (and, under the #114 benchmark's
 * injection seam, many times a second), while a row's content is a pure
 * function of its own event. Memoising keeps the cost of a batch proportional
 * to the rows the batch actually added instead of to the feed's whole 250-row
 * cap — the difference between holding frame rate and remounting the table on
 * every update.
 *
 * The key is `eventKey`, the provider's own identity for de-duplication, so
 * React reconciles against the same uniqueness the feed guarantees: a new
 * event prepending shifts nothing, and no row is ever unmounted and rebuilt
 * merely because rows above it changed.
 */
const TelemetryRow = memo(function TelemetryRow({ event }: { event: GuardEvent }) {
  return (
    <tr>
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
        <span className={`pill${event.source === "diagnostic" ? " warn" : ""}`}>{event.source}</span>
      </td>
      <td className="mono tiny">{event.ledger ?? "—"}</td>
      <td>
        {event.transactionHash ? (
          starLink(event.transactionHash)
        ) : (
          <span className="tiny muted">none — never broadcast</span>
        )}
      </td>
    </tr>
  );
});

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
