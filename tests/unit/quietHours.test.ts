import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  DEFAULT_QUIET_HOURS,
  describeQuietHours,
  normalizeQuietHours,
  quietHoursDayNote,
  resolveQuietHours,
  validateQuietHoursClock,
  validateQuietHoursTimeZone,
  type QuietHoursDecision,
  type QuietHoursSchedule,
} from "../../lib/guard/quietHours.ts";
import {
  ALERT_SETTINGS_STORAGE_KEY,
  DEFAULT_ALERT_SETTINGS,
  loadAlertSettings,
  saveAlertSettings,
  type SecurityAlertReason,
} from "../../lib/guard/audioAlert.ts";

/**
 * Quiet hours (#494), and the daylight-saving teeth of them.
 *
 * Every instant below is a fixed UTC epoch millisecond. That is the whole point
 * of the file: a test that built `new Date(2026, 2, 8, 2, 30)` would be asking
 * the machine's own zone for a wall time that may not exist, and would then be
 * asserting against whatever the runtime invented — which proves nothing about
 * the schedule. Pinned instants plus a named zone make "02:30 on the
 * spring-forward day" a claim we can actually check: it never happens, so a
 * 02:00–03:00 window suppresses nothing that day.
 *
 * The US transitions of 2026 are the ones `lib/guard/time.ts` and
 * `tests/unit/timeago.test.ts` already reason about, so the three agree:
 * 2026-03-08 02:00 local jumps to 03:00, and 2026-11-01 02:00 EDT falls back to
 * 01:00 EST.
 */

const NEW_YORK = "America/New_York";
const KARACHI = "Asia/Karachi";

/** The conventional night window, switched on, in a zone named rather than assumed. */
function night(overrides: Partial<QuietHoursSchedule> = {}): QuietHoursSchedule {
  return {
    enabled: true,
    start: "22:00",
    end: "07:00",
    timeZone: NEW_YORK,
    breakThrough: ["frozen", "policy_revoked"],
    ...overrides,
  };
}

/** A decision for one reason at one instant, the way the panel asks for it. */
function check(
  atMs: number,
  schedule: QuietHoursSchedule,
  reason: SecurityAlertReason = "blocked",
): QuietHoursDecision {
  return resolveQuietHours(atMs, schedule, reason);
}

