import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { rpc } from "@stellar/stellar-sdk";
import { GuardFeed, GuardFeedCoordinator } from "../../lib/guard/telemetry.ts";
import { MultiGuardFeed, type FeedWatchStatus } from "../../lib/guard/feedSubscriptions.ts";
import {
  createPollGate,
  describeFeedFailures,
  feedFailuresHeadline,
  feedGuardFailures,
  pollRound,
} from "../../lib/guard/feedRefresh.ts";
import { feedRefreshed } from "../../lib/guard/announceCopy.ts";

/**
 * Manual refresh of the current event window (#488).
 *
 * The rules under test, in the order they matter:
 *
 *   1. **One round at a time.** A refresh is the interval's round requested
 *      early, not a second request alongside it. Overlapping fan-outs double RPC
 *      load and let a slow round land after a fast one, painting an older page
 *      over a newer one.
 *   2. **A press is never lost.** An arrival during a round is remembered and
 *      served by that round's successor — coalesced, not queued, so five clicks
 *      become one extra round rather than five.
 *   3. **A restarted watch really restarts.** The coordinator caches feeds by
 *      guard identity, so Stop/Start hands back the *stopped* instance; a feed
 *      that refuses to poll while reporting an empty page successfully is worse
 *      than one that errors.
 *   4. **Every failing guard is named.** One guard's failure used to be the only
 *      failure the operator could see.
 */

const GUARD = "CAYJZT4XH5SWDXNR7MZJCCUBIDAT2KZDDUTZ7OZQEMKCPJGD4P3X4CU7";
const GUARD_B = "CBYJZT4XH5SWDXNR7MZJCCUBIDAT2KZDDUTZ7OZQEMKCPJGD4P3X4CU7";

/** A stellar-rpc style event id: a 19-digit TOID, a dash and a 10-digit index. */
const cursorAt = (ledger: number, index = 0) =>
  `${String(ledger).padStart(19, "0")}-${String(index).padStart(10, "0")}`;

