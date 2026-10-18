export interface FormattedRemaining {
  text: string;
  expired: boolean;
}

/**
 * Format a remaining duration in seconds into a compact human string.
 *
 * This formatter is deliberately "dumb" -- it only produces text and an
 * expired signal. Urgency tiering (i.e. critical < 10% of window) is a
 * consumer-owned policy and must not live here.
 *
 * Semantics:
 *  - remaining <= 0 -> { text: "expired", expired: true }
 *  - 0 < remaining < 60 -> { text: "<m1", expired: false }
 *  - 60 <= remaining < 3600 -> minutes (e.g. "3m")
 *  - 3600 <= remaining < 86400 -> hours + minutes (e.g. "1h30m")
 *  - >= 86400 -> days + hours (e.g. "1d2h"), capped at "999d+"
 *
 * Input may be bigint or number. BigInt input is converted to number only
 * after clamping to the cap threshold, so we never lose precision for
 * u64 values that exceed Number.safeInteger.
 */
export function formatRemaining(
  remainingSeconds: bigint | number,
): FormattedRemaining {
  const seconds =
    typeof remainingSeconds === "bigint"
      ? remainingSeconds
      : BigInt(Math.floor(remainingSeconds));

  if (seconds <= 0n) {
    return { text: "expired", expired: true };
  }

  // Cap at 999d+ to avoid absurd large values like "10475d".
  const CAP_SECONDS = BigInt(86400 * 999);
  if (seconds >= CAP_SECONDS) {
    return { text: "999d+", expired: false };
  }

  // Safe to convert to number now -- value is below the cap.
  const total = Number(seconds);

  if (total < 60) {
    return { text: "<m1", expired: false };
  }

  if (total < 3600) {
    const minutes = Math.floor(total / 60);
    return { text: `${minutes}m`, expired: false };
  }

  if (total < 86400) {
    const hours = Math.floor(total / 3600);
    const minutes = Math.floor((total % 3600) / 60);
    const text = minutes > 0 ? `${hours}h${minutes}m` : `${hours}h`;
    return { text, expired: false };
  }

  const days = Math.floor(total / 86400);
  const hours = Math.floor((total % 86400) / 3600);
  const text = hours > 0 ? `${days}d${hours}h` : `${days}d`;
  return { text, expired: false };
}

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