describe("a window that wraps past midnight", () => {
  // 2026-09-15 is an ordinary DST day in New York: UTC-04:00 all day.
  const evening = Date.UTC(2026, 8, 15, 1, 59); // 21:59 local
  const startOfNight = Date.UTC(2026, 8, 15, 2, 0); // 22:00 local
  const middle = Date.UTC(2026, 8, 15, 3, 0); // 23:00 local
  const beforeEnd = Date.UTC(2026, 8, 15, 10, 59); // 06:59 local
  const end = Date.UTC(2026, 8, 15, 11, 0); // 07:00 local
  const morning = Date.UTC(2026, 8, 15, 12, 0); // 08:00 local

  const schedule = night();

  it("is quiet through the night and loud through the day", () => {
    assert.equal(check(evening, schedule).quiet, false, "21:59 is before the window");
    assert.equal(check(middle, schedule).quiet, true);
    assert.equal(check(beforeEnd, schedule).quiet, true, "06:59 is still inside");
    assert.equal(check(morning, schedule).quiet, false, "08:00 is a working hour");
  });

  it("includes the start minute and excludes the end minute", () => {
    // `[start, end)` matters because it is what the operator reads: a window
    // that says 22:00 means 22:00 onwards, and one that says 07:00 means the
    // alerts are back by 07:00, not by 07:01.
    const atStart = check(startOfNight, schedule);
    assert.equal(atStart.quiet, true, "22:00 exactly is quiet");
    assert.equal(atStart.wallClock, "22:00");

    const atEnd = check(end, schedule);
    assert.equal(atEnd.quiet, false, "07:00 exactly is not quiet");
    assert.equal(atEnd.wallClock, "07:00");
  });

  it("treats a window whose clocks are equal as covering the whole day", () => {
    // `end <= start` is the wrap, so equal clocks are the wrap taken to its end:
    // everything from that minute round to the same minute. An operator who set
    // both fields to 09:00 asked to be left alone all day; reading that as
    // "no window at all" would be a silent surprise in the other direction.
    const allDay = night({ start: "09:00", end: "09:00" });
    assert.equal(check(middle, allDay).quiet, true);
    assert.equal(check(morning, allDay).quiet, true);
  });

  it("handles a window that does not wrap on its own terms", () => {
    const officeHours = night({ start: "09:00", end: "17:00" });
    assert.equal(
      check(Date.UTC(2026, 8, 15, 12, 0), officeHours).quiet,
      false,
      "08:00 is before it",
    );
    assert.equal(check(Date.UTC(2026, 8, 15, 13, 0), officeHours).quiet, true, "09:00 is inside");
    assert.equal(check(Date.UTC(2026, 8, 15, 20, 59), officeHours).quiet, true, "16:59 is inside");
    assert.equal(
      check(Date.UTC(2026, 8, 15, 21, 0), officeHours).quiet,
      false,
      "17:00 exactly is not quiet",
    );
    assert.equal(
      check(Date.UTC(2026, 8, 15, 23, 0), officeHours).quiet,
      false,
      "19:00 is after it",
    );
  });

  it("reports the wall clock and the offset in force, which is the disclosure", () => {
    const decision = check(middle, schedule);
    assert.equal(decision.wallClock, "23:00");
    assert.equal(decision.offsetLabel, "UTC-04:00");
    assert.equal(decision.timeZone, NEW_YORK);
  });
});

describe("the spring-forward day", () => {
  // 2026-03-08 in New York: 02:00 EST is replaced by 03:00 EDT, so 02:30 local
  // does not exist. 05:00Z is 00:00 local and the local day ends 04:00Z the
  // next day — 23 real hours.
  const localMidnight = Date.UTC(2026, 2, 8, 5, 0);
  const twoThirtyWouldBe = Date.UTC(2026, 2, 8, 7, 30);

  it("suppresses nothing at all when the window is the skipped hour", () => {
    const skipped = night({ start: "02:00", end: "03:00" });
    assert.equal(check(twoThirtyWouldBe, skipped).quiet, false);
    assert.equal(check(Date.UTC(2026, 2, 8, 6, 59), skipped).quiet, false, "01:59 EST");
    assert.equal(check(Date.UTC(2026, 2, 8, 7, 0), skipped).quiet, false, "03:00 EDT");

    // Every quarter hour of that local day: the window is empty because the
    // wall times it names never occurred, which is the honest reading of a
    // schedule rather than a fudge over a missing hour.
    for (let quarter = 0; quarter <= 92; quarter += 1) {
      const at = localMidnight + quarter * 15 * 60_000;
      const decision = check(at, skipped);
      assert.equal(decision.quiet, false, `${decision.wallClock} on 2026-03-08 is not quiet`);
      assert.notEqual(
        decision.wallClock,
        "02:30",
        "no instant reports the hour that does not exist",
      );
    }
  });

  it("moves the window with the clock, not with the offset", () => {
    // A 22:00–07:00 night starts at 22:00 local on the transition day too, but
    // 22:00 EST is 03:00Z while 22:00 EDT the next night is 02:00Z: the same
    // wall-clock schedule begins an hour earlier in UTC, so the *real* quiet
    // time on this day is an hour shorter. The window follows the clock.
    const schedule = night();
    assert.equal(check(Date.UTC(2026, 2, 8, 2, 59), schedule).quiet, false, "21:59 EST");
    assert.equal(check(Date.UTC(2026, 2, 8, 3, 0), schedule).quiet, true, "22:00 EST");
    assert.equal(
      check(Date.UTC(2026, 2, 8, 2, 30), schedule).quiet,
      false,
      "02:30Z is still 21:30 EST on the transition day",
    );
    assert.equal(
      check(Date.UTC(2026, 2, 9, 2, 30), schedule).quiet,
      true,
      "the same UTC minute is 22:30 EDT the night after",
    );
  });

  it("discloses the shortened day", () => {
    const note = quietHoursDayNote(twoThirtyWouldBe, NEW_YORK);
    assert.ok(note, "a transition day gets a disclosure");
    assert.match(note, /2026-03-08/);
    assert.match(note, /23 hours long/);
    assert.match(note, /clocks went forward/);
    assert.match(note, /1 hour shorter in real time/);
  });

  it("labels the offset that was actually in force", () => {
    assert.equal(check(Date.UTC(2026, 2, 8, 6, 59), night()).offsetLabel, "UTC-05:00");
    assert.equal(check(Date.UTC(2026, 2, 8, 7, 0), night()).offsetLabel, "UTC-04:00");
  });
});

