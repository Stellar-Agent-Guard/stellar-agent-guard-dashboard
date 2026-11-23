/**
 * The local investigation timeline (#489).
 *
 * An operator working across several guards wants one compact sequence of the
 * events they are chasing, without touching the live query that produced them.
 * A feed table is a window: it holds the most recent `STREAM_BUFFER_LIMIT` rows
 * of whichever guards are tailed, and a filter or a historical range replaces
 * what is in it. Bookmarking is how a row survives that: the operator picks the
 * rows, and the timeline keeps them in ledger order across every saved guard.
 *
 * Three decisions shape this module:
 *
 *   - **A bookmark is a record of facts, not a reference into the buffer.** The
 *     row a bookmark points at leaves the table as soon as the feed fills up,
 *     the filter changes or the guard stops being tailed. So the record carries
 *     the fields the timeline displays — including both timestamps — and the
 *     link to the row is a *bonus*, reported as present or absent rather than
 *     assumed.
 *
 *   - **Ordering says what it was ordered by.** A committed row has
 *     `ledgerClosedAt`: chain time. A diagnostic row has no ledger at all — it
 *     was never broadcast — so its only time is when this console observed it.
 *     Those are not the same kind of fact, and sorting them together silently
 *     would present a local clock as chain time, so every item is labelled with
 *     which one placed it. An item with neither is not dropped: it is placed
 *     last and labelled as having nothing to order it by.
 *
 *   - **Storage is per guard, because deletion is per guard.** The bucket key is
 *     the scoped key from `guardScoped.ts`, so removing an instance removes the
 *     bookmarks it held, and a bookmark about guard B does not vanish when guard
 *     A is deleted. The bucket is keyed by the *event's* guard rather than the
 *     one on screen for exactly that reason.
 *
 * Nothing here leaves the browser: no API route, no server, no key material.
 * The timeline is a local reading aid; the live chain read stays the authority
 * on what happened.
 */

import type { GuardEvent, GuardEventKind } from "stellar-agent-guard-sdk";
import { NETWORK } from "./network.ts";
import {
  loadScopedValue,
  saveScopedValue,
  type ScopedBase,
  type ScopedOptions,
} from "./guardScoped.ts";
import type { TelemetryEvent } from "./telemetry.ts";

/**
 * The scoped base under which each guard's bookmarks are remembered. Typed as a
 * member of the closed list in `guardScoped.ts`, which `clearGuardScopedState`
 * enumerates on delete — a base outside that list would survive the guard it
 * belongs to.
 */
export const BOOKMARKS_STORAGE_BASE: ScopedBase = "bookmarks";

/**
 * How many bookmarks one guard bucket holds. The cap bounds localStorage growth
 * on a tab that runs for weeks; the oldest bookmark (by the time it was taken)
 * is the one dropped, so the sequence an operator is actively reading is the one
 * that survives.
 */
export const BOOKMARK_CAP = 50;

export interface BookmarkOptions extends ScopedOptions {
  /** Which network's buckets to read or write. Defaults to this build's network. */
  network?: string;
}

/**
 * What one bookmark remembers about the row it came from.
 *
 * `guard` is the bucket this record lives in, and `contractId` is the guard the
 * event names for itself. They are usually the same value; they differ only for
 * an event whose contract could not be identified, which is filed under the
 * guard on screen so it still has a bucket to be deleted with.
 */
export interface BookmarkRecord {
  eventId: string;
  network: string;
  guard: string;
  kind: GuardEventKind;
  topic: string;
  /** The SDK's origin discriminator: `ledger` rows settled, `diagnostic` ones did not. */
  source: GuardEvent["source"];
  contractId: string | null;
  ledger: number | null;
  /** Chain time. Only a committed row has it. */
  ledgerClosedAt: string | null;
  /** When this console saw the event. The only time a diagnostic row can have. */
  observedAt: string | null;
  transactionHash: string | null;
  decision: string | null;
  reason: string | null;
  /** When the bookmark was taken, for the cap and for ordering what has no other time. */
  bookmarkedAt: string;
}

/** Which fact placed an item in the timeline. */
export type TimelineOrdering =
  /** A committed row, placed by the ledger that closed it. */
  | "ledger"
  /** A diagnostic row, placed by this console's clock because it has no ledger time. */
  | "observed"
  /** Nothing to place it by: listed after the dated items and labelled as such. */
  | "missing";

export interface TimelineItem {
  record: BookmarkRecord;
  ordering: TimelineOrdering;
  /** The instant used to place this item; `null` when `ordering` is `"missing"`. */
  orderedAtMs: number | null;
  /** The `id` attribute of this event's row, for the link to it. */
  anchorId: string;
  /** True when that row is in the table right now. */
  rowPresent: boolean;
}

/**
 * The network and the storage seam a call acts on. Storage resolution — the
 * `localStorage` default and the no-storage fallback — belongs to
 * `guardScoped.ts`, so this only supplies the network default.
 */
function split(options?: BookmarkOptions): { network: string; scope: ScopedOptions } {
  return {
    network: options?.network ?? NETWORK.name,
    scope: options?.storage === undefined ? {} : { storage: options.storage },
  };
}

