import assert from "node:assert/strict";
import { test } from "node:test";
import { canonicalUtc, formatEventTimestamp } from "../../lib/guard/time.ts";

/**
 * `canonicalUtc` is the form every machine-readable export writes an instant
 * in (issue #318). These tests pin the rule itself, so an export cannot drift
 * back to a producer's raw string — or, worse, to the operator's local time —
 * without one of them failing.
 */

test("an absent time is the empty cell, never an invented date", () => {
  assert.equal(canonicalUtc(null), "");
  assert.equal(canonicalUtc(undefined), "");
  assert.equal(canonicalUtc(""), "");
  assert.equal(canonicalUtc("   "), "");
});

test("a canonical UTC value passes through untouched", () => {
  assert.equal(canonicalUtc("2026-09-24T10:00:00Z"), "2026-09-24T10:00:00Z");
  assert.equal(canonicalUtc("2026-09-24T10:00:00.412Z"), "2026-09-24T10:00:00Z");
  assert.equal(canonicalUtc("  2026-09-24T10:00:00Z  "), "2026-09-24T10:00:00Z");
});

test("an explicit offset is folded into the same instant", () => {
  assert.equal(canonicalUtc("2026-09-24T12:00:00+02:00"), "2026-09-24T10:00:00Z");
  assert.equal(canonicalUtc("2026-09-24T05:00:00-05:00"), "2026-09-24T10:00:00Z");
  assert.equal(canonicalUtc("2026-09-24T10:30:00+00:30"), "2026-09-24T10:00:00Z");
});

test("a zone-less wall time is read as UTC, not as the host's local time", () => {
  // `Date.parse` gives these three a *different instant per zone*; the export
  // must give them one.
  assert.equal(canonicalUtc("2026-09-24T10:00:00"), "2026-09-24T10:00:00Z");
  assert.equal(canonicalUtc("2026-09-24T10:00:00.412"), "2026-09-24T10:00:00Z");
  assert.equal(canonicalUtc("2026-09-24 10:00:00"), "2026-09-24T10:00:00Z");
  // A bare date is already UTC to `Date.parse`, so it needs no correction — and
  // must not be turned into a suffix that makes it unparseable.
  assert.equal(canonicalUtc("2026-09-24"), "2026-09-24T00:00:00Z");
});

test("a value that names no instant is returned verbatim, never blanked", () => {
  assert.equal(canonicalUtc("latest"), "latest");
  assert.equal(canonicalUtc("1789481712"), "1789481712");
  assert.equal(canonicalUtc("2026-13-45T99:99:99Z"), "2026-13-45T99:99:99Z");
});

test("the exported form is the form the on-screen UTC column shows", () => {
  const iso = "2026-09-24T10:00:00.000Z";
  const rendered = formatEventTimestamp(iso, "Europe/London");
  assert.ok(rendered, "the UI renders the same instant");
  assert.equal(canonicalUtc(iso), rendered.utc, "the file and the screen agree byte for byte");
});

test("the rendering does not depend on the host time zone", () => {
  const realTz = process.env.TZ;
  const inputs = [
    "2026-03-08T02:30:00", // a zone-less time inside the US spring-forward gap
    "2026-03-29T00:30:00-05:00", // the instant London shifts onto summer time
    "2026-10-25T01:30:00+01:00", // and the instant it shifts back off it
    "2026-12-31T23:59:59.999Z",
  ];
  try {
    process.env.TZ = "UTC";
    const underUtc = inputs.map((input) => canonicalUtc(input));
    for (const zone of [
      "America/New_York",
      "Asia/Kolkata",
      "Europe/London",
      "Pacific/Kiritimati",
    ]) {
      process.env.TZ = zone;
      assert.deepEqual(
        inputs.map((input) => canonicalUtc(input)),
        underUtc,
        `TZ=${zone}`,
      );
    }
  } finally {
    if (realTz === undefined) delete process.env.TZ;
    else process.env.TZ = realTz;
  }
});