describe("the fall-back day", () => {
  // 2026-11-01 in New York: 02:00 EDT becomes 01:00 EST, so 01:30 local happens
  // twice, once at 05:30Z and once at 06:30Z. The local day is 25 real hours.
  const first = Date.UTC(2026, 10, 1, 5, 30);
  const second = Date.UTC(2026, 10, 1, 6, 30);

  it("is quiet on both occurrences of the repeated wall time", () => {
    const repeated = night({ start: "01:00", end: "02:00" });
    const before = check(first, repeated);
    const after = check(second, repeated);

    assert.equal(before.quiet, true, "01:30 EDT is inside the window");
    assert.equal(after.quiet, true, "01:30 EST is inside the same window");
    assert.equal(before.wallClock, "01:30");
    assert.equal(after.wallClock, "01:30");
    // The two instants are one hour apart in real time and identical on the
    // wall; only the offset tells them apart, which is why the decision carries
    // it. Suppressing both is the safe reading: an operator who asked for quiet
    // at 01:30 did not mean to be woken by the second one.
    assert.equal(before.offsetLabel, "UTC-04:00");
    assert.equal(after.offsetLabel, "UTC-05:00");
  });

  it("is quiet through the night across the transition too", () => {
    const schedule = night();
    assert.equal(check(Date.UTC(2026, 10, 1, 4, 0), schedule).quiet, true, "00:00 EDT");
    assert.equal(check(first, schedule).quiet, true, "01:30 EDT");
    assert.equal(check(second, schedule).quiet, true, "01:30 EST");
    // 12:30Z is 07:30 EST, one hour past the window's end; the same minute an
    // hour earlier was still quiet, which is the part an offset-blind reading
    // gets wrong on this day.
    assert.equal(check(Date.UTC(2026, 10, 1, 11, 30), schedule).quiet, true, "06:30 EST");
    assert.equal(check(Date.UTC(2026, 10, 1, 12, 30), schedule).quiet, false, "07:30 EST");
  });

  it("discloses the lengthened day", () => {
    const note = quietHoursDayNote(first, NEW_YORK);
    assert.ok(note);
    assert.match(note, /2026-11-01/);
    assert.match(note, /25 hours long/);
    assert.match(note, /clocks went back/);
    assert.match(note, /1 hour longer in real time/);
  });
});

