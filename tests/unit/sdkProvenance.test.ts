import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import { PROVENANCE_PATH, run, verifySdkProvenance } from "../../scripts/verify-sdk-provenance.mjs";

let root: string;
const TARBALL = "vendor/sdk-test.tgz";
const BYTES = Buffer.from("not really a tarball, and never executed");

function fixture(bytes = BYTES, overrides: Record<string, unknown> = {}): void {
  mkdirSync(join(root, "vendor"), { recursive: true });
  writeFileSync(join(root, TARBALL), bytes);
  const integrity = `sha512-${createHash("sha512").update(BYTES).digest("base64")}`;
  writeFileSync(
    join(root, PROVENANCE_PATH),
    JSON.stringify({
      tarball: TARBALL,
      sha256: createHash("sha256").update(BYTES).digest("hex"),
      integrity,
      sourceRevision: "abc123",
      ...overrides,
    }),
  );
  writeFileSync(
    join(root, "package-lock.json"),
    JSON.stringify({
      packages: {
        "node_modules/stellar-agent-guard-sdk": { resolved: `file:${TARBALL}`, integrity },
      },
    }),
  );
}

function capture(action: () => number): { code: number; out: string } {
  const lines: string[] = [];
  const realLog = console.log;
  const realError = console.error;
  console.log = (...args: unknown[]) => void lines.push(args.join(" "));
  console.error = (...args: unknown[]) => void lines.push(args.join(" "));
  try {
    return { code: action(), out: lines.join("\n") };
  } finally {
    console.log = realLog;
    console.error = realError;
  }
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "guard-provenance-"));
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe("vendored SDK provenance", () => {
  it("passes when bytes, record and lockfile agree", () => {
    fixture();
    assert.deepEqual(verifySdkProvenance(root), []);
    assert.equal(capture(() => run(root)).code, 0);
  });

  it("fails actionably when the tarball bytes were replaced", () => {
    fixture(Buffer.from("replacement"));
    const result = capture(() => run(root));
    assert.equal(result.code, 1);
    assert.match(result.out, /SHA-256 is [0-9a-f]{64}, expected/);
    assert.match(result.out, /abc123/);
    assert.match(result.out, /never unpacked or executed/);
  });

  it("fails when the lockfile integrity drifts from the record", () => {
    fixture();
    writeFileSync(
      join(root, "package-lock.json"),
      JSON.stringify({
        packages: {
          "node_modules/stellar-agent-guard-sdk": {
            resolved: `file:${TARBALL}`,
            integrity: "sha512-other",
          },
        },
      }),
    );
    assert.match(verifySdkProvenance(root).join("\n"), /package-lock\.json integrity/);
  });

  it("fails when the record is missing or incomplete", () => {
    assert.match(verifySdkProvenance(root)[0] ?? "", /missing or not valid JSON/);
    fixture(BYTES, { sha256: "" });
    assert.match(verifySdkProvenance(root).join("\n"), /field "sha256" is missing/);
  });

  it("fails when the recorded tarball is absent", () => {
    fixture();
    rmSync(join(root, TARBALL));
    assert.match(verifySdkProvenance(root)[0] ?? "", /cannot be read/);
  });

  it("verifies this repository's committed tarball", () => {
    assert.deepEqual(verifySdkProvenance(), []);
    void cpSync;
  });
});
