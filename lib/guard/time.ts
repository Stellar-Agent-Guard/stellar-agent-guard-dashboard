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

/**
 * A date or date-time that carries no zone and no offset, e.g. `2026-03-08T02:30:00`.
 *
 * `Date.parse` reads a *time* without a zone in the *host's* zone, so the same
 * text becomes a different instant on two operators' machines — and around a
 * daylight-saving transition it can become an instant that never existed in
 * that zone. A bare date (`2026-09-24`) is already UTC to `Date.parse`, so it
 * needs no correction.
 */
function withUtcZone(text: string): string {
  const zoneless = text.match(/^(\d{4}-\d{2}-\d{2})(?:[T ](\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?))?$/);
  if (!zoneless) return text;
  const [, datePart, timePart] = zoneless;
  if (!datePart || !timePart) return text;
  return `${datePart}T${timePart}Z`;
}

/**
 * The one canonical rendering of an instant for machine-readable exports
 * (issue #318): ISO-8601 UTC at second precision with a `Z` suffix — the same
 * bytes `formatEventTimestamp` shows in its `utc` column on screen.
 *
 * Three cases, and the reason each is what it is:
 *
 * - Absent (null, undefined, blank) returns the empty string, which every
 *   export renders as an empty cell rather than an invented date.
 * - A value that denotes an instant is normalised to UTC. An explicit offset
 *   (`+02:00`) is folded into the same instant; a zone-less wall time is read
 *   as UTC rather than as the operator's local time, because a zone-less
 *   string means two different instants in two different zones, and an export
 *   that changed with the browser's `TZ` could not be compared by two people.
 * - A value that does not denote an instant at all (an upstream glitch, an
 *   epoch integer) is returned trimmed, verbatim. Blanking it would delete the
 *   only time a row carries; passing it through leaves the anomaly visible and
 *   attributable to whatever produced it.
 */
export function canonicalUtc(value: string | null | undefined): string {
  if (value === null || value === undefined) return "";
  const text = value.trim();
  if (text === "") return "";
  const parsed = Date.parse(withUtcZone(text));
  if (Number.isNaN(parsed)) return text;
  return new Date(parsed).toISOString().replace(/\.\d{3}Z$/, "Z");
}
