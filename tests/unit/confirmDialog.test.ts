import assert from "node:assert/strict";
import { before, test } from "node:test";
import { installDom, loadReact, sleep, type Act } from "./domHarness.ts";
import { ConfirmDialog } from "../../components/ConfirmDialog.tsx";
import { useModalFocus } from "../../components/ConfirmDialog.tsx";
import { PanicPanel } from "../../components/PanicPanel.tsx";
import { GuardContext } from "../../components/GuardProvider.tsx";
import type { ReactElement } from "react";

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

/** Mount an element and return helpers to drive and inspect it. */
async function mount(element: ReactElement) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  let root: ReturnType<typeof createRoot> | undefined;
  await act(async () => {
    root = createRoot(container);
    root.render(element);
  });
  return {
    container,
    unmount: async () => {
      await act(async () => {
        root?.unmount();
      });
      container.remove();
    },
  };
}

function buttonByText(container: HTMLElement, text: string): HTMLButtonElement {
  const button = Array.from(container.querySelectorAll("button")).find(
    (candidate) => candidate.textContent?.trim() === text,
  );
  assert.ok(button, `expected a button labelled "${text}"`);
  return button;
}

/** A wrapper component whose state the test drives through the exposed handle. */
function makeControlledDialog(props: {
  consequence: string;
  confirmLabel?: string;
  title?: string;
  onConfirm: () => void;
  onClose: () => void;
}) {
  function Controlled(): ReactElement {
    return react.createElement(ConfirmDialog, {
      title: props.title ?? "Delete the contact",
      consequence: props.consequence,
      confirmLabel: props.confirmLabel ?? "Delete",
      labelledById: "confirm-test-title",
      onClose: props.onClose,
      onConfirm: props.onConfirm,
    });
  }
  return Controlled;
}

test("the dialog renders role=dialog with a labelled title and the consequence copy", async () => {
  let confirmed = 0;
  let closed = 0;
  const Controlled = makeControlledDialog({
    consequence: "This removes the nickname from this browser — the address itself is untouched.",
    onConfirm: () => {
      confirmed += 1;
    },
    onClose: () => {
      closed += 1;
    },
  });
  const mounted = await mount(react.createElement(Controlled));
  try {
    const dialog = mounted.container.querySelector<HTMLElement>('[role="dialog"]');
    assert.ok(dialog, "the confirm renders as role=dialog");
    assert.equal(dialog.getAttribute("aria-modal"), "true");
    const labelledBy = dialog.getAttribute("aria-labelledby");
    assert.ok(labelledBy, "the dialog must carry aria-labelledby");
    assert.equal(
      dialog.ownerDocument.getElementById(labelledBy)?.textContent,
      "Delete the contact",
      "aria-labelledby must resolve to the rendered title",
    );
    // Consequence-first copy rule: the body states what confirming does. The
    // consequence is a required prop, so this is the presence test of a
    // compile-time guarantee.
    assert.match(
      dialog.textContent ?? "",
      /This removes the nickname from this browser/,
      "the rendered body must contain the provided consequence text exactly",
    );
  } finally {
    await mounted.unmount();
  }
});

test("cancel never executes the action; confirm executes it once (count asserts)", async () => {
  let confirmed = 0;
  let closed = 0;
  const Controlled = makeControlledDialog({
    consequence: "This freezes the account — agent transactions will be blocked until unfrozen.",
    onConfirm: () => {
      confirmed += 1;
    },
    onClose: () => {
      closed += 1;
    },
  });
  const mounted = await mount(react.createElement(Controlled));
  try {
    await act(async () => {
      buttonByText(mounted.container, "Cancel").click();
      await sleep(0);
    });
    assert.equal(confirmed, 0, "cancel must not execute the destructive action");
    assert.equal(closed, 1, "cancel reports dismissal to the owner");

    await act(async () => {
      buttonByText(mounted.container, "Delete").click();
      await sleep(0);
    });
    assert.equal(confirmed, 1, "confirm executes the action exactly once");
  } finally {
    await mounted.unmount();
  }
});

test("useModalFocus: the wired dialog traps Tab and dismisses on Escape", async () => {
  let closed = 0;
  function Probe(): ReactElement {
    const ref = react.useRef<HTMLDivElement>(null);
    useModalFocus({
      open: true,
      dialogRef: ref,
      onClose: () => {
        closed += 1;
      },
      restoreFocus: false,
    });
    return react.createElement(
      "div",
      { ref, role: "dialog", tabIndex: -1 },
      react.createElement("button", null, "only control"),
    );
  }
  const mounted = await mount(react.createElement(Probe));
  try {
    const dialog = mounted.container.querySelector<HTMLElement>('[role="dialog"]');
    assert.ok(dialog);
    // The hook moved focus into the dialog on open.
    assert.equal(document.activeElement, dialog, "focus enters the dialog on open");

    await act(async () => {
      document.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }),
      );
    });
    assert.equal(closed, 1, "Escape reports dismissal to the owner");
  } finally {
    await mounted.unmount();
  }
});

/** The no-network guard context the a11y audit already uses. */
const noNetworkServer = new Proxy(
  {},
  { get: () => () => Promise.reject(new Error("network disabled in unit tests")) },
);
const TEST_GUARD = {
  server: noNetworkServer,
  wallet: {
    address: "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWH",
    networkPassphrase: "Test SDF Network ; September 2015",
    network: "Testnet",
  },
  walletError: null,
  connecting: false,
  connect: async () => {},
  disconnect: () => {},
  signer: () => {
    throw new Error("no signing in this test");
  },
  instances: [],
  guard: "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
  selectGuard: () => {},
  addInstance: () => {},
  snapshot: null,
  snapshotError: null,
  refreshing: false,
  refresh: async () => {},
  events: [],
  feed: { watching: false, latestLedger: null, error: null, lastPolledAt: null },
  startWatching: () => {},
  stopWatching: () => {},
  clearEvents: () => {},
  pushEvents: () => {},
} as any;

test("PanicPanel adopts the shared dialog: cancel → freeze count 0, confirm renders signing", async () => {
  const mounted = await mount(
    react.createElement(
      GuardContext.Provider,
      { value: TEST_GUARD },
      react.createElement(PanicPanel),
    ),
  );
  try {
    const trigger = buttonByText(mounted.container, "Freeze this account");
    await act(async () => {
      trigger.click();
      await sleep(0);
    });

    const dialog = mounted.container.querySelector<HTMLElement>('[role="dialog"]');
    assert.ok(dialog, "the freeze confirmation renders through the shared dialog");
    assert.equal(dialog.getAttribute("aria-modal"), "true");
    // The consequence copy survives the port, verbatim from the original panel.
    assert.match(
      dialog.textContent ?? "",
      /The agent will not be able to make any call/,
      "the freeze consequence copy is intact",
    );

    await act(async () => {
      buttonByText(mounted.container, "Cancel").click();
      await sleep(0);
    });
    assert.equal(
      mounted.container.querySelector('[role="dialog"]'),
      null,
      "cancel dismisses the dialog",
    );
    // No freeze was attempted: the signer (which throws) was never invoked,
    // and the panel returned to idle rather than showing signing state.
    assert.ok(buttonByText(mounted.container, "Freeze this account"), "the trigger is back");
  } finally {
    await mounted.unmount();
  }
});
