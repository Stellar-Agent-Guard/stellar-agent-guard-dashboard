/**
 * Bounded backoff for reads, and the rule about what may be retried at all
 * (issues #345 and #344).
 *
 * A retry is a second request, and a second request is only free when the first
 * one changed nothing. Soroban RPC throttles and times out, so a read that failed
 * transiently is worth repeating on a capped, jittered schedule; a broadcast that
 * timed out is not, because the network may have accepted the transaction exactly
 * as the connection dropped. That distinction is what this module encodes: the
 * failure is classified (`classifyFailure`), the operation's safety is declared
 * (`OperationSafety`), and only the intersection of a transient failure and a
 * question gets a second attempt (`retryAllowed`).
 */

import { MAX_RETRY_AFTER_MS, retryAfterFromError, retryAfterHint } from "../rpc/backoff.ts";

/** A transient read failure: repeating the same request can legitimately succeed. */
export class RetryableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RetryableError";
  }
}

/**
 * A request that is wrong on its face — a malformed argument, an id that is not
 * a contract, a credential kind this console cannot satisfy. Repeating it returns
 * the same rejection, so it is never a retry candidate however it is worded.
 */
export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ValidationError";
  }
}

/**
 * The operator dismissed the wallet's prompt, so nothing was signed and nothing
 * was broadcast. Distinct from a refusal by the network and from a timeout: the
 * action to take is to ask again deliberately, never to retry automatically.
 */
export class WalletCancellationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WalletCancellationError";
  }
}

/**
 * A broadcast whose answer never arrived — the request left this browser and the
 * connection died before the reply. Whether the transaction landed is something
 * only the ledger can say, so this is reported, never retried: re-sending would
 * not retry the first freeze, it would risk a second one.
 */
export class AmbiguousSubmissionError extends Error {
  /** The hash computed locally from the signed envelope, when one was built. */
  readonly hash: string | null;

  constructor(message: string, hash: string | null = null) {
    super(message);
    this.name = "AmbiguousSubmissionError";
    this.hash = hash;
  }
}

/**
 * Why an attempt failed, in the one vocabulary the read and write paths share
 * (issue #344). The four categories the write path distinguishes are a retryable
 * read, a validation failure, a wallet cancellation and an ambiguous submission;
 * `unclassified` is everything else, and it exists so an unrecognised failure is
 * reported as itself instead of being guessed into one of the four.
 */
export type FailureCategory =
  "retryable-read" | "validation" | "wallet-cancellation" | "ambiguous-submission" | "unclassified";

/**
 * Whether repeating this operation is safe.
 *
 * `idempotent-read` covers anything that only asks the network a question —
 * including a preflight simulation, which costs fees but changes no ledger state.
 * `write` covers anything that could leave a transaction on the network, and a
 * write is attempted exactly once no matter how it failed.
 */
export type OperationSafety = "idempotent-read" | "write";

/**
 * Classify a failure structurally first, by message only for the shapes the RPC
 * and the wallets actually produce.
 *
 * Order matters. A wallet error that says the operator declined is a
 * cancellation even though its text contains "reject", and an error the caller
 * already typed is taken at its word — the typing is the point.
 */
export function classifyFailure(error: unknown): FailureCategory {
  if (error instanceof AmbiguousSubmissionError) return "ambiguous-submission";
  if (error instanceof WalletCancellationError) return "wallet-cancellation";
  if (error instanceof ValidationError) return "validation";
  if (error instanceof RetryableError) return "retryable-read";
  if (isWalletCancellation(error)) return "wallet-cancellation";

  const candidate = error as { message?: unknown; status?: unknown; statusCode?: unknown } | null;
  if (isTransientReadFailure(candidate)) return "retryable-read";
  if (isValidationWording(messageOf(error))) return "validation";
  return "unclassified";
}

/**
 * The idioms a wallet uses when the operator dismisses a prompt.
 *
 * Deliberately narrow, and only ever applied to an error that came from a wallet
 * adapter: "the network rejected the transaction" contains the same verb and
 * means the opposite thing.
 */
const WALLET_DECLINE = /\b(?:user|you)\b[^.\n]{0,48}\b(?:reject|cancell?ed|declin|deni|dismiss)/i;

function walletErrorName(error: unknown): string | null {
  const name = (error as { name?: unknown } | null)?.name;
  return typeof name === "string" ? name : null;
}

/** True when the failure is the operator declining in the wallet, not the network refusing. */
export function isWalletCancellation(error: unknown): boolean {
  const name = walletErrorName(error);
  // `walletConnector` already collapses every provider's wording onto this class.
  if (name === "WalletUserRejectedError") return true;
  // The bare Freighter adapter reports the decline inside a generic `WalletError`,
  // so its text is the only thing that says which it was.
  if (name !== "WalletError") return false;
  return WALLET_DECLINE.test(messageOf(error));
}

/**
 * Whether a second attempt is allowed.
 *
 * Both halves are required: the failure has to be one a repeat can clear, *and*
 * the operation has to be one a repeat cannot damage. This is the whole of
 * issue #344 stated as one predicate.
 */
export function retryAllowed(category: FailureCategory, safety: OperationSafety): boolean {
  return safety === "idempotent-read" && category === "retryable-read";
}

function messageOf(error: unknown): string {
  const message = (error as { message?: unknown } | null)?.message;
  return typeof message === "string" ? message : "";
}

