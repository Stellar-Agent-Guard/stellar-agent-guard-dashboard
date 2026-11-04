import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const scriptPath = fileURLToPath(new URL("../../scripts/check-doc-scripts.ts", import.meta.url));

test("the doc script audit passes against the current README and CONTRIBUTING references", () => {
  const result = execFileSync("node", ["--import", "tsx", scriptPath], {
    cwd: fileURLToPath(new URL("../..", import.meta.url)),
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });

  assert.match(result, /validated|OK|documented/i);
});