/** Let the awaiting continuation run, without a timer the suite has to wait on. */
function flushed(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

describe("pollRound — at most one round in flight", () => {
  /**
   * A round that runs until the test lets it finish, and records how many were
   * ever running at once. `peak` is the whole point: a lock that works keeps it
   * at 1 however many callers arrive.
   */
  function scriptedRound() {
    const releasers: Array<() => void> = [];
    let running = 0;
    let peak = 0;
    let finished = 0;
    const round = async (): Promise<number> => {
      running += 1;
      peak = Math.max(peak, running);
      let release!: () => void;
      const held = new Promise<void>((resolve) => {
        release = resolve;
      });
      releasers.push(release);
      await held;
      running -= 1;
      finished += 1;
      return finished;
    };
    return {
      round,
      releasers,
      running: () => running,
      peak: () => peak,
      finished: () => finished,
    };
  }

  it("starts no second round while one is in flight", async () => {
    const script = scriptedRound();
    const gate = createPollGate();
    const first = pollRound(gate, script.round);
    const second = pollRound(gate, script.round);

    assert.equal(script.running(), 1, "the second caller did not start its own round");
    assert.equal(gate.isPolling(), true);
    assert.equal(gate.isQueued(), true, "the second request is remembered, not dropped");

    const coalesced = await second;
    assert.deepEqual(coalesced, { ran: false, coalesced: true, rounds: 0, value: null });

    script.releasers[0]!();
    await flushed();
    assert.equal(script.running(), 1, "the remembered press became a successor round");
    assert.equal(script.peak(), 1, "and never ran alongside the first");
    script.releasers[1]!();
    const winner = await first;
    assert.equal(winner.rounds, 2, "the remembered request became the successor round");
    assert.equal(winner.value, 2, "and reported the page the successor round returned");
    assert.equal(gate.isPolling(), false);
    assert.equal(gate.isQueued(), false);
  });

  it("collapses five presses during one round into one extra round", async () => {
    const script = scriptedRound();
    const gate = createPollGate();
    const winner = pollRound(gate, script.round);
    const presses = await Promise.all(
      [1, 2, 3, 4, 5].map(async () => pollRound(gate, script.round)),
    );
    assert.deepEqual(
      presses.map((press) => press.rounds),
      [0, 0, 0, 0, 0],
    );
    assert.equal(gate.isQueued(), true, "five presses are one remembered request");

    script.releasers[0]!();
    await flushed();
    script.releasers[1]!();
    await winner;
    assert.equal(script.finished(), 2, "not six");
    assert.equal(script.peak(), 1);
  });

  it("runs one round and no more when nothing else asks", async () => {
    const script = scriptedRound();
    const gate = createPollGate();
    const winner = pollRound(gate, script.round);
    script.releasers[0]!();
    const outcome = await winner;
    assert.deepEqual(outcome, { ran: true, coalesced: false, rounds: 1, value: 1 });
  });

  it("distinguishes a request that was queued from one that cannot be served", async () => {
    const script = scriptedRound();
    const gate = createPollGate();
    gate.close();
    const refused = await pollRound(gate, script.round);
    assert.equal(refused.ran, false);
    assert.equal(refused.coalesced, false, "nothing is in flight to remember it");
    assert.equal(script.finished(), 0, "a closed gate polls nothing");
  });

  it("drops a remembered request when the watch closes before it is served", async () => {
    const script = scriptedRound();
    const gate = createPollGate();
    const winner = pollRound(gate, script.round);
    const pressed = pollRound(gate, script.round);
    assert.equal((await pressed).coalesced, true);

    // The operator pressed Stop while the round was still out.
    gate.close();
    script.releasers[0]!();
    const outcome = await winner;
    assert.equal(outcome.rounds, 1, "the unmounted watch ran no successor round");
    assert.equal(script.finished(), 1);
  });

  it("releases the lock when a round throws, so the feed can poll again", async () => {
    const gate = createPollGate();
    let attempts = 0;
    const failing = async () => {
      attempts += 1;
      throw new Error("bug in the round");
    };
    await assert.rejects(() => pollRound(gate, failing), /bug in the round/);
    assert.equal(gate.isPolling(), false, "a thrown round must not hold the lock");

    const next = await pollRound(gate, async () => "served");
    assert.equal(next.value, "served", "and a later round still runs");
    assert.equal(attempts, 1, "the throw is not retried by the drain");
  });
});

describe("a restarted watch polls again (#488)", () => {
  /**
   * The provider's exact wiring: a coordinator caching one `GuardFeed` per guard
   * identity, fanned out by a supervisor. Pages carry no events on purpose —
   * nothing here is about decoding, it is about whether the RPC was asked at all
   * and from where.
   */
  function wiredGuards() {
    const requests: Array<{ cursor?: string; startLedger?: number; limit: number }> = [];
    let ledger = 100;
    const server = {
      getLatestLedger: async () => ({ sequence: ledger }),
      getEvents: async (request: { cursor?: string; startLedger?: number; limit: number }) => {
        requests.push(request);
        ledger += 5;
        return {
          events: [],
          cursor: cursorAt(ledger),
          latestLedger: ledger,
          oldestLedger: ledger - 5,
        };
      },
    } as unknown as rpc.Server;
    const coordinator = new GuardFeedCoordinator((guard: string) => new GuardFeed(server, guard));
    const supervisor = () =>
      new MultiGuardFeed({
        cap: 2,
        createFeed: (guard: string) => coordinator.ensure(guard),
      });
    return { coordinator, requests, supervisor, ledger: () => ledger };
  }

  const sources = [{ guard: GUARD, label: "Guard A" }];

  it("Stop then Start asks the RPC again instead of reporting an empty page", async () => {
    const { requests, supervisor } = wiredGuards();
    const first = supervisor();
    first.sync(sources);
    await first.pollAll();
    assert.equal(requests.length, 1);

    first.stopAll();
    const restarted = supervisor();
    restarted.sync(sources);
    const page = await restarted.pollAll();

    assert.equal(requests.length, 2, "the re-armed feed made a real request");
    assert.equal(page.watch.length, 1);
    assert.equal(page.watch[0]!.ok, true);
    // The failure this closes: a stopped feed answers *successfully* with
    // nothing, so `ok: true` and zero events is exactly what a watch that never
    // restarted looked like.
    assert.equal(restarted.guards()[0]!.guard, GUARD);
  });

  it("keeps the cursor across the restart, so a re-watch does not re-read history", async () => {
    const { requests, supervisor } = wiredGuards();
    const first = supervisor();
    first.sync(sources);
    await first.pollAll();
    const held = cursorAt(105);
    assert.equal(requests[0]!.cursor, undefined, "the first page had no cursor to send");

    first.stopAll();
    const restarted = supervisor();
    restarted.sync(sources);
    await restarted.pollAll();

    assert.equal(requests[1]!.cursor, held, "the restart resumed from the held cursor");
    assert.equal(requests[1]!.startLedger, undefined, "and did not fall back to a re-scan");
  });

  it("re-arms every guard the supervisor adopts, including one added after a stop", async () => {
    const { requests, supervisor } = wiredGuards();
    const first = supervisor();
    first.sync([{ guard: GUARD, label: "Guard A" }]);
    await first.pollAll();
    first.stopAll();

    const restarted = supervisor();
    restarted.sync([
      { guard: GUARD, label: "Guard A" },
      { guard: GUARD_B, label: "Guard B" },
    ]);
    const page = await restarted.pollAll();

    assert.equal(requests.length, 3, "both the cached guard and the new one polled");
    assert.equal(page.watch.filter((entry) => entry.ok).length, 2);
  });
});

describe("per-guard poll failures are all named (#488)", () => {
  function status(overrides: Partial<FeedWatchStatus>): FeedWatchStatus {
    return {
      guard: GUARD,
      label: "Guard A",
      ok: true,
      error: null,
      latestLedger: 100,
      gaps: null,
      ...overrides,
    };
  }

  it("lists every guard that failed, in tailing order", () => {
    const failures = feedGuardFailures([
      status({ label: "Guard A", ok: false, error: "getEvents timed out" }),
      status({ guard: GUARD_B, label: "Guard B" }),
      status({ guard: GUARD_B, label: "Guard C", ok: false, error: "429" }),
      status({ label: "Guard D", ok: false, error: null }),
    ]);
    assert.deepEqual(
      failures.map((failure) => `${failure.label}=${failure.error}`),
      ["Guard A=getEvents timed out", "Guard C=429", "Guard D=the poll failed without a reason"],
      "the failures are in tailing order, and a failure with no message still says so",
    );
  });

  it("says how many guards answered when the failure is partial", () => {
    const failures = feedGuardFailures([
      status({ label: "Guard A", ok: false, error: "timed out" }),
      status({ guard: GUARD_B, label: "Guard B", ok: false, error: "429" }),
      status({ guard: GUARD_B, label: "Guard C" }),
    ]);
    assert.deepEqual(describeFeedFailures(failures, 3), [
      "Guard A: timed out",
      "Guard B: 429",
      "1 of 3 tailed guards answered; the rows for the guards above are from the last round that reached them.",
    ]);
  });

  it("says that nothing on screen is current when no guard answered", () => {
    const failures = feedGuardFailures([status({ label: "Guard A", ok: false, error: "down" })]);
    assert.deepEqual(describeFeedFailures(failures, 1), [
      "Guard A: down",
      "No tailed guard answered, so the rows below are unchanged — they are not a picture of the chain now.",
    ]);
  });

  it("says nothing when every guard answered", () => {
    assert.deepEqual(feedGuardFailures([status({})]), []);
    assert.deepEqual(describeFeedFailures([], 5), []);
    assert.equal(feedFailuresHeadline([]), "");
  });

  it("names one guard in the headline and counts several", () => {
    const one = feedGuardFailures([status({ label: "Guard A", ok: false, error: "timed out" })]);
    assert.equal(feedFailuresHeadline(one), "The event feed could not poll Guard A");
    const two = feedGuardFailures([
      status({ label: "Guard A", ok: false, error: "timed out" }),
      status({ guard: GUARD_B, label: "Guard B", ok: false, error: "429" }),
    ]);
    assert.equal(feedFailuresHeadline(two), "The event feed could not poll 2 of its tailed guards");
  });
});

describe("what a refresh says out loud (#488)", () => {
  it("announces a folded-in press as served by the round already running", () => {
    const spoken = feedRefreshed({ events: 7, failedGuards: 0, coalesced: true });
    assert.match(spoken.message, /already running/i);
    assert.equal(spoken.priority, "polite");
  });

  it("interrupts when the refresh failed for a guard", () => {
    const spoken = feedRefreshed({ events: 0, failedGuards: 2, coalesced: false });
    assert.equal(spoken.priority, "assertive");
    assert.match(spoken.message, /Refresh failed for 2 guards/);
  });

  it("counts what came back, in words that match the round and not the table", () => {
    assert.equal(
      feedRefreshed({ events: 0, failedGuards: 0, coalesced: false }).message,
      "Feed refreshed; no events returned",
    );
    assert.equal(
      feedRefreshed({ events: 1, failedGuards: 0, coalesced: false }).message,
      "Feed refreshed; 1 event returned",
    );
    assert.equal(
      feedRefreshed({ events: 4, failedGuards: 0, coalesced: false }).message,
      "Feed refreshed; 4 events returned",
    );
  });
});
