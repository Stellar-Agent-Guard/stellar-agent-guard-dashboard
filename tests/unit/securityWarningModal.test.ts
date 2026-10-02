import assert from "node:assert/strict";
import { before, test } from "node:test";
import type { ReactElement } from "react";
import { installDom, loadReact, sleep, type Act } from "./domHarness.ts";
import { PolicyForm } from "../../components/PolicyForm.tsx";
import { GuardContext } from "../../components/GuardProvider.tsx";
import { MaliciousAddressModal } from "../../components/MaliciousAddressModal.tsx";
import { CRITICAL_ADDRESS_WARNING, MALICIOUS_ADDRESS_REGISTRY, OVERRIDE_PHRASE, screenDraft } from "../../lib/guard/securityChecker.ts";
import { EMPTY_DRAFT, type PolicyDraft } from "../../lib/guard/policyForm.ts";

/**
 * The warning modal and the trigger that opens it.
 *
 * The pure matching is covered in `securityChecker.test.ts`; what is left is the
 * part that only exists in the interface: that clicking the policy buttons with a
 * flagged address in the draft produces the dialog and *does not* reach the
 * wallet, that the dialog names the address and its report, that neither of its
 * two gates can be passed by accident, and that the dialog is keyboard-reachable
 * and escape-able like every other dialog in the shell.
 */

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

const FLAGGED = MALICIOUS_ADDRESS_REGISTRY[0]!.address;
const CLEAN = "GAOBCRXTCO4ZCBNHALJUMJJ5JDXNOUZ7U6VZJX4UBTXAHQEO66IPU6PH";

/** `signer()` throws, so any path that reaches the wallet fails the test loudly. */
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
    throw new Error("the wallet must not be reached before the operator overrides the warning");
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

function draft(overrides: Partial<PolicyDraft> = {}): PolicyDraft {
  return { ...EMPTY_DRAFT, perTxCap: "1000", windowSecs: "60", ...overrides };
}

interface Rendered {
  container: HTMLElement;
  unmount: () => Promise<void>;
}

