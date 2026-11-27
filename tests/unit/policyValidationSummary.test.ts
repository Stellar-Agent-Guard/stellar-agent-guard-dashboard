import assert from "node:assert/strict";
import { afterEach, before, beforeEach, test } from "node:test";
import type { ReactElement } from "react";
import { installDom, loadReact, sleep, type Act } from "./domHarness.ts";
import { PolicyForm } from "../../components/PolicyForm.tsx";
import {
  GuardContext,
  GuardEventsContext,
  type GuardContextValue,
} from "../../components/GuardProvider.tsx";
import type { GuardSnapshot } from "../../lib/guard/guardOps.ts";
import { NETWORK } from "../../lib/guard/network.ts";
import {
  POLICY_DEFAULT_NOTES,
  buildPolicyConfig,
  policyFieldInputId,
} from "../../lib/guard/policyForm.ts";
import { clearAnnouncements, pendingAnnouncements } from "../../lib/guard/useAnnounce.ts";

installDom();

const GUARD = "CBLQLJAG72M4XQRJMQHSKYIFVHQD7LNTNOQH2GRMCMBWMSLBSLTGTJC7";
const SIGNER = "GA76DICZHOAA3L2OUCHG4X6J6DMM2NDEPLUWMK4PVLR2YTXZADHJZIXD";

let react: typeof import("react");
let createRoot: typeof import("react-dom/client").createRoot;
let act: Act;

before(async () => {
  const loaded = await loadReact();
  react = loaded.react;
  createRoot = loaded.createRoot;
  act = loaded.act;
});

beforeEach(() => {
  clearAnnouncements();
});

afterEach(() => {
  window.localStorage.clear();
  clearAnnouncements();
});

function snapshot(): GuardSnapshot {
  return {
    guard: GUARD,
    fetchedAt: new Date().toISOString(),
    status: {
      ok: true,
      value: {
        admin_frozen: false,
        has_policy: false,
        heartbeat_expired: false,
        last_heartbeat: 1n,
        now: 2n,
      },
    },
    policy: { ok: true, value: null },
    window: { ok: true, value: null },
    identity: {
      ok: true,
      value: { reportedWasmHash: null, fetchedSha256: "", bytes: 0, match: false },
    },
  };
}

interface Harness {
  container: HTMLElement;
  unmount: () => Promise<void>;
}