/**
 * The RPC's own transient signals. `NOT_FOUND` is absent on purpose: a not-found
 * is transient only when the caller knows why — the inclusion poll says so by
 * throwing `RetryableError` — and as a bare substring it also matches the
 * definitive "contract not found", which no amount of retrying can fix.
 */
function isTransientReadFailure(
  error: { message?: unknown; status?: unknown; statusCode?: unknown } | null,
): boolean {
  const message = typeof error?.message === "string" ? error.message : "";
  return (
    message.includes("TIMEOUT") ||
    message.includes("TRY_AGAIN_LATER") ||
    message.includes("429") ||
    error?.status === 429 ||
    error?.statusCode === 429
  );
}

function isValidationWording(message: string): boolean {
  return /\binvalid\b|malformed|unsupported|not a valid|must be|cannot satisfy/i.test(message);
}

/** One retry wait, described for whoever needs to tell the operator about it. */
export interface RetryWait {
  /** Zero-based retry number that is about to be attempted. */
  attempt: number;
  /** How long the wait will be, after clamping and (for backoff) jitter. */
  delayMs: number;
  /** Where the delay came from: the provider's hint or this client's backoff. */
  source: "retry-after" | "backoff";
  /** The provider's unclamped request, when it sent a hint. */
  requestedMs: number | null;
  /** True when the provider asked for longer than the clamp allows. */
  clamped: boolean;
}

export interface RetryOptions {
  maxRetries?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  /**
   * Ceiling for a provider `Retry-After` hint. Deliberately separate from
   * `maxDelayMs`: exponential backoff and a provider's requested quiet period
   * are different promises, and only the latter is clamped here.
   */
  maxRetryAfterMs?: number;
  /**
   * Called with each wait before it starts, so a caller can show the operator
   * why the read is paused and for how long.
   */
  onWait?: (wait: RetryWait) => void;
  /** Cancels a pending wait and stops further retries. */
  signal?: AbortSignal;
  /**
   * Whether repeating the operation could damage anything. Defaults to
   * `idempotent-read` because everything that reaches this helper today is a
   * question to the network; a `write` is attempted exactly once, whatever the
   * failure looked like, so no broadcast is ever repeated on a timeout.
   */
  safety?: OperationSafety;
}

export async function withBackoff<T>(
  operation: () => Promise<T>,
  options: RetryOptions = {},
): Promise<T> {
  const maxRetries = options.maxRetries ?? 5;
  const baseDelayMs = options.baseDelayMs ?? 500;
  const maxDelayMs = options.maxDelayMs ?? 8000;
  const maxRetryAfterMs = options.maxRetryAfterMs ?? MAX_RETRY_AFTER_MS;
  const safety = options.safety ?? "idempotent-read";

  let attempt = 0;
  while (true) {
    options.signal?.throwIfAborted();
    try {
      const result = await operation();
      return result;
    } catch (error: any) {
      if (!retryAllowed(classifyFailure(error), safety)) {
        throw error;
      }
      if (attempt >= maxRetries) {
        throw error;
      }

      const wait = retryWait(error, attempt, {
        baseDelayMs,
        maxDelayMs,
        maxRetryAfterMs,
      });
      options.onWait?.(wait);
      await waitFor(wait.delayMs, options.signal);
      attempt++;
    }
  }
}

/**
 * The next wait: the provider's hint when this is a rate-limited read and the
 * hint is usable, otherwise the client's own capped, jittered backoff.
 *
 * A hint is honoured only for rate-limit signals. A `Retry-After` attached to a
 * timeout or a not-found error says nothing about that failure, so applying it
 * there would turn an unrelated header into an extra wait.
 */
function retryWait(
  error: any,
  attempt: number,
  limits: { baseDelayMs: number; maxDelayMs: number; maxRetryAfterMs: number },
): RetryWait {
  if (isRateLimited(error)) {
    const hint = retryAfterHint(retryAfterFromError(error), {
      maxDelayMs: limits.maxRetryAfterMs,
    });
    if (hint) {
      return {
        attempt,
        delayMs: hint.delayMs,
        source: "retry-after",
        requestedMs: hint.requestedMs,
        clamped: hint.clamped,
      };
    }
  }

  const delay = Math.min(limits.maxDelayMs, limits.baseDelayMs * Math.pow(2, attempt));
  // Jitter is drawn from the current delay so retries from a fleet do not
  // arrive together; it never exceeds the ceiling above.
  return {
    attempt,
    delayMs: Math.random() * delay,
    source: "backoff",
    requestedMs: null,
    clamped: false,
  };
}

function isRateLimited(error: any): boolean {
  const message = typeof error?.message === "string" ? error.message : "";
  return (
    error?.status === 429 ||
    error?.statusCode === 429 ||
    /\b429\b/.test(message) ||
    /TRY_AGAIN_LATER/i.test(message) ||
    /rate.?limit/i.test(message)
  );
}

/**
 * Wait, but stop immediately if the caller's signal aborts. Rejecting with the
 * signal's own reason keeps cancellation and timeout behaviour identical to the
 * rest of the read path, instead of swallowing the abort and retrying on.
 */
function waitFor(delayMs: number, signal?: AbortSignal): Promise<void> {
  if (!signal) {
    return new Promise((resolve) => setTimeout(resolve, delayMs));
  }
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(id);
      reject(signal.reason);
    };
    const id = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, delayMs);
    signal.addEventListener("abort", onAbort, { once: true });
  });
}
