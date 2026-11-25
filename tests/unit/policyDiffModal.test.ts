/**
 * Policy comparison: linear narrow-screen layout (issue #537) and the review
 * dialog's focus contract (issue #540).
 *
 * jsdom has no layout engine, so — like `responsiveContract.test.ts` — the
 * narrow layout is asserted as a contract between markup and stylesheet:
 *
 *   - the markup carries everything the linear layout needs: real column
 *     headers, and a before/after `data-label` on every value cell, in
 *     Field → Before → After DOM order;
 *   - the 720px media block linearizes the table, hides the header row only
 *     visually, prints each cell's label, and never reorders cells (no
 *     `order`, no reversed flex direction), which is what keeps reading,
 *     screen-reader and keyboard order identical to the wide layout.
 *
 * The rendered-layout proof at 375px belongs to the Playwright visual suite.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { afterEach, before, describe, test } from "node:test";
import type { ReactElement, ReactNode } from "react";
import type { PolicyConfig } from "stellar-agent-guard-sdk";
import { installDom, loadReact, type Act } from "./domHarness.ts";
import { computePolicyDiff, type PolicyDiff } from "../../lib/guard/policyDiff.ts";

installDom();

let React: typeof import("react");
let createRoot: typeof import("react-dom/client").createRoot;
let act: Act;
let PolicyDiffModal: typeof import("../../components/PolicyDiffModal.tsx").PolicyDiffModal;
let DIFF_COLUMN_LABELS: typeof import("../../components/PolicyDiffModal.tsx").DIFF_COLUMN_LABELS;
let dialogStack: typeof import("../../lib/guard/useModalFocus.ts").dialogStack;

before(async () => {
  const loaded = await loadReact();
  React = loaded.react;
  createRoot = loaded.createRoot;
  act = loaded.act;
  ({ PolicyDiffModal, DIFF_COLUMN_LABELS } = await import("../../components/PolicyDiffModal.tsx"));
  ({ dialogStack } = await import("../../lib/guard/useModalFocus.ts"));
});

/** A confirmed signer, so the review offers its Confirm button (see #343). */
const TEST_AUTHORIZATION = {
  operation: "set_policy",
  guard: "CBBD7223BM5VCEOR2G26KDW6Y4G6ZUNS5U67GZ2BGB26KDW6Y4G6ZUNS",
  networkPassphrase: "Test SDF Network ; September 2015",
  admin: "GBBD7223BM5VCEOR2G26KDW6Y4G6ZUNS5U67GZ2BGB26KDW6Y4G6ZUNS",
};

let root: ReturnType<typeof createRoot> | null = null;

afterEach(async () => {
  if (root) {
    const current = root;
    await act(async () => current.unmount());
    root = null;
  }
  document.body.innerHTML = "";
});

const BASE: PolicyConfig = {
  per_tx_cap: 100n,
  window_secs: 86400n,
  window_cap: 1000n,
  assets: [],
  protocols: [],
  recipients: [],
  allow_any_recipient: false,
  active_from: 0n,
  active_until: 0n,
  paused: false,
  dms_grace_secs: 0n,
};

function sampleDiff(): PolicyDiff {
  return computePolicyDiff(BASE, { ...BASE, per_tx_cap: 250n, window_cap: 500n, paused: true });
}

/**
 * `createElement` without JSX (test files are `.ts`). Loosely typed on
 * purpose: the harness components take ad-hoc props, and React's overloads
 * cannot be forwarded through a rest parameter.
 */
const h = (type: any, props?: any, ...children: ReactNode[]): ReactElement =>
  React.createElement(type, props, ...children);

/** A trigger button plus the modal, mounted/unmounted by state like PolicyForm does. */
function Harness(props: { diff: PolicyDiff; onCancel?: () => void; onConfirm?: () => void }) {
  const [open, setOpen] = React.useState(false);
  return h(
    React.Fragment,
    null,
    h("button", { id: "review", onClick: () => setOpen(true) }, "Review and install"),
    open &&
      h(PolicyDiffModal, {
        diff: props.diff,
        authorization: TEST_AUTHORIZATION,
        onConfirm: () => {
          props.onConfirm?.();
          setOpen(false);
        },
        onCancel: () => {
          props.onCancel?.();
          setOpen(false);
        },
      }),
  );
}

