/**
 * The fixture update workflow, enforced (issue #557).
 *
 * `docs/operations/test-fixtures.md` documents where every shared fixture comes
 * from, what must never be in one, and how the mirrored SDK vocabulary is kept
 * current. This file turns the parts of that doc that can be checked
 * mechanically into failing tests:
 *
 *   - the inventory covers every file in `tests/fixtures/`, and every row points
 *     at files that exist and that really read the fixture;
 *   - the doc is reachable from the fixture READMEs and CONTRIBUTING;
 *   - no checksummed Stellar secret seed is committed anywhere fixtures live;
 *   - captured and generated fixtures carry their provenance fields and are
 *     testnet-only;
 *   - pinned bytecode still hashes to the pin;
 *   - the mirrored reason vocabulary matches the SDK in both directions;
 *   - every focused command the doc tells contributors to run actually exists.
 *
 * The first block exercises the helpers against bad inputs, so a rule that
 * quietly stops matching (an empty inventory, a seed it can't see) fails here
 * rather than passing vacuously against the real tree.
 */

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { basename, extname, join } from "node:path";
import { describe, it } from "node:test";
import { Keypair } from "@stellar/stellar-sdk";
import { GUARD_REASON_CODES, explainReason } from "stellar-agent-guard-sdk";
import {
  FIXTURE_KINDS,
  INVENTORY_END,
  INVENTORY_START,
  findSecretSeeds,
  parseFixtureInventory,
  vocabularyDrift,
} from "../helpers/fixtureProvenance.ts";
import { PHASE1_ARTIFACT } from "../../lib/guard/network.ts";

const DOC = "docs/operations/test-fixtures.md";
const TESTNET_PASSPHRASE = "Test SDF Network ; September 2015";

const docText = readFileSync(DOC, "utf8");
const inventory = parseFixtureInventory(docText);

function readJson<T = Record<string, unknown>>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

function filesUnder(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) found.push(...filesUnder(path));
    else found.push(path.replace(/\\/g, "/"));
  }
  return found;
}

// ── The helpers, against inputs that must fail ──────────────────────────────

describe("fixture provenance helpers", () => {
  const header =
    "| Fixture | Kind | Source | Consumers | Focused check |\n| --- | --- | --- | --- | --- |";

  it("refuses an inventory without markers instead of reading it as empty", () => {
    assert.throws(() => parseFixtureInventory("# no table here"), /markers/);
    assert.throws(
      () => parseFixtureInventory(`${INVENTORY_END}\n${header}\n${INVENTORY_START}`),
      /out of order/,
    );
  });

  it("refuses an inventory with a renamed column or no rows", () => {
    const wrongHeader =
      "| Fixture | Kind | Origin | Consumers | Focused check |\n| --- | --- | --- | --- | --- |";
    assert.throws(
      () =>
        parseFixtureInventory(
          `${INVENTORY_START}\n${wrongHeader}\n| a | b | c | d | e |\n${INVENTORY_END}`,
        ),
      /header/,
    );
    assert.throws(
      () => parseFixtureInventory(`${INVENTORY_START}\n${header}\n${INVENTORY_END}`),
      /no rows/,
    );
  });

  it("refuses a row with a missing cell or no fixture path", () => {
    assert.throws(
      () =>
        parseFixtureInventory(
          `${INVENTORY_START}\n${header}\n| \`a.json\` | captured | x |\n${INVENTORY_END}`,
        ),
      /cells/,
    );
    assert.throws(
      () =>
        parseFixtureInventory(
          `${INVENTORY_START}\n${header}\n| a.json | captured | x | y | z |\n${INVENTORY_END}`,
        ),
      /no fixture path/,
    );
  });

  it("parses consumers as backticked paths", () => {
    const [row] = parseFixtureInventory(
      `${INVENTORY_START}\n${header}\n| \`tests/fixtures/a.json\` | captured | testnet | \`x.ts\`, \`y.ts\` | \`npm test\` |\n${INVENTORY_END}`,
    );
    assert.deepEqual(row, {
      path: "tests/fixtures/a.json",
      kind: "captured",
      source: "testnet",
      consumers: ["x.ts", "y.ts"],
      check: "`npm test`",
    });
  });

  it("finds a real secret seed wherever it is embedded", () => {
    const keypair = Keypair.random();
    const secret = keypair.secret();
    assert.deepEqual(findSecretSeeds(JSON.stringify({ admin: { seed: secret } })), [secret]);
    assert.deepEqual(findSecretSeeds(`const KEY="${secret}";`), [secret]);
    assert.deepEqual(findSecretSeeds(`${secret}\n${secret}`), [secret], "reported once");
  });

  it("does not flag public keys, contract ids, or S-prefixed strings without a valid checksum", () => {
    const keypair = Keypair.random();
    assert.deepEqual(findSecretSeeds(keypair.publicKey()), []);
    assert.deepEqual(findSecretSeeds(PHASE1_ARTIFACT.guard), []);
    const broken = `${keypair.secret().slice(0, 55)}${keypair.secret().endsWith("A") ? "B" : "A"}`;
    assert.deepEqual(findSecretSeeds(broken), [], "a corrupted checksum is not a seed");
    assert.deepEqual(findSecretSeeds("S".repeat(56)), []);
  });

  it("reports vocabulary drift in both directions", () => {
    assert.deepEqual(vocabularyDrift(["a", "b"], ["a", "b"]), {
      missingFromFixture: [],
      unknownToSdk: [],
    });
    assert.deepEqual(vocabularyDrift(["a", "old"], ["a", "new"]), {
      missingFromFixture: ["new"],
      unknownToSdk: ["old"],
    });
  });
});