describe("the zone is honored, not the machine's", () => {
  // One instant, one schedule, two zones: 03:00Z is 23:00 in New York and 08:00
  // in Karachi. If the schedule were read in the runtime's own zone, both would
  // give the same answer, and an operator in Lagos would be silently suppressing
  // the wrong hours.
  const at = Date.UTC(2026, 8, 15, 3, 0);

  it("gives different answers at the same instant", () => {
    const western = check(at, night({ timeZone: NEW_YORK }));
    const eastern = check(at, night({ timeZone: KARACHI }));

    assert.equal(western.quiet, true, "23:00 in New York is quiet");
    assert.equal(eastern.quiet, false, "08:00 in Karachi is not");
    assert.equal(western.wallClock, "23:00");
    assert.equal(eastern.wallClock, "08:00");
    assert.equal(western.offsetLabel, "UTC-04:00");
    assert.equal(eastern.offsetLabel, "UTC+05:00");
  });

  it("stays put on a day when the machine's zone moves and the schedule's does not", () => {
    // 2026-03-08 is a transition day only in New York. Karachi's offset is
    // fixed all year, so its reading of the same window must not slide an hour
    // the way New York's does — the schedule is only trustworthy if a change of
    // zone never changes the zone it was written in.
    const before = check(Date.UTC(2026, 2, 8, 1, 0), night({ timeZone: KARACHI }));
    const after = check(Date.UTC(2026, 2, 8, 12, 0), night({ timeZone: KARACHI }));
    assert.equal(before.offsetLabel, "UTC+05:00");
    assert.equal(after.offsetLabel, "UTC+05:00", "and no DST to move it");
    assert.equal(before.quiet, true, "06:00 in Karachi is inside the night");
    assert.equal(after.quiet, false, "17:00 in Karachi is not");
    assert.equal(
      check(Date.UTC(2026, 2, 8, 1, 0), night({ timeZone: NEW_YORK })).offsetLabel,
      "UTC-05:00",
      "the same instant in New York is still on standard time",
    );
    assert.equal(
      check(Date.UTC(2026, 2, 8, 12, 0), night({ timeZone: NEW_YORK })).offsetLabel,
      "UTC-04:00",
      "and has gone forward by then",
    );
  });

  it("reads a UTC schedule in UTC whatever the runtime resolves to", () => {
    const utc = check(Date.UTC(2026, 8, 15, 3, 0), night({ timeZone: "UTC" }));
    assert.equal(utc.timeZone, "UTC");
    assert.equal(utc.wallClock, "03:00");
    assert.equal(utc.offsetLabel, "UTC+00:00");
    assert.equal(utc.quiet, true);
  });
});

describe("the break-through list", () => {
  const at = Date.UTC(2026, 8, 15, 3, 0); // 23:00 in New York, inside the night.

  it("suppresses the routine refusal and lets the guardrail changes through", () => {
    const schedule = night();
    assert.equal(check(at, schedule, "blocked").suppresses, true);
    assert.equal(check(at, schedule, "frozen").suppresses, false);
    assert.equal(check(at, schedule, "policy_revoked").suppresses, false);
  });

  it("suppresses everything when the operator allowed nothing through", () => {
    const schedule = night({ breakThrough: [] });
    for (const reason of ["blocked", "frozen", "policy_revoked"] as const) {
      assert.equal(check(at, schedule, reason).suppresses, true, `${reason} is silenced too`);
    }
  });

  it("follows the operator's choice rather than the default", () => {
    const schedule = night({ breakThrough: ["blocked"] });
    assert.equal(check(at, schedule, "blocked").suppresses, false);
    assert.equal(check(at, schedule, "frozen").suppresses, true);
  });

  it("never suppresses outside the window, whatever the list says", () => {
    const schedule = night({ breakThrough: [] });
    assert.equal(check(Date.UTC(2026, 8, 15, 12, 0), schedule, "blocked").suppresses, false);
  });
});

