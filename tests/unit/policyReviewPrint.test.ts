import assert from "node:assert/strict";
import { before, test } from "node:test";
import { installDom, loadReact, type Act } from "./domHarness.ts";
import { buildPolicyReviewModel } from "../../lib/guard/policyReview.ts";
import { PolicyReviewPrintView } from "../../components/PolicyReviewPrintView.tsx";
import { EMPTY_DRAFT, type PolicyDraft } from "../../lib/guard/policyForm.ts";

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

const VALID_GUARD = "CAPADGEK457RHKN4RYVUMDJTFHDSG7R5HREQONKLYK7MFKC5WFENPP44";
const SAMPLE_RECIPIENT = "GAOBCRXTCO4ZCBNHALJUMJJ5JDXNOUZ7U6VZJX4UBTXAHQEO66IPU6PH";
const SAMPLE_ASSET = "CDCYDGBGS5AZ5BZS6XY2SK2PHJHSOEGTN3N4INCK34KF6GU2BGC7Z6MB";

const validDraft: PolicyDraft = {
  ...EMPTY_DRAFT,
  perTxCap: "500",
  windowCap: "2000",
  windowSecs: "3600",
  dmsGraceSecs: "7200",
  allowAnyRecipient: false,
  recipients: SAMPLE_RECIPIENT,
  assets: SAMPLE_ASSET,
  protocols: "CDCYDGBGS5AZ5BZS6XY2SK2PHJHSOEGTN3N4INCK34KF6GU2BGC7Z6MB:swap",
  assetCaps: [
    {
      assetContractAddress: SAMPLE_ASSET,
      maxCapStroops: "1000",
      symbol: "USDC",
    },
  ],
  paused: true,
};

test("buildPolicyReviewModel creates a draft-labeled model with correct metadata", () => {
  const model = buildPolicyReviewModel(validDraft, VALID_GUARD, "Testnet");

  assert.equal(model.isDraft, true);
  assert.equal(model.draftLabel, "DRAFT - NOT SUBMITTED");
  assert.equal(model.guardAddress, VALID_GUARD);
  assert.equal(model.network, "Testnet");
  assert.equal(model.validation.ok, true);
  assert.equal(model.validation.statusText, "Valid (Ready for Review)");
  assert.equal(model.validation.issues.length, 0);

  // Spending limits
  const perTx = model.spendingCaps.find((c) => c.label === "Per-Transaction Cap");
  assert.equal(perTx?.value, "500 SAC stroops");
  assert.equal(perTx?.status, "valid");

  const windowCap = model.spendingCaps.find((c) => c.label === "Rolling-Window Cap");
  assert.equal(windowCap?.value, "2000 SAC stroops");

  // DMS & Paused
  const dms = model.inactivity.find((c) => c.label === "Dead-Man Switch Grace");
  assert.equal(dms?.value, "7200 seconds");
  assert.equal(model.operationalState.pausedOnInstall, true);

  // Allowlists
  assert.deepEqual(model.allowlists.recipients, [SAMPLE_RECIPIENT]);
  assert.deepEqual(model.allowlists.assets, [SAMPLE_ASSET]);
  assert.equal(model.allowlists.assetCaps.length, 1);
  assert.equal(model.allowlists.assetCaps[0]?.symbol, "USDC");
});

test("buildPolicyReviewModel accurately surfaces validation failures", () => {
  const invalidDraft: PolicyDraft = {
    ...EMPTY_DRAFT,
    perTxCap: "not-a-number",
    recipients: "invalid-address",
  };

  const model = buildPolicyReviewModel(invalidDraft, VALID_GUARD, "Mainnet");
  assert.equal(model.validation.ok, false);
  assert.equal(model.validation.statusText, "Invalid (Issues Detected)");
  assert.ok(model.validation.issues.length > 0);
  assert.ok(model.validation.issues.some((issue) => issue.field === "perTxCap"));
});

test("buildPolicyReviewModel strictly omits wallet and session data", () => {
  const model = buildPolicyReviewModel(validDraft, VALID_GUARD, "Testnet") as any;

  assert.equal(model.wallet, undefined);
  assert.equal(model.signer, undefined);
  assert.equal(model.session, undefined);
  assert.equal(model.privateKey, undefined);
  assert.equal(model.secret, undefined);
  assert.equal(model.account, undefined);

  // Ensure JSON representation contains no wallet/session keys
  const serialized = JSON.stringify(model);
  assert.equal(serialized.includes("wallet"), false);
  assert.equal(serialized.includes("session"), false);
  assert.equal(serialized.includes("privateKey"), false);
});

test("PolicyReviewPrintView renders without editable controls or session data", async () => {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);

  let closed = false;
  await act(async () => {
    root.render(
      react.createElement(PolicyReviewPrintView, {
        draft: validDraft,
        guard: VALID_GUARD,
        network: "Testnet",
        onClose: () => {
          closed = true;
        },
      }),
    );
  });

  // Verify draft label
  const draftLabel = container.querySelector('[data-testid="draft-label"]');
  assert.ok(draftLabel, "Draft label should be rendered");
  assert.equal(draftLabel.textContent?.trim(), "DRAFT - NOT SUBMITTED");

  // Verify network and guard display
  const networkEl = container.querySelector('[data-testid="review-network"]');
  assert.equal(networkEl?.textContent?.trim(), "Testnet");

  const guardEl = container.querySelector('[data-testid="review-guard"]');
  assert.equal(guardEl?.textContent?.trim(), VALID_GUARD);

  const statusEl = container.querySelector('[data-testid="review-validation-status"]');
  assert.equal(statusEl?.textContent?.trim(), "Valid (Ready for Review)");

  // Strict Read-Only Guarantee: Zero form input controls
  const inputs = container.querySelectorAll("input");
  const textareas = container.querySelectorAll("textarea");
  const selects = container.querySelectorAll("select");

  assert.equal(inputs.length, 0, "Print review view must contain NO input elements");
  assert.equal(textareas.length, 0, "Print review view must contain NO textarea elements");
  assert.equal(selects.length, 0, "Print review view must contain NO select elements");

  // Verify that only read-only tables and articles exist
  const documentArticle = container.querySelector('[data-testid="policy-review-document"]');
  assert.ok(documentArticle, "Review document article must exist");

  // Verify close callback
  const closeBtn = container.querySelector<HTMLButtonElement>('button[aria-label="Close review"]');
  assert.ok(closeBtn, "Close button must exist");
  await act(async () => {
    closeBtn.click();
  });
  assert.equal(closed, true, "onClose should be called when Close button is clicked");

  // Cleanup
  await act(async () => {
    root.unmount();
  });
  container.remove();
});

test("PolicyReviewPrintView renders validation errors when draft is invalid", async () => {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);

  const invalidDraft: PolicyDraft = {
    ...EMPTY_DRAFT,
    perTxCap: "invalid_cap",
  };

  await act(async () => {
    root.render(
      react.createElement(PolicyReviewPrintView, {
        draft: invalidDraft,
        guard: VALID_GUARD,
        network: "Standalone",
        onClose: () => {},
      }),
    );
  });

  const statusEl = container.querySelector('[data-testid="review-validation-status"]');
  assert.equal(statusEl?.textContent?.trim(), "Invalid (Issues Detected)");

  const issuesSection = container.querySelector(".policy-review-issues");
  assert.ok(issuesSection, "Issues section should be visible for invalid drafts");
  assert.ok(
    issuesSection.textContent?.includes("perTxCap"),
    "Should display invalid perTxCap issue",
  );

  await act(async () => {
    root.unmount();
  });
  container.remove();
});
