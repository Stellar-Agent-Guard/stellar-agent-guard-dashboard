/**
 * Focus restoration after nested portal dialogs (issue #540).
 *
 * Every modal trap in the console listens on `document` in the capture phase.
 * When two dialogs are open at once — and each lives in its own portal, so the
 * upper one is *not* a DOM descendant of the lower one — an uncoordinated pair
 * of traps breaks the keyboard in three ways:
 *
 *   1. one Escape dismisses both dialogs at once;
 *   2. the lower trap sees focus "outside" itself and drags Tab focus back
 *      behind the overlay the operator is looking at;
 *   3. closing the upper dialog drops focus on `<body>`.
 *
 * These tests pin the stack-aware contract of `useModalFocus`: only the
 * topmost dialog owns Escape/Tab, and every way out — Escape, an explicit
 * close button, or a cancelled flow that closes several dialogs in one commit
 * — returns focus to the control that opened the dialog, falling back to the
 * dialog underneath rather than to the page behind it.
 */
import assert from "node:assert/strict";
import { afterEach, before, describe, test } from "node:test";
import type { ReactElement, ReactNode } from "react";
import { installDom, loadReact, type Act } from "./domHarness.ts";

installDom();

let React: typeof import("react");
let createRoot: typeof import("react-dom/client").createRoot;
let act: Act;
let Portal: typeof import("../../components/Portal.tsx").Portal;
let useModalFocus: typeof import("../../lib/guard/useModalFocus.ts").useModalFocus;
let dialogStack: typeof import("../../lib/guard/useModalFocus.ts").dialogStack;
let SecretKeyGuard: typeof import("../../components/SecretKeyGuard.tsx").SecretKeyGuard;
let raiseSecretKeyAlert: typeof import("../../lib/guard/inputSanitizer.ts").raiseSecretKeyAlert;
let dismissSecretKeyAlert: typeof import("../../lib/guard/inputSanitizer.ts").dismissSecretKeyAlert;

before(async () => {
  const loaded = await loadReact();
  React = loaded.react;
  createRoot = loaded.createRoot;
  act = loaded.act;
  ({ Portal } = await import("../../components/Portal.tsx"));
  ({ useModalFocus, dialogStack } = await import("../../lib/guard/useModalFocus.ts"));
  ({ SecretKeyGuard } = await import("../../components/SecretKeyGuard.tsx"));
  ({ raiseSecretKeyAlert, dismissSecretKeyAlert } =
    await import("../../lib/guard/inputSanitizer.ts"));
});

let root: ReturnType<typeof createRoot> | null = null;

afterEach(async () => {
  if (root) {
    const current = root;
    await act(async () => current.unmount());
    root = null;
  }
  document.body.innerHTML = "";
  assert.equal(dialogStack.depth, 0, "every dialog must leave the stack when it unmounts");
});

/**
 * `createElement` without JSX (test files are `.ts`). Loosely typed on
 * purpose: the harness components take ad-hoc props, and React's overloads
 * cannot be forwarded through a rest parameter.
 */
const h = (type: any, props?: any, ...children: ReactNode[]): ReactElement =>
  React.createElement(type, props, ...children);

/**
 * A dialog body that registers with the shared focus hook. It is rendered
 * *inside* a `<Portal>`, exactly like a real portaled modal, so its node only
 * exists once the portal container does.
 */
function DialogBody(props: {
  id: string;
  onClose: () => void;
  fallbackRef?: { current: HTMLElement | null };
  children: ReactNode;
}) {
  const ref = React.useRef<HTMLDivElement>(null);
  useModalFocus({
    open: true,
    containerRef: ref,
    onDismiss: props.onClose,
    ...(props.fallbackRef ? { fallbackFocusRef: props.fallbackRef } : {}),
  });
  return h(
    "div",
    {
      ref,
      id: props.id,
      role: "dialog",
      "aria-modal": "true",
      "aria-label": props.id,
      tabIndex: -1,
    },
    props.children,
  );
}

function PortalDialog(props: Parameters<typeof DialogBody>[0]) {
  return h(Portal, null, h(DialogBody, props));
}

/**
 * Page trigger → outer portal dialog → inner portal dialog. The two dialogs
 * are sibling portals under `<body>`: the inner one is not inside the outer
 * one's DOM, which is the configuration that defeats a naive trap.
 */
