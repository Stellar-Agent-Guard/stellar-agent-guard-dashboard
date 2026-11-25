import assert from "node:assert/strict";
import { afterEach, before, describe, it } from "node:test";
import type { ContextType } from "react";
import type { GuardEvent } from "stellar-agent-guard-sdk";
import { installDom, loadReact, sleep, type Act } from "./domHarness.ts";
import { TelemetryAlerts } from "../../components/TelemetryAlerts.tsx";
import { GuardContext, GuardEventsContext } from "../../components/GuardProvider.tsx";
import {
  ALERT_CLASS_HINTS,
  ALERT_CLASS_LABELS,
  ALERT_REASON_ORDER,
  ALERT_SETTINGS_STORAGE_KEY,
  BEEP_COUNT,
  DEFAULT_ALERT_SETTINGS,
  alertClassEnabled,
  alertsArmed,
  isSecurityAlertReason,
  loadAlertSettings,
  normalizeAlertSettings,
  saveAlertSettings,
  type AlertSettings,
  type SecurityAlertReason,
} from "../../lib/guard/audioAlert.ts";
import { withIdentity } from "../mocks/eventFixtures.ts";

/**
 * Per-event-class notification preferences (#492).
 *
 * The channels say *how* an operator is interrupted; the classes say *what
 * for*, and this feature is where those two stop being one switch. Two
 * failures are more interesting than the checkboxes themselves, so both are
 * tested here rather than assumed:
 *
 *   - **An upgrade that disarms somebody.** A settings record written before
 *     this feature has no `classes` key, and reading that absence as "no
 *     classes" would leave an operator who had alerts on with a console that
 *     quietly stopped interrupting them. Absence means everything; an empty
 *     list, which only an explicit choice produces, means nothing.
 *   - **A selection the panel misreports.** Every class unticked beside an
 *     enabled channel is a switch implying protection the tab cannot deliver
 *     (#314), so it has to read as nothing-will-alert rather than as armed.
 *
 * The pure half is what a stored selection means; the panel half is what an
 * operator can click and what the panel then says. Both live under
 * `tests/unit`, because that is the directory `npm test` gates and a component
 * test filed anywhere else is not part of CI.
 */

installDom();

type GuardContextValue = NonNullable<ContextType<typeof GuardContext>>;

const GUARD = "CAYJZT4XH5SWDXNR7MZJCCUBIDAT2KZDDUTZ7OZQEMKCPJGD4P3X4CU7";

let react: typeof import("react");
let createRoot: typeof import("react-dom/client").createRoot;
let act: Act;

before(async () => {
  const loaded = await loadReact();
  react = loaded.react;
  createRoot = loaded.createRoot;
  act = loaded.act;
});

afterEach(() => {
  document.body.innerHTML = "";
  window.localStorage.clear();
  window.sessionStorage.clear();
  delete (window as unknown as { Notification?: unknown }).Notification;
  delete (window as unknown as { AudioContext?: unknown }).AudioContext;
});

/** One event per alertable class, distinct by ledger so nothing dedupes away. */
function eventFor(reason: SecurityAlertReason, ledger: number): GuardEvent {
  return withIdentity({
    kind: reason === "blocked" ? "auth_checked" : reason,
    topic:
      reason === "blocked"
        ? "event_auth_checked"
        : reason === "frozen"
          ? "event_frozen"
          : "event_policy_revoked",
    source: "ledger",
    contractId: GUARD,
    ledger,
    ledgerClosedAt: "2026-09-25T12:00:00.000Z",
    transactionHash: `${ledger}`.padEnd(64, "0"),
    decision:
      reason === "blocked"
        ? { result: "blocked", reason: "per_tx_cap_exceeded", source: "ledger" }
        : null,
    data: {},
  });
}

function createMockStorage(initial: Record<string, string> = {}) {
  const map = new Map<string, string>(Object.entries(initial));
  return {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => void map.set(key, value),
    raw: () => map.get(ALERT_SETTINGS_STORAGE_KEY) ?? null,
  };
}

// ── The pure half: what a stored class selection means ─────────────────────