/** The guard whose bucket a bookmark for this event belongs in. */
export function bookmarkBucketFor(event: TelemetryEvent, activeGuard: string): string {
  return event.contractId ?? activeGuard;
}

/** The record a bookmark stores for an event, tagged with its bucket and network. */
export function bookmarkFromEvent(
  event: TelemetryEvent,
  params: { guard: string; bookmarkedAt: string; network?: string },
): BookmarkRecord {
  return {
    eventId: event.id,
    network: params.network ?? NETWORK.name,
    guard: params.guard,
    kind: event.kind,
    topic: event.topic,
    source: event.source,
    contractId: event.contractId ?? null,
    ledger: event.ledger ?? null,
    ledgerClosedAt: event.ledgerClosedAt ?? null,
    observedAt: event.observedAt ?? null,
    transactionHash: event.transactionHash ?? null,
    decision: event.decision?.result ?? null,
    reason: event.decision?.reason ?? null,
    bookmarkedAt: params.bookmarkedAt,
  };
}

/** One guard bucket, as stored. A corrupt payload reads as an empty bucket. */
export function loadBookmarks(guard: string, options?: BookmarkOptions): BookmarkRecord[] {
  const { network, scope } = split(options);
  const stored = loadScopedValue<unknown>(BOOKMARKS_STORAGE_BASE, network, guard, scope);
  if (!Array.isArray(stored)) return [];
  const records: BookmarkRecord[] = [];
  for (const entry of stored) {
    const record = readRecord(entry, network);
    // An entry this build cannot attribute is not shown rather than shown wrong:
    // a bookmark with an unreadable origin is the exact row #490 warns about.
    if (record !== null) records.push(record);
  }
  return records;
}

/** Write one guard bucket, capped, and return what was kept. */
export function saveBookmarks(
  records: readonly BookmarkRecord[],
  guard: string,
  options?: BookmarkOptions,
): BookmarkRecord[] {
  const { network, scope } = split(options);
  const kept = enforceCap(records);
  saveScopedValue(BOOKMARKS_STORAGE_BASE, network, guard, kept, scope);
  return kept;
}

/**
 * Add or remove the bookmark over this event, in the bucket the caller names.
 *
 * The bucket is a parameter rather than derived here because the caller knows
 * which guard is on screen; `bookmarkBucketFor` is the derivation this module
 * recommends.
 */
export function toggleBookmark(params: {
  event: TelemetryEvent;
  guard: string;
  bookmarkedAt: string;
  options?: BookmarkOptions;
}): { bookmarked: boolean; records: BookmarkRecord[] } {
  const current = loadBookmarks(params.guard, params.options);
  const index = current.findIndex((record) => record.eventId === params.event.id);
  if (index >= 0) {
    const records = current.filter((_, position) => position !== index);
    return {
      bookmarked: false,
      records: saveBookmarks(records, params.guard, params.options),
    };
  }
  const added = bookmarkFromEvent(params.event, {
    guard: params.guard,
    bookmarkedAt: params.bookmarkedAt,
    network: split(params.options).network,
  });
  return {
    bookmarked: true,
    records: saveBookmarks([...current, added], params.guard, params.options),
  };
}

/**
 * Take one bookmark off, in the bucket its own record names.
 *
 * Removal rather than toggling: the caller may be holding a record whose row
 * has left the table, where there is no button to press and `toggleBookmark`
 * would answer a missing entry by *adding* it back. The bucket is written, not
 * just the caller's copy, because a bookmark you cannot put back is a bookmark
 * the operator thinks they have deleted.
 */
export function removeBookmark(params: {
  eventId: string;
  guard: string;
  options?: BookmarkOptions;
}): BookmarkRecord[] {
  const current = loadBookmarks(params.guard, params.options);
  return saveBookmarks(
    current.filter((record) => record.eventId !== params.eventId),
    params.guard,
    params.options,
  );
}

/** Every bookmark across buckets, oldest-bookmark first, de-duplicated. */
export function mergeBookmarks(buckets: readonly (readonly BookmarkRecord[])[]): BookmarkRecord[] {
  const seen = new Set<string>();
  const merged: BookmarkRecord[] = [];
  for (const bucket of buckets) {
    for (const record of bucket) {
      const key = `${record.network}\u0000${record.guard}\u0000${record.eventId}`;
      if (seen.has(key)) continue;
      seen.add(key);
      merged.push(record);
    }
  }
  return merged;
}

/**
 * The timeline: dated bookmarks in chronological order, undated ones last.
 *
 * `visibleEventIds` is the set of row ids currently in the table, which decides
 * whether an item can link to its source row. The order is total and does not
 * depend on input order: two items with the same instant are separated by their
 * ordering basis (chain time before this console's clock) and then by event id,
 * so a re-render cannot shuffle the sequence the operator is reading.
 */
export function buildTimeline(
  records: readonly BookmarkRecord[],
  visibleEventIds: ReadonlySet<string>,
): TimelineItem[] {
  const items = records.map((record) => {
    const placed = orderingOf(record);
    return {
      record,
      ordering: placed.ordering,
      orderedAtMs: placed.ms,
      anchorId: rowAnchorId(record.eventId),
      rowPresent: visibleEventIds.has(record.eventId),
    };
  });
  items.sort(compareTimelineItems);
  return items;
}

