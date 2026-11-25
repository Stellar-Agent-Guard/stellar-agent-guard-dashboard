"use client";

/**
 * Quiet hours: an operator-chosen window in which this tab holds its own alerts
 * back (issue #494).
 *
 * An operator console stays open overnight, and a channel that can interrupt at
 * any hour is a channel that gets silenced at the browser level — a denied
 * permission is permanent in a way a switch is not. The block that matters at
 * 03:00 is the one nobody hears because the operator had already turned the
 * site's notifications off to sleep through the rest.
 *
 * Three decisions shape the module:
 *
 *   - **Wall clock, in one named zone.** The window is stated as local wall
 *     time (`22:00`–`07:00`) and read in an explicit IANA zone, because that is
 *     what "at night" means to a person. It is also what makes the
 *     daylight-saving cases fall out of the arithmetic instead of needing
 *     special handling: the minute-of-day comes from `Intl` for the instant, so
 *     on a spring-forward day a 02:xx window simply never matches (that wall
 *     time does not exist), and on a fall-back day the repeated 01:xx is quiet
 *     on both occurrences — the safe reading of a schedule. `lib/guard/time.ts`
 *     frames the same problem for one timestamp; this is that framing applied to
 *     a window, with the same formatter idiom rather than a second one.
 *   - **Local notifications only, and only the operator's own choice.** Nothing
 *     here can suppress a guard decision, an on-chain event, or a row in the
 *     feed. Quiet hours change whether *this tab* makes noise; a refused call
 *     still happened and is still readable.
 *   - **Some classes break through by default.** `blocked` is the guard doing
 *     its job — the account is safe and the refusal is in the feed, so waking
 *     anyone for it is how the whole channel gets muted. `frozen` and
 *     `policy_revoked` are someone changing the guardrails under the operator's
 *     feet, which is worth being woken for. That is the default and not a claim
 *     about anyone's risk: the list is configurable per class, and the panel
 *     says which classes are in it.
 *
 * Pure by construction — an instant, a schedule and a reason go in, a decision
 * comes out. No DOM, no React, no timers, nothing read from storage: the
 * component owns all of that, so every rule here is unit-testable at a fixed
 * epoch millisecond.
 */
import type { SecurityAlertReason } from "./audioAlert.ts";

export interface QuietHoursSchedule {
  /** Off until the operator asks: an absent or non-true record changes nothing. */
  enabled: boolean;
  /** Local wall clock, `HH:MM`; the moment the window starts, included. */
  start: string;
  /** Local wall clock, `HH:MM`; the moment the window ends, excluded. */
  end: string;
  /** The IANA zone both clocks are read in — the schedule's disclosure. */
  timeZone: string;
  /** Event classes that still alert inside the window. */
  breakThrough: SecurityAlertReason[];
}

/**
 * Each class as this module's sentence reads it, worded like the panel's own
 * alert line.
 *
 * `Record<SecurityAlertReason, …>` is exhaustive, so a fourth class added to the
 * union fails the build here rather than going silently missing from a
 * break-through sentence. `ALERT_REASON_ORDER` in `audioAlert.ts` stays the
 * public order the panels render; this module keeps its own copy of the list
 * only because importing it from there would close a module cycle — that module
 * builds `DEFAULT_ALERT_SETTINGS` out of this one's default.
 */
const BREAK_THROUGH_LABELS: Record<SecurityAlertReason, string> = {
  blocked: "a call was blocked",
  frozen: "the account was frozen",
  policy_revoked: "a policy was revoked",
};

/** The classes this module will accept in a stored break-through list. */
const QUIET_ALERT_CLASSES = Object.keys(BREAK_THROUGH_LABELS) as SecurityAlertReason[];

/**
 * The browser's own zone where there is one, UTC where there is not (a locked
 * down runtime, an `Intl` without a resolved zone). The default schedule carries
 * it so a first-run panel names the zone it is really using instead of leaving
 * the field blank and letting a guess stand in for it.
 */
function resolvedLocalTimeZone(): string {
  try {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return typeof zone === "string" && zone !== "" ? zone : "UTC";
  } catch {
    return "UTC";
  }
}

/**
 * Quiet hours off: an upgrade must not silence anyone. The night window is the
 * conventional one, and the zone is disclosed rather than assumed.
 */
export const DEFAULT_QUIET_HOURS: QuietHoursSchedule = {
  enabled: false,
  start: "22:00",
  end: "07:00",
  timeZone: resolvedLocalTimeZone(),
  breakThrough: ["frozen", "policy_revoked"],
};

const CLOCK_PATTERN = /^(\d{2}):(\d{2})$/;
const OFFSET_PATTERN = /^(?:GMT|UTC|Z)([+-])(\d{2}):?(\d{2})$/;
const BARE_ZONE_PATTERN = /^(?:GMT|UTC|Z)$/;
const DAY_MS = 86_400_000;

