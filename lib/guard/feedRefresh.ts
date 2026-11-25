/**
 * Manual refresh of the current event window (#488).
 *
 * An operator who has just fixed connectivity wants the feed to ask the RPC again
 * *now*, without the two things the existing controls do instead:
 *
 *   - `Clear buffer` keeps the cursor and shows nothing until the next scheduled
 *     poll, so it does not re-read anything.
 *   - `Stop` then `Start watching` rebuilds the supervisor and, because the
 *     coordinator hands back the same cached feed, used to re-arm nothing at all —
 *     a stopped feed answers `pollOnce()` with an empty page *successfully*, so
 *     the health line read "healthy" while no request was ever made.
 *
 * A refresh must therefore be safe to press at any moment, which means one rule
 * this module owns: **at most one round of RPC requests is in flight per tab**,
 * however many things ask for a round. `setInterval` cannot be trusted to keep
 * that on its own — a round that outlasts the 5s cadence overlaps the next tick,
 * and a refresh button multiplies the ways a round can start.
 *
 * `createPollGate()` + `pollRound()` implement the other half: an arrival during
 * an in-flight round is *remembered*, not dropped, and drains as one extra round.
 * Coalescing rather than queueing keeps a double-click from becoming four
 * sequential RPC fan-outs, and a closed gate means an unmounted watch never runs
 * a round behind the component's back.
 */

import type { FeedWatchStatus } from "./feedSubscriptions.ts";

/**
 * The single-slot lock over poll rounds.
 *
 * Deliberately a factory returning a closed object rather than a class with
 * state fields: the provider holds one in a ref, and the interface is what the
 * tests assert against.
 */
export interface PollGate {
  /**
   * Claim the round. `false` when one is already in flight — in which case the
   * request is remembered so it still gets served, rather than silently lost.
   */
  tryBegin(): boolean;
  /** Release the round; `"rerun"` when something asked for it while it ran. */
  finish(): "rerun" | "idle";
  /** Close the gate: nothing further begins, and a remembered request is dropped. */
  close(): void;
  isPolling(): boolean;
  isQueued(): boolean;
  isClosed(): boolean;
}

export function createPollGate(): PollGate {
  let polling = false;
  let pending = false;
  let closed = false;
  return {
    tryBegin() {
      if (closed) return false;
      if (polling) {
        pending = true;
        return false;
      }
      polling = true;
      return true;
    },
    finish() {
      polling = false;
      if (closed || !pending) return "idle";
      pending = false;
      return "rerun";
    },
    close() {
      closed = true;
      pending = false;
    },
    isPolling: () => polling,
    isQueued: () => pending,
    isClosed: () => closed,
  };
}

/** What one call to `pollRound` did. */
export interface PollRoundOutcome<T> {
  /** True when this call ran at least one round (it may have run more, after a drain). */
  ran: boolean;
  /** True when this call was folded into a round already in flight. */
  coalesced: boolean;
  /** Rounds actually run by this call. */
  rounds: number;
  /** The value of the last round this call ran. */
  value: T | null;
}

/**
 * Run `round` under `gate`, never overlapping another round.
 *
 * Whichever caller wins the gate also drains the remembered requests, so a
 * refresh pressed during a slow round is served by that round's successor
 * instead of being dropped or run concurrently. Draining stops as soon as the
 * gate says it is idle (or refuses), so a cancelled watch cannot keep polling.
 *
 * `round` is expected to swallow its own per-guard failures and return normally;
 * a rejection ends the drain and propagates to the caller, because a round that
 * throws is a bug in the round, not a reason to keep retrying it. It still
 * releases the gate on the way out: a lock left held by a thrown round would
 * silently coalesce every later poll — including the interval's — into a request
 * nobody ever serves.
 */
export async function pollRound<T>(
  gate: PollGate,
  round: () => Promise<T>,
): Promise<PollRoundOutcome<T>> {
  if (!gate.tryBegin()) {
    // Two different kinds of *no*: a round is in flight that will remember this
    // request, or the gate is closed and nothing will ever serve it. Collapsing
    // them would let a refresh on an unmounted watch be announced as "queued".
    return { ran: false, coalesced: !gate.isClosed(), rounds: 0, value: null };
  }
  let rounds = 0;
  let value: T | null = null;
  for (;;) {
    let released: "rerun" | "idle";
    try {
      value = await round();
      rounds += 1;
      released = gate.finish();
    } catch (error) {
      gate.finish();
      throw error;
    }
    if (released !== "rerun") break;
    if (!gate.tryBegin()) break;
  }
  return { ran: true, coalesced: false, rounds, value };
}

/**
 * What one press of the refresh control did, returned so the caller can say so
 * out loud. The counts come from the round this press ran, never from a later
 * interval tick — a refresh that was folded into a round in flight has no round
 * of its own to report, and saying "refreshed with 4 events" then would be a
 * claim about somebody else's request.
 */
export interface FeedRefreshOutcome {
  /** True when the press was folded into a round that was already in flight. */
  coalesced: boolean;
  /** Rounds this press ran itself (0 when coalesced, 1 or more when it won). */
  rounds: number;
  /** Events the last round this press ran delivered. */
  events: number;
  /** Tailed guards that did not answer that round. */
  failedGuards: number;
}

/** One tailed guard that did not answer, in the words the panel shows. */
export interface FeedGuardFailure {
  guard: string;
  label: string;
  error: string;
}

/**
 * Every guard whose poll failed, in tailing order.
 *
 * Before this, the panel was handed only the *first* failure, so three guards
 * down out of five read as one guard down — the operator fixed the guard named
 * and still saw nothing from the others. The supervisor already recorded each
 * guard's own outcome; this is that list, filtered.
 */
export function feedGuardFailures(watch: readonly FeedWatchStatus[]): FeedGuardFailure[] {
  const failures: FeedGuardFailure[] = [];
  for (const entry of watch) {
    if (entry.ok) continue;
    failures.push({
      guard: entry.guard,
      label: entry.label,
      error: entry.error ?? "the poll failed without a reason",
    });
  }
  return failures;
}

/** How many guards answered, as a line the operator can act on. */
export function describeFeedFailures(
  failures: readonly FeedGuardFailure[],
  tailedCount: number,
): string[] {
  if (failures.length === 0) return [];
  const lines = failures.map((failure) => `${failure.label}: ${failure.error}`);
  const answered = Math.max(0, tailedCount - failures.length);
  lines.push(
    failures.length === tailedCount
      ? `No tailed guard answered, so the rows below are unchanged — they are not a picture of the chain now.`
      : `${answered} of ${tailedCount} tailed guard${tailedCount === 1 ? "" : "s"} answered; the rows for the guards above are from the last round that reached them.`,
  );
  return lines;
}

/** The headline for the failure block: a count before the first reason. */
export function feedFailuresHeadline(failures: readonly FeedGuardFailure[]): string {
  if (failures.length === 0) return "";
  if (failures.length === 1) return `The event feed could not poll ${failures[0]!.label}`;
  return `The event feed could not poll ${failures.length} of its tailed guards`;
}