/** What would place this record in the timeline, and by which kind of time. */
export function orderingOf(record: BookmarkRecord): {
  ordering: TimelineOrdering;
  ms: number | null;
} {
  const ledgerMs = parseInstant(record.ledgerClosedAt);
  if (ledgerMs !== null) return { ordering: "ledger", ms: ledgerMs };
  const observedMs = parseInstant(record.observedAt);
  if (observedMs !== null) return { ordering: "observed", ms: observedMs };
  return { ordering: "missing", ms: null };
}

function compareTimelineItems(a: TimelineItem, b: TimelineItem): number {
  if (a.orderedAtMs === null || b.orderedAtMs === null) {
    if (a.orderedAtMs !== b.orderedAtMs) return a.orderedAtMs === null ? 1 : -1;
    // Both undated: neither has a time to compare, so the tie-break below keeps
    // the list stable without implying that anything was ordered by time.
  } else if (a.orderedAtMs !== b.orderedAtMs) {
    return a.orderedAtMs - b.orderedAtMs;
  }
  if (ORDERING_RANK[a.ordering] !== ORDERING_RANK[b.ordering]) {
    return ORDERING_RANK[a.ordering] - ORDERING_RANK[b.ordering];
  }
  if (a.record.eventId !== b.record.eventId) {
    return a.record.eventId < b.record.eventId ? -1 : 1;
  }
  return a.record.guard < b.record.guard ? -1 : a.record.guard > b.record.guard ? 1 : 0;
}

/** Chain time outranks local time when two items land on the same instant. */
const ORDERING_RANK: Record<TimelineOrdering, number> = { ledger: 0, observed: 1, missing: 2 };

/**
 * The `id` attribute a row is given for its event.
 *
 * An event id is `ledger:<txHash>:<topic>` or `diag:<sha256>`, and the topic is
 * read off chain: a contract can name its event with a space in it, which is not
 * legal in an HTML `id`. Percent-encoding is injective — every `%` in the input
 * becomes `%25` — so distinct ids cannot collapse onto one anchor, and the
 * result is whitespace-free and matchable by `getElementById`.
 */
export function rowAnchorId(eventId: string): string {
  return `row-${encodeURIComponent(eventId)}`;
}

/**
 * The instant a timestamp names, or `null` when it names none.
 *
 * Deliberately narrower than `Date.parse`: the SDK's timestamps are ISO-8601,
 * and a value that is *not* one must not be silently placed. `Date.parse("0")`
 * is `946681200000` — New Year's Eve 1999 — so a bare number arriving in place
 * of a close time would sort the item to the start of history rather than tell
 * the operator it has no ordering data.
 */
function parseInstant(value: string | null | undefined): number | null {
  if (typeof value !== "string") return null;
  if (!ISO_INSTANT.test(value)) return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}[T ]/;

/** Keep the newest `BOOKMARK_CAP` bookmarks in the bucket. */
function enforceCap(records: readonly BookmarkRecord[]): BookmarkRecord[] {
  if (records.length <= BOOKMARK_CAP) return [...records];
  const takenAt = (record: BookmarkRecord) => parseInstant(record.bookmarkedAt) ?? 0;
  const byAge = [...records].sort((a, b) => takenAt(a) - takenAt(b) || compareIds(a, b));
  return byAge.slice(byAge.length - BOOKMARK_CAP);
}

function compareIds(a: BookmarkRecord, b: BookmarkRecord): number {
  return a.eventId < b.eventId ? -1 : a.eventId > b.eventId ? 1 : 0;
}

function readRecord(entry: unknown, network: string): BookmarkRecord | null {
  if (typeof entry !== "object" || entry === null) return null;
  const raw = entry as Record<string, unknown>;
  if (typeof raw.eventId !== "string" || raw.eventId === "") return null;
  if (typeof raw.guard !== "string" || raw.guard === "") return null;
  if (raw.source !== "ledger" && raw.source !== "diagnostic") return null;
  return {
    eventId: raw.eventId,
    network: typeof raw.network === "string" ? raw.network : network,
    guard: raw.guard,
    kind: typeof raw.kind === "string" ? (raw.kind as GuardEventKind) : "unknown",
    topic: typeof raw.topic === "string" ? raw.topic : "",
    source: raw.source,
    contractId: nullableString(raw.contractId),
    ledger: typeof raw.ledger === "number" && Number.isFinite(raw.ledger) ? raw.ledger : null,
    ledgerClosedAt: nullableString(raw.ledgerClosedAt),
    observedAt: nullableString(raw.observedAt),
    transactionHash: nullableString(raw.transactionHash),
    decision: nullableString(raw.decision),
    reason: nullableString(raw.reason),
    bookmarkedAt: typeof raw.bookmarkedAt === "string" ? raw.bookmarkedAt : "",
  };
}

function nullableString(value: unknown): string | null {
  return typeof value === "string" && value !== "" ? value : null;
}