/** A message when `value` is not a `HH:MM` clock, otherwise null. */
export function validateQuietHoursClock(value: unknown): string | null {
  if (typeof value !== "string") return "Times must be written like 22:00.";
  const match = CLOCK_PATTERN.exec(value);
  if (!match) return "Use a 24-hour HH:MM time, like 22:00.";
  const hour = Number(match[1] ?? "");
  const minute = Number(match[2] ?? "");
  if (!Number.isInteger(hour) || !Number.isInteger(minute)) {
    return "Use a 24-hour HH:MM time, like 22:00.";
  }
  if (hour >= 24) return "The hour must be between 00 and 23.";
  if (minute >= 60) return "The minute must be between 00 and 59.";
  return null;
}

/**
 * A message when `value` is not an IANA zone this `Intl` accepts, otherwise null.
 *
 * `Intl.DateTimeFormat` throws `RangeError` on an unsupported zone, which is the
 * only honest test available: the IANA list is a runtime's, not ours, and a
 * zone that the browser cannot resolve is a zone the schedule cannot be read in.
 */
export function validateQuietHoursTimeZone(value: unknown): string | null {
  if (typeof value !== "string") return "A time zone name is required.";
  const name = value.trim();
  if (name === "") return "Choose a time zone, like America/New_York.";
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: name });
  } catch {
    return `"${name}" is not a time zone this browser recognises. Use an IANA name like America/New_York.`;
  }
  return null;
}

/** The zone to read a schedule in, or UTC when the stored name is unusable. */
function usableQuietHoursTimeZone(value: unknown): string {
  return typeof value === "string" && validateQuietHoursTimeZone(value) === null
    ? value.trim()
    : "UTC";
}

/** `HH:MM` into minutes past local midnight, or null when it is not a clock. */
function clockMinutes(value: unknown): number | null {
  if (validateQuietHoursClock(value) !== null) return null;
  const [hour, minute] = (value as string).split(":");
  return Number(hour) * 60 + Number(minute);
}

/**
 * One schedule field at a time, from whatever storage held.
 *
 * Every field is validated on its own and falls back to *that* field's default,
 * because a half-written record is the normal outcome of an older build, a
 * hand-edited row, or a form submitted twice: discarding the whole schedule
 * would undo the parts the operator did set, and trusting a raw stored value
 * would let `"25:00"` reach the window arithmetic.
 *
 * A missing key means quiet hours are off — the record predates the feature, and
 * the last thing an upgrade should do is go silent on its own.
 */
export function normalizeQuietHours(value: unknown): QuietHoursSchedule {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return { ...DEFAULT_QUIET_HOURS, breakThrough: [...DEFAULT_QUIET_HOURS.breakThrough] };
  }
  const record = value as Record<string, unknown>;
  return {
    // Strictly `true`: a string, a `1` or a stray object is not somebody
    // switching the feature on.
    enabled: record.enabled === true,
    start:
      validateQuietHoursClock(record.start) === null
        ? String(record.start)
        : DEFAULT_QUIET_HOURS.start,
    end:
      validateQuietHoursClock(record.end) === null ? String(record.end) : DEFAULT_QUIET_HOURS.end,
    timeZone:
      validateQuietHoursTimeZone(record.timeZone) === null
        ? String(record.timeZone).trim()
        : DEFAULT_QUIET_HOURS.timeZone,
    breakThrough: normalizeBreakThrough(record.breakThrough),
  };
}

/**
 * The break-through list, cleaned.
 *
 * An array — including an empty one — is an answer the operator gave, so it is
 * kept in the canonical order and de-duplicated; anything that is not an array
 * at all is the absence of an answer, which falls back to the default. Keeping
 * the canonical order matters because the same array is what the panel renders,
 * so a stored order cannot make two identical schedules look different.
 */
function normalizeBreakThrough(value: unknown): SecurityAlertReason[] {
  if (!Array.isArray(value)) return [...DEFAULT_QUIET_HOURS.breakThrough];
  const stored = new Set<unknown>(value);
  return QUIET_ALERT_CLASSES.filter((reason) => stored.has(reason));
}

export interface QuietHoursDecision {
  /** The instant falls inside the window and the schedule is switched on. */
  quiet: boolean;
  /** Quiet, and this class has no break-through — so nothing local fires. */
  suppresses: boolean;
  /** The zone's wall clock at the instant, `HH:MM`. */
  wallClock: string;
  /** The offset in force at the instant, `UTC-04:00` — DST is disclosed, not assumed. */
  offsetLabel: string;
  /** The zone actually used: the schedule's, or UTC when that name was unusable. */
  timeZone: string;
}