describe("the stored class selection", () => {
  it("round-trips exactly the classes the operator kept", () => {
    const storage = createMockStorage();
    saveAlertSettings(
      {
        ...DEFAULT_ALERT_SETTINGS,
        desktop: true,
        volume: 0.6,
        classes: ["blocked", "policy_revoked"],
      },
      storage,
    );

    const loaded = loadAlertSettings(storage);
    assert.deepEqual(loaded.classes, ["blocked", "policy_revoked"]);
    assert.equal(loaded.desktop, true);
    assert.equal(loaded.audio, false);
    assert.equal(loaded.volume, 0.6);
    assert.deepEqual(JSON.parse(storage.raw()!).classes, ["blocked", "policy_revoked"]);
  });

  it("keeps every class when the record predates the choice existing", () => {
    // The upgrade case, and the reason an absent key is not an empty array:
    // this is what the previous build left behind, and its owner had alerts on.
    const storage = createMockStorage({
      [ALERT_SETTINGS_STORAGE_KEY]: JSON.stringify({ audio: true, desktop: true, volume: 0.4 }),
    });
    const loaded = loadAlertSettings(storage);

    assert.deepEqual(loaded.classes, [...ALERT_REASON_ORDER]);
    assert.equal(alertsArmed(loaded), true);
    for (const reason of ALERT_REASON_ORDER) {
      assert.equal(alertClassEnabled(loaded, reason), true, `${reason} stays enabled`);
    }
  });

  it("keeps an empty selection empty, because that is a choice and not a gap", () => {
    const storage = createMockStorage({
      [ALERT_SETTINGS_STORAGE_KEY]: JSON.stringify({ audio: true, desktop: true, classes: [] }),
    });
    const loaded = loadAlertSettings(storage);

    assert.deepEqual(loaded.classes, []);
    assert.equal(
      alertsArmed(loaded),
      false,
      "both channels on with nothing selected cannot interrupt anyone",
    );
    assert.equal(alertClassEnabled(loaded, "blocked"), false);
  });

  it("writes one canonical order whatever sequence the classes arrived in", () => {
    const storage = createMockStorage();
    saveAlertSettings(
      { ...DEFAULT_ALERT_SETTINGS, audio: true, classes: ["policy_revoked", "blocked"] },
      storage,
    );
    assert.deepEqual(loadAlertSettings(storage).classes, ["blocked", "policy_revoked"]);
    assert.deepEqual(
      normalizeAlertSettings({ classes: ["frozen", "frozen", "blocked", "frozen"] }).classes,
      ["blocked", "frozen"],
      "a class listed twice is one selection, not three",
    );
  });

  it("validates every field independently against a hand-edited record", () => {
    // One bad entry has to cost the operator that entry and nothing else: the
    // channels they configured and the classes they kept are still theirs.
    const storage = createMockStorage({
      [ALERT_SETTINGS_STORAGE_KEY]:
        '{"audio":true,"desktop":false,"volume":0.75,' +
        '"classes":["frozen","quiet_hours",42,null,"blocked","frozen"]}',
    });
    const loaded = loadAlertSettings(storage);

    assert.equal(loaded.audio, true, "a valid channel survives next to an invalid class");
    assert.equal(loaded.desktop, false);
    assert.equal(loaded.volume, 0.75, "and a valid volume survives too");
    assert.deepEqual(loaded.classes, ["blocked", "frozen"]);
  });

  it("reads a classes value that is not a list as every class", () => {
    for (const value of ['"blocked"', "null", '{"0":"blocked"}', "0", "true"]) {
      const storage = createMockStorage({
        [ALERT_SETTINGS_STORAGE_KEY]: `{"audio":true,"classes":${value}}`,
      });
      assert.deepEqual(
        loadAlertSettings(storage).classes,
        [...ALERT_REASON_ORDER],
        `a non-array cannot mean "no classes", so it does not for ${value}`,
      );
    }
  });

  it("falls back to the defaults for storage that is not a settings record", () => {
    for (const value of ["{not json", "null", '"yes"', "[]", "{}"]) {
      const storage = createMockStorage({ [ALERT_SETTINGS_STORAGE_KEY]: value });
      const loaded = loadAlertSettings(storage);
      assert.equal(loaded.audio, false, `a corrupt record never enables a channel: ${value}`);
      assert.equal(loaded.desktop, false, `for ${value}`);
      assert.deepEqual(loaded.classes, [...ALERT_REASON_ORDER], `for ${value}`);
    }
  });

  it("defaults every class on while leaving both channels off", () => {
    // Both halves of the issue's first line, stated together: the classes are
    // opt-out and the channels are opt-in.
    assert.deepEqual(DEFAULT_ALERT_SETTINGS.classes, [...ALERT_REASON_ORDER]);
    assert.equal(DEFAULT_ALERT_SETTINGS.audio, false);
    assert.equal(DEFAULT_ALERT_SETTINGS.desktop, false);
    assert.equal(alertsArmed(DEFAULT_ALERT_SETTINGS), false);
    assert.deepEqual(normalizeAlertSettings(undefined).classes, [...ALERT_REASON_ORDER]);
  });
});

