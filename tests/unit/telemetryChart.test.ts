/**
 * The telemetry chart in a real DOM: an axe-core scan with data present,
 * keyboard navigation with its live readout, the window toggle, and the table
 * fallback.
 */

import assert from "node:assert/strict";
import { after, before, mock, test } from "node:test";
import type axeCore from "axe-core";
import type { TelemetryEvent } from "../../lib/guard/telemetry.ts";
import { installDom, loadReact, sleep, type Act } from "./domHarness.ts";
import { withIdentity } from "../mocks/eventFixtures.ts";
import { TelemetryChart } from "../../components/TelemetryChart.tsx";
import { GuardContext, GuardEventsContext } from "../../components/GuardProvider.tsx";

installDom();

let react: typeof import("react");
let createRoot: typeof import("react-dom/client").createRoot;
let act: Act;
let axe: typeof axeCore;

const GUARD = "CAYJZT4XH5SWDXNR7MZJCCUBIDAT2KZDDUTZ7OZQEMKCPJGD4P3X4CU7";

// Pin the wall clock. The chart picks its intervals from `Date.now()` when it
// renders, so anchoring fixtures to the real clock at module load raced the
// chart across the 5-minute boundary between load and render: a CI run that
// loaded at 15:09:11 put its events in the 15:05 bucket, but the chart rendered
// at 15:10:06 and had already rolled to 15:10, so it showed every bucket empty.
// A frozen clock makes module load and render read the same instant, whatever
// the wall clock happens to do. Mid-interval, so the boundary is never near.
const FIXED_NOW = Date.UTC(2026, 9, 2, 15, 7, 30);
mock.timers.enable({ apis: ["Date"], now: FIXED_NOW });

// Anchor fixtures to the start of the frozen 5-minute interval, so the recent
// events always share the chart's last bucket.
const BUCKET_START = Math.floor(FIXED_NOW / 300_000) * 300_000;

function event(minutesAgo: number, result: "allowed" | "blocked"): TelemetryEvent {
  return withIdentity({
    kind: "auth_checked",
    topic: "event_auth_checked",
    source: result === "allowed" ? "ledger" : "diagnostic",
    contractId: GUARD,
    ledger: result === "allowed" ? 1000 + minutesAgo : null,
    ledgerClosedAt: new Date(BUCKET_START + 1_000 - minutesAgo * 60_000).toISOString(),
    transactionHash: null,
    decision: {
      result,
      reason: result === "blocked" ? "per_tx_cap_exceeded" : null,
      source: "ledger",
    },
    data: {},
  });
}

const bucketSecs = BigInt(BUCKET_START / 1000);

// Three in the current interval (offsets of seconds), one 40 minutes earlier.
const EVENTS: TelemetryEvent[] = [
  event(0, "allowed"),
  event(0.01, "allowed"),
  event(0.015, "blocked"),
  event(40, "allowed"),
];

// A partial context is enough for the chart.
const CONTEXT: any = {
  guard: GUARD,
  snapshot: {
    guard: GUARD,
    fetchedAt: new Date().toISOString(),
    window: {
      ok: true,
      value: {
        total: 12_345_678_901_234_567_890n,
        entries: [
          { ts: bucketSecs + 2n, amount: 12_345_678_901_234_567_000n },
          { ts: bucketSecs - 1_800n, amount: 890n },
        ],
      },
    },
  },
};

let container: HTMLElement;
let unmount: () => Promise<void>;

/** Render an isolated chart with its own events/context, for state-specific tests. */
async function renderChart(
  events: TelemetryEvent[],
  context: any,
): Promise<{ container: HTMLElement; unmount: () => Promise<void> }> {
  const host = document.createElement("div");
  document.body.appendChild(host);
  let root: ReturnType<typeof createRoot> | undefined;
  await act(async () => {
    root = createRoot(host);
    root.render(
      react.createElement(
        GuardContext.Provider,
        { value: context },
        react.createElement(
          GuardEventsContext.Provider,
          { value: events },
          react.createElement(TelemetryChart),
        ),
      ),
    );
  });
  await act(async () => {
    await sleep(20);
  });
  return {
    container: host,
    unmount: async () => {
      await act(async () => root?.unmount());
      host.remove();
    },
  };
}