/**
 * Is this class of alert silenced at this instant?
 *
 * The window is `[start, end)` and wraps past midnight when `end` is at or
 * before `start`, so `22:00`–`07:00` is one night rather than a mistake; two
 * equal clocks are that rule taken to its end, an all-day window, which is what
 * an operator who sets both fields to the same minute has asked for.
 *
 * A minute-of-day that cannot be read (a non-finite instant) and a schedule with
 * an unusable clock leave the alert *loud*: the failure mode to avoid is a
 * console that goes quiet for a reason it never told anyone about.
 */
export function resolveQuietHours(
  atMs: number,
  schedule: QuietHoursSchedule,
  reason: SecurityAlertReason,
): QuietHoursDecision {
  const timeZone = usableQuietHoursTimeZone(schedule.timeZone);
  const clock = Number.isFinite(atMs) ? readWallClock(atMs, timeZone) : null;
  const start = clockMinutes(schedule.start);
  const end = clockMinutes(schedule.end);
  let quiet = false;
  if (clock && start !== null && end !== null && schedule.enabled) {
    quiet =
      end > start
        ? clock.minutes >= start && clock.minutes < end
        : clock.minutes >= start || clock.minutes < end;
  }
  return {
    quiet,
    suppresses: quiet && !schedule.breakThrough.includes(reason),
    wallClock: clock?.wallClock ?? "--:--",
    offsetLabel: clock?.offsetLabel ?? "UTC+00:00",
    timeZone,
  };
}

/** Formatters are expensive to build; one per zone per shape is plenty (`time.ts` does the same). */
const clockFormatters = new Map<string, Intl.DateTimeFormat>();
const dayFormatters = new Map<string, Intl.DateTimeFormat>();

function part(parts: Intl.DateTimeFormatPart[], type: Intl.DateTimeFormatPartTypes): string {
  return parts.find((entry) => entry.type === type)?.value ?? "";
}

/** `HH:MM` plus the offset actually in force, as that zone had them at `atMs`. */
function zonedParts(atMs: number, timeZone: string): Intl.DateTimeFormatPart[] {
  let formatter = clockFormatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
      timeZoneName: "longOffset",
    });
    clockFormatters.set(timeZone, formatter);
  }
  return formatter.formatToParts(atMs);
}

function readWallClock(
  atMs: number,
  timeZone: string,
): { minutes: number; wallClock: string; offsetLabel: string } | null {
  const parts = zonedParts(atMs, timeZone);
  const hour = Number(part(parts, "hour"));
  const minute = Number(part(parts, "minute"));
  if (!Number.isInteger(hour) || !Number.isInteger(minute)) return null;
  return {
    minutes: hour * 60 + minute,
    wallClock: `${twoDigits(hour)}:${twoDigits(minute)}`,
    offsetLabel: offsetLabelOf(part(parts, "timeZoneName")),
  };
}

/**
 * `longOffset` yields `GMT+02:00`, or bare `GMT` at zero offset. Rewritten to
 * `UTC…` because that is the frame of reference operators compare in — the same
 * rewrite `formatEventTimestamp` makes, so both read-outs agree.
 */
function offsetLabelOf(offsetName: string): string {
  if (BARE_ZONE_PATTERN.test(offsetName)) return "UTC+00:00";
  return offsetName.replace(/^(?:GMT|UTC)/, "UTC");
}

/** The signed offset in force at an instant, in minutes. */
function offsetMinutesAt(instantMs: number, timeZone: string): number | null {
  const name = part(zonedParts(instantMs, timeZone), "timeZoneName");
  if (BARE_ZONE_PATTERN.test(name)) return 0;
  const match = OFFSET_PATTERN.exec(name);
  if (!match) return null;
  const sign = match[1] === "-" ? -1 : 1;
  const hours = Number(match[2] ?? "");
  const minutes = Number(match[3] ?? "");
  if (!Number.isInteger(hours) || !Number.isInteger(minutes)) return null;
  return sign * (hours * 60 + minutes);
}

function localDayParts(
  atMs: number,
  timeZone: string,
): { year: number; month: number; day: number } | null {
  let formatter = dayFormatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    dayFormatters.set(timeZone, formatter);
  }
  const parts = formatter.formatToParts(atMs);
  const year = Number(part(parts, "year"));
  const month = Number(part(parts, "month"));
  const day = Number(part(parts, "day"));
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return null;
  return { year, month, day };
}

/**
 * The instant a local calendar day began, in that zone.
 *
 * There is no `Date` API for "midnight in a zone", so this is the standard
 * fixed-point: read the offset the zone reports for a guess, move the guess by
 * it, repeat. Three passes is more than any real zone needs — an offset is a
 * step function, and a day whose midnight does not exist (a rare zone that
 * springs forward at 00:00) settles on the first instant the zone reaches after
 * the jump, which is the same answer either way for a window that day.
 */