describe("the class vocabulary", () => {
  it("recognises only its own classes", () => {
    for (const reason of ALERT_REASON_ORDER) assert.equal(isSecurityAlertReason(reason), true);
    const notClasses = [
      "quiet_hours",
      "blocked ",
      "",
      "BLOCKED",
      0,
      null,
      undefined,
      {},
      ["frozen"],
    ];
    for (const value of notClasses) {
      assert.equal(isSecurityAlertReason(value), false, `${String(value)} is not a class`);
    }
  });

  it("says what each class is, so the choice is an informed one", () => {
    // A checkbox reading `frozen` is not a choice an operator can make on
    // purpose, so every class carries words saying what it interrupts for.
    for (const reason of ALERT_REASON_ORDER) {
      assert.ok(ALERT_CLASS_LABELS[reason].length > 0);
      assert.ok(ALERT_CLASS_HINTS[reason].length > 0);
    }
    assert.equal(new Set(ALERT_REASON_ORDER.map((reason) => ALERT_CLASS_LABELS[reason])).size, 3);
    assert.match(ALERT_CLASS_HINTS.blocked, /refused a call/i);
    assert.match(ALERT_CLASS_HINTS.frozen, /frozen by an admin|admin froze/i);
    assert.match(ALERT_CLASS_HINTS.policy_revoked, /revoked/i);
  });
});

// ── The panel half ─────────────────────────────────────────────────────────

interface NotificationCalls {
  prompts: number;
  titles: string[];
}

/** `window.Notification`, as the browser fakes are everywhere else in this suite. */
function installNotifications(
  init: { permission?: string; grantOnAsk?: boolean; throwOnShow?: boolean } = {},
): NotificationCalls {
  const calls: NotificationCalls = { prompts: 0, titles: [] };
  class FakeNotification {
    static permission = init.permission ?? "default";
    static requestPermission(): Promise<string> {
      calls.prompts += 1;
      if (init.grantOnAsk) FakeNotification.permission = "granted";
      return Promise.resolve(FakeNotification.permission);
    }
    constructor(title: string, _options: Record<string, unknown>) {
      if (init.throwOnShow) throw new Error("notifications disabled by enterprise policy");
      calls.titles.push(title);
    }
  }
  (window as unknown as { Notification?: unknown }).Notification = FakeNotification;
  return calls;
}

/**
 * `window.AudioContext`, counting the oscillators the panel schedules.
 *
 * A chime is `BEEP_COUNT` oscillators, which is enough to tell "never sounded"
 * apart from "sounded once" without a speaker being involved anywhere.
 */
function installFakeAudio(): { beeps: () => number } {
  let beeps = 0;
  class FakeAudioContext {
    readonly currentTime = 0;
    readonly destination = { id: "destination" };
    readonly state = "running";
    createOscillator() {
      beeps += 1;
      return {
        type: "square",
        frequency: { value: 0 },
        connect: () => undefined,
        start: () => undefined,
        stop: () => undefined,
      };
    }
    createGain() {
      return { gain: { value: 1 }, connect: () => undefined };
    }
    resume() {
      return Promise.resolve();
    }
  }
  (window as unknown as { AudioContext?: unknown }).AudioContext = FakeAudioContext;
  return { beeps: () => beeps };
}

interface MountOptions {
  events?: GuardEvent[];
  audio?: boolean;
  desktop?: boolean;
  volume?: number;
  /**
   * The stored selection. Omitting it writes a record with no `classes` key at
   * all, which is the shape a build from before #492 left behind.
   */
  classes?: SecurityAlertReason[];
}

