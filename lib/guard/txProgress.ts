/**
 * Transaction progress as one concise, screen-reader-friendly status line
 * (issue #539).
 *
 * A wallet-authorized write passes through several internal steps — two
 * simulations, one or more authorization signatures, an envelope signature, a
 * broadcast and an inclusion poll — and announcing each of them overwhelms
 * assistive technology. This module collapses that into the handful of stages
 * an operator actually acts on, and enforces three rules:
 *
 *   1. **Each stage is spoken once.** Stages only move forward within a run, so
 *      a second authorization prompt, a retried simulation or a repeated poll
 *      cannot make the region repeat itself.
 *   2. **Every message names the operation, and the run ends with its outcome.**
 *      "Policy install: waiting for wallet approval" tells the operator what is
 *      being signed; the final line says whether it landed, failed, was refused,
 *      declined, exported, interrupted or has an unknown outcome.
 *   3. **Nothing from the envelope is ever spoken.** Messages are assembled
 *      from a fixed vocabulary plus the contract function's name, and the name
 *      itself is only used when it is a plain Soroban symbol. XDR, signatures,
 *      arguments, hashes and network error payloads never reach the region —
 *      the panel that started the write shows those on screen.
 *
 * The state lives at module level (like `useAnnounce`) because the submit path
 * is plain TypeScript, not React; `<TxProgressStatus />` subscribes to it and
 * renders the line into a `role="status"` / `role="alert"` pair.
 */

import type { InvokeResult } from "./submit.ts";
import type { WritePhase } from "./writeReview.ts";

/** The mid-flight stages, in the only order they may be reported. */
export type TxStage = "simulating" | "signing" | "submitting";

const STAGE_ORDER: Readonly<Record<TxStage, number>> = {
  simulating: 0,
  signing: 1,
  submitting: 2,
};

/** How a run ended, reduced to what the operator needs to hear. */
export type TxOutcome =
  | { kind: "confirmed"; ledger: number | null }
  | { kind: "failed" }
  /** Broadcast, but the network never said what became of it. */
  | { kind: "ambiguous" }
  | { kind: "refused"; stage: string }
  | { kind: "cancelled" }
  | { kind: "exported" }
  | { kind: "interrupted"; phase: WritePhase }
  /** The write threw before it produced a result; the panel shows why. */
  | { kind: "errored" };

/** `progress` and `success` are polite; `failure` interrupts. */
export type TxTone = "idle" | "progress" | "success" | "failure";

export interface TxProgressState {
  /** Increases with every run; 0 before the first. */
  run: number;
  /** The operator-facing operation label, or null when idle. */
  operation: string | null;
  stage: TxStage | null;
  outcome: TxOutcome | null;
  tone: TxTone;
  /** The single line the status region shows and speaks. */
  message: string;
}

export const IDLE_TX_PROGRESS: TxProgressState = Object.freeze({
  run: 0,
  operation: null,
  stage: null,
  outcome: null,
  tone: "idle",
  message: "",
}) as TxProgressState;

/** Operator words for the guard's own entry points. */
const KNOWN_OPERATIONS: Readonly<Record<string, string>> = {
  set_policy: "Policy install",
  revoke_policy: "Policy revoke",
  freeze: "Freeze",
  unfreeze: "Unfreeze",
  initialize: "Guard initialization",
  heartbeat: "Heartbeat",
  rotate_agent_key: "Agent key rotation",
};

/**
 * A Soroban contract function name: a symbol of at most 32 characters from
 * `[A-Za-z0-9_]`. Anything else is not a function name this module will speak.
 */
const SOROBAN_SYMBOL = /^[A-Za-z_][A-Za-z0-9_]{0,31}$/;

/** Fallback label when the operation name is missing or not a plain symbol. */
export const GENERIC_OPERATION = "Contract call";

/**
 * The label spoken for a contract function.
 *
 * Unknown but well-formed names are spoken as-is with underscores read as
 * spaces; anything that is not a plain Soroban symbol — which is how an
 * envelope, argument or base64 payload would look if one were ever passed in
 * by mistake — collapses to the generic label.
 */
export function operationLabel(fn: string | null | undefined): string {
  if (typeof fn !== "string" || !SOROBAN_SYMBOL.test(fn)) return GENERIC_OPERATION;
  const known = KNOWN_OPERATIONS[fn];
  if (known) return known;
  const words = fn.replace(/_+/g, " ").trim();
  if (words.length === 0) return GENERIC_OPERATION;
  return `${words[0]!.toUpperCase()}${words.slice(1)}`;
}

const STAGE_COPY: Readonly<Record<TxStage, string>> = {
  simulating: "simulating",
  signing: "waiting for wallet approval",
  submitting: "submitted, waiting for confirmation",
};

const REFUSED_STAGE_COPY: Readonly<Record<string, string>> = {
  discovery: "simulation",
  enforcement: "the guard's enforcement check",
  submission: "submission",
  wallet: "wallet checks",
};

const INTERRUPTED_PHASE_COPY: Readonly<Record<WritePhase, string>> = {
  discovery: "simulation",
  authorization: "authorization signing",
  envelope: "transaction signing",
  submission: "submission",
};