describe("validation and normalization", () => {
  it("accepts only a real HH:MM clock", () => {
    assert.equal(validateQuietHoursClock("00:00"), null);
    assert.equal(validateQuietHoursClock("23:59"), null);
    for (const bad of ["24:00", "02:60", "2:00", "02:0", "0200", "", "  22:00", "late", 7, null]) {
      assert.notEqual(validateQuietHoursClock(bad), null, `${String(bad)} is not a clock`);
    }
  });

  it("accepts only a zone this Intl can resolve", () => {
    assert.equal(validateQuietHoursTimeZone(NEW_YORK), null);
    assert.equal(validateQuietHoursTimeZone("UTC"), null);
    for (const bad of ["Mars/Olympus", "", "   ", "New York", 42, null, ["UTC"]]) {
      assert.notEqual(validateQuietHoursTimeZone(bad), null, `${String(bad)} is not a zone`);
    }
  });

  it("falls back per field, keeping the parts the operator did set", () => {
    const partial = normalizeQuietHours({
      enabled: true,
      start: "half past nine",
      end: "05:30",
      timeZone: "Mars/Olympus",
      breakThrough: ["frozen"],
    });
    assert.equal(partial.enabled, true, "a bad clock cannot switch the feature off");
    assert.equal(partial.start, DEFAULT_QUIET_HOURS.start);
    assert.equal(partial.end, "05:30");
    assert.equal(partial.timeZone, DEFAULT_QUIET_HOURS.timeZone);
    assert.deepEqual(partial.breakThrough, ["frozen"]);
  });

  it("reads `enabled` strictly, so nothing is on by accident", () => {
    for (const truthy of ["true", 1, {}, [], "yes"]) {
      assert.equal(normalizeQuietHours({ enabled: truthy }).enabled, false);
    }
    assert.equal(normalizeQuietHours({ enabled: true }).enabled, true);
  });

  it("canonicalises the break-through list without losing a choice", () => {
    assert.deepEqual(
      normalizeQuietHours({ breakThrough: ["policy_revoked", "frozen", "frozen", "blocked"] })
        .breakThrough,
      ["blocked", "frozen", "policy_revoked"],
      "the declared order, de-duplicated",
    );
    assert.deepEqual(
      normalizeQuietHours({ breakThrough: ["quiet_hours", "blocked", 42, null] }).breakThrough,
      ["blocked"],
      "a class that is not ours drops out on its own",
    );
    assert.deepEqual(normalizeQuietHours({ breakThrough: [] }).breakThrough, []);
    assert.deepEqual(
      normalizeQuietHours({ breakThrough: "frozen" }).breakThrough,
      DEFAULT_QUIET_HOURS.breakThrough,
      "not an array is the absence of an answer",
    );
  });

  it("disables the schedule when the record is absent or not a record at all", () => {
    for (const value of [undefined, null, "22:00", 42, [], {}]) {
      const normalized = normalizeQuietHours(value);
      assert.equal(normalized.enabled, false, `${JSON.stringify(value)} cannot switch it on`);
      assert.equal(normalized.start, DEFAULT_QUIET_HOURS.start);
      assert.deepEqual(normalized.breakThrough, DEFAULT_QUIET_HOURS.breakThrough);
    }
  });

  it("defaults to off, to a stated zone, and to the two guardrail classes", () => {
    assert.equal(DEFAULT_QUIET_HOURS.enabled, false);
    assert.equal(DEFAULT_QUIET_HOURS.start, "22:00");
    assert.equal(DEFAULT_QUIET_HOURS.end, "07:00");
    assert.deepEqual(DEFAULT_QUIET_HOURS.breakThrough, ["frozen", "policy_revoked"]);
    assert.equal(validateQuietHoursTimeZone(DEFAULT_QUIET_HOURS.timeZone), null);
    assert.notEqual(DEFAULT_QUIET_HOURS.timeZone, "");
    assert.equal(DEFAULT_QUIET_HOURS, DEFAULT_ALERT_SETTINGS.quiet);
  });
});

