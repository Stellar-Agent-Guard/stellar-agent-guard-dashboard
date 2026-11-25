/**
 * The local investigation timeline (#489).
 *
 * Three behaviours are pinned here, because each is a claim the panel makes out
 * loud: the sequence is ordered by ledger time *where one exists*, an item with
 * no chain time is labelled rather than silently sorted by somebody's clock, and
 * every item can be traced back to the row it came from — or says that the row
 * is gone. The persistence half matters just as much: bookmarks live in the
 * per-guard scoped bucket, so deleting a guard deletes what was bookmarked from
 * it and keeps everyone else's.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { GUARD_EVENT_TOPICS } from "stellar-agent-guard-sdk";
import {
  BOOKMARKS_STORAGE_BASE,
  BOOKMARK_CAP,
  bookmarkBucketFor,
  buildTimeline,
  loadBookmarks,
  mergeBookmarks,
  orderingOf,
  removeBookmark,
  rowAnchorId,
  saveBookmarks,
  toggleBookmark,
  type BookmarkRecord,
} from "../../lib/guard/investigations.ts";
import {
  SCOPED_STORAGE_BASES,
  clearGuardScopedState,
  scopedStorageKey,
} from "../../lib/guard/guardScoped.ts";
import type { StorageLike } from "../../lib/guard/instance.ts";
import { withIdentity } from "../mocks/eventFixtures.ts";
import type { TelemetryEvent } from "../../lib/guard/telemetry.ts";

const GUARD_A = "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
const GUARD_B = "CBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB";
const NETWORK = "testnet";

function memoryStorage(initial: Record<string, string> = {}): StorageLike {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (key) => (data.has(key) ? (data.get(key) as string) : null),
    setItem: (key, value) => {
      data.set(key, value);
    },
    removeItem: (key) => {
      data.delete(key);
    },
  };
}

/** A committed row: it has a ledger close, so chain time places it. */
function ledgerEvent(ledger: number, closedAt: string, contractId = GUARD_A): TelemetryEvent {
  return withIdentity({
    kind: "auth_checked",
    topic: GUARD_EVENT_TOPICS.authChecked,
    source: "ledger",
    contractId,
    ledger,
    ledgerClosedAt: closedAt,
    transactionHash: `hash-${ledger}`,
    decision: { result: "allowed", reason: null, source: "ledger" },
    data: {},
  });
}

/**
 * A diagnostic row: never broadcast, so it has no ledger and no chain time.
 *
 * `withIdentity` stamps `observedAt` when the fixture omits it, which is what
 * the SDK's own `watchAll()` does — so this helper cannot produce a row with no
 * time at all. The undated cases below are built from `record()` instead, which
 * is what the timeline actually reads.
 */
function diagnosticEvent(contractId = GUARD_A): TelemetryEvent {
  return withIdentity(
    {
      kind: "auth_checked",
      topic: GUARD_EVENT_TOPICS.authChecked,
      source: "diagnostic",
      contractId,
      ledger: null,
      ledgerClosedAt: null,
      transactionHash: null,
      decision: { result: "blocked", reason: "per_tx_cap_exceeded", source: "diagnostic" },
      data: {},
    },
    null,
  );
}

