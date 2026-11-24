import assert from "node:assert/strict";
import { describe, it, before, afterEach } from "node:test";
import { installDom, loadReact } from "./domHarness.ts";
import {
  deriveNextAction,
  deriveSetupSteps,
  type SetupStep,
} from "../../lib/guard/setupChecklist.ts";
import {
  detectScreenFromHash,
  GROUNDED_TERMINOLOGY,
  SCREEN_HELP_MAP,
} from "../../lib/guard/contextualHelp.ts";
import {
  EVENT_EXPORT_COLUMNS,
  eventToExportRow,
  eventsToCsv,
  eventsToJson,
} from "../../lib/guard/eventExport.ts";
import { ContextualHelp } from "../../components/ContextualHelp.tsx";
import { DemoBadge } from "../../components/DemoBadge.tsx";
import { SetupWizard } from "../../components/SetupWizard.tsx";
import { GuardContext } from "../../components/GuardProvider.tsx";
import type { GuardEvent } from "stellar-agent-guard-sdk";

const GUARD = "CDMBPI64FS3RZW6G23NCDPLBY5GTKX7TSVZZSHE6ZQX4XAIV3HCPXUDJ";

function dummyEvent(overrides: Partial<GuardEvent> = {}): GuardEvent {
  return {
    id: "ledger:1234:event_auth_checked",
    kind: "auth_checked",
    topic: "event_auth_checked",
    source: "ledger",
    stream: "committed",
    contractId: GUARD,
    ledger: 1234,
    observedAt: null,
    ledgerClosedAt: "2026-10-01T12:00:00Z",
    transactionHash: "abcd".repeat(16),
    decision: { result: "allowed", reason: null, source: "ledger" },
    data: {},
    ...overrides,
  };
}

describe("Issue #524: show next actions for an already deployed guard", () => {
  it("derives deployed step as done when alreadyDeployed flag is true", () => {
    const steps = deriveSetupSteps({
      deployedMarker: null,
      alreadyDeployed: true,
      initialized: { ok: true, value: false },
      status: { ok: false, error: "not yet configured" },
      policy: { ok: false, error: "not yet configured" },
      verified: null,
    });
    assert.equal(steps[0]!.id, "deployed");
    assert.equal(steps[0]!.state, "done");
    assert.match(steps[0]!.detail, /deployed/i);
  });

  it("derives next action when initialization is pending", () => {
    const steps: SetupStep[] = [
      { id: "deployed", label: "Deployed", state: "done", detail: "ready" },
      { id: "initialized", label: "Initialized", state: "pending", detail: "pending init" },
      { id: "policy", label: "Policy", state: "pending", detail: "default-deny" },
      { id: "verified", label: "Verified", state: "pending", detail: "unverified" },
    ];
    const next = deriveNextAction(steps);
    assert.equal(next.stepId, "initialized");
    assert.match(next.title, /initialize/i);
    assert.equal(next.isReadOnly, false);
    assert.equal(next.actionHref, "#deploy");
  });

  it("derives next action when policy installation is pending", () => {
    const steps: SetupStep[] = [
      { id: "deployed", label: "Deployed", state: "done", detail: "ready" },
      { id: "initialized", label: "Initialized", state: "done", detail: "admin set" },
      { id: "policy", label: "Policy", state: "pending", detail: "default-deny" },
      { id: "verified", label: "Verified", state: "pending", detail: "unverified" },
    ];
    const next = deriveNextAction(steps);
    assert.equal(next.stepId, "policy");
    assert.match(next.title, /install.*policy/i);
    assert.equal(next.actionHref, "#policy");
  });

  it("derives next action when policy is set but unverified (requires read-only verify)", () => {
    const steps: SetupStep[] = [
      { id: "deployed", label: "Deployed", state: "done", detail: "ready" },
      { id: "initialized", label: "Initialized", state: "done", detail: "admin set" },
      { id: "policy", label: "Policy", state: "done", detail: "policy in force" },
      { id: "verified", label: "Verified", state: "pending", detail: "re-verify required" },
    ];
    const next = deriveNextAction(steps);
    assert.equal(next.stepId, "verified");
    assert.match(next.title, /verify/i);
    assert.equal(next.isReadOnly, true);
    assert.match(next.actionText, /read-only/i);
  });

  it("derives error resolution without replaying writes when read fails", () => {
    const steps: SetupStep[] = [
      { id: "deployed", label: "Deployed", state: "done", detail: "ready" },
      { id: "initialized", label: "Initialized", state: "error", detail: "rpc timeout" },
      { id: "policy", label: "Policy", state: "pending", detail: "unknown" },
      { id: "verified", label: "Verified", state: "pending", detail: "unverified" },
    ];
    const next = deriveNextAction(steps);
    assert.equal(next.stepId, "initialized");
    assert.match(next.title, /resolve.*error/i);
    assert.equal(next.isReadOnly, true);
    assert.match(next.detail, /never replay writes/i);
  });

  it("derives complete state when all four steps are verified", () => {
    const steps: SetupStep[] = [
      { id: "deployed", label: "Deployed", state: "done", detail: "ready" },
      { id: "initialized", label: "Initialized", state: "done", detail: "admin set" },
      { id: "policy", label: "Policy", state: "done", detail: "policy in force" },
      { id: "verified", label: "Verified", state: "done", detail: "confirmed on-chain" },
    ];
    const next = deriveNextAction(steps);
    assert.equal(next.stepId, "complete");
    assert.match(next.title, /fully configured/i);
    assert.equal(next.actionHref, "#telemetry");
  });
});

