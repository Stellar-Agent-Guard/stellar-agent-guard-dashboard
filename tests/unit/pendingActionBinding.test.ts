import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  createPendingActionSnapshot,
  validatePendingActionBinding,
} from "../../lib/guard/walletConnector.ts";

describe("pending action account snapshot binding (issue #512)", () => {
  const ACCOUNT_A = "GD5S5O2MZ6FSMFH6QILG37KSQNRVR3RPSWBTTV4JOUJ7J6TWLLL5LAVS";
  const ACCOUNT_B = "GA7QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJVTAX";

  it("creates an immutable snapshot with account, network, and actionName", () => {
    const snapshot = createPendingActionSnapshot({
      account: ACCOUNT_A,
      network: "testnet",
      actionName: "Freeze Guard",
    });

    assert.equal(snapshot.account, ACCOUNT_A);
    assert.equal(snapshot.network, "testnet");
    assert.equal(snapshot.actionName, "Freeze Guard");
    assert.ok(typeof snapshot.timestamp === "number");
  });

  it("validates successfully when the account and network have not moved", () => {
    const snapshot = createPendingActionSnapshot({
      account: ACCOUNT_A,
      network: "testnet",
      actionName: "Freeze Guard",
    });

    const validation = validatePendingActionBinding(snapshot, ACCOUNT_A, "testnet");
    assert.equal(validation.valid, true);
    assert.equal(validation.reason, undefined);
  });

  it("fails validation and provides reason when account switches", () => {
    const snapshot = createPendingActionSnapshot({
      account: ACCOUNT_A,
      network: "testnet",
      actionName: "Deploy Guard",
    });

    const validation = validatePendingActionBinding(snapshot, ACCOUNT_B, "testnet");
    assert.equal(validation.valid, false);
    assert.match(
      validation.reason ?? "",
      /Account changed from GD5S…LAVS to GA7Q…VTAX during Deploy Guard/,
    );
  });

  it("fails validation when wallet disconnects (currentAccount is null or undefined)", () => {
    const snapshot = createPendingActionSnapshot({
      account: ACCOUNT_A,
      network: "testnet",
      actionName: "Set Policy",
    });

    const nullVal = validatePendingActionBinding(snapshot, null, "testnet");
    assert.equal(nullVal.valid, false);
    assert.match(nullVal.reason ?? "", /Wallet disconnected during Set Policy/);

    const undefVal = validatePendingActionBinding(snapshot, undefined, "testnet");
    assert.equal(undefVal.valid, false);
    assert.match(undefVal.reason ?? "", /Wallet disconnected during Set Policy/);
  });

  it("fails validation when network switches", () => {
    const snapshot = createPendingActionSnapshot({
      account: ACCOUNT_A,
      network: "testnet",
      actionName: "Set Policy",
    });

    const validation = validatePendingActionBinding(snapshot, ACCOUNT_A, "mainnet");
    assert.equal(validation.valid, false);
    assert.match(validation.reason ?? "", /Network changed from testnet to mainnet/);
  });
});