describe("an unusable zone degrades loudly instead of throwing", () => {
  const at = Date.UTC(2026, 8, 15, 3, 0);
  const broken = night({ timeZone: "Mars/Olympus" });

  it("reads the window in UTC and says so", () => {
    const decision = check(at, broken);
    assert.equal(decision.timeZone, "UTC");
    assert.equal(decision.wallClock, "03:00");
    assert.equal(decision.offsetLabel, "UTC+00:00");
    assert.equal(decision.quiet, true);
    assert.match(describeQuietHours(decision, broken), /Mars\/Olympus/);
    assert.match(describeQuietHours(decision, broken), /is being read in UTC/);
  });

  it("survives a non-finite instant without inventing a window", () => {
    for (const at2 of [Number.NaN, Number.POSITIVE_INFINITY]) {
      const decision = check(at2, night());
      assert.equal(decision.quiet, false);
      assert.equal(decision.suppresses, false);
    }
    assert.equal(quietHoursDayNote(Number.NaN, NEW_YORK), null);
  });

  it("returns nothing rather than throwing for a note on a bad zone", () => {
    assert.equal(quietHoursDayNote(at, "Mars/Olympus"), null);
    assert.equal(quietHoursDayNote(at, ""), null);
  });

  it("says nothing on a day that is exactly 24 hours, and on a zone that never shifts", () => {
    assert.equal(quietHoursDayNote(Date.UTC(2026, 8, 15, 12, 0), NEW_YORK), null);
    assert.equal(quietHoursDayNote(Date.UTC(2026, 2, 8, 12, 0), "UTC"), null);
    assert.equal(quietHoursDayNote(Date.UTC(2026, 2, 8, 12, 0), KARACHI), null);
    assert.equal(quietHoursDayNote(Date.UTC(2026, 2, 7, 12, 0), NEW_YORK), null, "the day before");
    assert.equal(quietHoursDayNote(Date.UTC(2026, 2, 9, 12, 0), NEW_YORK), null, "the day after");
  });
});

describe("the quiet-hours sentence", () => {
  it("says nothing is held back while the schedule is off", () => {
    const disabled = DEFAULT_QUIET_HOURS;
    const text = describeQuietHours(check(Date.UTC(2026, 8, 15, 3, 0), disabled), disabled);
    assert.match(text, /Quiet hours are off/);
    assert.doesNotMatch(text, /America|UTC[+-]/, "no window, no zone, no wall clock to report");
  });

  it("names the window, the zone, the offset and the clock when it is on", () => {
    const schedule = night();
    const decision = check(Date.UTC(2026, 8, 15, 3, 0), schedule);
    const text = describeQuietHours(decision, schedule);
    assert.match(text, /22:00–07:00/);
    assert.match(text, /America\/New_York/);
    assert.match(text, /23:00/);
    assert.match(text, /UTC-04:00/);
    assert.match(text, /holds back its own chime and desktop notifications/);
    assert.match(text, /the account was frozen or a policy was revoked/);
  });

  it("says the feed and the guard are outside its reach", () => {
    const text = describeQuietHours(check(Date.UTC(2026, 8, 15, 3, 0), night()), night());
    assert.match(text, /guard, the ledger and this feed are unaffected/);
  });

  it("says so plainly when the window is not covering now", () => {
    const schedule = night();
    const text = describeQuietHours(check(Date.UTC(2026, 8, 15, 12, 0), schedule), schedule);
    assert.match(text, /08:00/);
    assert.match(text, /outside the window/);
    assert.match(text, /not holding anything back/);
  });

  it("drops the exception clause when nothing breaks through", () => {
    const schedule = night({ breakThrough: [] });
    const text = describeQuietHours(check(Date.UTC(2026, 8, 15, 3, 0), schedule), schedule);
    assert.doesNotMatch(text, /except/);
  });

  it("keeps each sentence a sentence", () => {
    const cases: [QuietHoursDecision, QuietHoursSchedule][] = [
      [check(Date.UTC(2026, 8, 15, 3, 0), DEFAULT_QUIET_HOURS), DEFAULT_QUIET_HOURS],
      [check(Date.UTC(2026, 8, 15, 3, 0), night()), night()],
      [check(Date.UTC(2026, 8, 15, 12, 0), night()), night()],
      [
        check(Date.UTC(2026, 8, 15, 3, 0), night({ breakThrough: [] })),
        night({ breakThrough: [] }),
      ],
      [
        check(Date.UTC(2026, 8, 15, 3, 0), night({ timeZone: "Mars/Olympus" })),
        night({ timeZone: "Mars/Olympus" }),
      ],
    ];
    for (const [decision, schedule] of cases) {
      const text = describeQuietHours(decision, schedule);
      assert.ok(text.length > 20);
      assert.ok(text.endsWith("."), `ends one sentence: ${text}`);
      assert.equal(text.split(". ").length, 1, `one sentence, not several: ${text}`);
    }
  });
});