async function mountPanel(options: MountOptions = {}) {
  window.localStorage.setItem(
    ALERT_SETTINGS_STORAGE_KEY,
    JSON.stringify({
      audio: options.audio ?? false,
      desktop: options.desktop ?? false,
      volume: options.volume ?? 0.4,
      ...(options.classes === undefined ? {} : { classes: options.classes }),
    }),
  );

  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);

  function contextFor(): GuardContextValue {
    return {
      guard: GUARD,
      instances: [],
      feed: {
        watching: true,
        latestLedger: 1_000,
        error: null,
        lastPolledAt: null,
        guards: [{ guard: GUARD, label: GUARD }],
        capped: 0,
        cappedLabels: [],
      },
      stream: { paused: false, pendingCount: 0, dropped: 0 },
      startWatching: () => {},
      stopWatching: () => {},
      clearEvents: () => {},
      pauseStream: () => {},
      resumeStream: () => {},
      queryRange: async () => {},
      rangeLabel: null,
    } as unknown as GuardContextValue;
  }

  /** A new poll page: always a fresh array of rows, as the live feed delivers. */
  async function poll(events: GuardEvent[]) {
    await act(async () => {
      root.render(
        react.createElement(
          GuardContext.Provider,
          { value: contextFor() },
          react.createElement(
            GuardEventsContext.Provider,
            { value: events },
            react.createElement(TelemetryAlerts),
          ),
        ),
      );
    });
    await act(async () => {
      await sleep(0);
    });
  }

  await poll(options.events ?? []);

  /** The panel's own checkbox for one class, found by the label it renders. */
  function classInput(reason: SecurityAlertReason): HTMLInputElement {
    const group = container.querySelector('[data-testid="alert-class-options"]');
    assert.ok(group, "the panel has to expose the per-class choices");
    const input = Array.from(group.querySelectorAll('input[type="checkbox"]')).find(
      (entry) => entry.getAttribute("aria-label") === ALERT_CLASS_LABELS[reason],
    );
    assert.ok(input, `expected a checkbox labelled ${ALERT_CLASS_LABELS[reason]}`);
    return input as HTMLInputElement;
  }

  return {
    container,
    poll,
    state(testid: string): string {
      return container.querySelector(`[data-testid="${testid}"]`)?.textContent ?? "";
    },
    /** The visible wording of the class group, for assertions about the choice. */
    classGroupText(): string {
      return container.querySelector('[data-testid="alert-class-options"]')?.textContent ?? "";
    },
    button(label: RegExp): HTMLButtonElement {
      const found = Array.from(container.querySelectorAll("button")).find((entry) =>
        label.test(entry.textContent ?? ""),
      );
      assert.ok(found, `expected a button labelled ${label}`);
      return found;
    },
    async click(label: RegExp) {
      await act(async () => {
        this.button(label).click();
        await sleep(0);
      });
    },
    async toggleClass(reason: SecurityAlertReason) {
      await act(async () => {
        classInput(reason).click();
        await sleep(0);
      });
    },
    classChecks(): { reason: SecurityAlertReason; checked: boolean }[] {
      return ALERT_REASON_ORDER.map((reason) => ({ reason, checked: classInput(reason).checked }));
    },
    classDisabled(reason: SecurityAlertReason): boolean {
      return classInput(reason).disabled;
    },
    /** The armed/off pill — the claim the panel makes about itself. */
    pill(): string {
      return container.querySelector(".pill")?.textContent ?? "";
    },
    /** What the panel wrote down, read back through the library's own loader. */
    stored(): AlertSettings {
      return loadAlertSettings();
    },
    async unmount() {
      await act(async () => {
        root.unmount();
      });
    },
  };
}