function record(overrides: Partial<BookmarkRecord> = {}): BookmarkRecord {
  return {
    eventId: "ledger:hash-1:event_auth_checked",
    network: NETWORK,
    guard: GUARD_A,
    kind: "auth_checked",
    topic: GUARD_EVENT_TOPICS.authChecked,
    source: "ledger",
    contractId: GUARD_A,
    ledger: 1,
    ledgerClosedAt: "2026-01-01T00:00:00.000Z",
    observedAt: null,
    transactionHash: "hash-1",
    decision: "allowed",
    reason: null,
    bookmarkedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function ids(items: { record: BookmarkRecord }[]): string[] {
  return items.map((item) => item.record.eventId);
}

describe("ordering the timeline", () => {
  it("places dated bookmarks by ledger time, oldest first", () => {
    const items = buildTimeline(
      [
        record({ eventId: "c", ledgerClosedAt: "2026-03-01T00:00:00.000Z" }),
        record({ eventId: "a", ledgerClosedAt: "2026-01-01T00:00:00.000Z" }),
        record({ eventId: "b", ledgerClosedAt: "2026-02-01T00:00:00.000Z" }),
      ],
      new Set(),
    );
    assert.deepEqual(ids(items), ["a", "b", "c"]);
    assert.deepEqual(
      items.map((item) => item.ordering),
      ["ledger", "ledger", "ledger"],
    );
  });

  it("does not depend on the order the buckets arrived in", () => {
    const first = buildTimeline(
      [
        record({ eventId: "a", ledgerClosedAt: "2026-01-01T00:00:00.000Z" }),
        record({ eventId: "b", ledgerClosedAt: "2025-12-31T00:00:00.000Z" }),
      ],
      new Set(),
    );
    const second = buildTimeline(
      [
        record({ eventId: "b", ledgerClosedAt: "2025-12-31T00:00:00.000Z" }),
        record({ eventId: "a", ledgerClosedAt: "2026-01-01T00:00:00.000Z" }),
      ],
      new Set(),
    );
    assert.deepEqual(ids(first), ids(second));
  });

  it("merges guards into one sequence", () => {
    const items = buildTimeline(
      [
        record({ eventId: "from-b", guard: GUARD_B, ledgerClosedAt: "2026-01-02T00:00:00.000Z" }),
        record({ eventId: "from-a", guard: GUARD_A, ledgerClosedAt: "2026-01-01T00:00:00.000Z" }),
      ],
      new Set(),
    );
    assert.deepEqual(ids(items), ["from-a", "from-b"]);
  });

  it("says which clock placed a diagnostic row", () => {
    const diagnostic = record({
      eventId: "diag:1",
      source: "diagnostic",
      ledger: null,
      ledgerClosedAt: null,
      observedAt: "2026-01-01T12:00:00.000Z",
    });
    assert.deepEqual(orderingOf(diagnostic), {
      ordering: "observed",
      ms: Date.parse("2026-01-01T12:00:00.000Z"),
    });
    const items = buildTimeline(
      [
        record({
          eventId: "diag:1",
          source: "diagnostic",
          ledgerClosedAt: null,
          observedAt: "2026-01-01T12:00:00.000Z",
        }),
        record({ eventId: "ledger:1", ledgerClosedAt: "2026-01-01T09:00:00.000Z" }),
      ],
      new Set(),
    );
    assert.deepEqual(ids(items), ["ledger:1", "diag:1"]);
    assert.deepEqual(
      items.map((item) => item.ordering),
      ["ledger", "observed"],
    );
  });

  it("prefers chain time over observation time when both exist", () => {
    const placed = orderingOf(
      record({
        ledgerClosedAt: "2026-01-01T00:00:00.000Z",
        observedAt: "2026-06-06T00:00:00.000Z",
      }),
    );
    assert.equal(placed.ordering, "ledger");
    assert.equal(placed.ms, Date.parse("2026-01-01T00:00:00.000Z"));
  });

  it("labels a row with no ordering data and puts it last, not lost", () => {
    const items = buildTimeline(
      [
        record({ eventId: "undated", ledgerClosedAt: null, observedAt: null }),
        record({ eventId: "dated", ledgerClosedAt: "2026-01-01T00:00:00.000Z" }),
      ],
      new Set(),
    );
    assert.deepEqual(ids(items), ["dated", "undated"]);
    assert.deepEqual(
      items.map((item) => item.ordering),
      ["ledger", "missing"],
    );
    assert.equal(items[1]?.orderedAtMs, null);
  });

  it("treats an unparseable timestamp as missing rather than as a NaN position", () => {
    // `Date.parse("0")` is New Year's Eve 1999 and `Date.parse("1700000000")` is
    // a 2023 instant, so a bare number would be *placed* rather than labelled.
    for (const bad of ["", "   ", "not a date", "0", "1700000000"]) {
      const placed = orderingOf(record({ ledgerClosedAt: bad, observedAt: bad }));
      assert.deepEqual(placed, { ordering: "missing", ms: null }, `${JSON.stringify(bad)}`);
    }
  });

  it("breaks a tie between a ledger row and a diagnostic row by basis, then by id", () => {
    const same = "2026-01-01T00:00:00.000Z";
    const items = buildTimeline(
      [
        record({ eventId: "zzz", ledgerClosedAt: null, observedAt: same }),
        record({ eventId: "aaa", ledgerClosedAt: same }),
        record({ eventId: "bbb", ledgerClosedAt: same }),
      ],
      new Set(),
    );
    assert.deepEqual(ids(items), ["aaa", "bbb", "zzz"]);
  });
});

describe("linking an item to its source row", () => {
  it("marks the row present only while it is on screen", () => {
    const items = buildTimeline(
      [record({ eventId: "on-screen" }), record({ eventId: "scrolled-away" })],
      new Set(["on-screen"]),
    );
    const present = items.find((item) => item.record.eventId === "on-screen")!;
    const gone = items.find((item) => item.record.eventId === "scrolled-away")!;
    assert.equal(present.rowPresent, true);
    assert.equal(gone.rowPresent, false);
  });

  it("gives the row an anchor that is a legal HTML id", () => {
    const anchor = rowAnchorId("ledger:hash:event auth checked");
    assert.doesNotMatch(anchor, /\s/);
    assert.match(anchor, /^row-/);
  });

  it("cannot alias two distinct events onto one anchor", () => {
    // Characters that a naive sanitiser would flatten to the same replacement.
    const distinct = ["event a", "event/a", "event%20a", "event#a"].map((topic) =>
      rowAnchorId(`ledger:hash:${topic}`),
    );
    assert.equal(new Set(distinct).size, distinct.length);
  });

  it("round-trips through getElementById-style matching of the raw id", () => {
    const raw = "ledger:abcd:event_auth_checked";
    assert.equal(decodeURIComponent(rowAnchorId(raw).slice("row-".length)), raw);
  });
});

describe("bookmarks per guard bucket", () => {
  it("stores a bookmark in the bucket of the guard the event names", () => {
    const storage = memoryStorage();
    const event = ledgerEvent(7, "2026-01-01T00:00:00.000Z", GUARD_B);
    const bucket = bookmarkBucketFor(event, GUARD_A);
    assert.equal(bucket, GUARD_B);
    toggleBookmark({
      event,
      guard: bucket,
      bookmarkedAt: "2026-02-01T00:00:00.000Z",
      options: { storage, network: NETWORK },
    });

    assert.equal(loadBookmarks(GUARD_B, { storage, network: NETWORK }).length, 1);
    assert.equal(loadBookmarks(GUARD_A, { storage, network: NETWORK }).length, 0);
  });

  it("falls back to the guard on screen when the event names none", () => {
    const event = { ...ledgerEvent(7, "2026-01-01T00:00:00.000Z"), contractId: null };
    assert.equal(bookmarkBucketFor(event as TelemetryEvent, GUARD_A), GUARD_A);
  });

  it("toggles: pressing twice removes it", () => {
    const storage = memoryStorage();
    const options = { storage, network: NETWORK };
    const event = ledgerEvent(7, "2026-01-01T00:00:00.000Z");
    const params = { event, guard: GUARD_A, bookmarkedAt: "2026-02-01T00:00:00.000Z", options };
    const added = toggleBookmark(params);
    assert.equal(added.bookmarked, true);
    assert.deepEqual(
      added.records.map((r) => r.eventId),
      [event.id],
    );
    const removed = toggleBookmark(params);
    assert.equal(removed.bookmarked, false);
    assert.deepEqual(removed.records, []);
    assert.equal(loadBookmarks(GUARD_A, options).length, 0);
  });

  it("removes by record, not by press count, and persists the removal", () => {
    // The timeline offers this path for an item whose row is gone. Toggling
    // cannot serve it: `toggleBookmark` answers a missing entry by adding it,
    // so a stale view would resurrect a bookmark the operator had just deleted.
    const storage = memoryStorage();
    const options = { storage, network: NETWORK };
    const event = ledgerEvent(7, "2026-01-01T00:00:00.000Z");
    toggleBookmark({
      event,
      guard: GUARD_A,
      bookmarkedAt: "2026-02-01T00:00:00.000Z",
      options,
    });
    const other = ledgerEvent(8, "2026-01-02T00:00:00.000Z");
    toggleBookmark({
      event: other,
      guard: GUARD_A,
      bookmarkedAt: "2026-02-02T00:00:00.000Z",
      options,
    });

    const kept = removeBookmark({ eventId: event.id, guard: GUARD_A, options });
    assert.deepEqual(
      kept.map((record) => record.eventId),
      [other.id],
    );
    assert.deepEqual(
      loadBookmarks(GUARD_A, options).map((record) => record.eventId),
      [other.id],
    );

    // Removing what is already gone changes nothing, in either direction.
    assert.deepEqual(
      removeBookmark({ eventId: "ledger:tx-absent:event_auth_checked", guard: GUARD_A, options })
        .length,
      1,
    );
  });

  it("keeps the network and the guard apart", () => {
    const storage = memoryStorage();
    toggleBookmark({
      event: ledgerEvent(7, "2026-01-01T00:00:00.000Z"),
      guard: GUARD_A,
      bookmarkedAt: "2026-02-01T00:00:00.000Z",
      options: { storage, network: "testnet" },
    });
    assert.equal(loadBookmarks(GUARD_A, { storage, network: "testnet" }).length, 1);
    assert.equal(loadBookmarks(GUARD_A, { storage, network: "mainnet" }).length, 0);
    assert.equal(loadBookmarks(GUARD_B, { storage, network: "testnet" }).length, 0);
  });

  it("is enumerated by the delete cascade", () => {
    // The claim in `guardScoped.ts` is that the base list is closed *because*
    // deletion enumerates it. A bookmarks base left off that list would survive
    // the guard it belongs to.
    assert.ok((SCOPED_STORAGE_BASES as readonly string[]).includes(BOOKMARKS_STORAGE_BASE));

    const storage = memoryStorage();
    const options = { storage, network: NETWORK };
    for (const guard of [GUARD_A, GUARD_B]) {
      saveBookmarks([record({ eventId: "x", guard, network: NETWORK })], guard, options);
    }
    clearGuardScopedState(NETWORK, GUARD_A, options);
    assert.deepEqual(loadBookmarks(GUARD_A, options), []);
    assert.equal(loadBookmarks(GUARD_B, options).length, 1);
  });

  it("reads a corrupt bucket as empty rather than throwing", () => {
    const corrupt = [
      "not json",
      '"a string"',
      "{}",
      "null",
      "[]",
      '[{"eventId":""}]',
      '[{"eventId":"x"}]',
      '[{"eventId":"x","guard":"","source":"ledger"}]',
      '[{"eventId":"x","guard":"g","source":"both"}]',
    ];
    const key = scopedStorageKey(BOOKMARKS_STORAGE_BASE, NETWORK, GUARD_A);
    for (const payload of corrupt) {
      const storage = memoryStorage({ [key]: payload });
      assert.deepEqual(loadBookmarks(GUARD_A, { storage, network: NETWORK }), [], payload);
    }
  });

  it("drops an entry whose origin cannot be read instead of showing it wrong", () => {
    const key = scopedStorageKey(BOOKMARKS_STORAGE_BASE, NETWORK, GUARD_A);
    const storage = memoryStorage({
      [key]: JSON.stringify([
        record({ eventId: "keep" }),
        { ...record({ eventId: "drop" }), source: undefined },
      ]),
    });
    const loaded = loadBookmarks(GUARD_A, { storage, network: NETWORK });
    assert.deepEqual(
      loaded.map((r) => r.eventId),
      ["keep"],
    );
  });

  it("caps the bucket by dropping the oldest bookmark", () => {
    const storage = memoryStorage();
    const options = { storage, network: NETWORK };
    let records: BookmarkRecord[] = [];
    for (let i = 0; i < BOOKMARK_CAP + 5; i += 1) {
      records = [
        ...records,
        record({
          eventId: `e${i}`,
          ledgerClosedAt: `2026-01-01T00:00:${String(i).padStart(2, "0")}.000Z`,
          bookmarkedAt: new Date(Date.UTC(2026, 0, 1, 0, 0, i)).toISOString(),
        }),
      ];
    }
    const kept = saveBookmarks(records, GUARD_A, options);
    assert.equal(kept.length, BOOKMARK_CAP);
    assert.equal(kept[0]?.eventId, `e${records.length - BOOKMARK_CAP}`);
    assert.equal(loadBookmarks(GUARD_A, options).length, BOOKMARK_CAP);
  });

  it("merges buckets without duplicating an event bookmarked in one guard twice", () => {
    const merged = mergeBookmarks([
      [record({ eventId: "x" })],
      [record({ eventId: "x" }), record({ eventId: "y", guard: GUARD_B })],
    ]);
    assert.deepEqual(merged.map((r) => r.eventId).sort(), ["x", "y"]);
  });

  it("keeps the same event id from two guards as two bookmarks", () => {
    const merged = mergeBookmarks([
      [record({ eventId: "ledger:tx:event_auth_checked", guard: GUARD_A })],
      [record({ eventId: "ledger:tx:event_auth_checked", guard: GUARD_B })],
    ]);
    assert.equal(merged.length, 2);
  });

  it("survives the fields a timeline needs", () => {
    const storage = memoryStorage();
    const options = { storage, network: NETWORK };
    const event = diagnosticEvent(GUARD_A);
    toggleBookmark({ event, guard: GUARD_A, bookmarkedAt: "2026-02-01T00:00:00.000Z", options });
    const [kept] = loadBookmarks(GUARD_A, options);
    assert.equal(kept?.eventId, event.id);
    assert.equal(kept?.source, "diagnostic");
    assert.equal(kept?.decision, "blocked");
    assert.equal(kept?.reason, "per_tx_cap_exceeded");
    assert.equal(kept?.ledger, null);
    assert.equal(kept?.transactionHash, null);
    assert.equal(kept?.bookmarkedAt, "2026-02-01T00:00:00.000Z");
  });
});
