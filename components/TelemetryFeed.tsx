"use client";

import { describeGuardEvent, explainReason } from "stellar-agent-guard-sdk";
import type { GuardEvent } from "stellar-agent-guard-sdk";
import { STREAM_BUFFER_LIMIT } from "../lib/guard/telemetry.ts";
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
  const { events, feed, stream, pauseStream, resumeStream, startWatching, stopWatching, clearEvents, guard } =
    useGuard();

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

      {events.length === 0 ? (
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
              {events.map((event, index) => (
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
        <span className="mono">{short(guard, 8, 6)}</span>.
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