before(async () => {
  const loaded = await loadReact();
  react = loaded.react;
  createRoot = loaded.createRoot;
  act = loaded.act;
  axe = ((await import("axe-core")) as unknown as { default: typeof axeCore }).default;

  container = document.createElement("div");
  document.body.appendChild(container);
  let root: ReturnType<typeof createRoot> | undefined;
  await act(async () => {
    root = createRoot(container);
    root.render(
      react.createElement(
        GuardContext.Provider,
        { value: CONTEXT },
        react.createElement(
          GuardEventsContext.Provider,
          { value: EVENTS },
          react.createElement(TelemetryChart),
        ),
      ),
    );
  });
  await act(async () => {
    await sleep(20);
  });
  unmount = async () => {
    await act(async () => root?.unmount());
    container.remove();
  };
});

after(async () => {
  await unmount();
  mock.timers.reset();
});

function svg(): SVGSVGElement {
  const found = container.querySelector<SVGSVGElement>('svg[role="img"]');
  assert.ok(found, "the chart is an SVG with role=img");
  return found;
}

async function key(name: string) {
  await act(async () => {
    svg().dispatchEvent(new window.KeyboardEvent("keydown", { key: name, bubbles: true }));
  });
}

test("passes automated axe-core WCAG 2.1 AA checks with data present", async () => {
  const results = await axe.run(container, {
    runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"] },
    rules: { "color-contrast": { enabled: false } },
  });
  assert.deepEqual(
    results.violations.map(
      (violation) => `${violation.id}: ${violation.nodes[0]?.target.join(" ")}`,
    ),
    [],
  );
});

test("the SVG's accessible name summarises the data, with exact stroop totals", () => {
  const label = svg().getAttribute("aria-label") ?? "";
  assert.match(label, /^Last hour in 12 5-minute intervals/);
  assert.match(label, /3 allowed and 1 blocked decisions/);
  assert.match(label, /12,345,678,901,234,567,890 stroops settled across 2 spends/);
  assert.equal(svg().getAttribute("tabindex"), "0");
});

test("arrow keys move through intervals and the readout is announced", async () => {
  const status = container.querySelector('[role="status"]');
  assert.ok(status);
  await key("End");
  assert.match(
    status.textContent ?? "",
    /2 allowed, 1 blocked, 12,345,678,901,234,567,000 stroops settled/,
  );
  assert.ok(
    container.querySelector(".tchart-tip"),
    "the visual tooltip follows keyboard focus too",
  );
  await key("Home");
  assert.match(status.textContent ?? "", /0 allowed, 0 blocked, 0 stroops/);
  await key("Escape");
  assert.equal(status.textContent, "");
  assert.equal(container.querySelector(".tchart-tip"), null);
});

test("hovering a column shows the tooltip with exact counts and stroops", async () => {
  const hits = container.querySelectorAll(".tchart-hit");
  assert.equal(hits.length, 12);
  await act(async () => {
    hits[hits.length - 1]!.dispatchEvent(new window.MouseEvent("mouseover", { bubbles: true }));
  });
  const tip = container.querySelector(".tchart-tip");
  assert.ok(tip);
  assert.match(tip.textContent ?? "", /2 allowed/);
  assert.match(tip.textContent ?? "", /12,345,678,901,234,567,000 stroops/);
});

test("the window toggle switches between 1h, 6h and 24h", async () => {
  const buttons = [...container.querySelectorAll<HTMLButtonElement>('[role="group"] button')];
  assert.deepEqual(
    buttons.map((button) => button.textContent),
    ["1h", "6h", "24h"],
  );
  assert.equal(buttons[0]!.getAttribute("aria-pressed"), "true");
  await act(async () => buttons[2]!.click());
  assert.equal(buttons[2]!.getAttribute("aria-pressed"), "true");
  assert.match(svg().getAttribute("aria-label") ?? "", /^Last 24 hours in 24 1-hour intervals/);
  assert.equal(container.querySelectorAll(".tchart-hit").length, 24);
});

test("a data table carries every interval for screen readers and anyone who prefers it", async () => {
  const toggle = container.querySelector<HTMLButtonElement>('[data-testid="tchart-data-toggle"]');
  assert.ok(toggle, "the alternate view has its own button");
  assert.equal(toggle.getAttribute("aria-expanded"), "false");
  assert.equal(toggle.getAttribute("aria-controls"), "tchart-data-table");
  assert.equal(container.querySelector("[data-testid='tchart-data-view']"), null);

  await act(async () => toggle.click());
  assert.equal(toggle.getAttribute("aria-expanded"), "true");

  const table = container.querySelector("table.chart-data");
  assert.ok(table);
  assert.ok(table.querySelector("caption"));
  assert.equal(table.querySelectorAll("tbody tr").length, 24);
  assert.equal(table.querySelectorAll('th[scope="col"]').length, 6);

  // Restore the collapsed state the next test starts from; this suite shares
  // one mounted chart across tests.
  await act(async () => toggle.click());
  assert.equal(toggle.getAttribute("aria-expanded"), "false");
});

