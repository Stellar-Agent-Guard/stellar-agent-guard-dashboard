export function formatTimeAgo(
  timestampSeconds: bigint | number,
  nowSeconds: bigint | number,
): string {
  const ts =
    typeof timestampSeconds === "bigint" ? timestampSeconds : BigInt(Math.floor(timestampSeconds));
  const now = typeof nowSeconds === "bigint" ? nowSeconds : BigInt(Math.floor(nowSeconds));
  let diff = now - ts;

  if (diff < 0n) {
    diff = 0n;
  }

  // MARK: i18n sweep target ("just now", "s", "m", "h", "d")
  if (diff < 10n) {
    return "just now";
  }
  if (diff < 60n) {
    return `${diff}s`;
  }

  const minutes = diff / 60n;
  if (minutes < 60n) {
    return `${minutes}m`;
  }

  const hours = minutes / 60n;
  if (hours < 24n) {
    return `${hours}h`;
  }

  const days = hours / 24n;
  return `${days}d`;
}

// ------------------------------------------------------------------------------
// Unified countdown formatter
//
// Formats an absolute remaining duration (seconds) as a short, human
// countdown string. This is purely text formatting -- it does NOT encode
// urgency policy (critical/warning tiers). Consumers own their threshold
// logic (e.g. dmsUrgency-style helpers) and render colors/badges accordingly.
//
// Semantics:
//   - Negative input   -> { text: "expired", expired: true }
//   - Zero           -> { text: "now", expired: false }
//   - 0 <  rem < 60  -> { text: "<1m", expired: false }
//   - 60 <= rem < 3600 -> "<mm"
//   - 3600 <= rem < 86400 -> "<h"
//   - >= 86400       -> "<d" (capped at "999d+")
//
// No-float rule: all arithmetic is done in bigint space. u64 second
// values (e.g. 2x64-1) are exactly representable and never round through
// IEEE-754 doubles. Number inputs are coerced via Math.floor + BigInt() at
// the boundary only.
//
// The 999d hard cap avoids absurd displays like "10475d" for very
// long windows; consumers that need exact days should read the raw value.

export const MAX_CAPPED_DAYS = 999n;

export interface FormatRemainingResult {
  /** Human-readable countdown text. */
  text: string;
  /** True when the input was negative (i.e. past the deadline). */
  expired: boolean;
}

export function formatRemaining(secondsRemaining: bigint | number): FormatRemainingResult {
  const rem =
    typeof secondsRemaining === "bigint"
      ? secondsRemaining
      : BigInt(Math.floor(secondsRemaining));

  if (rem < 0n) {
    return { text: "expired", expired: true };
  }
  if (rem === 0n) {
    return { text: "now", expired: false };
  }
  if (rem < 60n) {
    return { text: "<1m", expired: false };
  }

  const minutes = rem / 60n;
  if (minutes < 60n) {
    return { text: `${minutes}m`, expired: false };
  }

  const hours = minutes / 60n;
  if (hours < 24n) {
    return { text: `${hours}h`, expired: false };
  }

  const days = hours / 24n;
  if (days > MAX_CAPPED_DAYS) {
    return { text: `${MAX_CAPPED_DAYS}d+`, expired: false };
  }
  return { text: `${days}d`, expired: false };
}
