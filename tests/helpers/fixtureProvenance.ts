/**
 * Pure helpers behind `tests/unit/fixtureProvenance.test.ts` (issue #557).
 *
 * The fixture update workflow lives in `docs/operations/test-fixtures.md`. Its
 * inventory table is the contract the test enforces: every committed fixture
 * is listed with where it came from and who reads it, nothing secret is in it,
 * and the hand-maintained vocabulary still matches the SDK. These helpers do
 * the parsing and scanning so the rules themselves can be tested against
 * failing inputs, not only against the repository as it happens to be today.
 */

import { StrKey } from "@stellar/stellar-sdk";

/** One row of the inventory table in the fixture workflow doc. */
export interface FixtureRow {
  /** Repo-relative path of the fixture, without backticks. */
  path: string;
  kind: string;
  source: string;
  /** Repo-relative paths of the files that read the fixture. */
  consumers: string[];
  /** The focused command (or test file) that proves the fixture still fits. */
  check: string;
}

export const INVENTORY_START = "<!-- fixture-inventory:start -->";
export const INVENTORY_END = "<!-- fixture-inventory:end -->";

/** The fixture kinds the doc defines; any other value is a typo or an undocumented kind. */
export const FIXTURE_KINDS = ["captured", "generated", "pinned", "mirrored", "synthetic"] as const;

/** Every backticked token in a cell, in order. */
function codeSpans(cell: string): string[] {
  return [...cell.matchAll(/`([^`]+)`/g)].map((match) => match[1]!.trim());
}

/**
 * Parse the inventory table between the two markers.
 *
 * Throws instead of returning an empty list when the markers or the header are
 * missing: an inventory that silently parses as "no fixtures" would make every
 * coverage check pass vacuously.
 */
export function parseFixtureInventory(markdown: string): FixtureRow[] {
  const start = markdown.indexOf(INVENTORY_START);
  const end = markdown.indexOf(INVENTORY_END);
  if (start === -1 || end === -1 || end < start) {
    throw new Error("fixture inventory markers are missing or out of order");
  }
  const lines = markdown
    .slice(start + INVENTORY_START.length, end)
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("|"));
  const [header, divider, ...body] = lines;
  const expected = ["Fixture", "Kind", "Source", "Consumers", "Focused check"];
  const columns = header
    ?.split("|")
    .slice(1, -1)
    .map((cell) => cell.trim());
  if (!columns || JSON.stringify(columns) !== JSON.stringify(expected) || !divider) {
    throw new Error(`fixture inventory header must be: | ${expected.join(" | ")} |`);
  }
  if (body.length === 0) throw new Error("fixture inventory has no rows");

  return body.map((line, index) => {
    const cells = line
      .split("|")
      .slice(1, -1)
      .map((cell) => cell.trim());
    if (cells.length !== expected.length) {
      throw new Error(`fixture inventory row ${index + 1} has ${cells.length} cells`);
    }
    const [fixture, kind, source, consumers, check] = cells as [
      string,
      string,
      string,
      string,
      string,
    ];
    const path = codeSpans(fixture)[0];
    if (!path) throw new Error(`fixture inventory row ${index + 1} names no fixture path`);
    return { path, kind, source, consumers: codeSpans(consumers), check };
  });
}

/**
 * Every valid Stellar secret seed (`S…`, checksummed) in `text`.
 *
 * Checksum validation is what keeps this precise: a 56-character string that
 * merely starts with `S` is not a seed, and a public key (`G…`) or contract id
 * (`C…`) never matches.
 */
export function findSecretSeeds(text: string): string[] {
  const candidates = text.match(/S[A-Z2-7]{55}/g) ?? [];
  return [...new Set(candidates.filter((candidate) => StrKey.isValidEd25519SecretSeed(candidate)))];
}

/** Reasons present on one side and not the other. Both empty means no drift. */
export function vocabularyDrift(
  fixtureReasons: readonly string[],
  sdkReasons: readonly string[],
): { missingFromFixture: string[]; unknownToSdk: string[] } {
  const fixture = new Set(fixtureReasons);
  const sdk = new Set(sdkReasons);
  return {
    missingFromFixture: [...sdk].filter((reason) => !fixture.has(reason)).sort(),
    unknownToSdk: [...fixture].filter((reason) => !sdk.has(reason)).sort(),
  };
}