test("the data view is reachable and operable with the keyboard alone", async () => {
  const toggle = container.querySelector<HTMLButtonElement>('[data-testid="tchart-data-toggle"]');
  assert.ok(toggle);
  toggle.focus();
  assert.equal(document.activeElement, toggle, "the toggle takes focus in tab order");

  // Enter/Space on a focused button is the browser's own activation behaviour;
  // jsdom does not synthesise it, so the click a keyboard would produce is
  // dispatched here and the resulting focusable region is asserted.
  await act(async () => toggle.click());
  const region = container.querySelector<HTMLElement>('[data-testid="tchart-data-view"]');
  assert.ok(region);
  assert.equal(region.getAttribute("role"), "region");
  assert.equal(region.tabIndex, 0, "the scrolling region itself is focusable");
  region.focus();
  assert.equal(document.activeElement, region);

  await act(async () => toggle.click());
  assert.equal(container.querySelector("[data-testid='tchart-data-view']"), null);
  assert.equal(document.activeElement, toggle, "focus returns to the control that closed it");
});

test("an empty window says so, and still lists every interval as zero", async () => {
  // Empty of spends as well as decisions: an empty *window* means no entries.
  const emptyContext = {
    ...CONTEXT,
    snapshot: {
      ...CONTEXT.snapshot,
      window: { ok: true, value: { total: 0n, entries: [] } },
    },
  };
  const rendered = await renderChart([], emptyContext);
  try {
    const empty = rendered.container.querySelector('[data-testid="tchart-empty"]');
    assert.ok(empty, "an empty window is stated in words");
    assert.match(empty.textContent ?? "", /No guard decisions or settled spends/);
    assert.match(
      rendered.container.querySelector('svg[role="img"]')?.getAttribute("aria-label") ?? "",
      /0 allowed and 0 blocked decisions/,
    );

    const openTable = rendered.container.querySelector<HTMLButtonElement>(
      '[data-testid="tchart-data-toggle"]',
    )!;
    await act(async () => openTable.click());
    const rows = rendered.container.querySelectorAll("table.chart-data tbody tr");
    assert.equal(rows.length, 12);
    for (const row of rows) {
      const cells = [...row.querySelectorAll("td")].map((cell) => cell.textContent);
      assert.deepEqual(cells, ["0", "0", "0", "0", "0"]);
    }
  } finally {
    await rendered.unmount();
  }
});

test("a failed spend read is reported, never drawn as zero", async () => {
  const failedContext = {
    ...CONTEXT,
    snapshot: {
      guard: GUARD,
      fetchedAt: new Date().toISOString(),
      window: { ok: false, error: "soroban window read timed out" },
    },
  };
  const rendered = await renderChart(EVENTS, failedContext);
  try {
    const notice = rendered.container.querySelector('[data-testid="tchart-spend-error"]');
    assert.ok(notice, "the failure is surfaced, not swallowed");
    assert.match(notice.textContent ?? "", /could not be read/);
    assert.match(notice.textContent ?? "", /soroban window read timed out/);

    const label =
      rendered.container.querySelector('svg[role="img"]')?.getAttribute("aria-label") ?? "";
    assert.match(label, /settled spend unavailable/);
    assert.doesNotMatch(label, /0 stroops settled/);

    const openTable = rendered.container.querySelector<HTMLButtonElement>(
      '[data-testid="tchart-data-toggle"]',
    )!;
    await act(async () => openTable.click());
    const table = rendered.container.querySelector("table.chart-data");
    assert.equal(table?.getAttribute("data-spend-state"), "unavailable");
    const spendCells = [...rendered.container.querySelectorAll("table.chart-data tbody tr")].map(
      (row) => row.querySelectorAll("td")[3]?.textContent,
    );
    assert.ok(spendCells.length > 0);
    assert.ok(spendCells.every((cell) => cell === "unavailable"));

    // Counts stay real: the feed is independent of the window read.
    assert.match(label, /3 allowed and 1 blocked decisions/);
  } finally {
    await rendered.unmount();
  }
});
