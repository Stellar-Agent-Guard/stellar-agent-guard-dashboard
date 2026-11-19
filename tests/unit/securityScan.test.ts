import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import { run, scan, summarize } from "../../scripts/security-scan.mjs";

let root: string;
// Built at runtime so this test file itself contains no secret-shaped literal.
const SEED = `SA${"B".repeat(54)}`;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "guard-scan-"));
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

function write(path: string, content: string): void {
  const absolute = join(root, path);
  mkdirSync(join(absolute, ".."), { recursive: true });
  writeFileSync(absolute, content);
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

describe("security scan summary", () => {
  it("passes a clean tree with a concise summary", () => {
    write("lib/a.ts", "export const a = 1;\n");
    const result = capture(() => run(root, {}));
    assert.equal(result.code, 0);
    assert.match(result.out, /Security scan: passed/);
    assert.match(result.out, /Scanned 1 file/);
  });

  it("fails with the rule, path and line but never the matched content", () => {
    write("lib/leak.ts", `const ok = 1;\nconst key = "${SEED}";\n`);
    const result = capture(() => run(root, {}));
    assert.equal(result.code, 1);
    assert.match(result.out, /stellar-secret-seed \| `lib\/leak\.ts` \| 2/);
    assert.ok(!result.out.includes(SEED), "the secret is not printed");
    assert.ok(!result.out.includes("BBBBBBBB"), "no fragment of the secret is printed");
  });

  it("detects private key blocks and ignores allowed fixture paths", () => {
    write("lib/k.ts", "-----BEGIN PRIVATE KEY-----\n");
    write("tests/unit/fixture.ts", `const s = "${SEED}";\n`);
    const { findings } = scan(root);
    assert.deepEqual(
      findings.map((f) => [f.rule, f.path]),
      [["private-key-block", "lib/k.ts"]],
    );
  });

  it("writes the same summary to GITHUB_STEP_SUMMARY and keeps the failing code", () => {
    write("lib/leak.ts", `${SEED}\n`);
    const summaryFile = join(root, "summary.md");
    const result = capture(() => run(root, { GITHUB_STEP_SUMMARY: summaryFile }));
    assert.equal(result.code, 1);
    const written = readFileSync(summaryFile, "utf8");
    assert.match(written, /Security scan: FAILED/);
    assert.ok(!written.includes(SEED));
  });

  it("summarize lists the finding count", () => {
    const text = summarize({ scanned: 3, findings: [{ rule: "r", path: "p", line: 1 }] });
    assert.match(text, /1 finding\(s\)/);
  });

  it("keeps this repository clean", () => {
    assert.equal(capture(() => run(undefined, {})).code, 0);
  });
});
