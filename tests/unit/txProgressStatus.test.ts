/**
 * The transaction status region as it renders (issue #539).
 *
 * Asserts the DOM contract a screen reader depends on: two static regions that
 * exist before anything is said, a polite `status` for stages and successes and
 * an assertive `alert` for problems, exactly one of them holding text at a
 * time, and the region mounted once in the page shell rather than in a panel.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { before, beforeEach, test } from "node:test";
import { installDom, loadReact, type Act } from "./domHarness.ts";
import { TxProgressStatus } from "../../components/TxProgressStatus.tsx";
import { beginTxProgress, resetTxProgress } from "../../lib/guard/txProgress.ts";

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

beforeEach(() => resetTxProgress());

async function mount() {
  const container = document.createElement("div");
  document.body.appendChild(container);
  let root: ReturnType<typeof createRoot> | undefined;
  await act(async () => {
    root = createRoot(container);
    root.render(react.createElement(TxProgressStatus));
  });
  const status = container.querySelector<HTMLElement>('[role="status"]');
  const alert = container.querySelector<HTMLElement>('[role="alert"]');
  assert.ok(status, "a status region is rendered up front");
  assert.ok(alert, "an alert region is rendered up front");
  return {
    container,
    status,
    alert,
    unmount: async () => {
      await act(async () => root?.unmount());
      container.remove();
    },
  };
}

test("renders two static, atomic, visually hidden regions that start empty", async () => {
  const mounted = await mount();
  try {
    assert.equal(mounted.status.getAttribute("aria-atomic"), "true");
    assert.equal(mounted.alert.getAttribute("aria-atomic"), "true");
    assert.match(mounted.container.firstElementChild!.className, /visually-hidden/);
    assert.equal(mounted.status.textContent, "");
    assert.equal(mounted.alert.textContent, "");
  } finally {
    await mounted.unmount();
  }
});

test("stages and a success go to the polite status region, keeping the same nodes", async () => {
  const mounted = await mount();
  const { status, alert } = mounted;
  try {
    const run = beginTxProgress("freeze");
    await act(async () => {
      run.stage("simulating");
    });
    assert.equal(status.textContent, "Freeze: simulating");
    assert.equal(alert.textContent, "");

    await act(async () => {
      run.stage("signing");
    });
    assert.equal(status.textContent, "Freeze: waiting for wallet approval");

    await act(async () => {
      run.finish({ kind: "confirmed", ledger: 42 });
    });
    assert.equal(status.textContent, "Freeze confirmed on ledger 42");
    assert.equal(alert.textContent, "");
    assert.equal(
      mounted.container.querySelector('[role="status"]'),
      status,
      "the live region node is never replaced, or it would go silent",
    );
  } finally {
    await mounted.unmount();
  }
});

test("a failure moves to the assertive alert and clears the status line", async () => {
  const mounted = await mount();
  try {
    const run = beginTxProgress("set_policy");
    await act(async () => {
      run.stage("signing");
    });
    await act(async () => {
      run.finish({ kind: "cancelled" });
    });
    assert.equal(mounted.status.textContent, "", "the line is not spoken twice");
    assert.equal(
      mounted.alert.textContent,
      "Policy install declined in the wallet — nothing was broadcast",
    );

    // The next write starts polite again.
    const next = beginTxProgress("set_policy");
    await act(async () => {
      next.stage("simulating");
    });
    assert.equal(mounted.alert.textContent, "");
    assert.equal(mounted.status.textContent, "Policy install: simulating");
  } finally {
    await mounted.unmount();
  }
});

test("the region is mounted once in the page shell, outside every panel and dialog", () => {
  const layout = readFileSync("app/layout.tsx", "utf8");
  assert.match(layout, /<TxProgressStatus\s*\/>/);
  assert.equal(
    /PanicPanel|PolicyForm|TelemetryFeed|Dialog|Modal/.test(layout),
    false,
    "it must not live inside anything that opens or closes",
  );
});
