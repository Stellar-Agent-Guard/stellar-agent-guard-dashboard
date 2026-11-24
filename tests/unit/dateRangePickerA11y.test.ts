import assert from "node:assert/strict";
import { before, test } from "node:test";
import type axeCore from "axe-core";
import { installDom, loadReact, type Act } from "./domHarness.ts";
import { DateRangePicker } from "../../components/DateRangePicker.tsx";
import {
  describeAppliedRange,
  futureBoundError,
  presetLabel,
  unixSecsToDatetimeLocal,
} from "../../lib/guard/ledgerTime.ts";

installDom();

let react: typeof import("react");
let createRoot: typeof import("react-dom/client").createRoot;
let act: Act;
let axe: typeof axeCore;

before(async () => {
  const loaded = await loadReact();
  react = loaded.react;
  createRoot = loaded.createRoot;
  act = loaded.act;
  axe = ((await import("axe-core")) as unknown as { default: typeof axeCore }).default;
});

async function mount() {
  const applied: Array<{ range: unknown; preset: string }> = [];
  const container = document.createElement("div");
  document.body.appendChild(container);
  let root: ReturnType<typeof createRoot> | undefined;
  await act(async () => {
    root = createRoot(container);
    root.render(
      react.createElement(DateRangePicker, {
        onApply: (range, preset) => void applied.push({ range, preset }),
      }),
    );
  });
  const radio = (name: string) =>
    Array.from(container.querySelectorAll<HTMLButtonElement>('[role="radio"]')).find(
      (candidate) => candidate.textContent === name,
    )!;
  return {
    container,
    applied,
    radio,
    input: (label: string) =>
      container.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`)!,
    unmount: async () => {
      await act(async () => root?.unmount());
      container.remove();
    },
  };
}

async function setValue(input: HTMLInputElement, value: string) {
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
    setter.call(input, value);
    input.dispatchEvent(new window.Event("input", { bubbles: true }));
  });
}

test("range helpers: future bounds are rejected and applied ranges are spoken", () => {
  const now = 1_800_000_000;
  assert.equal(futureBoundError({ fromUnixSecs: now - 10, toUnixSecs: now }, now), null);
  assert.match(
    futureBoundError({ fromUnixSecs: now + 60, toUnixSecs: null }, now)!,
    /start date is in the future/,
  );
  assert.match(
    futureBoundError({ fromUnixSecs: now - 60, toUnixSecs: now + 60 }, now)!,
    /end date is in the future/,
  );
  const from = 1_700_000_000;
  const to = 1_700_003_600;
  assert.equal(
    describeAppliedRange({ fromUnixSecs: from, toUnixSecs: to }),
    `from ${unixSecsToDatetimeLocal(from).replace("T", " ")} to ${unixSecsToDatetimeLocal(to).replace("T", " ")}`,
  );
  assert.match(describeAppliedRange({ fromUnixSecs: from, toUnixSecs: null }), /until now$/);
  assert.equal(presetLabel("7d"), "Last 7 Days");
});

test("only the checked preset is in the tab order, and arrows move the selection", async () => {
  const m = await mount();
  try {
    assert.equal(m.radio("Last 24 Hours").tabIndex, 0);
    assert.equal(m.radio("Last 1 Hour").tabIndex, -1);
    await act(async () => {
      m.radio("Last 24 Hours").dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true, cancelable: true }),
      );
    });
    assert.equal(m.radio("Last 7 Days").getAttribute("aria-checked"), "true");
    assert.equal(document.activeElement, m.radio("Last 7 Days"));
    assert.equal(m.applied.at(-1)?.preset, "7d", "a preset applies as soon as it is chosen");
  } finally {
    await m.unmount();
  }
});

test("custom range exposes the disabled (future) dates and a hint tied to both inputs", async () => {
  const m = await mount();
  try {
    await act(async () => m.radio("Custom Range").click());
    const from = m.input("Range start date and time");
    const to = m.input("Range end date and time");
    assert.match(from.max, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/, "future dates are disabled via max");
    assert.equal(to.max, from.max);
    const hintId = from.getAttribute("aria-describedby")!;
    assert.equal(to.getAttribute("aria-describedby"), hintId);
    assert.match(m.container.querySelector(`[id="${hintId}"]`)?.textContent ?? "", /disabled/);
  } finally {
    await m.unmount();
  }
});

test("an invalid range is announced, linked to the inputs and focus goes to the first input", async () => {
  const m = await mount();
  try {
    await act(async () => m.radio("Custom Range").click());
    const apply = Array.from(m.container.querySelectorAll("button")).find(
      (button) => button.textContent === "Apply range",
    )!;
    await act(async () => apply.click());
    const alert = m.container.querySelector('[role="alert"]');
    assert.match(alert?.textContent ?? "", /Pick a start and end date/);
    const from = m.input("Range start date and time");
    assert.equal(from.getAttribute("aria-invalid"), "true");
    assert.ok(from.getAttribute("aria-describedby")!.includes(alert!.id));
    assert.equal(document.activeElement, from);
    assert.equal(m.applied.filter((entry) => entry.preset === "custom").length, 0);

    // A future end date is refused too, rather than returning a silent empty feed.
    await setValue(from, "2020-01-01T00:00");
    await setValue(m.input("Range end date and time"), "2999-01-01T00:00");
    await act(async () => apply.click());
    assert.match(m.container.querySelector('[role="alert"]')?.textContent ?? "", /in the future/);
  } finally {
    await m.unmount();
  }
});

test("a valid range applies and focus stays on the Apply button", async () => {
  const m = await mount();
  try {
    await act(async () => m.radio("Custom Range").click());
    await setValue(m.input("Range start date and time"), "2020-01-01T00:00");
    await setValue(m.input("Range end date and time"), "2020-01-02T00:00");
    const apply = Array.from(m.container.querySelectorAll("button")).find(
      (button) => button.textContent === "Apply range",
    )!;
    await act(async () => apply.click());
    assert.equal(m.applied.at(-1)?.preset, "custom");
    assert.equal(m.container.querySelector('[role="alert"]'), null);
    assert.equal(document.activeElement, apply);
  } finally {
    await m.unmount();
  }
});

test("Escape dismisses the custom panel, restores the last preset and returns focus", async () => {
  const m = await mount();
  try {
    await act(async () => m.radio("Last 7 Days").click());
    await act(async () => m.radio("Custom Range").click());
    const from = m.input("Range start date and time");
    await act(async () => {
      from.focus();
      from.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }),
      );
    });
    assert.equal(m.input("Range start date and time"), null);
    assert.equal(m.radio("Last 7 Days").getAttribute("aria-checked"), "true");
    assert.equal(document.activeElement, m.radio("Custom Range"));
  } finally {
    await m.unmount();
  }
});

test("the open custom picker passes axe-core", async () => {
  const m = await mount();
  try {
    await act(async () => m.radio("Custom Range").click());
    const results = await axe.run(m.container, {
      runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"] },
      rules: { "color-contrast": { enabled: false } },
    });
    assert.deepEqual(
      results.violations.map((violation) => violation.id),
      [],
    );
  } finally {
    await m.unmount();
  }
});
