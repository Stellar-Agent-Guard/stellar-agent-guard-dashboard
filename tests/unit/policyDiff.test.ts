import { describe, it } from "node:test";
import assert from "node:assert";
import { computePolicyDiff } from "../../lib/guard/policyDiff";
import type { PolicyConfig } from "stellar-agent-guard-sdk";

const emptyConfig: PolicyConfig = {
  per_tx_cap: 0n,
  window_secs: 86400n,
  window_cap: 0n,
  assets: [],
  protocols: [],
  recipients: [],
  allow_any_recipient: false,
  active_from: 0n,
  active_until: 0n,
  paused: false,
  dms_grace_secs: 0n,
};

describe("policyDiff", () => {
  it("computes a field diff without treating a tighter cap as high impact", () => {
    const newConfig = { ...emptyConfig, window_cap: 100n };
    const diff = computePolicyDiff(emptyConfig, newConfig);
    const windowCapEntry = diff.entries.find((entry) => entry.field === "window_cap");
    assert.strictEqual(windowCapEntry?.status, "modified");
    assert.strictEqual(diff.warnings.length, 0);
    assert.strictEqual(diff.highImpact, false);
  });

  it("requires review before installing a policy when none is installed", () => {
    const diff = computePolicyDiff(null, { ...emptyConfig, per_tx_cap: 100n });
    assert.strictEqual(diff.highImpact, true);
    assert.match(diff.highImpactReasons[0] ?? "", /No policy is currently installed/);
  });

  it("flags higher caps and a transition to an unlimited cap", () => {
    const oldConfig = { ...emptyConfig, per_tx_cap: 100n, window_cap: 500n };
    const increased = computePolicyDiff(oldConfig, { ...oldConfig, per_tx_cap: 200n, window_cap: 0n });
    assert.strictEqual(increased.highImpact, true);
    assert.strictEqual(increased.highImpactReasons.length, 2);
  });

  it("flags a shorter rolling window because the cap resets sooner", () => {
    const oldConfig = { ...emptyConfig, window_cap: 500n, window_secs: 86400n };
    const diff = computePolicyDiff(oldConfig, { ...oldConfig, window_secs: 3600n });
    assert.strictEqual(diff.highImpact, true);
    assert.match(diff.highImpactReasons[0] ?? "", /rolling-window duration is shortened/);
  });

  it("flags broadening recipient, asset and protocol permissions", () => {
    const oldConfig = {
      ...emptyConfig,
      recipients: ["GOLD"],
      assets: ["COLD"],
      protocols: [{ contract: "COLD", fns: ["swap"] }],
    };
    const nextConfig = {
      ...oldConfig,
      recipients: ["GOLD", "GNEW"],
      assets: ["COLD", "CNEW"],
      protocols: [{ contract: "COLD", fns: null }],
    };
    const diff = computePolicyDiff(oldConfig, nextConfig);
    assert.strictEqual(diff.highImpact, true);
    assert.strictEqual(diff.highImpactReasons.length, 3);
  });

  it("flags enabling any-recipient access and widening the active window", () => {
    const oldConfig = { ...emptyConfig, allow_any_recipient: false, active_from: 100n, active_until: 200n };
    const diff = computePolicyDiff(oldConfig, {
      ...oldConfig,
      allow_any_recipient: true,
      active_from: 0n,
      active_until: 0n,
    });
    assert.strictEqual(diff.highImpact, true);
    assert.strictEqual(diff.highImpactReasons.length, 2);
  });

  it("generates warnings for lowered caps and a shortened dead-man grace period", () => {
    const oldConfig = { ...emptyConfig, window_cap: 100n, dms_grace_secs: 100n };
    const newConfig = { ...emptyConfig, window_cap: 50n, dms_grace_secs: 50n };
    const diff = computePolicyDiff(oldConfig, newConfig);
    assert.strictEqual(diff.warnings.length, 2);
    assert.strictEqual(diff.highImpact, true);
  });

  it("flags disabling the dead-man switch or removing the paused state", () => {
    const oldConfig = { ...emptyConfig, dms_grace_secs: 3600n, paused: true };
    const diff = computePolicyDiff(oldConfig, { ...oldConfig, dms_grace_secs: 0n, paused: false });
    assert.strictEqual(diff.highImpact, true);
    assert.ok(diff.highImpactReasons.some((reason) => /dead-man switch is disabled/.test(reason)));
    assert.ok(diff.highImpactReasons.some((reason) => /no longer start paused/.test(reason)));
  });

  it("does not flag unchanged or narrowing recipient permissions", () => {
    const oldConfig = { ...emptyConfig, allow_any_recipient: true, recipients: ["GOLD"] };
    const diff = computePolicyDiff(oldConfig, { ...oldConfig, allow_any_recipient: false });
    assert.strictEqual(diff.highImpact, false);
    assert.match(diff.warnings[0] ?? "", /restricts transfers/);
  });
});
