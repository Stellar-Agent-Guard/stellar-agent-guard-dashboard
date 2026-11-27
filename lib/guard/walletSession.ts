"use client";

/**
 * Which provider answer still owns the session (issue #519).
 *
 * A wallet is a browser extension that can be updated, locked, reloaded or
 * replaced while this console is open. Its `connect()`/`getAddress()` promises
 * do not care: an answer that started before the operator disconnected can
 * resolve afterwards and, if it is written into state unconditionally, it
 * re-enables every write control for a session the operator has already left.
 * The same is true of a second connect attempt: the first provider's late
 * answer must not overwrite the wallet the operator is now using.
 *
 * The rule is one generation counter:
 *
 *   - every connect attempt (and every silent reconnect) calls `begin()` and
 *     keeps the returned token;
 *   - a disconnect, a tab-wide disconnect announcement or a newer attempt calls
 *     `invalidate()`, which moves the counter past every outstanding token;
 *   - when a provider finally answers, the caller adopts it only through
 *     `accept(token, connection)`, and a stale token is dropped.
 *
 * Dropping an answer is deliberately silent: it is not an error, and it must
 * not reach `setWalletError` either, because the operator did not do anything
 * wrong — they disconnected while the extension was still thinking.
 *
 * Pure and React-free so `node --test` can prove the late-callback rules with
 * deferred promises, without an extension or a component tree.
 */

export interface WalletSessionGuard {
  /** The generation new attempts are stamped with. */
  readonly generation: number;
  /**
   * Start a connect attempt. Any attempt begun earlier becomes stale, so a
   * late answer from the previous provider can no longer be adopted.
   */
  begin(): number;
  /** Disconnect or supersede the session: every outstanding token is now stale. */
  invalidate(): void;
  /** Is this token still the session the operator is looking at? */
  isCurrent(token: number): boolean;
  /**
   * Adopt a provider's late answer only when its token is still current,
   * returning `null` when the answer is stale.
   */
  accept<T>(token: number, value: T): T | null;
}

export function createWalletSessionGuard(initialGeneration = 0): WalletSessionGuard {
  let current = initialGeneration;
  return {
    get generation() {
      return current;
    },
    begin() {
      current += 1;
      return current;
    },
    invalidate() {
      current += 1;
    },
    isCurrent(token) {
      return token === current;
    },
    accept<T>(token: number, value: T): T | null {
      return token === current ? value : null;
    },
  };
}