async function render(element: ReactElement): Promise<HTMLElement> {
  const container = document.createElement("div");
  document.body.appendChild(container);
  await act(async () => {
    root = createRoot(container);
    root.render(element);
  });
  return container;
}

async function openReview(): Promise<HTMLElement> {
  const trigger = document.getElementById("review") as HTMLButtonElement;
  await act(async () => {
    trigger.focus();
    trigger.click();
  });
  const dialog = document.querySelector<HTMLElement>(
    '[role="dialog"][aria-label="Policy changes"]',
  );
  assert.ok(dialog, "the review dialog is open");
  return dialog;
}

async function press(key: string, init: KeyboardEventInit = {}): Promise<KeyboardEvent> {
  const event = new window.KeyboardEvent("keydown", {
    key,
    bubbles: true,
    cancelable: true,
    ...init,
  });
  await act(async () => {
    (document.activeElement ?? document.body).dispatchEvent(event);
  });
  return event;
}

describe("policy comparison markup (#537)", () => {
  test("column headers are semantic and carry the before/after wording", async () => {
    await render(h(Harness, { diff: sampleDiff() }));
    const dialog = await openReview();
    const headers = Array.from(dialog.querySelectorAll("thead th"));
    assert.deepEqual(
      headers.map((th) => th.textContent),
      [DIFF_COLUMN_LABELS.field, DIFF_COLUMN_LABELS.before, DIFF_COLUMN_LABELS.after],
    );
    for (const th of headers) assert.equal(th.getAttribute("scope"), "col");
    assert.match(DIFF_COLUMN_LABELS.before, /^Before/);
    assert.match(DIFF_COLUMN_LABELS.after, /^After/);
  });

  test("every value cell carries its column label, in Field → Before → After DOM order", async () => {
    await render(h(Harness, { diff: sampleDiff() }));
    const dialog = await openReview();
    const rows = Array.from(dialog.querySelectorAll("tbody tr"));
    assert.equal(rows.length, 3, "only the changed fields are listed");
    for (const row of rows) {
      const labels = Array.from(row.querySelectorAll("th, td")).map((cell) =>
        cell.getAttribute("data-label"),
      );
      assert.deepEqual(labels, [
        DIFF_COLUMN_LABELS.field,
        DIFF_COLUMN_LABELS.before,
        DIFF_COLUMN_LABELS.after,
      ]);
    }
    const perTx = rows.find((row) => row.textContent?.includes("per_tx_cap"));
    assert.ok(perTx);
    const cells = perTx.querySelectorAll("th, td");
    assert.equal(cells[1]!.textContent, "100", "before = installed value");
    assert.equal(cells[2]!.textContent, "250", "after = draft value");
  });

  test("the table opts into the linear layout and has an accessible caption", async () => {
    await render(h(Harness, { diff: sampleDiff() }));
    const dialog = await openReview();
    const table = dialog.querySelector("table");
    assert.ok(table, "the comparison table renders");
    assert.ok(table.classList.contains("diff-linear"));
    assert.match(table.querySelector("caption")?.textContent ?? "", /3 changed policy fields/);
  });

  test("an unchanged policy renders no comparison table (edge case)", async () => {
    await render(h(Harness, { diff: computePolicyDiff(BASE, { ...BASE }) }));
    const dialog = await openReview();
    assert.equal(dialog.querySelector("table"), null);
    assert.match(dialog.textContent ?? "", /identical to the one currently installed/);
  });

  test("keyboard order: the comparison comes before Confirm, then Cancel", async () => {
    await render(h(Harness, { diff: sampleDiff() }));
    const dialog = await openReview();
    const buttons = Array.from(dialog.querySelectorAll("button")).map((b) => b.textContent);
    assert.deepEqual(buttons, ["Confirm and sign", "Cancel"]);
    const table = dialog.querySelector("table")!;
    const actions = dialog.querySelector(".policy-diff-actions")!;
    assert.ok(
      table.compareDocumentPosition(actions) & window.Node.DOCUMENT_POSITION_FOLLOWING,
      "the actions follow the comparison in DOM (and therefore Tab) order",
    );
  });
});

