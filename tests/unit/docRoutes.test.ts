import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import {
  NON_PAGE_ROUTES,
  compareRoutes,
  findDocumentedRoutes,
  findPageRoutes,
  run,
} from "../../scripts/check-doc-routes.mjs";

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "guard-routes-"));
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

function write(path: string, content = "export {};\n"): void {
  const absolute = join(root, path);
  mkdirSync(join(absolute, ".."), { recursive: true });
  writeFileSync(absolute, content);
}

function capture(action: () => number): { code: number; err: string } {
  const errors: string[] = [];
  const realLog = console.log;
  const realError = console.error;
  console.log = () => undefined;
  console.error = (...args: unknown[]) => void errors.push(args.join(" "));
  try {
    return { code: action(), err: errors.join("\n") };
  } finally {
    console.log = realLog;
    console.error = realError;
  }
}

describe("route documentation check", () => {
  it("finds pages, ignoring route groups and non-page files", () => {
    write("app/page.tsx");
    write("app/configure/page.tsx");
    write("app/(shell)/fleet/page.tsx");
    write("app/configure/helpers.ts");
    assert.deepEqual(findPageRoutes(root), ["/", "/configure", "/fleet"]);
  });

  it("extracts documented routes and strips query strings", () => {
    write(
      "README.md",
      "- **`/`** home\n- **`/configure?guard=C1`** deep link\n- plain `/ignored`\n",
    );
    assert.deepEqual(findDocumentedRoutes(root), ["/", "/configure"]);
  });

  it("passes when documentation and tree agree, allowing non-page routes", () => {
    write("app/page.tsx");
    write("README.md", "- **`/`** home\n- **`/manifest.json`** static\n");
    assert.equal(capture(() => run(root)).code, 0);
    assert.ok(NON_PAGE_ROUTES.has("/manifest.json"));
  });

  it("reports a documented route with no page", () => {
    write("app/page.tsx");
    write("README.md", "- **`/`** home\n- **`/ghost`** gone\n");
    const result = capture(() => run(root));
    assert.equal(result.code, 1);
    assert.match(result.err, /documents \/ghost but the app has no page/);
  });

  it("reports an undocumented page", () => {
    write("app/page.tsx");
    write("app/panic/page.tsx");
    write("README.md", "- **`/`** home\n");
    const result = capture(() => run(root));
    assert.equal(result.code, 1);
    assert.match(result.err, /page \/panic but the README/);
  });

  it("compareRoutes is empty for matching lists", () => {
    assert.deepEqual(compareRoutes(["/a"], ["/a"]), []);
  });

  it("keeps this repository's README in step with app/", () => {
    assert.equal(capture(() => run()).code, 0);
  });
});
