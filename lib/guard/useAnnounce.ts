/**
 * Screen-reader announcements for the transaction lifecycle.
 *
 * The submit path is plain TypeScript, not React, so the channel is a tiny
 * module-level queue rather than context: `announce()` can be called from
 * `submit.ts` at the exact moment a milestone happens, and the
 * `<AriaAnnouncer />` mounted in the layout drains the queue into the live
 * regions when it is on screen. Announcements made before the component
 * mounts are not lost — subscribing flushes the backlog.
 *
 * Two rules keep the channel usable rather than noisy:
 *
 *   1. Redundant messages are dropped. A poll that re-renders the same
 *      milestone, or a state that flaps and settles inside the duplicate
 *      window, must not make the screen reader repeat itself — that is the
 *      "spam" the announcer exists to prevent.
 *   2. The queue is bounded. Rapid distinct updates coalesce into the most
 *      recent few messages instead of growing without limit.
 */

import { useCallback } from "react";

/** `polite` waits for a pause; `assertive` interrupts — reserved for critical alerts. */
export type AnnouncePriority = "polite" | "assertive";

export interface Announcement {
  message: string;
  priority: AnnouncePriority;
  /** `Date.now()` at the moment `announce()` accepted the message. */
  at: number;
}

/** Bounded backlog: a flood of rapid updates must not grow without limit. */
export const ANNOUNCE_QUEUE_CAP = 20;

/**
 * An identical message inside this window is redundant, not news. This is
 * what suppresses repeats caused by rapid state updates (a re-render storm,
 * a polling tick that re-announces the same milestone).
 */
export const DUPLICATE_WINDOW_MS = 1_500;

let queue: Announcement[] = [];
let lastAccepted: Announcement | null = null;
const listeners = new Set<(pending: Announcement[]) => void>();

function emit(): void {
  for (const listener of [...listeners]) listener(queue);
}

/**
 * Queue a message for the screen reader.
 *
 * Returns `true` when the message was accepted, `false` when it was dropped
 * as redundant (already queued, or spoken within the duplicate window).
 */
export function announce(
  message: string,
  priority: AnnouncePriority = "polite",
  now: number = Date.now(),
): boolean {
  const text = message.trim();
  if (text.length === 0) return false;
  if (queue.some((entry) => entry.message === text && entry.priority === priority)) return false;
  if (
    lastAccepted !== null &&
    lastAccepted.message === text &&
    lastAccepted.priority === priority &&
    now - lastAccepted.at < DUPLICATE_WINDOW_MS
  ) {
    return false;
  }
  const entry: Announcement = { message: text, priority, at: now };
  queue = [...queue, entry].slice(-ANNOUNCE_QUEUE_CAP);
  lastAccepted = entry;
  emit();
  return true;
}

/**
 * Watch the queue. The listener is called synchronously with the current
 * backlog (so nothing announced before mount is missed) and again on every
 * change. Returns the unsubscribe function.
 */
export function subscribeAnnouncements(listener: (pending: Announcement[]) => void): () => void {
  listeners.add(listener);
  listener(queue);
  return () => {
    listeners.delete(listener);
  };
}

/** Drop the head message — called by the announcer once it has been spoken. */
export function shiftAnnouncement(): void {
  if (queue.length === 0) return;
  queue = queue.slice(1);
  emit();
}

/** The queue as it currently stands (newest at the end). For tests and diagnostics. */
export function pendingAnnouncements(): Announcement[] {
  return queue;
}

/** Empty the queue and the duplicate window. For tests. */
export function clearAnnouncements(): void {
  queue = [];
  lastAccepted = null;
  emit();
}

/**
 * The hook form of `announce()`, stable across renders so it can be used in
 * effect dependency lists and passed to child components.
 */
export function useAnnounce(): (message: string, priority?: AnnouncePriority) => void {
  return useCallback((message: string, priority: AnnouncePriority = "polite") => {
    announce(message, priority);
  }, []);
}