describe("Issue #525: contextual help for current screen", () => {
  it("detects screen help from hash routes", () => {
    assert.equal(detectScreenFromHash("#policy").id, "policy");
    assert.equal(detectScreenFromHash("#deploy").id, "deploy");
    assert.equal(detectScreenFromHash("#telemetry").id, "telemetry");
    assert.equal(detectScreenFromHash("#fleet").id, "fleet");
    assert.equal(detectScreenFromHash("#webhooks").id, "webhooks");
    assert.equal(detectScreenFromHash("").id, "overview");
  });

  it("provides grounded terminology that distinguishes client vs contract enforcement", () => {
    const nonCustodial = GROUNDED_TERMINOLOGY.find((t) => t.term === "Non-Custodial");
    assert.ok(nonCustodial);
    assert.equal(nonCustodial.contractEnforced, false);
    assert.match(nonCustodial.definition, /never stores, generates, or transmits/i);

    const defaultDeny = GROUNDED_TERMINOLOGY.find((t) => t.term === "Default-Deny");
    assert.ok(defaultDeny);
    assert.equal(defaultDeny.contractEnforced, true);
    assert.match(defaultDeny.definition, /contract rejects all agent invocations/i);
  });

  it("provides valid doc links for every defined screen", () => {
    for (const screen of Object.values(SCREEN_HELP_MAP)) {
      assert.ok(screen.docLinks.length > 0, `Screen ${screen.id} should have doc links`);
      for (const link of screen.docLinks) {
        assert.ok(link.href.startsWith("docs/"), `Link ${link.href} should point to docs/`);
      }
    }
  });
});

describe("Issue #526: keep live versus demo provenance visible in all views and exports", () => {
  it("event exports include provenance column as column 12", () => {
    assert.equal(EVENT_EXPORT_COLUMNS[11], "provenance");
    assert.equal(EVENT_EXPORT_COLUMNS.length, 12);
  });

  it("exports live events with provenance: live-chain", () => {
    const row = eventToExportRow(dummyEvent(), GUARD, false);
    assert.equal(row.provenance, "live-chain");

    const json = eventsToJson([dummyEvent()], GUARD, { demo: false });
    assert.equal(json.demo, false);
    assert.equal(json.provenance, "live-chain");
    assert.equal(json.rows[0]!.provenance, "live-chain");

    const csv = eventsToCsv([dummyEvent()], GUARD, { demo: false });
    assert.ok(csv.includes("live-chain"));
  });

  it("exports demo events with provenance: demo-fixtures and never live-chain", () => {
    const row = eventToExportRow(dummyEvent(), GUARD, true);
    assert.equal(row.provenance, "demo-fixtures");

    const json = eventsToJson([dummyEvent()], GUARD, { demo: true });
    assert.equal(json.demo, true);
    assert.equal(json.provenance, "demo-fixtures");
    assert.equal(json.rows[0]!.provenance, "demo-fixtures");

    const csv = eventsToCsv([dummyEvent()], GUARD, { demo: true });
    assert.ok(csv.includes("demo-fixtures"));
    assert.equal(csv.includes("live-chain"), false);
  });
});

