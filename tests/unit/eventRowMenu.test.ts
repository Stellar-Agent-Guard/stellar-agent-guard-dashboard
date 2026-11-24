import assert from "node:assert/strict";
import { before, test } from "node:test";
import type axeCore from "axe-core";
import { installDom, loadReact, sleep, type Act } from "./domHarness.ts";
import { EventRowMenu, nextMenuIndex } from "../../components/EventRowMenu.tsx";

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

const TX = "b".repeat(64);
const CONTRACT = "C" + "A".repeat(55);
const ROW = "Authorization decision, blocked, ledger 100";

async function mount(props: { contractId?: string | null; transactionHash?: string | null } = {}) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  let root: ReturnType<typeof createRoot> | undefined;
  await act(async () => {
    root = createRoot(container);
    root.render(
      react.createElement(EventRowMenu, {
        rowLabel: ROW,
        contractId: props.contractId === undefined ? CONTRACT : props.contractId,
        transactionHash: props.transactionHash === undefined ? TX : props.transactionHash,
        details: [{ label: "Ledger", value: "100" }],
      }),
    );
  });
  return {
    container,
    button: container.querySelector<HTMLButtonElement>("button[aria-haspopup]")!,
    menu: () => container.querySelector<HTMLElement>('[role="menu"]'),
    items: () => Array.from(container.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')),
    unmount: async () => {
      await act(async () => root?.unmount());
      container.remove();
    },
  };
}

function key(target: Element, name: string, init: KeyboardEventInit = {}) {
  return act(async () => {
    target.dispatchEvent(
      new KeyboardEvent("keydown", { key: name, bubbles: true, cancelable: true, ...init }),
    );
  });
}

test("menu navigation wraps and honours Home and End", () => {
  assert.equal(nextMenuIndex("ArrowDown", 2, 3), 0);
  assert.equal(nextMenuIndex("ArrowUp", 0, 3), 2);
  assert.equal(nextMenuIndex("Home", 2, 3), 0);
  assert.equal(nextMenuIndex("End", 0, 3), 2);
  assert.equal(nextMenuIndex("a", 0, 3), null, "unhandled keys are left alone");
  assert.equal(nextMenuIndex("ArrowDown", 0, 0), null, "an empty menu has nowhere to go");
});

test("the button names its row and exposes menu-button state", async () => {
  const m = await mount();
  try {
    assert.equal(m.button.getAttribute("aria-label"), `Actions for ${ROW}`);
    assert.equal(m.button.getAttribute("aria-haspopup"), "menu");
    assert.equal(m.button.getAttribute("aria-expanded"), "false");
    assert.equal(m.menu(), null);
  } finally {
    await m.unmount();
  }
});

test("opening moves focus to the first item; Escape closes and returns focus", async () => {
  const m = await mount();
  try {
    await act(async () => m.button.click());
    assert.equal(m.button.getAttribute("aria-expanded"), "true");
    assert.equal(m.menu()?.getAttribute("aria-label"), `Actions for ${ROW}`);
    assert.deepEqual(
      m.items().map((item) => item.textContent),
      ["Copy contract address", "Copy transaction hash", "Show details"],
    );
    assert.equal(document.activeElement, m.items()[0]);

    await key(m.items()[0]!, "Escape");
    assert.equal(m.menu(), null);
    assert.equal(document.activeElement, m.button, "focus must return to the menu button");
    assert.equal(m.button.getAttribute("aria-expanded"), "false");
  } finally {
    await m.unmount();
  }
});

test("arrow keys, Home and End move between items; ArrowUp on the button opens on the last", async () => {
  const m = await mount();
  try {
    await key(m.button, "ArrowUp");
    const items = m.items();
    assert.equal(document.activeElement, items[2], "ArrowUp opens on the last item");
    await key(items[2]!, "ArrowDown");
    assert.equal(document.activeElement, items[0], "ArrowDown wraps to the first");
    await key(items[0]!, "End");
    assert.equal(document.activeElement, items[2]);
    await key(items[2]!, "Home");
    assert.equal(document.activeElement, items[0]);
  } finally {
    await m.unmount();
  }
});

test("Tab closes the menu without trapping focus", async () => {
  const m = await mount();
  try {
    await act(async () => m.button.click());
    const tab = new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true });
    await act(async () => {
      m.items()[0]!.dispatchEvent(tab);
    });
    assert.equal(m.menu(), null);
    assert.equal(tab.defaultPrevented, false, "Tab must keep its native behaviour");
    assert.equal(document.activeElement, m.button);
  } finally {
    await m.unmount();
  }
});

test("copying writes the exact value, closes the menu and returns focus", async () => {
  const written: string[] = [];
  Object.defineProperty(window.navigator, "clipboard", {
    value: { writeText: async (text: string) => void written.push(text) },
    configurable: true,
  });
  const m = await mount();
  try {
    await act(async () => m.button.click());
    await act(async () => {
      m.items()[1]!.click();
      await sleep(10);
    });
    assert.deepEqual(written, [TX]);
    assert.equal(m.menu(), null);
    assert.equal(document.activeElement, m.button);
    assert.match(m.container.textContent ?? "", /Copied transaction hash/);
  } finally {
    await m.unmount();
  }
});

test("a failed copy is reported on screen instead of swallowed", async () => {
  Object.defineProperty(window.navigator, "clipboard", {
    value: {
      writeText: async () => {
        throw new Error("denied");
      },
    },
    configurable: true,
  });
  const m = await mount();
  try {
    await act(async () => m.button.click());
    await act(async () => {
      m.items()[0]!.click();
      await sleep(10);
    });
    const status = m.container.querySelector('[role="status"]');
    assert.match(status?.textContent ?? "", /Could not copy the contract address: denied/);
  } finally {
    await m.unmount();
  }
});

test("rows without a transaction or contract do not offer to copy what is absent", async () => {
  const m = await mount({ contractId: null, transactionHash: null });
  try {
    await act(async () => m.button.click());
    assert.deepEqual(
      m.items().map((item) => item.textContent),
      ["Show details"],
    );
  } finally {
    await m.unmount();
  }
});

test("details toggle in place and the open menu passes axe-core", async () => {
  const m = await mount();
  try {
    await act(async () => m.button.click());
    const results = await axe.run(m.container, {
      runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"] },
      rules: { "color-contrast": { enabled: false } },
    });
    assert.deepEqual(
      results.violations.map((v) => v.id),
      [],
    );
    await act(async () => m.items()[2]!.click());
    assert.ok(m.container.querySelector("dl"), "details render after Show details");
    assert.equal(document.activeElement, m.button);
    await act(async () => m.button.click());
    assert.equal(m.items()[2]!.textContent, "Hide details");
  } finally {
    await m.unmount();
  }
});
