/**
 * Human-readable countdown formatting, shared by every surface that shows a
 * "time left" value.
 *
 * The console has several countdown-ish readouts — the dead-man-switch grace
 * (`StatusPanel`), the fleet table's DMS column, and the active-window expiry
 * that a status extension is expected to expose. Before this module each one
 * hand-rolled its own rendering (`"3600s of grace left"`, `"3600s"`, …), so the
 * same number of seconds read differently from panel to panel and looked
 * broken. The rendering now lives here once.
 *
 * Scope boundary (deliberate). This formatter is *dumb*: it turns a number of
 * seconds into text and signals whether the countdown has expired, and nothing
 * else. It does **not** tier urgency ("critical"/"warn") or pick a colour,
 * because urgency needs context the formatter does not have — it needs the
 * *ratio* against the window the value counts down from, and 10% of a
 * five-minute grace is a different situation from 10% of a thirty-day one.
 * Consumers own their thresholds and tones (the `StatusPanel` velocity block
 * already carries an `isCritical` policy of its own); keeping that policy out of
 * here is what stops it being duplicated — and drifting — across panels.
 *
 * No dependency and no floating point (zero-dep rule): the whole ladder is
 * BigInt arithmetic, so a `u64` second count (the contract's native width,
 * `GuardStatus.now`/`last_heartbeat`/`dms_grace_secs`) never passes through
 * `Number`, where it would silently lose precision above 2^53.
 */

/**
 * The largest whole-day value rendered before the formatter caps out.
 *
 * Without a cap, a misconfigured (or merely distant) deadline renders as
 * `"10475d"`, which is absurdity, not information. Above this many days the
 * value is reported as `"999d+"`: still exact about the order of magnitude, and
 * still cheap to compare at a glance. This is the "cap policy" the issue asks
 * the PR to state.
 */
export const MAX_REMAINING_DAYS = 999;

const SECONDS_PER_MINUTE = 60n;
const SECONDS_PER_HOUR = 3_600n;
const SECONDS_PER_DAY = 86_400n;

export interface FormattedRemaining {
  /**
   * The countdown text: `"now"` in the final minute, then `"5m"`, `"2h 4m"`,
   * `"3d 2h"`, and `"999d+"` above the day cap. When `expired` is true the text
   * is the literal `"expired"`.
   */
  text: string;
  /**
   * True when the remaining time has reached or passed zero.
   *
   * Signalled as a field rather than baked into `text` so each consumer renders
   * the overdue case its own way without re-parsing a string: the status panel
   * says the grace elapsed and the account refuses calls, while a table might
   * simply show `"expired"`. The formatter reports the fact; the consumer owns
   * the wording (and the tone).
   */
  expired: boolean;
}

function toSecondsBigInt(value: bigint | number): bigint {
  if (typeof value === "bigint") return value;
  if (!Number.isInteger(value)) {
    throw new RangeError(`remaining seconds must be an integer, got ${value}`);
  }
  return BigInt(value);
}

/**
 * Format a countdown expressed as a number of seconds.
 *
 * `formatRemaining(3600n)` → `{ text: "1h", expired: false }`;
 * `formatRemaining(-30)` → `{ text: "expired", expired: true }`.
 *
 * `null` is intentionally *not* accepted: the SDK's `deadManRemaining` returns
 * `null` for "no countdown at all" (switch disabled, or never heartbeated),
 * which is a different sentence than "a countdown that has run out" — the
 * caller decides that wording, then hands the non-null remainder here.
 *
 * Partial units floor rather than round, so the text never overstates the time
 * left (59m59s reads as `"59m"`, not `"1h"`).
 */
export function formatRemaining(seconds: bigint | number): FormattedRemaining {
  const total = toSecondsBigInt(seconds);

  if (total <= 0n) {
    return { text: "expired", expired: true };
  }
  if (total < SECONDS_PER_MINUTE) {
    return { text: "now", expired: false };
  }
  if (total < SECONDS_PER_HOUR) {
    return { text: `${total / SECONDS_PER_MINUTE}m`, expired: false };
  }
  if (total < SECONDS_PER_DAY) {
    const hours = total / SECONDS_PER_HOUR;
    const minutes = (total % SECONDS_PER_HOUR) / SECONDS_PER_MINUTE;
    return { text: minutes > 0n ? `${hours}h ${minutes}m` : `${hours}h`, expired: false };
  }

  const days = total / SECONDS_PER_DAY;
  if (days > BigInt(MAX_REMAINING_DAYS)) {
    return { text: `${MAX_REMAINING_DAYS}d+`, expired: false };
  }
  const hours = (total % SECONDS_PER_DAY) / SECONDS_PER_HOUR;
  return { text: hours > 0n ? `${days}d ${hours}h` : `${days}d`, expired: false };
}
