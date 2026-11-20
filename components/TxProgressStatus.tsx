"use client";

/**
 * The transaction status region (issue #539).
 *
 * One concise line per write: the operation and its current stage while it is
 * in flight, then the operation and its final outcome. The line comes from
 * `lib/guard/txProgress.ts`, which reports each stage once and never includes
 * envelope contents; this component only renders it.
 *
 * Two static elements are rendered up front and only their text changes —
 * replacing a live region's node would silence it:
 *
 *   - `role="status"` (polite) carries stages and successful outcomes;
 *   - `role="alert"` (assertive) carries outcomes that need the operator now —
 *     refused, failed, declined, interrupted.
 *
 * Exactly one of them holds text at a time, so a line is never spoken twice.
 * Like the announcer, the region is mounted once in the page shell, outside
 * every panel and dialog, so it outlives the control that started the write.
 */

import { useSyncExternalStore } from "react";
import {
  IDLE_TX_PROGRESS,
  subscribeTxProgress,
  txProgressSnapshot,
} from "../lib/guard/txProgress.ts";

const serverSnapshot = () => IDLE_TX_PROGRESS;

export function TxProgressStatus() {
  const progress = useSyncExternalStore(subscribeTxProgress, txProgressSnapshot, serverSnapshot);
  const urgent = progress.tone === "failure";

  return (
    <div className="visually-hidden" data-testid="tx-progress" data-tone={progress.tone}>
      <p role="status" aria-atomic="true" aria-label="Transaction progress">
        {urgent ? "" : progress.message}
      </p>
      <p role="alert" aria-atomic="true" aria-label="Transaction problem">
        {urgent ? progress.message : ""}
      </p>
    </div>
  );
}