function NestedHarness() {
  const [outer, setOuter] = React.useState(false);
  const [inner, setInner] = React.useState(false);
  const [innerTriggerShown, setInnerTriggerShown] = React.useState(true);
  const closeAll = () => {
    setInner(false);
    setOuter(false);
  };
  return h(
    React.Fragment,
    null,
    h("button", { id: "page-trigger", onClick: () => setOuter(true) }, "Open review"),
    outer &&
      h(
        PortalDialog,
        { id: "outer", onClose: closeAll },
        innerTriggerShown &&
          h("button", { id: "inner-trigger", onClick: () => setInner(true) }, "Open details"),
        h("button", { id: "outer-close", onClick: closeAll }, "Close review"),
      ),
    inner &&
      h(
        PortalDialog,
        { id: "inner", onClose: () => setInner(false) },
        h(
          "button",
          { id: "inner-first", onClick: () => setInnerTriggerShown(false) },
          "Remove trigger",
        ),
        h("button", { id: "inner-close", onClick: () => setInner(false) }, "Close details"),
        h("button", { id: "inner-cancel-flow", onClick: closeAll }, "Cancel everything"),
      ),
  );
}

async function render(element: ReactElement): Promise<void> {
  const container = document.createElement("div");
  document.body.appendChild(container);
  await act(async () => {
    root = createRoot(container);
    root.render(element);
  });
}

const byId = (id: string) => document.getElementById(id);

