import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { installDom, loadReact } from "../unit/domHarness.ts";
import { PendingActionSummary } from "../../components/PendingActionSummary.tsx";
import { createPendingActionSnapshot } from "../../lib/guard/walletConnector.ts";

describe("PendingActionSummary component (issue #512)", () => {
  const ACCOUNT_1 = "GD5S5O2MZ6FSMFH6QILG37KSQNRVR3RPSWBTTV4JOUJ7J6TWLLL5LAVS";
  const ACCOUNT_2 = "GA7QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJVTAX";

  it("renders shortened account, action name, network, and copy button", async () => {
    installDom();
    const { react, createRoot, act } = await loadReact();
    const container = document.createElement("div");
    const root = createRoot(container);

    const snapshot = createPendingActionSnapshot({
      account: ACCOUNT_1,
      network: "testnet",
      actionName: "Freeze Guard",
    });

    try {
      await act(async () => {
        root.render(
          react.createElement(PendingActionSummary, {
            snapshot,
            currentAccount: ACCOUNT_1,
            currentNetwork: "testnet",
          }),
        );
      });

      const summary = container.querySelector('[data-testid="pending-action-summary"]');
      assert.ok(summary, "Expected pending action summary to render");

      const actionName = container.querySelector('[data-testid="pending-action-name"]');
      assert.equal(actionName?.textContent, "Freeze Guard");

      const network = container.querySelector('[data-testid="pending-network"]');
      assert.equal(network?.textContent, "testnet");

      const account = container.querySelector('[data-testid="pending-account"]');
      // Shortened to 6 and 4: GD5S5O…LAVS
      assert.equal(account?.textContent, "GD5S5O…LAVS");
      assert.equal(account?.getAttribute("title"), ACCOUNT_1);

      const copyBtn = container.querySelector('button[aria-label="Copy signer account"]');
      assert.ok(copyBtn, "Expected copy button for signer account");
    } finally {
      act(() => root.unmount());
      document.body.innerHTML = "";
    }
  });

  it("safely triggers onCancel when account changes underneath pending action", async () => {
    installDom();
    const { react, createRoot, act } = await loadReact();
    const container = document.createElement("div");
    const root = createRoot(container);

    const snapshot = createPendingActionSnapshot({
      account: ACCOUNT_1,
      network: "testnet",
      actionName: "Deploy Guard",
    });

    let cancelReason: string | null = null;
    const handleCancel = (reason: string) => {
      cancelReason = reason;
    };

    try {
      // First render with matching account
      await act(async () => {
        root.render(
          react.createElement(PendingActionSummary, {
            snapshot,
            currentAccount: ACCOUNT_1,
            currentNetwork: "testnet",
            onCancel: handleCancel,
          }),
        );
      });

      assert.equal(cancelReason, null);

      // Re-render with switched account
      await act(async () => {
        root.render(
          react.createElement(PendingActionSummary, {
            snapshot,
            currentAccount: ACCOUNT_2,
            currentNetwork: "testnet",
            onCancel: handleCancel,
          }),
        );
      });

      assert.ok(cancelReason !== null, "Expected onCancel to be called");
      assert.match(cancelReason!, /Account changed/);
    } finally {
      act(() => root.unmount());
      document.body.innerHTML = "";
    }
  });

  it("safely triggers onCancel when wallet disconnects during pending action", async () => {
    installDom();
    const { react, createRoot, act } = await loadReact();
    const container = document.createElement("div");
    const root = createRoot(container);

    const snapshot = createPendingActionSnapshot({
      account: ACCOUNT_1,
      network: "testnet",
      actionName: "Set Policy",
    });

    let cancelReason: string | null = null;
    const handleCancel = (reason: string) => {
      cancelReason = reason;
    };

    try {
      await act(async () => {
        root.render(
          react.createElement(PendingActionSummary, {
            snapshot,
            currentAccount: null,
            currentNetwork: "testnet",
            onCancel: handleCancel,
          }),
        );
      });

      assert.ok(cancelReason !== null, "Expected onCancel when wallet is disconnected");
      assert.match(cancelReason!, /Wallet disconnected/);
    } finally {
      act(() => root.unmount());
      document.body.innerHTML = "";
    }
  });
});
