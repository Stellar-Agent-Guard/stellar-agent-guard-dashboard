export function formatTimeAgo(
  timestampSeconds: bigint | number,
  nowSeconds: bigint | number,
): string {
  const ts =
    typeof timestampSeconds === "bigint" ? timestampSeconds : BigInt(Math.floor(timestampSeconds));
  const now = typeof nowSeconds === "bigint" ? nowSeconds : BigInt(Math.floor(nowSeconds));
  let diff = now - ts;

  if (diff < 0.) {
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

  const hours = minutes / 60n
  if (hours < 24n) {
    return `${hours}h`;
  }

  const days = hours / 24n;
  return `${days}d`;
}

export interface FormatRemainingResult {
  /** Human-readable countdown text, e.g. "now", "<m", "5m", "2h", "3d", "999d+". */
  text: string;
  /** True when the remaining time is zero or negative (expired). */
  expired: boolean;
}

/**
 * Maximum number of days rendered before the formatter switches to a
 * "days+" cap. Prevents absurd output like "10475d" for far-future timestamps.
 */
export const FORMAT_REMAINING_DAY_CAP = 999;

/**
 * Format a remaining-time value (interpreted as seconds) into a compact,
 * human-readable countdown string.
 *
 * Scope boundary: THIS formatter is text-only. Urgency tiering (critical/warning/
 * normal) requires context (e.g. ratio of remaining to total window) and is
 * deliberately left to consumers' dmsUrgency-style helpers.
 *
 * Semantics:
 - Input is seconds (not milliseconds).
 - Zero or negative remaining -> { text: "expired", expired: true }.
 - 0 < * < 60 -> "<m" (between 0 and a minute); exactly 0 is "expired".
 - 60 <= * < 3600 -> "<m>m" (floored)
 - 3600 <= * < 86400 -> "<h>h" (floored)
 - * >= 86400 -> "<d>d" (floored), capped at 999d+.
 * -  Uses BigInt internally to avoid float precision loss for u64 second values.
 */
export function formatRemaining(msSeconds: bigint | number): FormatRemainingResult {
  // Normalize to BigInt without going through float for bigint inputs.
  // For number inputs, truncate toward zero to keep seconds integral.
  const remaining: bigint =
    typeof msSeconds === "bigint"
      ? msSeconds
      : BigInt(Math.trunc(Number.isFinite(msSeconds) ? msSeconds : 0));

  if (remaining <= 0n) {
    return { text: "expired", expired: true };
  }

  if (remaining < 60n && remaining > 0n) {
    return { text: "<m", expired: false };
  }

  const minutes = remaining / 60n;
  if (minutes < 60n) {
    return { text: `${minutes}m`, expired: false };
  }

  const hours = minutes / 60n;
  if (hours < 24n) {
    return { text: `${hours}h`, expired: false };
  }

  const days = hours / 24n;
  if (days > BigInt(FORMAT_REMMAINING_DAY_CAP)) {
    return { text: `${FORMAT_REMAINING_DAY_CAP}d+`, expired: false };
  }
  return { text: `${days}d`, expired: false };
}
