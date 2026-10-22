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

/**
 * One instant rendered two ways, so a timestamp cannot be misread across
 * teams in different time zones (issue #387).
 *
 * The UTC rendering is the stable, unambiguous value — identical on every
 * operator's screen and safe to quote in an incident report. The local
 * rendering is what the operator reads at a glance, and it always carries an
 * explicit zone label (`UTC+02:00`) so "14:03" is never ambiguous — least of
 * all across a daylight-saving transition, where the same local wall time can
 * occur twice a year.
 */
export interface EventTimestamp {
  /** Stable UTC rendering of the instant: `2026-03-08T06:59:59Z`. */
  utc: string;
  /** Wall-clock rendering in the display zone: `2026-03-08 01:59:59`. */
  local: string;
  /** Explicit zone label for the local rendering: `UTC-05:00`. */
  zoneLabel: string;
}

/** Formatters are expensive to build; one per requested zone is plenty. */
const timestampFormatterCache = new Map<string | undefined, Intl.DateTimeFormat>();

function timestampFormatter(timeZone?: string): Intl.DateTimeFormat {
  let formatter = timestampFormatterCache.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
      timeZoneName: "longOffset",
    });
    timestampFormatterCache.set(timeZone, formatter);
  }
  return formatter;
}

/**
 * Render an event's timestamp as both a stable UTC value and an explicitly
 * zoned local value.
 *
 * `timeZone` defaults to the browser's zone; tests (and anyone comparing
 * regions) can pin one. Returns null for a missing or unparseable timestamp —
 * an invalid timestamp renders as absence, never as a guessed date, and the
 * caller keeps its `—` placeholder.
 *
 * The UTC value is derived from the parsed instant, so it is unaffected by
 * the display zone and by DST; the zone label is derived from the *same*
 * instant, so around a DST transition the label changes with the offset that
 * was actually in force at that moment.
 */
export function formatEventTimestamp(
  iso: string | null | undefined,
  timeZone?: string,
): EventTimestamp | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;

  // Stable machine-readable form: ISO-8601 UTC without milliseconds.
  const utc = date.toISOString().replace(/\.\d{3}Z$/, "Z");

  const parts = timestampFormatter(timeZone).formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((piece) => piece.type === type)?.value ?? "";
  const local =
    `${part("year")}-${part("month")}-${part("day")}` +
    ` ${part("hour")}:${part("minute")}:${part("second")}`;

  // `longOffset` yields "GMT+02:00", or bare "GMT" at zero offset. Rendered
  // as "UTC…" because that is the frame of reference operators compare in.
  const offsetName = part("timeZoneName");
  const zoneLabel =
    offsetName === "GMT" || offsetName === "UTC" ? "UTC+00:00" : offsetName.replace(/^GMT/, "UTC");

  return { utc, local, zoneLabel };
}