describe("policy comparison stylesheet contract (#537)", () => {
  const stylesheet = readFileSync("app/globals.css", "utf8");

  function mediaBlock(query: string): string {
    const start = stylesheet.indexOf(`@media ${query}`);
    assert.ok(start >= 0, `expected an @media ${query} block in globals.css`);
    let depth = 0;
    let i = stylesheet.indexOf("{", start);
    const open = i;
    for (; i < stylesheet.length; i++) {
      if (stylesheet[i] === "{") depth += 1;
      if (stylesheet[i] === "}") {
        depth -= 1;
        if (depth === 0) break;
      }
    }
    return stylesheet.slice(open, i + 1);
  }

  const block = mediaBlock("(max-width: 720px)");
  // Comments are stripped so prose that *mentions* `order` cannot trip the
  // declaration checks below.
  const diffRules = block
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("}")
    .filter((rule) => /diff-linear|policy-diff-actions/.test(rule))
    .join("}");

  test("rows and cells become blocks below the breakpoint", () => {
    assert.match(
      block,
      /table\.diff-linear,\s*table\.diff-linear tbody,\s*table\.diff-linear tr,\s*table\.diff-linear td\s*\{[^}]*display:\s*block/,
    );
  });

  test("the header row is hidden visually, not removed (no display:none)", () => {
    assert.match(block, /table\.diff-linear thead\s*\{[^}]*position:\s*absolute/);
    assert.match(block, /table\.diff-linear thead\s*\{[^}]*clip:\s*rect\(0 0 0 0\)/);
    assert.doesNotMatch(diffRules, /thead[^{]*\{[^}]*display:\s*none/);
  });

  test("each value prints its before/after label", () => {
    assert.match(block, /table\.diff-linear td::before\s*\{[^}]*content:\s*attr\(data-label\)/);
  });

  test("long addresses wrap instead of forcing horizontal scroll", () => {
    assert.match(block, /table\.diff-linear td\s*\{[^}]*overflow-wrap:\s*anywhere/);
  });

  test("nothing reorders cells or actions visually, so keyboard order stays logical", () => {
    assert.match(diffRules, /diff-linear/, "sanity: the diff rules were found");
    assert.doesNotMatch(diffRules, /(^|[\s;{])order\s*:/);
    assert.doesNotMatch(diffRules, /row-reverse|column-reverse/);
  });

  test("actions stack full-width with a 44px touch target", () => {
    assert.match(block, /\.policy-diff-actions\s*\{[^}]*flex-direction:\s*column/);
    assert.match(block, /\.policy-diff-actions button\s*\{[^}]*min-height:\s*44px/);
  });

  test("the linear rules exist only under the breakpoint (desktop stays side by side)", () => {
    const outside = stylesheet.replace(block, "");
    assert.doesNotMatch(outside, /table\.diff-linear[^{]*\{[^}]*display:\s*block/);
  });
});

describe("policy review dialog focus (#540)", () => {
  test("focus moves into the dialog on open and the dialog joins the stack", async () => {
    await render(h(Harness, { diff: sampleDiff() }));
    const dialog = await openReview();
    assert.equal(document.activeElement, dialog);
    assert.equal(dialogStack.top(), dialog);
  });

  test("Escape cancels and returns focus to the control that opened the review", async () => {
    let cancelled = 0;
    let confirmed = 0;
    await render(
      h(Harness, {
        diff: sampleDiff(),
        onCancel: () => cancelled++,
        onConfirm: () => confirmed++,
      }),
    );
    await openReview();
    await press("Escape");
    assert.equal(cancelled, 1);
    assert.equal(confirmed, 0, "Escape must never confirm a signature");
    assert.equal(document.querySelector('[aria-label="Policy changes"]'), null);
    assert.equal(document.activeElement, document.getElementById("review"));
    assert.equal(dialogStack.depth, 0);
  });

  test("Cancel button (explicit close) also restores focus", async () => {
    await render(h(Harness, { diff: sampleDiff() }));
    const dialog = await openReview();
    const cancel = Array.from(dialog.querySelectorAll("button")).find(
      (b) => b.textContent === "Cancel",
    )!;
    await act(async () => cancel.click());
    assert.equal(document.activeElement, document.getElementById("review"));
  });

  test("Tab wraps inside the dialog", async () => {
    await render(h(Harness, { diff: sampleDiff() }));
    const dialog = await openReview();
    const [confirm, cancel] = Array.from(dialog.querySelectorAll("button"));
    cancel!.focus();
    const forward = await press("Tab");
    assert.equal(forward.defaultPrevented, true);
    assert.equal(document.activeElement, confirm);
    const backward = await press("Tab", { shiftKey: true });
    assert.equal(backward.defaultPrevented, true);
    assert.equal(document.activeElement, cancel);
  });
});