// ── The inventory against the tree ──────────────────────────────────────────

describe("the fixture inventory", () => {
  it("lists every file in tests/fixtures/", () => {
    const listed = new Set(inventory.map((row) => row.path));
    const unlisted = filesUnder("tests/fixtures").filter(
      (path) => basename(path) !== "README.md" && !listed.has(path),
    );
    assert.deepEqual(unlisted, [], `add these to the inventory in ${DOC}`);
  });

  it("lists each fixture once, with a documented kind", () => {
    const paths = inventory.map((row) => row.path);
    assert.equal(new Set(paths).size, paths.length, "a fixture is listed twice");
    for (const row of inventory) {
      assert.ok(
        (FIXTURE_KINDS as readonly string[]).includes(row.kind),
        `${row.path}: kind "${row.kind}" is not one of ${FIXTURE_KINDS.join(", ")}`,
      );
      assert.ok(row.source.length > 0, `${row.path}: the Source column is empty`);
      assert.ok(row.check.length > 0, `${row.path}: the Focused check column is empty`);
    }
  });

  it("points only at files that exist", () => {
    for (const row of inventory) {
      assert.ok(existsSync(row.path), `${row.path} is listed but does not exist`);
      assert.ok(row.consumers.length > 0, `${row.path} lists no consumers`);
      for (const consumer of row.consumers) {
        assert.ok(existsSync(consumer), `${row.path}: consumer ${consumer} does not exist`);
      }
    }
  });

  it("names consumers that really read the fixture", () => {
    for (const row of inventory) {
      const file = basename(row.path);
      const stem = basename(row.path, extname(row.path));
      for (const consumer of row.consumers) {
        const text = readFileSync(consumer, "utf8");
        assert.ok(
          text.includes(file) || text.includes(stem),
          `${consumer} is listed as reading ${row.path} but never references it`,
        );
      }
    }
  });

  it("is reachable from the fixture READMEs, CONTRIBUTING and the docs summary", () => {
    const link = /operations\/test-fixtures\.md/;
    assert.match(readFileSync("tests/fixtures/README.md", "utf8"), link);
    assert.match(readFileSync("tests/mocks/README.md", "utf8"), link);
    assert.match(readFileSync("CONTRIBUTING.md", "utf8"), link);
    assert.match(readFileSync("docs/SUMMARY.md", "utf8"), link);
  });

  it("only recommends commands and test files that exist", () => {
    const scripts = Object.keys(
      readJson<{ scripts: Record<string, string> }>("package.json").scripts,
    );
    for (const [, name] of docText.matchAll(/npm run ([A-Za-z0-9:_-]+)/g)) {
      assert.ok(scripts.includes(name!), `${DOC} recommends missing script "npm run ${name}"`);
    }
    for (const [path] of docText.matchAll(
      /tests\/(?:unit|e2e)\/[A-Za-z0-9_.-]+\.(?:test|spec)\.ts/g,
    )) {
      assert.ok(existsSync(path), `${DOC} references ${path}, which does not exist`);
    }
  });
});

