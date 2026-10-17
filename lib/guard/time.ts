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

/**
 * Result of formatting a countdown.
 *
 * - `text`: the human-readable remaining string (e.g. "2d", "<m1", "now").
 *           When expired, this is the literal "expired" label. Consumers that
 *           want a different label can branch on the `expired` flag.
 * - `expired`: true when the input is negative (i.e. the deadline has passed).
 *           This is the explicit expiry signal so consumers can branch on it
 *           without parsing the text.
 */
export interface FormattedRemaining {
  text: string;
  expired: boolean;
}

/**
 * Cap for the days tier. Anything at or above this is rendered as
 * "999d+" to avoid absurd values like "10475d" from a misconfigured
 * deadline or an accidental unit bug in a consumer.
 */
export const FORMAT_REMAINING_DAYS_CAP = 999n;

/**
 * Format a remaining duration in seconds into a short human-readable string.
 *
 * This formatter is deliberately dumb: text only, no urgency tiering.
 * Urgency policy (e.g. "critical < 10% of window") requires context that
 * the formatter does not have, so it stays with consumers (dmsUrgency-style
 * helpers). This is the scope boundary for this utility.
 *
 * Precision ladder:
 *   - negative         -> expired: true, text = "expired"
 *   - 0                -> "now", expired: false
 *   - (0, 60)          -> "now" (sub-minute, non-zero)
 *   - [60, 3600)      -> "<n>m"
 *   - [3600, 86400)    -> "<n>h"
 *   - >= 86400         -> "<n>d" (capped at "999d+")
 *
 * Uses bigint arithmetic internally so u64 seconds values do not lose
 * precision through float conversion. Number inputs are floored to an
 * integer before being converted to bigint.
 */
export function formatRemaining(msSeconds: bigint | number): FormattedRemaining {
  const seconds =
    typeof msSeconds === "bigint" ? msSeconds : BigInt(Math.floor(msSeconds));

  if (seconds < 0n) {
    // Overdue: signal expiry via the flag and use a distinct label.
    // Consumers that want the overdue duration can compute it themselves.
    return { text: "expired", expired: true };
  }

  if (seconds < 60n) {
    // Sub-minute including zero: avoid flickering "59s" -> "58s" -> ... on a
    // countdown that refreshes second-by-second; "now" is stable and clear.
    return { text: "now", expired: false };
  }

  const minutes = seconds / 60n;
  if (minutes < 60n) {
    return { text: `${minutes}m`, expired: false };
  }

  const hours = minutes / 60n;
  if (hours < 24n) {
    return { text: `${hours}h`, expired: false };
  }

  const days = hours / 24n;
  if (days >= FORMAT_REMAINING_DAYS_CAP) {
    return { text: `${FORMAT_REMAINING_DAYS_CAP}+d`, expired: false };
  }
  return { text: `${days}d`, expired: false };
}
