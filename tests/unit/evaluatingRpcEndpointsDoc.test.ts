import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it } from "node:test";
import {
  EVALUATE_ENDPOINTS_GUIDE_PATH,
  EVALUATE_ENDPOINTS_LABEL,
} from "../../components/ConfigureNetworkContext.tsx";

describe("evaluating third-party RPC endpoints checklist (issue #511)", () => {
  const guidePath = resolve(process.cwd(), "docs/guides/evaluating-rpc-endpoints.md");
  const summaryPath = resolve(process.cwd(), "docs/SUMMARY.md");

  it("publishes the safe checklist guide in docs/guides/", () => {
    assert.ok(existsSync(guidePath), `Expected ${guidePath} to exist`);
    const content = readFileSync(guidePath, "utf-8");

    // Provider-neutral checklist items
    assert.match(content, /Trust & Cryptographic Integrity/i);
    assert.match(content, /Availability & Reliability/i);
    assert.match(content, /Privacy, Logging & Retention/i);
    assert.match(content, /Network Identity & Passphrase Isolation/i);

    // Browser request data explanation: what leaves vs what never leaves
    assert.match(content, /What Data Leaves the Browser/i);
    assert.match(content, /What Data NEVER Leaves the Browser/i);
    assert.match(content, /Private Keys or Seed Phrases/i);
    assert.match(content, /JSON-RPC Queries/i);
    assert.match(content, /Signed Transaction Envelopes/i);
  });

  it("indexes the guide in docs/SUMMARY.md under Guides", () => {
    assert.ok(existsSync(summaryPath), `Expected ${summaryPath} to exist`);
    const summary = readFileSync(summaryPath, "utf-8");
    assert.match(summary, /Evaluating Third-Party Endpoints.*guides\/evaluating-rpc-endpoints\.md/);
  });

  it("exports guide link constants from ConfigureNetworkContext", () => {
    assert.equal(EVALUATE_ENDPOINTS_GUIDE_PATH, "/docs/guides/evaluating-rpc-endpoints.md");
    assert.equal(EVALUATE_ENDPOINTS_LABEL, "Evaluating third-party endpoints");
  });
});