// ── Redaction ───────────────────────────────────────────────────────────────

describe("redaction", () => {
  const scanned = [
    ...filesUnder("tests/fixtures"),
    ...filesUnder("tests/mocks"),
    ...filesUnder("tests/e2e"),
    "lib/guard/demoFixtures.ts",
  ];

  it("commits no Stellar secret seed where fixtures live", () => {
    // Binary fixtures are scanned as latin1 so an embedded ASCII seed still shows.
    const leaks = scanned.flatMap((path) =>
      findSecretSeeds(readFileSync(path, "latin1")).map((seed) => `${path}: ${seed.slice(0, 4)}…`),
    );
    assert.deepEqual(leaks, [], "secret seeds must never be committed in fixtures");
    assert.ok(scanned.length > 10, "the scan covers the fixture directories");
  });

  it("keeps the proof script's key file gitignored", () => {
    // `.env.phase3` holds the funded testnet keys `prove:phase3` reuses. It may
    // exist on a contributor's machine; it must never be committable.
    const rules = readFileSync(".gitignore", "utf8")
      .split("\n")
      .map((line) => line.trim());
    assert.ok(
      rules.includes(".env.*") || rules.includes(".env.phase3"),
      ".env.phase3 must stay gitignored",
    );
    assert.equal(rules.includes("!.env.phase3"), false, ".env.phase3 must not be re-included");
  });
});

// ── Provenance fields and content ───────────────────────────────────────────

describe("captured and generated fixtures carry their provenance", () => {
  it("rpc-capture.json says when, where and from which network it was captured", () => {
    const capture = readJson("tests/fixtures/rpc-capture.json");
    assert.equal(typeof capture._comment, "string");
    assert.ok(!Number.isNaN(Date.parse(String(capture.capturedAt))), "capturedAt is an ISO date");
    assert.equal(capture.network, "testnet");
    assert.equal(capture.passphrase, TESTNET_PASSPHRASE, "captures are testnet-only");
    for (const field of ["headerXdr", "metadataXdr", "accountEntryXdr"]) {
      assert.equal(typeof capture[field], "string", `${field} is present`);
    }
  });

  it("phase3-proof.json records the run's network, endpoint and time", () => {
    const proof = readJson("tests/fixtures/phase3-proof.json");
    assert.equal(proof.networkPassphrase, TESTNET_PASSPHRASE);
    assert.match(String(proof.rpcUrl), /^https:\/\/soroban-testnet\.stellar\.org/);
    assert.ok(!Number.isNaN(Date.parse(String(proof.ranAt))), "ranAt is an ISO date");
  });

  it("phase3-proof.run.json explains itself in its note", () => {
    const record = readJson("tests/fixtures/phase3-proof.run.json");
    assert.equal(typeof record.note, "string");
    assert.ok(String(record.note).length > 0);
  });

  it("pinned bytecode still hashes to the pin", () => {
    for (const path of ["tests/fixtures/phase1-artifact.wasm", "tests/fixtures/pinnedGuard.wasm"]) {
      const hash = createHash("sha256").update(readFileSync(path)).digest("hex");
      assert.equal(hash, PHASE1_ARTIFACT.wasmHash, `${path} is not the pinned artifact`);
    }
  });
});

describe("mirrored SDK vocabulary", () => {
  const vocabulary = readJson<{
    event: string;
    known_reasons: string[];
    reason_explanations: Record<string, string>;
  }>("tests/fixtures/auth-checked-vocabulary.json");

  it("lists exactly the SDK's reasons", () => {
    assert.deepEqual(
      vocabularyDrift(vocabulary.known_reasons, Object.keys(GUARD_REASON_CODES)),
      { missingFromFixture: [], unknownToSdk: [] },
      "update known_reasons to match stellar-agent-guard-sdk (see docs/operations/test-fixtures.md)",
    );
  });

  it("explains every known reason, and only known reasons", () => {
    assert.deepEqual(
      Object.keys(vocabulary.reason_explanations).sort(),
      [...vocabulary.known_reasons].sort(),
    );
    for (const reason of vocabulary.known_reasons) {
      assert.ok(
        explainReason(reason as never).length > 0,
        `the SDK has no explanation for ${reason}`,
      );
    }
  });

  it("describes the auth_checked topic", () => {
    assert.equal(vocabulary.event, "event_auth_checked");
  });
});
