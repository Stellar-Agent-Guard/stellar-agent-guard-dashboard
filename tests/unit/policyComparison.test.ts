import assert from "node:assert/strict";
import { before, test } from "node:test";
import { installDom, loadReact, type Act } from "./domHarness.ts";
import { comparePolicyProfiles, type PolicyProfile } from "../../lib/guard/policyDiff.ts";
import { PolicyComparisonModal } from "../../components/PolicyComparisonModal.tsx";
import { POLICY_PRESETS } from "../../lib/guard/presets.ts";
import type { PolicyConfig } from "stellar-agent-guard-sdk";

installDom();

let react: typeof import("react");
let createRoot: typeof import("react-dom/client").createRoot;
let act: Act;

before(async () => {
  const loaded = await loadReact();
  react = loaded.react;
  createRoot = loaded.createRoot;
  act = loaded.act;
});

const baseConfig: PolicyConfig = {
  per_tx_cap: 100n,
  window_secs: 86400n,
  window_cap: 500n,
  assets: ["CDCYDGBGS5AZ5BZS6XY2SK2PHJHSOEGTN3N4INCK34KF6GU2BGC7Z6MB"],
  protocols: [],
  recipients: ["GAOBCRXTCO4ZCBNHALJUMJJ5JDXNOUZ7U6VZJX4UBTXAHQEO66IPU6PH"],
  allow_any_recipient: false,
  active_from: 0n,
  active_until: 0n,
  paused: false,
  dms_grace_secs: 3600n,
};

test("comparePolicyProfiles identifies identical profiles with zero differences", () => {
  const profileA: PolicyProfile = {
    name: "Profile Alpha",
    network: "Testnet",
    config: { ...baseConfig },
  };
  const profileB: PolicyProfile = {
    name: "Profile Alpha Copy",
    network: "Testnet",
    config: { ...baseConfig },
  };

  const result = comparePolicyProfiles(profileA, profileB);
  assert.equal(result.hasChanges, false);
  assert.equal(result.changeCount, 0);
  assert.equal(result.networkMismatch, false);
  assert.equal(result.networkMismatchWarning, undefined);

  // Every field should be marked unchanged
  for (const entry of result.diff.entries) {
    assert.equal(entry.status, "unchanged");
  }
});

test("comparePolicyProfiles highlights changed fields and preserves warnings", () => {
  const profileA: PolicyProfile = {
    name: "High Cap",
    network: "Testnet",
    config: {
      ...baseConfig,
      per_tx_cap: 1000n,
      window_cap: 5000n,
      dms_grace_secs: 7200n,
      paused: false,
    },
  };

  const profileB: PolicyProfile = {
    name: "Low Cap",
    network: "Testnet",
    config: {
      ...baseConfig,
      per_tx_cap: 500n,
      window_cap: 2500n, // Lowered cap
      dms_grace_secs: 1800n, // Shortened grace
      paused: true,
    },
  };

  const result = comparePolicyProfiles(profileA, profileB);
  assert.equal(result.hasChanges, true);
  assert.equal(result.networkMismatch, false);

  const perTx = result.diff.entries.find((e) => e.field === "per_tx_cap");
  assert.equal(perTx?.status, "modified");

  const paused = result.diff.entries.find((e) => e.field === "paused");
  assert.equal(paused?.status, "modified");

  // Warnings for lowered cap and shortened grace
  assert.equal(result.diff.warnings.length, 2);
  assert.ok(result.diff.warnings.some((w) => w.includes("rolling-window cap")));
  assert.ok(result.diff.warnings.some((w) => w.includes("dead-man switch grace period")));
});

test("comparePolicyProfiles flags network mismatches when profiles target different networks", () => {
  const testnetProfile: PolicyProfile = {
    name: "Staging Profile",
    network: "Testnet",
    config: { ...baseConfig },
  };

  const mainnetProfile: PolicyProfile = {
    name: "Production Profile",
    network: "Mainnet",
    config: { ...baseConfig },
  };

  const result = comparePolicyProfiles(testnetProfile, mainnetProfile);
  assert.equal(result.networkMismatch, true);
  assert.ok(result.networkMismatchWarning?.includes("Network mismatch detected"));
  assert.ok(result.networkMismatchWarning?.includes("Testnet"));
  assert.ok(result.networkMismatchWarning?.includes("Mainnet"));
});

test("comparePolicyProfiles ignores case in matching networks", () => {
  const profile1: PolicyProfile = {
    name: "P1",
    network: "testnet",
    config: { ...baseConfig },
  };
  const profile2: PolicyProfile = {
    name: "P2",
    network: "TESTNET",
    config: { ...baseConfig },
  };

  const result = comparePolicyProfiles(profile1, profile2);
  assert.equal(result.networkMismatch, false);
});