/**
 * The schedule rides in the alert settings record, so these check the two
 * shared-code decisions: an upgrade with no `quiet` key must stay loud, and a
 * corrupt one must not take the panel down.
 */
describe("persistence through the alert settings record", () => {
  function createMockStorage(initial: Record<string, string> = {}) {
    const map = new Map<string, string>(Object.entries(initial));
    return {
      getItem: (key: string) => map.get(key) ?? null,
      setItem: (key: string, value: string) => void map.set(key, value),
      raw: () => map.get(ALERT_SETTINGS_STORAGE_KEY) ?? null,
    };
  }

  it("round-trips the schedule the operator wrote", () => {
    const storage = createMockStorage();
    const chosen = { ...DEFAULT_ALERT_SETTINGS, quiet: night({ start: "21:30", end: "06:15" }) };
    saveAlertSettings(chosen, storage);

    const loaded = loadAlertSettings(storage);
    assert.deepEqual(loaded.quiet, chosen.quiet);
    assert.equal(JSON.parse(storage.raw()!).quiet.enabled, true);
    assert.equal(JSON.parse(storage.raw()!).quiet.timeZone, NEW_YORK);
  });

  it("reads a record with no quiet-hours key as switched off", () => {
    // The upgrade case: this is a record from before the feature, and the
    // operator who had alerts on must not come back to a console that has gone
    // quiet on its own.
    const storage = createMockStorage({
      [ALERT_SETTINGS_STORAGE_KEY]:
        '{"audio":true,"desktop":true,"volume":0.5,"classes":["blocked"]}',
    });
    const loaded = loadAlertSettings(storage);
    assert.equal(loaded.audio, true, "the channels the operator chose survive");
    assert.equal(loaded.quiet.enabled, false);
    assert.equal(check(Date.UTC(2026, 8, 15, 3, 0), loaded.quiet).suppresses, false);
  });

  it("reads a corrupt schedule as off, field by field, without throwing", () => {
    for (const quiet of ['"22:00"', "42", "null", "[]", '{"enabled":"yes","start":"nope"}']) {
      const storage = createMockStorage({
        [ALERT_SETTINGS_STORAGE_KEY]: `{"audio":true,"desktop":true,"volume":0.5,"quiet":${quiet}}`,
      });
      const loaded = loadAlertSettings(storage);
      assert.equal(loaded.audio, true, `the channels are not punished for ${quiet}`);
      assert.equal(loaded.quiet.enabled, false, `${quiet} cannot switch quiet hours on`);
    }
  });

  it("keeps a broken zone out of storage rather than leaving it to throw later", () => {
    const storage = createMockStorage();
    saveAlertSettings(
      { ...DEFAULT_ALERT_SETTINGS, quiet: night({ timeZone: "Mars/Olympus" }) },
      storage,
    );
    const loaded = loadAlertSettings(storage);
    assert.equal(loaded.quiet.timeZone, DEFAULT_QUIET_HOURS.timeZone);
    assert.equal(loaded.quiet.enabled, true, "the rest of the schedule is still the operator's");
  });

  it("is inert with no storage at all, which is the server-render path", () => {
    assert.deepEqual(loadAlertSettings(null).quiet, DEFAULT_QUIET_HOURS);
    assert.doesNotThrow(() =>
      saveAlertSettings({ ...DEFAULT_ALERT_SETTINGS, quiet: night() }, null),
    );
  });
});