/** Focus a control and click it, as a keyboard user pressing Enter would. */
async function activate(id: string): Promise<void> {
  const element = byId(id) as HTMLElement | null;
  assert.ok(element, `#${id} should be in the document`);
  await act(async () => {
    element.focus();
    element.click();
  });
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

async function openBoth(): Promise<void> {
  await activate("page-trigger");
  await activate("inner-trigger");
  assert.ok(byId("outer") && byId("inner"), "both dialogs should be open");
}

describe("nested portal dialogs: Escape", () => {
  test("the outer dialog takes focus on open and joins the stack", async () => {
    await render(h(NestedHarness));
    await activate("page-trigger");
    assert.equal(document.activeElement, byId("outer"));
    assert.equal(dialogStack.depth, 1);
    assert.equal(dialogStack.top(), byId("outer"));
  });

  test("Escape closes only the top dialog and restores focus to its trigger inside the lower one", async () => {
    await render(h(NestedHarness));
    await openBoth();
    assert.equal(document.activeElement, byId("inner"));
    assert.equal(dialogStack.depth, 2);

    const event = await press("Escape");
    assert.equal(event.defaultPrevented, true);
    assert.equal(byId("inner"), null, "the inner dialog closed");
    assert.ok(byId("outer"), "the outer dialog is still open — one Escape, one dialog");
    assert.equal(document.activeElement, byId("inner-trigger"));
    assert.equal(dialogStack.depth, 1);
  });

  test("a second Escape closes the outer dialog and restores focus to the page trigger", async () => {
    await render(h(NestedHarness));
    await openBoth();
    await press("Escape");
    await press("Escape");
    assert.equal(byId("outer"), null);
    assert.equal(document.activeElement, byId("page-trigger"));
    assert.equal(dialogStack.depth, 0);
  });
});

describe("nested portal dialogs: explicit close", () => {
  test("closing each dialog with its own button walks focus back down the stack", async () => {
    await render(h(NestedHarness));
    await openBoth();

    await activate("inner-close");
    assert.equal(byId("inner"), null);
    assert.equal(document.activeElement, byId("inner-trigger"));

    await activate("outer-close");
    assert.equal(byId("outer"), null);
    assert.equal(document.activeElement, byId("page-trigger"));
  });
});

describe("nested portal dialogs: cancelled flows", () => {
  test("cancelling the whole flow from the inner dialog lands focus on the page trigger, not <body>", async () => {
    await render(h(NestedHarness));
    await openBoth();

    await activate("inner-cancel-flow");
    assert.equal(byId("inner"), null);
    assert.equal(byId("outer"), null);
    assert.notEqual(document.activeElement, document.body);
    assert.equal(document.activeElement, byId("page-trigger"));
    assert.equal(dialogStack.depth, 0);
  });

  test("if the inner trigger is gone, focus falls back to the dialog underneath", async () => {
    await render(h(NestedHarness));
    await openBoth();

    // The inner dialog's first button removes its own trigger from the outer
    // dialog (a row re-rendered away while the details were open).
    await activate("inner-first");
    assert.equal(byId("inner-trigger"), null);

    await press("Escape");
    assert.equal(byId("inner"), null);
    assert.equal(
      document.activeElement,
      byId("outer"),
      "focus must stay inside the still-open overlay, never drop behind it",
    );
  });

  test("a fallback control receives focus when the trigger itself was removed", async () => {
    function FallbackHarness() {
      const [open, setOpen] = React.useState(false);
      const fallbackRef = React.useRef<HTMLButtonElement>(null);
      return h(
        React.Fragment,
        null,
        !open && h("button", { id: "trigger", onClick: () => setOpen(true) }, "Freeze"),
        h("button", { id: "fallback", ref: fallbackRef }, "Unfreeze"),
        open &&
          h(
            PortalDialog,
            { id: "dialog", onClose: () => setOpen(false), fallbackRef },
            h("button", { id: "close", onClick: () => setOpen(false) }, "Cancel"),
          ),
      );
    }
    await render(h(FallbackHarness));
    await activate("trigger");
    assert.equal(byId("trigger"), null, "the trigger unmounts while the dialog is open");
    await press("Escape");
    assert.equal(byId("dialog"), null);
    assert.equal(document.activeElement, byId("fallback"));
  });
});

describe("nested portal dialogs: Tab stays with the top dialog", () => {
  test("Tab from the last control wraps within the inner dialog, not into the outer one", async () => {
    await render(h(NestedHarness));
    await openBoth();

    (byId("inner-cancel-flow") as HTMLElement).focus();
    const forward = await press("Tab");
    assert.equal(forward.defaultPrevented, true);
    assert.equal(document.activeElement, byId("inner-first"));

    const backward = await press("Tab", { shiftKey: true });
    assert.equal(backward.defaultPrevented, true);
    assert.equal(document.activeElement, byId("inner-cancel-flow"));
  });

  test("the lower dialog's trap is inert while another dialog is on top", async () => {
    await render(h(NestedHarness));
    await openBoth();

    // Focus sits inside the inner dialog, which is *outside* the outer
    // dialog's DOM. Before #540 the outer trap treated that as "focus escaped"
    // and yanked it to the outer dialog's first control.
    (byId("inner-close") as HTMLElement).focus();
    const event = await press("Tab");
    assert.equal(event.defaultPrevented, false, "a middle control tabs natively");
    assert.equal(document.activeElement, byId("inner-close"));
  });
});

describe("real components: the secret-key alert stacked over a modal", () => {
  test("Escape dismisses only the alert and returns focus to the field inside the dialog below", async () => {
    function Host() {
      const [open, setOpen] = React.useState(true);
      return h(
        React.Fragment,
        null,
        h(SecretKeyGuard),
        open &&
          h(
            PortalDialog,
            { id: "layout-dialog", onClose: () => setOpen(false) },
            h("input", { id: "layout-name", "aria-label": "Layout name" }),
            h("button", { id: "layout-cancel", onClick: () => setOpen(false) }, "Cancel"),
          ),
      );
    }

    await render(h(Host));
    (byId("layout-name") as HTMLInputElement).focus();
    // A pasted seed is caught by the document-level screen; raising the alert
    // directly is the same store transition without depending on paste events.
    await act(async () => raiseSecretKeyAlert());

    const alert = document.querySelector('[role="alertdialog"]');
    assert.ok(alert, "the secret-key alert is open");
    assert.equal(document.activeElement, alert, "the alert takes focus");
    assert.equal(dialogStack.depth, 2);
    assert.equal(dialogStack.top(), alert);

    await press("Escape");
    assert.equal(document.querySelector('[role="alertdialog"]'), null, "the alert closed");
    assert.ok(byId("layout-dialog"), "the dialog underneath did not close on the same Escape");
    assert.equal(document.activeElement, byId("layout-name"));

    await press("Escape");
    assert.equal(byId("layout-dialog"), null);
  });

  test("Acknowledge (explicit close) also restores focus to the field", async () => {
    function Host() {
      return h(
        React.Fragment,
        null,
        h(SecretKeyGuard),
        h(
          PortalDialog,
          { id: "d", onClose: () => {} },
          h("input", { id: "field", "aria-label": "Field" }),
        ),
      );
    }
    await render(h(Host));
    (byId("field") as HTMLInputElement).focus();
    await act(async () => raiseSecretKeyAlert());

    const acknowledge = Array.from(document.querySelectorAll("button")).find(
      (button) => button.textContent === "Acknowledge",
    );
    assert.ok(acknowledge);
    await act(async () => acknowledge.click());
    assert.equal(document.querySelector('[role="alertdialog"]'), null);
    assert.equal(document.activeElement, byId("field"));
    // Clean global alert state for the next test.
    dismissSecretKeyAlert();
  });
});
