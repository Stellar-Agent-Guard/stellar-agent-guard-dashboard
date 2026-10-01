import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { MAX_REMAINING_DAYS, formatRemaining } from "../../lib/guard/time.ts";

const MINUTE = 60n;
const HOUR = 3_600n;
const DAY = 86_400n;

describe("formatRemaining — sub-minute rung", () => {
  it('renders the final minute as "now"', () => {
    assert.deepEqual(formatRemaining(59n), { text: "now", expired: false });
    assert.deepEqual(formatRemaining(1n), { text: "now", expired: false });
  });
});

describe("formatRemaining — zero and overdue", () => {
  it("signals expiry at exactly zero (the deadline itself)", () => {
    assert.deepEqual(formatRemaining(0n), { text: "expired", expired: true });
  });

  it("signals expiry for a negative (past-deadline) value", () => {
    assert.deepEqual(formatRemaining(-1n), { text: "expired", expired: true });
    assert.deepEqual(formatRemaining(-180), { text: "expired", expired: true });
  });
});

describe("formatRemaining — precision ladder", () => {
  it("renders exact minutes", () => {
    assert.deepEqual(formatRemaining(MINUTE), { text: "1m", expired: false });
    assert.deepEqual(formatRemaining(5n * MINUTE), { text: "5m", expired: false });
  });

  it("renders hours, dropping a zero minute component", () => {
    assert.deepEqual(formatRemaining(HOUR), { text: "1h", expired: false });
    assert.deepEqual(formatRemaining(2n * HOUR), { text: "2h", expired: false });
  });

  it('renders hours and minutes together (the "2h 4m" shape)', () => {
    assert.deepEqual(formatRemaining(2n * HOUR + 4n * MINUTE), {
      text: "2h 4m",
      expired: false,
    });
  });

  it("renders whole days, dropping a zero hour component", () => {
    assert.deepEqual(formatRemaining(DAY), { text: "1d", expired: false });
  });

  it('renders days and hours together (the "2d 4h" shape)', () => {
    assert.deepEqual(formatRemaining(2n * DAY + 4n * HOUR), { text: "2d 4h", expired: false });
  });

  it("floors partial units so the text never overstates the time left", () => {
    assert.deepEqual(formatRemaining(59n * MINUTE + 59n), { text: "59m", expired: false });
    assert.deepEqual(formatRemaining(23n * HOUR + 59n * MINUTE + 59n), {
      text: "23h 59m",
      expired: false,
    });
  });

  it("accepts a plain number as well as a bigint", () => {
    assert.deepEqual(formatRemaining(300), { text: "5m", expired: false });
    assert.deepEqual(formatRemaining(2 * 3600 + 4 * 60), { text: "2h 4m", expired: false });
  });

  it("rejects a non-integer number rather than formatting a fractional value", () => {
    assert.throws(() => formatRemaining(1.5), RangeError);
  });
});

describe("formatRemaining — cap for absurd magnitudes", () => {
  it("caps days at MAX_REMAINING_DAYS with a +", () => {
    assert.equal(MAX_REMAINING_DAYS, 999);
    assert.deepEqual(formatRemaining(1_000n * DAY), { text: "999d+", expired: false });
    assert.deepEqual(formatRemaining(10_475n * DAY), { text: "999d+", expired: false });
  });

  it("still renders the largest in-range value exactly", () => {
    assert.deepEqual(formatRemaining(999n * DAY), { text: "999d", expired: false });
    assert.deepEqual(formatRemaining(999n * DAY + 5n * HOUR), { text: "999d 5h", expired: false });
  });
});

describe("formatRemaining — no-float bigint precision", () => {
  it("accepts the full u64 range without routing it through Number", () => {
    const u64Max = 18_446_744_073_709_551_615n; // 2^64 - 1
    // Far outside Number's exact-integer range, so a float divide would be
    // lossy. BigInt arithmetic keeps the result well-defined.
    assert.equal(Number.isSafeInteger(Number(u64Max)), false);
    assert.deepEqual(formatRemaining(u64Max), { text: "999d+", expired: false });
  });

  it("renders the top of the ladder exactly, not by rounding", () => {
    // 999d 23h 59m 59s is the largest sub-cap value; the next second crosses
    // into the cap. An off-by-one would show precisely here.
    assert.deepEqual(formatRemaining(86_399_999n), { text: "999d 23h", expired: false });
    assert.deepEqual(formatRemaining(86_400_000n), { text: "999d+", expired: false });
  });
});