describe("Component integration: ContextualHelp & SetupWizard", () => {
  let dom: ReturnType<typeof installDom>;
  let React: Awaited<ReturnType<typeof loadReact>>["react"];
  let createRoot: Awaited<ReturnType<typeof loadReact>>["createRoot"];
  let act: Awaited<ReturnType<typeof loadReact>>["act"];
  let root: ReturnType<typeof createRoot> | null = null;

  before(async () => {
    dom = installDom();
    const reactDeps = await loadReact();
    React = reactDeps.react;
    createRoot = reactDeps.createRoot;
    act = reactDeps.act;
  });

  afterEach(() => {
    if (root) {
      act(() => {
        root!.unmount();
      });
      root = null;
    }
    document.body.innerHTML = "";
    localStorage.clear();
  });

  it("ContextualHelp opens on trigger click and closes on Escape", async () => {
    const div = document.createElement("div");
    document.body.appendChild(div);
    root = createRoot(div);

    await act(() => {
      root!.render(React.createElement(ContextualHelp));
    });

    const trigger = document.querySelector(".contextual-help-trigger") as HTMLButtonElement;
    assert.ok(trigger);
    assert.equal(trigger.getAttribute("aria-expanded"), "false");

    // Click trigger to open modal
    await act(() => {
      trigger.click();
    });

    assert.equal(trigger.getAttribute("aria-expanded"), "true");
    const modal = document.querySelector("#contextual-help-dialog");
    assert.ok(modal);
    assert.dom(document.body).containsText("Grounded Terminology");
    assert.dom(document.body).containsText("Non-Custodial");

    // Press Escape to close modal
    await act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });

    assert.equal(document.querySelector("#contextual-help-dialog"), null);
  });

  it("DemoBadge renders live provenance indicator by default", async () => {
    const div = document.createElement("div");
    document.body.appendChild(div);
    root = createRoot(div);

    await act(() => {
      root!.render(React.createElement(DemoBadge));
    });

    const indicator = document.querySelector('[data-testid="mode-indicator"]');
    assert.ok(indicator);
    assert.equal(indicator.getAttribute("data-mode"), "live");
    assert.dom(document.body).containsText("LIVE CHAIN");
  });

  it("SetupWizard renders next recommended action and rehearsal toggle", async () => {
    const div = document.createElement("div");
    document.body.appendChild(div);
    root = createRoot(div);

    const dummySnapshot = {
      guard: GUARD,
      fetchedAt: new Date().toISOString(),
      status: {
        ok: true,
        value: {
          has_policy: false,
          admin_frozen: false,
          heartbeat_expired: false,
          last_heartbeat: 0n,
          now: 1n,
        },
      },
      policy: { ok: true, value: null },
      window: { ok: true, value: { total: 0n, entries: [] } },
      identity: {
        ok: true,
        value: {
          reportedWasmHash: "abcd",
          fetchedSha256: "abcd",
          bytes: new Uint8Array(),
          match: true,
        },
      },
    };

    const mockContext = {
      server: new Proxy(
        {},
        { get: () => () => Promise.reject(new Error("network disabled")) },
      ) as any,
      guard: GUARD,
      setGuard: () => {},
      instances: [],
      addInstance: () => {},
      removeInstance: () => {},
      updateInstance: () => {},
      snapshot: dummySnapshot,
      refresh: async () => {},
      loading: false,
    };

    await act(() => {
      root!.render(
        React.createElement(
          GuardContext.Provider,
          { value: mockContext as any },
          React.createElement(SetupWizard),
        ),
      );
    });

    // Check next action callout exists
    const nextActionBox = document.querySelector('[data-testid="setup-next-action"]');
    assert.ok(nextActionBox, "Next action callout should render");
    assert.dom(document.body).containsText("Recommended Next Action");

    // Check rehearsal toggle exists
    const rehearsalToggle = document.querySelector(
      '[data-testid="rehearsal-toggle-btn"]',
    ) as HTMLButtonElement;
    assert.ok(rehearsalToggle, "Rehearsal toggle button should exist");
    assert.equal(rehearsalToggle.textContent?.includes("Rehearse Setup"), true);

    // Click rehearsal button
    await act(() => {
      rehearsalToggle.click();
    });

    // Guided rehearsal workspace should now be displayed
    const rehearsalBanner = document.querySelector('[data-testid="setup-rehearsal"]');
    assert.ok(rehearsalBanner, "Guided rehearsal banner should render");
    assert.dom(document.body).containsText("GUIDED REHEARSAL (DEMO)");
    assert.dom(document.body).containsText("Safe Rehearsal with Demo Fixtures");

    // Verify all write actions are disabled in rehearsal
    const writeBtn = document.querySelector(
      '[data-testid="rehearsal-disabled-write-btn"]',
    ) as HTMLButtonElement;
    assert.ok(writeBtn);
    assert.equal(writeBtn.disabled, true);
    assert.equal(writeBtn.getAttribute("aria-disabled"), "true");
    assert.match(writeBtn.title, /disabled in guided rehearsal/i);
  });
});