function localDayStartMs(
  year: number,
  month: number,
  day: number,
  timeZone: string,
): number | null {
  const asUtc = Date.UTC(year, month - 1, day);
  let ms = asUtc;
  for (let pass = 0; pass < 3; pass += 1) {
    const offset = offsetMinutesAt(ms, timeZone);
    if (offset === null) return null;
    const next = asUtc - offset * 60_000;
    if (next === ms) break;
    ms = next;
  }
  return ms;
}

/**
 * One sentence on the daylight-saving truth of the day `atMs` falls on, or null
 * on an ordinary day.
 *
 * A wall-clock window is the schedule an operator writes; the hour it *actually*
 * suppresses is the day's own length. Reading both day boundaries in the zone
 * makes that measurable rather than guessed: 25 hours on a fall-back night (the
 * repeated hour is suppressed twice), 23 on a spring-forward one. Zones that
 * shift by something other than an hour get the real figure rather than "an
 * hour", and UTC and the zones that never change their offset get nothing at
 * all, because there is nothing to disclose.
 */
export function quietHoursDayNote(atMs: number, timeZone: string): string | null {
  if (!Number.isFinite(atMs)) return null;
  const zone = usableQuietHoursTimeZone(timeZone);
  const day = localDayParts(atMs, zone);
  if (!day) return null;
  const dayStart = localDayStartMs(day.year, day.month, day.day, zone);
  const nextStart = localDayStartMs(day.year, day.month, day.day + 1, zone);
  if (dayStart === null || nextStart === null) return null;
  const deltaMinutes = Math.round((nextStart - dayStart - DAY_MS) / 60_000);
  if (deltaMinutes === 0) return null;
  const lengthHours = Math.round(((nextStart - dayStart) / 3_600_000) * 100) / 100;
  const shift = deltaMinutes > 0 ? "the clocks went back" : "the clocks went forward";
  return (
    `On ${dayLabel(day)} in ${zone} the local day is ${lengthHours} hours long (${shift}), so a ` +
    `wall-clock quiet window that day runs ${realTimePhrase(Math.abs(deltaMinutes))} ` +
    `${deltaMinutes > 0 ? "longer" : "shorter"} in real time than it looks.`
  );
}

/** `60` → "1 hour", `90` → "90 minutes": the shift in the size it actually is. */
function realTimePhrase(absMinutes: number): string {
  if (absMinutes % 60 !== 0) return `${absMinutes} minutes`;
  const hours = absMinutes / 60;
  return `${hours} hour${hours === 1 ? "" : "s"}`;
}

function dayLabel(day: { year: number; month: number; day: number }): string {
  return `${day.year}-${twoDigits(day.month)}-${twoDigits(day.day)}`;
}

function twoDigits(value: number): string {
  return `${value}`.padStart(2, "0");
}

/**
 * The schedule, in the operator's own terms, including what it cannot do.
 *
 * The sentence names the window, the zone it is being read in and the offset in
 * force right now, because those three together are what makes "quiet from
 * 22:00" falsifiable at 01:00. It also says which classes still get through and
 * what quiet hours do not touch: a preference that silences the *alert* is not a
 * preference that silences the guard, and an operator who reads it as the second
 * one is reading a false comfort.
 */
export function describeQuietHours(
  decision: QuietHoursDecision,
  schedule: QuietHoursSchedule,
): string {
  if (!schedule.enabled) {
    return "Quiet hours are off, so an armed alert can interrupt at any hour.";
  }
  const window = `${schedule.start}–${schedule.end}`;
  if (decision.timeZone !== schedule.timeZone.trim()) {
    return (
      `Quiet hours are set for ${window}, but the stored time zone "${schedule.timeZone}" is not one ` +
      `this browser recognises, so the window is being read in ${decision.timeZone} ` +
      `(${decision.offsetLabel}) instead — check the zone above.`
    );
  }
  const exceptions =
    schedule.breakThrough.length === 0
      ? ""
      : `, except when ${listWithOr(schedule.breakThrough.map((reason) => BREAK_THROUGH_LABELS[reason]))}`;
  return decision.quiet
    ? `Quiet hours run ${window} in ${decision.timeZone}: it is ${decision.wallClock} there ` +
        `(${decision.offsetLabel}) and inside the window, so this tab holds back its own chime and ` +
        `desktop notifications${exceptions} — the guard, the ledger and this feed are unaffected.`
    : `Quiet hours run ${window} in ${decision.timeZone}: it is ${decision.wallClock} there ` +
        `(${decision.offsetLabel}) and outside the window, so this tab is not holding anything back.`;
}

function listWithOr(items: readonly string[]): string {
  if (items.length <= 1) return items[0] ?? "";
  return `${items.slice(0, -1).join(", ")} or ${items.at(-1)}`;
}