test("comparePolicyProfiles does not mutate input configurations", () => {
  const original = { ...baseConfig };
  const target = { ...baseConfig, per_tx_cap: 9999n };

  comparePolicyProfiles({ name: "Original", config: original }, { name: "Target", config: target });

  assert.equal(original.per_tx_cap, 100n);
  assert.equal(target.per_tx_cap, 9999n);
});

test("PolicyComparisonModal renders side-by-side comparison without apply buttons", async () => {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);

  let closed = false;
  await act(async () => {
    root.render(
      react.createElement(PolicyComparisonModal, {
        currentDraftConfig: baseConfig,
        installedConfig: POLICY_PRESETS[1]!.config,
        activeGuard: "CAPADGEK457RHKN4RYVUMDJTFHDSG7R5HREQONKLYK7MFKC5WFENPP44",
        activeNetwork: "Testnet",
        onClose: () => {
          closed = true;
        },
      }),
    );
  });

  // Verify modal exists
  const modal = container.querySelector(".policy-comparison-modal");
  assert.ok(modal, "Modal should be rendered");

  // Verify side-by-side selects exist
  const leftSelect = container.querySelector('[data-testid="left-profile-select"]');
  const rightSelect = container.querySelector('[data-testid="right-profile-select"]');
  assert.ok(leftSelect, "Left profile select must exist");
  assert.ok(rightSelect, "Right profile select must exist");

  // Verify NO apply / submit / install buttons exist
  const buttons = Array.from(container.querySelectorAll("button"));
  const buttonTexts = buttons.map((b) => b.textContent?.trim().toLowerCase());

  assert.ok(
    !buttonTexts.some(
      (txt) => txt?.includes("install") || txt?.includes("apply") || txt?.includes("sign"),
    ),
    "Modal must contain NO install, apply, or sign actions (comparison only)",
  );

  // Close action
  const closeBtn = container.querySelector<HTMLButtonElement>(
    'button[aria-label="Close comparison"]',
  );
  assert.ok(closeBtn, "Close button must exist");
  await act(async () => {
    closeBtn.click();
  });
  assert.equal(closed, true, "Clicking close triggers onClose");

  await act(async () => {
    root.unmount();
  });
  container.remove();
});

test("PolicyComparisonModal displays network mismatch banner when profiles differ in network", async () => {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);

  await act(async () => {
    root.render(
      react.createElement(PolicyComparisonModal, {
        currentDraftConfig: baseConfig,
        installedConfig: null,
        activeGuard: "CAPADGEK457RHKN4RYVUMDJTFHDSG7R5HREQONKLYK7MFKC5WFENPP44",
        activeNetwork: "Testnet",
        onClose: () => {},
      }),
    );
  });

  // Select the cross-network archetype ("Mainnet Vetted Archive") on right select
  const rightSelect = container.querySelector<HTMLSelectElement>(
    '[data-testid="right-profile-select"]',
  );
  assert.ok(rightSelect);

  // Find index of the Mainnet profile
  const options = Array.from(rightSelect.options);
  const mainnetIdx = options.findIndex((opt) => opt.text.includes("Mainnet"));
  assert.ok(mainnetIdx >= 0, "Should have a cross-network profile option");

  await act(async () => {
    rightSelect.value = String(mainnetIdx);
    rightSelect.dispatchEvent(new window.Event("change", { bubbles: true }));
  });

  // Network mismatch alert should now be visible
  const mismatchAlert = container.querySelector('[data-testid="network-mismatch-alert"]');
  assert.ok(mismatchAlert, "Network mismatch alert should be rendered");
  assert.ok(mismatchAlert.textContent?.includes("Network mismatch detected"));

  await act(async () => {
    root.unmount();
  });
  container.remove();
});

test("PolicyComparisonModal filters unchanged fields when checkbox is toggled", async () => {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);

  await act(async () => {
    root.render(
      react.createElement(PolicyComparisonModal, {
        currentDraftConfig: baseConfig,
        installedConfig: POLICY_PRESETS[0]!.config,
        activeGuard: "CAPADGEK457RHKN4RYVUMDJTFHDSG7R5HREQONKLYK7MFKC5WFENPP44",
        activeNetwork: "Testnet",
        onClose: () => {},
      }),
    );
  });

  const allRowsBefore = container.querySelectorAll("tbody tr");
  const countBefore = allRowsBefore.length;

  // Toggle "show changed only"
  const checkbox = container.querySelector<HTMLInputElement>(
    '[data-testid="show-changed-only-checkbox"]',
  );
  assert.ok(checkbox);

  await act(async () => {
    checkbox.click();
  });

  const rowsAfter = container.querySelectorAll("tbody tr");
  // Only changed rows (or empty message) should be visible
  for (const row of Array.from(rowsAfter)) {
    const status = row.getAttribute("data-status");
    if (status) {
      assert.notEqual(status, "unchanged", "Unchanged rows should be hidden when filter is on");
    }
  }

  await act(async () => {
    root.unmount();
  });
  container.remove();
});