describe("the panel's per-class choices", () => {
  it("offers one opt-in per class, ticked, and saves the change", async () => {
    const panel = await mountPanel({ desktop: true });

    assert.deepEqual(
      panel.classChecks(),
      ALERT_REASON_ORDER.map((reason) => ({ reason, checked: true })),
      "every class starts ticked, in the declared order",
    );
    for (const reason of ALERT_REASON_ORDER) {
      assert.ok(
        panel.classGroupText().includes(ALERT_CLASS_LABELS[reason]),
        `the checkbox names ${reason}`,
      );
      assert.ok(panel.classGroupText().includes(ALERT_CLASS_HINTS[reason]), "and its own hint");
    }

    await panel.toggleClass("blocked");
    assert.deepEqual(panel.stored().classes, ["frozen", "policy_revoked"]);
    assert.deepEqual(panel.classChecks(), [
      { reason: "blocked", checked: false },
      { reason: "frozen", checked: true },
      { reason: "policy_revoked", checked: true },
    ]);

    // Unticking and re-ticking lands on the same stored selection rather than
    // on a reshuffled one that reads as a change.
    await panel.toggleClass("blocked");
    assert.deepEqual(panel.stored().classes, [...ALERT_REASON_ORDER]);
    await panel.unmount();
  });

  it("alerts for the class that is ticked and for nobody else", async () => {
    const calls = installNotifications({ permission: "granted" });
    const panel = await mountPanel({ desktop: true, classes: ["frozen"] });

    await panel.poll([eventFor("blocked", 100)]);
    assert.equal(calls.titles.length, 0, "a refusal whose class is off alerts nobody");
    assert.doesNotMatch(
      panel.container.textContent ?? "",
      /Last alert/i,
      "and it is not reported as an alert that did happen",
    );

    await panel.poll([eventFor("frozen", 101)]);
    assert.equal(calls.titles.length, 1, "a ticked class still gets through");
    assert.match(calls.titles[0]!, /account frozen/i);

    // The state line says what is covered instead of repeating the panel's
    // blanket description of all three classes.
    assert.match(panel.state("alert-class-state"), /account was frozen/i);
    assert.doesNotMatch(panel.state("alert-class-state"), /blocked/i);
    await panel.unmount();
  });

  it("interrupts for every class when the record predates the choice", async () => {
    // The upgrade case where an operator would notice: nothing was re-ticked,
    // so nothing may have gone quiet. `mountPanel` writes this record with no
    // `classes` key at all, which is the shape the previous build left behind.
    const calls = installNotifications({ permission: "granted" });
    const panel = await mountPanel({ desktop: true });

    await panel.poll([eventFor("blocked", 110)]);
    assert.equal(calls.titles.length, 1, "a refusal still interrupts after an upgrade");
    await panel.poll([eventFor("policy_revoked", 111)]);
    assert.equal(calls.titles.length, 2, "and so does every other class");

    // The record the panel writes back is the new shape with the same meaning:
    // a read of "everything" that persisted as "nothing" would disarm the tab
    // on the next load, which is the failure this test exists for.
    assert.deepEqual(panel.stored().classes, [...ALERT_REASON_ORDER]);
    await panel.unmount();
  });

  it("says nothing will alert when a channel is on but every class is off", async () => {
    const audio = installFakeAudio();
    const calls = installNotifications({ permission: "granted" });
    const panel = await mountPanel({ audio: false, desktop: true, classes: [] });

    // Arming the chime is also the gesture the browser needs, and that click
    // sounds once on its own. Everything after it is the feed's doing.
    await panel.click(/Enable chime/);
    const chimes = audio.beeps();
    assert.equal(chimes, BEEP_COUNT, "the click itself sounded the chime once");

    await panel.poll([eventFor("blocked", 120)]);
    await panel.poll([eventFor("frozen", 121), eventFor("policy_revoked", 122)]);
    assert.equal(audio.beeps(), chimes, "no class selected, so no chime for any of them");
    assert.equal(calls.titles.length, 0, "and no notification either");

    assert.match(panel.state("alert-class-state"), /nothing will alert/i);
    assert.equal(panel.pill(), "off", "the panel does not call this armed");
    await panel.unmount();
  });

  it("does not attempt a notification the browser has denied, however classes are ticked", async () => {
    const calls = installNotifications({ permission: "denied" });
    const panel = await mountPanel({ desktop: true, classes: ["frozen"] });

    await panel.toggleClass("blocked");
    assert.equal(
      panel.classDisabled("blocked"),
      false,
      "the browser denied the channel, not this choice",
    );
    assert.equal(panel.button(/notifications/).disabled, true);

    await panel.poll([eventFor("blocked", 130), eventFor("frozen", 131)]);
    assert.equal(calls.titles.length, 0, "a denied permission is never even attempted");
    assert.equal(calls.prompts, 0, "and ticking a class never re-prompts the browser");
    assert.match(panel.state("desktop-alert-state"), /blocked by the browser/i);
    assert.match(panel.state("notification-delivery"), /permission was not granted/i);
    await panel.unmount();
  });
});