/** The spoken line for a mid-flight stage. */
export function stageMessage(operation: string, stage: TxStage): string {
  return `${operation}: ${STAGE_COPY[stage]}`;
}

/** The spoken line, and its urgency, for a final outcome. */
export function outcomeMessage(
  operation: string,
  outcome: TxOutcome,
): { message: string; tone: "success" | "failure" } {
  switch (outcome.kind) {
    case "confirmed":
      return {
        message:
          outcome.ledger !== null
            ? `${operation} confirmed on ledger ${outcome.ledger}`
            : `${operation} confirmed on the network`,
        tone: "success",
      };
    case "failed":
      return { message: `${operation} failed on chain`, tone: "failure" };
    case "ambiguous":
      // Something was broadcast and may have landed, so the line must claim
      // neither success nor rejection (issue #341).
      return {
        message: `${operation} outcome unknown — verify on chain before retrying`,
        tone: "failure",
      };
    case "refused":
      return {
        message: `${operation} refused during ${
          REFUSED_STAGE_COPY[outcome.stage] ?? "pre-flight checks"
        } — nothing was broadcast`,
        tone: "failure",
      };
    case "cancelled":
      return {
        message: `${operation} declined in the wallet — nothing was broadcast`,
        tone: "failure",
      };
    case "exported":
      // The operator asked for this; it is a neutral, successful end of the run.
      return {
        message: `${operation} exported for offline signing — nothing was broadcast`,
        tone: "success",
      };
    case "interrupted":
      // At submission the provider may have been the only witness to a
      // broadcast, so the line must not claim nothing happened (issue #341).
      return {
        message: `${operation} interrupted during ${INTERRUPTED_PHASE_COPY[outcome.phase]} — ${
          outcome.phase === "submission"
            ? "verify on chain before retrying"
            : "nothing was broadcast; review and retry"
        }`,
        tone: "failure",
      };
    case "errored":
      return {
        message: `${operation} did not complete — see the panel for details`,
        tone: "failure",
      };
  }
}

/**
 * Reduce an `InvokeResult` to the outcome the region speaks. Only the result's
 * kind and a few scalar fields are read — never `xdr`, `detail`, `hash`,
 * `events` or diagnostics.
 */
export function outcomeOf(result: InvokeResult): TxOutcome {
  switch (result.kind) {
    case "submitted":
      return {
        kind: "confirmed",
        ledger:
          typeof result.ledger === "number" && result.status === "SUCCESS" ? result.ledger : null,
      };
    case "failed":
      return { kind: "failed" };
    case "ambiguous":
      return { kind: "ambiguous" };
    case "cancelled":
      return { kind: "cancelled" };
    case "exported":
      return { kind: "exported" };
    case "refused":
      return result.writeInterruption
        ? { kind: "interrupted", phase: result.writeInterruption.phase }
        : { kind: "refused", stage: result.stage };
  }
}

// ── The store ──────────────────────────────────────────────────────────────

let state: TxProgressState = IDLE_TX_PROGRESS;
let runCounter = 0;
const listeners = new Set<() => void>();

function publish(next: TxProgressState): void {
  state = next;
  for (const listener of [...listeners]) listener();
}

/** The current line, for `useSyncExternalStore`. */
export function txProgressSnapshot(): TxProgressState {
  return state;
}

/** Subscribe to changes; returns the unsubscribe function. */
export function subscribeTxProgress(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Back to idle. Tests use it; the app never needs to. */
export function resetTxProgress(): void {
  runCounter = 0;
  publish(IDLE_TX_PROGRESS);
}

/** A handle to one write's progress. Every method is a no-op once superseded. */
export interface TxRun {
  readonly id: number;
  readonly operation: string;
  /** Report a stage. Repeats and backwards moves are ignored. Returns whether it was published. */
  stage(stage: TxStage): boolean;
  /** Report the final outcome. Only the first call counts. Returns whether it was published. */
  finish(outcome: TxOutcome): boolean;
}

/**
 * Start tracking a write for the contract function `fn`. A newer run replaces
 * an older one in the region; the older handle then goes quiet, so a slow
 * write that settles late cannot overwrite the operator's current action.
 */
export function beginTxProgress(fn: string | null | undefined): TxRun {
  const id = ++runCounter;
  const operation = operationLabel(fn);
  let current: TxStage | null = null;
  let finished = false;

  const isLive = (): boolean => state.run === id && !finished;

  publish({ run: id, operation, stage: null, outcome: null, tone: "progress", message: "" });

  return {
    id,
    operation,
    stage(stage) {
      if (!isLive()) return false;
      if (current !== null && STAGE_ORDER[stage] <= STAGE_ORDER[current]) return false;
      current = stage;
      publish({
        run: id,
        operation,
        stage,
        outcome: null,
        tone: "progress",
        message: stageMessage(operation, stage),
      });
      return true;
    },
    finish(outcome) {
      if (!isLive()) return false;
      finished = true;
      const spoken = outcomeMessage(operation, outcome);
      publish({
        run: id,
        operation,
        stage: current,
        outcome,
        tone: spoken.tone,
        message: spoken.message,
      });
      return true;
    },
  };
}
