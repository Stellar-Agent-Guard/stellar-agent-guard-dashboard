import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { describe, it } from "node:test";

const DOC = resolve("docs/security-claims.md");
const text = readFileSync(DOC, "utf8");

describe("security claims map", () => {
  it("links only to paths that exist", () => {
    const missing: string[] = [];
    for (const match of text.matchAll(/\]\((\.[^)#\s]*)(?:#[^)]*)?\)/g)) {
      const target = match[1] as string;
      if (!existsSync(resolve(dirname(DOC), target))) missing.push(target);
    }
    assert.deepEqual(missing, []);
  });

  it("covers the core claims with a verification and an owner", () => {
    for (const claim of ["No server", "Non-custodial", "No mock state", "vendored SDK tarball"]) {
      assert.match(text, new RegExp(claim), `claim "${claim}" is mapped`);
    }
    const rows = text.split("\n").filter((line) => /^\| (?!-|Claim)/.test(line));
    assert.ok(rows.length >= 8);
    for (const row of rows) {
      const cells = row.split("|").slice(1, -1);
      assert.equal(cells.length, 6, `row has six columns: ${row.slice(0, 40)}`);
      assert.ok(cells.every((cell) => cell.trim() !== ""));
    }
  });

  it("names only npm scripts that exist", () => {
    const pkg = JSON.parse(readFileSync("package.json", "utf8")) as {
      scripts: Record<string, string>;
    };
    for (const match of text.matchAll(/npm run ([A-Za-z0-9:_-]+)/g)) {
      assert.ok(pkg.scripts[match[1] as string], `npm script ${match[1]} exists`);
    }
  });
});