async function render(element: ReactElement): Promise<Rendered> {
  const container = document.createElement("div");
  document.body.appendChild(container);
  let root: ReturnType<typeof createRoot> | undefined;
  await act(async () => {
    root = createRoot(container);
    root.render(element);
  });
  await act(async () => {
    await sleep(30);
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

function renderForm(): ReactElement {
  return react.createElement(
    GuardContext.Provider,
    { value: TEST_GUARD },
    react.createElement(PolicyForm),
  );
}

function buttonByText(container: HTMLElement, text: string): HTMLButtonElement {
  const button = Array.from(container.querySelectorAll("button")).find(
    (candidate) => candidate.textContent?.trim() === text,
  );
  assert.ok(button, `expected a button labelled "${text}"`);
  return button;
}

function setFieldValue(container: HTMLElement, label: RegExp, value: string): void {
  const field = Array.from(container.querySelectorAll<HTMLElement>("label.field")).find((node) =>
    label.test(node.textContent ?? ""),
  );
  assert.ok(field, `expected a field labelled ${label}`);
  const input = field.querySelector("input, textarea");
  assert.ok(input, "the field must have an editable control");
  const setter = Object.getOwnPropertyDescriptor(
    input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype,
    "value",
  )!.set!;
  setter.call(input, value);
  input.dispatchEvent(new window.Event("input", { bubbles: true }));
}

/** Type into the form the way an operator does, rather than seeding it directly. */
async function typeRecipients(container: HTMLElement, value: string): Promise<void> {
  await act(async () => {
    setFieldValue(container, /Recipients/, value);
  });
}

function typeInto(input: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  setter.call(input, value);
  input.dispatchEvent(new window.Event("input", { bubbles: true }));
}

test("a flagged address raises the critical warning, naming the address and the report", async () => {
  const rendered = await render(renderForm());
  try {
    await typeRecipients(rendered.container, FLAGGED);
    await act(async () => {
      buttonByText(rendered.container, "Sign and install policy").click();
    });

    const dialog = rendered.container.querySelector<HTMLElement>('[role="dialog"]');
    assert.ok(dialog, "a flagged address must open the warning dialog");
    assert.equal(dialog.getAttribute("aria-modal"), "true");
    assert.ok(
      rendered.container.textContent?.includes(CRITICAL_ADDRESS_WARNING),
      "the dialog must state the required warning verbatim",
    );
    assert.ok(
      rendered.container.textContent?.includes(FLAGGED),
      "the dialog must name the flagged address",
    );
    assert.ok(
      rendered.container.querySelector<HTMLAnchorElement>('a[href^="https://"]'),
      "the dialog must link the report so the claim is checkable",
    );
  } finally {
    await rendered.unmount();
  }
});

test("the wallet is never prompted while a flagged address is unconfirmed", async () => {
  // The guard's `signer()` throws. Reaching it before the override is cleared is
  // the failure this gate exists to prevent, so an unhandled rejection here is
  // the assertion.
  const rendered = await render(renderForm());
  try {
    await typeRecipients(rendered.container, FLAGGED);
    await act(async () => {
      buttonByText(rendered.container, "Sign and install policy").click();
    });
    assert.ok(rendered.container.querySelector('[role="dialog"]'));
    assert.equal(
      rendered.container.textContent?.includes("did not complete"),
      false,
      "no policy write may have been attempted",
    );
  } finally {
    await rendered.unmount();
  }
});

test("XDR export is gated by the same warning, since it is signed later elsewhere", async () => {
  // An exported envelope is the policy update that escapes this warning entirely
  // — it gets signed on a hardware wallet, out of reach of the modal.
  const rendered = await render(renderForm());
  try {
    await typeRecipients(rendered.container, FLAGGED);
    await act(async () => {
      buttonByText(rendered.container, "Export XDR").click();
    });
    const dialog = rendered.container.querySelector('[role="dialog"]');
    assert.ok(dialog, "exporting a flagged policy must open the warning dialog");
    assert.ok(rendered.container.textContent?.includes(CRITICAL_ADDRESS_WARNING));
  } finally {
    await rendered.unmount();
  }
});

test("a clean policy opens no dialog at all", async () => {
  const rendered = await render(renderForm());
  try {
    await typeRecipients(rendered.container, CLEAN);
    await act(async () => {
      buttonByText(rendered.container, "Sign and install policy").click();
    });
    // `signer()` throws, so a thrown error here means the click was intercepted.
    assert.equal(
      rendered.container.querySelector('[role="dialog"]'),
      null,
      "a policy with no flagged address must not be gated",
    );
  } finally {
    await rendered.unmount();
  }
});

test("the inline panel names the flagged address before the operator ever clicks", async () => {
  // The dialog is the last gate, not the first notice. Reading the address list
  // in the form is where a lookalike paste actually gets caught.
  const rendered = await render(renderForm());
  try {
    await typeRecipients(rendered.container, FLAGGED);
    const text = rendered.container.textContent ?? "";
    assert.match(text, /on the warning registry/);
    assert.ok(text.includes(FLAGGED));
  } finally {
    await rendered.unmount();
  }
});

test("the dialog is a real dialog: labelled, described, and focused on open", async () => {
  const rendered = await render(renderForm());
  try {
    await typeRecipients(rendered.container, FLAGGED);
    const trigger = buttonByText(rendered.container, "Sign and install policy");
    await act(async () => {
      trigger.click();
    });

    const dialog = rendered.container.querySelector<HTMLElement>('[role="dialog"]');
    assert.ok(dialog);
    assert.equal(
      rendered.container.ownerDocument.getElementById(dialog.getAttribute("aria-labelledby") ?? ""),
      dialog.querySelector("#malicious-address-title"),
      "aria-labelledby must reference the visible title",
    );
    assert.ok(
      rendered.container.ownerDocument.getElementById(dialog.getAttribute("aria-describedby") ?? ""),
      "aria-describedby must reference real text",
    );
    assert.equal(document.activeElement, dialog, "opening the dialog must move focus into it");
  } finally {
    await rendered.unmount();
  }
});

test("the proceed control stays disabled until both gates are cleared", async () => {
  const screen = screenDraft(draft({ recipients: FLAGGED }));
  const rendered = await render(
    react.createElement(MaliciousAddressModal, {
      screen,
      onCancel: () => {},
      onProceed: () => {},
      returnFocusTo: { current: null },
    }),
  );
  try {
    const proceed = buttonByText(rendered.container, "Sign with flagged addresses");
    assert.equal(proceed.disabled, true, "an untouched dialog must not be passable");

    const ack = rendered.container.querySelector<HTMLInputElement>("#ack-flagged-address");
    const phrase = rendered.container.querySelector<HTMLInputElement>("input:not([type=checkbox])");
    assert.ok(ack && phrase);

    // Gate one alone. A checkbox is one click, and one click is the thing this
    // dialog exists to interrupt.
    await act(async () => {
      ack.click();
    });
    assert.equal(proceed.disabled, true, "the acknowledgement alone must not be enough");

    // Gate two alone. A typed phrase is not consent on its own.
    await act(async () => {
      ack.click();
    });
    await act(async () => {
      typeInto(phrase, OVERRIDE_PHRASE);
    });
    assert.equal(proceed.disabled, true, "the phrase alone must not be enough");

    // An approximate phrase, with the acknowledgement back on.
    await act(async () => {
      ack.click();
    });
    await act(async () => {
      typeInto(phrase, "probably fine");
    });
    assert.equal(proceed.disabled, true, "an approximate phrase must not pass");

    await act(async () => {
      typeInto(phrase, OVERRIDE_PHRASE);
    });
    assert.equal(proceed.disabled, false, "both gates cleared must enable the override");
  } finally {
    await rendered.unmount();
  }
});

test("proceeding fires exactly once, and only after the gates are cleared", async () => {
  let proceeds = 0;
  const screen = screenDraft(draft({ recipients: FLAGGED }));
  const rendered = await render(
    react.createElement(MaliciousAddressModal, {
      screen,
      onCancel: () => {},
      onProceed: () => {
        proceeds += 1;
      },
      returnFocusTo: { current: null },
    }),
  );
  try {
    const ack = rendered.container.querySelector<HTMLInputElement>("#ack-flagged-address");
    const phrase = rendered.container.querySelector<HTMLInputElement>("input:not([type=checkbox])");
    assert.ok(ack && phrase);

    await act(async () => {
      ack.click();
      typeInto(phrase, OVERRIDE_PHRASE);
    });
    await act(async () => {
      buttonByText(rendered.container, "Sign with flagged addresses").click();
    });
    assert.equal(proceeds, 1);
  } finally {
    await rendered.unmount();
  }
});

test("Escape closes the dialog and returns focus to the control that opened it", async () => {
  const rendered = await render(renderForm());
  try {
    await typeRecipients(rendered.container, FLAGGED);
    await act(async () => {
      buttonByText(rendered.container, "Sign and install policy").click();
    });
    assert.ok(rendered.container.querySelector('[role="dialog"]'));

    await act(async () => {
      document.dispatchEvent(
        new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }),
      );
    });

    assert.equal(rendered.container.querySelector('[role="dialog"]'), null);
    assert.equal(
      document.activeElement,
      buttonByText(rendered.container, "Sign and install policy"),
      "focus must return to the trigger",
    );
  } finally {
    await rendered.unmount();
  }
});

test("a second flagged address re-arms the gate after an override", async () => {
  // Consent was to one list of addresses. Appending another flagged one after
  // confirming must ask again, or the gate is satisfied by history rather than
  // by the policy being signed.
  const second = MALICIOUS_ADDRESS_REGISTRY[1]!.address;
  const rendered = await render(renderForm());
  try {
    await typeRecipients(rendered.container, FLAGGED);
    await act(async () => {
      buttonByText(rendered.container, "Sign and install policy").click();
    });

    // Edit the field behind the dialog, then dismiss it.
    await typeRecipients(rendered.container, `${FLAGGED}\n${second}`);
    await act(async () => {
      buttonByText(rendered.container, "Cancel").click();
    });

    await act(async () => {
      buttonByText(rendered.container, "Sign and install policy").click();
    });
    const dialog = rendered.container.querySelector('[role="dialog"]');
    assert.ok(dialog, "the edited policy must be gated again");
    assert.ok(
      rendered.container.textContent?.includes(second),
      "the dialog must name the newly added flagged address",
    );
    assert.match(rendered.container.textContent ?? "", /2 addresses in this policy/);
  } finally {
    await rendered.unmount();
  }
});
