/**
 * Human-readable amount formatting for stroop-denominated values.
 *
 * Stroop amounts (e.g. `100000000000` = 10,000 XLM) are unreadable as raw
 * integers, yet they must never pass through floating point: `Number`
 * cannot represent large stroop counts exactly. Everything here operates
 * on BigInt so grouping and decimal placement are exact at any magnitude,
 * from single stroops to multi-billion XLM treasuries.
 */

export interface FormatStroopsOptions {
  /** Token symbol appended in human mode. @default "XLM" */
  symbol?: string;
  /** Base-unit decimals (7 for XLM). @default 7 */
  decimals?: number;
}

function toStroopsBigInt(value: bigint | number | string): bigint {
  if (typeof value === "bigint") return value;
  if (typeof value === "number") {
    if (!Number.isInteger(value)) {
      throw new RangeError(`stroops must be an integer, got ${value}`);
    }
    return BigInt(value);
  }
  const trimmed = value.trim();
  if (!/^-?\d+$/.test(trimmed)) {
    throw new RangeError(`stroops must be an integer string, got ${value}`);
  }
  return BigInt(trimmed);
}

function groupThousands(digits: string): string {
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/**
 * Format a stroop count as a grouped decimal string, e.g.
 * `formatStroops(100_000_000_000n)` → `"10,000.0000000"`.
 *
 * Pure BigInt arithmetic — no floating point at any step.
 */
export function formatStroops(
  value: bigint | number | string,
  options: FormatStroopsOptions = {},
): string {
  const { decimals = 7 } = options;
  if (!Number.isInteger(decimals) || decimals < 0) {
    throw new RangeError(`decimals must be a non-negative integer, got ${decimals}`);
  }
  const stroops = toStroopsBigInt(value);
  if (stroops < 0n) {
    throw new RangeError(`stroops must be non-negative, got ${value}`);
  }
  const scale = 10n ** BigInt(decimals);
  const whole = stroops / scale;
  const frac = stroops % scale;
  const fracStr = frac.toString().padStart(decimals, "0");
  return decimals === 0
    ? groupThousands(whole.toString())
    : `${groupThousands(whole.toString())}.${fracStr}`;
}

/**
 * Format a stroop count with its unit label, e.g.
 * `formatStroopsWithUnit(100_000_000_000n)` → `"10,000.0000000 XLM"`.
 */
export function formatStroopsWithUnit(
  value: bigint | number | string,
  options: FormatStroopsOptions = {},
): string {
  const { symbol = "XLM" } = options;
  return `${formatStroops(value, options)} ${symbol}`;
}

/**
 * Format a stroop count in raw units, e.g.
 * `formatRawStroops(100_000_000_000n)` → `"100,000,000,000 stroops"`.
 * Useful as the exact counterpart to the human-readable form.
 */
export function formatRawStroops(value: bigint | number | string): string {
  const stroops = toStroopsBigInt(value);
  if (stroops < 0n) {
    throw new RangeError(`stroops must be non-negative, got ${value}`);
  }
  return `${groupThousands(stroops.toString())} stroops`;
}