async function renderForm(): Promise<Harness> {
  const value = {
    server: {},
    wallet: {
      address: SIGNER,
      networkPassphrase: NETWORK.passphrase,
      network: NETWORK.name,
    },
    signer: () => ({}),
    guard: GUARD,
    refresh: async () => {},
    snapshot: snapshot(),
    pushEvents: () => {},
    notifyTabs: () => {},
  } as unknown as GuardContextValue;
  const container = document.createElement("div");
  document.body.appendChild(container);
  let root: ReturnType<typeof createRoot> | undefined;
  const tree = (): ReactElement =>
    react.createElement(
      GuardContext.Provider,
      { value },
      react.createElement(
        GuardEventsContext.Provider,
        { value: [] },
        react.createElement(PolicyForm),
      ),
    );
  await act(async () => {
    root = createRoot(container);
    root.render(tree());
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

function setField(container: HTMLElement, selector: string, value: string): void {
  const element = container.querySelector(selector) as HTMLInputElement | HTMLTextAreaElement;
  assert.ok(element, `expected a field matching ${selector}`);
  const prototype =
    element instanceof HTMLTextAreaElement
      ? window.HTMLTextAreaElement.prototype
      : window.HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(prototype, "value")!.set!;
  setter.call(element, value);
  element.dispatchEvent(new window.Event("input", { bubbles: true }));
}

async function settle(ms = 30): Promise<void> {
  await act(async () => {
    await sleep(ms);
  });
}

test("validation summary sits before review, links fields, focuses them and announces the same message", async () => {
  const harness = await renderForm();
  try {
    await act(async () => {
      setField(harness.container, 'input[placeholder="1000"]', "not-a-number");
      setField(
        harness.container,
        `textarea[placeholder="${"GAOBCRXTCO4ZCBNHALJUMJJ5JDXNOUZ7U6VZJX4UBTXAHQEO66IPU6PH"}"]`,
        "bad-address",
      );
    });
    await settle();

    const summary = harness.container.querySelector<HTMLElement>(
      '[data-testid="policy-validation-summary"]',
    );
    assert.ok(summary, "expected a validation summary");
    const review = [...harness.container.querySelectorAll("h3")].find(
      (heading) => heading.textContent === "Review",
    );
    assert.ok(review, "expected the review heading");
    assert.notEqual(
      summary!.compareDocumentPosition(review) & window.Node.DOCUMENT_POSITION_FOLLOWING,
      0,
      "the summary must appear before the review heading",
    );

    const built = buildPolicyConfig({
      perTxCap: "not-a-number",
      windowCap: "",
      windowSecs: "86400",
      assets: "",
      assetCaps: [],
      recipients: "bad-address",
      allowAnyRecipient: false,
      protocols: "",
      activeFrom: "",
      activeUntil: "",
      paused: false,
      dmsGraceSecs: "",
    });
    assert.equal(built.ok, false);
    if (built.ok) return;
    const capMessage = built.issues.find((issue) => issue.field === "perTxCap")!.message;
    const recipientMessage = built.issues.find((issue) => issue.field === "recipients")!.message;

    const capLink = [...summary!.querySelectorAll("a")].find((link) =>
      link.textContent?.includes("Per-transaction cap"),
    );
    assert.ok(capLink, "expected a linked per-transaction cap issue");
    assert.equal(capLink!.getAttribute("href"), `#${policyFieldInputId("perTxCap")}`);
    assert.equal(harness.container.querySelector("#policy-error-perTxCap"), null);

    await act(async () => {
      capLink!.click();
    });

    const capInput = harness.container.querySelector<HTMLInputElement>(
      `#${policyFieldInputId("perTxCap")}`,
    );
    assert.ok(capInput, "expected the linked input to exist");
    assert.equal(document.activeElement, capInput);
    assert.equal(
      harness.container.querySelector("#policy-error-perTxCap")?.textContent,
      capMessage,
    );
    assert.equal(capInput!.getAttribute("aria-invalid"), "true");
    assert.equal(capInput!.getAttribute("aria-describedby"), "policy-error-perTxCap");
    assert.equal(pendingAnnouncements().at(-1)?.message, `Per-transaction cap: ${capMessage}`);

    const recipientLink = [...summary!.querySelectorAll("a")].find((link) =>
      link.textContent?.includes("Recipients"),
    );
    assert.ok(recipientLink, "expected a linked recipients issue");
    await act(async () => {
      recipientLink!.click();
    });
    const recipientInput = harness.container.querySelector<HTMLTextAreaElement>(
      `#${policyFieldInputId("recipients")}`,
    );
    assert.equal(document.activeElement, recipientInput);
    assert.equal(pendingAnnouncements().at(-1)?.message, `Recipients: ${recipientMessage}`);
  } finally {
    await harness.unmount();
  }
});

test("effective default notes are rendered beside fields with contract source links", async () => {
  const harness = await renderForm();
  try {
    const notes = harness.container.querySelectorAll('[data-testid^="policy-default-note-"]');
    assert.equal(notes.length, POLICY_DEFAULT_NOTES.length);
    for (const note of POLICY_DEFAULT_NOTES) {
      const element = harness.container.querySelector<HTMLElement>(
        `[data-testid="policy-default-note-${note.field}"]`,
      );
      assert.ok(element, `expected a default note for ${note.field}`);
      assert.match(element!.textContent ?? "", /^Default:/);
      assert.ok((element!.textContent ?? "").includes(note.sourceLabel));
      const link = element!.querySelector("a");
      assert.equal(link?.getAttribute("href"), note.sourceUrl);
    }
  } finally {
    await harness.unmount();
  }
});
