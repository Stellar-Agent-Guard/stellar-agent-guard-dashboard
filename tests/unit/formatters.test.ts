import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  formatStroops,
  formatRawStroops,
  formatStroopsWithUnit,
} from "../../lib/guard/formatters.ts";
import { formatRemaining } from "../../lib/guard/time.ts";

describe("formatStroops", () => {
  it("groups a standard 10,000 XLM value without floats", () => {
    assert.equal(formatStroops(100_000_000_000n), "10,000.0000000");
  });

  it("renders a single stroop and zero exactly", () => {
    assert.equal(formatStroops(1n), "0.0000001");
    assert.equal(formatStroops(0n), "0.0000000");
  });

  it("handles multi-billion XLM magnitudes exactly", () => {
    // 2.5B XLM = 25_000_000_000_000_000 stroops — beyond float precision.
    assert.equal(formatStroops(25_000_000_000_000_000_000n), "2,500,000,000.0000000");
  });

  it("accepts number and string inputs", () => {
    assert.equal(formatStroops(10_000_000), "1.0000000");
    assert.equal(formatStroops("10000000"), "1.0000000");
  });

  it("supports custom symbols and decimals", () => {
    assert.equal(formatStroops(1_500_000n, { symbol: "USDC", decimals: 6 }), "1.500000");
    assert.equal(formatStroops(1500n, { decimals: 0 }), "1,500");
  });

  it("rejects negative and non-integer input", () => {
    assert.throws(() => formatStroops(-1n), RangeError);
    assert.throws(() => formatStroops(1.5), RangeError);
    assert.throws(() => formatStroops("abc"), RangeError);
  });
});

describe("formatStroopsWithUnit / formatRawStroops", () => {
  it("pairs human and raw forms for the toggle", () => {
    assert.equal(formatStroopsWithUnit(100_000_000_000n), "10,000.0000000 XLM");
    assert.equal(formatRawStroops(100_000_000_000n), "100,000,000,000 stroops");
  });

  it("honours a custom symbol", () => {
    assert.equal(
      formatStroopsWithUnit(2_000_000n, { symbol: "USDC", decimals: 6 }),
      "2.000000 USDC",
    );
  });
});

describe("formatRemaining", () => {
  it("signals expired for zero and negative remaining", () => {
    const zero = formatRemaining(0);
    assert.equal(zero.expired, true);
    assert.equal(zero.text, "expired");

    const neg = formatRemaining(-120n);
    assert.equal(neg.expired, true);
    assert.equal(neg.text, "expired");
  });

  it("renders sub-minute remaining as <m1", () => {
    const result = formatRemaining(30);
    assert.equal(result.expired, false);
    assert.equal(result.text, "<m1");
  });

  it("renders exact minutes without seconds noise", () => {
    assert.equal(formatRemaining(60n).text, "1m");
    assert.equal(formatRemaining(180).text, "3m");
  });

  it("renders hours and days with a rounded-down ladder", () => {
    assert.equal(formatRemaining(3600).text, "1h");
    assert.equal(formatRemaining(3600 + 1800).text, "1h30m");
    assert.equal(formatRemaining(86400).text, "1d");
    assert.equal(formatRemaining(86400 + 7200).text, "1d2h");
  });

  it("caps large values at 999d+", () => {
    const huge = formatRemaining(86400 * 10_000);
    assert.equal(huge.text, "999d+");
    assert.equal(huge.expired, false);
  });

  it("preserves bigint precision without floats", () => {
    // u64 seconds beyond Number.safeInteger — no float conversion.
    const big = 9_000_000_000_000_000n;
    const result = formatRemaining(big);
    assert.equal(result.text, "999d+");
    assert.equal(result.expired, false);
  });

  it("accepts number and bigint inputs identically", () => {
    assert.equal(formatRemaining(7200).text, formatRemaining(7200n).text);
  });
});
