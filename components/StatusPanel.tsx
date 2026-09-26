"use client";

import { useEffect, useSyncExternalStore } from "react";
import { deadManRemaining, describePolicy, isDeadManFrozen } from "stellar-agent-guard-sdk";
import { useGuard } from "./GuardProvider.tsx";
import { ErrorBlock, Read, Stat, relativeTime, short } from "./bits.tsx";
import { PHASE1_ARTIFACT, NETWORK } from "../lib/guard/network.ts";
import { compilePrintReport } from "../lib/guard/printReport.ts";
import {
  SCENARIO_LABELS,
  armScenario,
  describeSimulation,
  simulatedAlert,
  simulatedStatus,
  tickScenario,
  type SimulationScenario,
  type SimulationState,
} from "../lib/guard/dmsSimulator.ts";

/**
 * The guard's live state, every field read from the chain on each refresh.
 *
 * The two freezes are shown separately rather than as one "frozen" light,
 * because they have different causes and the same single reversal is worth
 * knowing about: an admin freeze is something the operator just did, while a
 * dead-man-switch freeze is the account having gone quiet. `unfreeze()` clears
 * both, which is why it sits next to the panic button.
 *
 * Incident Simulation Mode (rehearsal) overlays synthetic dead-man states on
 * this panel for training. The overlay is render-only: it wraps the same read
 * results in a `simulatedStatus` projection and stamps a striped watermark
 * across the panel, so no write path can be reached while it is active.
 */
export function StatusPanel() {
  const { snapshot, snapshotError, refreshing, refresh, guard, wallet } = useGuard();

  const printReport = snapshot ? compilePrintReport(snapshot, NETWORK.name, wallet?.address || "Disconnected") : null;

  return (
    <div className={`panel${useRehearsalActive() ? " sim-active" : ""}`}>
      <div className="row" style={{ justifyContent: "space-between" }}>
        <h2 style={{ margin: 0 }}>On-chain state</h2>

        <div className="row">
          {snapshot && <span className="tiny muted">read {relativeTime(snapshot.fetchedAt)}</span>}
          <button className="secondary no-print" onClick={() => window.print()}>
            Print Compliance Report
          </button>
          <button className="secondary no-print" onClick={() => void refresh()} disabled={refreshing}>
            {refreshing ? "Reading…" : "Refresh"}
          </button>
        </div>
      </div>

      <p className="tiny muted" style={{ marginTop: 10 }}>
        <span className="mono">{guard}</span>
      </p>

      <RehearsalModeToggle />

      {snapshotError && (
        <ErrorBlock
          title="The guard's state could not be read"
          detail={`${snapshotError} — no values are shown, because a failed read is not an empty policy.`}
        />
      )}

      {!snapshot && !snapshotError && <p className="muted tiny">Reading the chain…</p>}

      {snapshot && (
        <>
          <SimulatedDmsStats snapshot={snapshot} />

          <h3>Rolling window</h3>
          <Read
            result={snapshot.window}
            label="Window"
            render={(window) => {
              const policy = snapshot.policy.ok ? snapshot.policy.value : null;
              if (!window || !policy) {
                return (
                  <p className="tiny muted">No spend recorded yet in this policy&apos;s window.</p>
                );
              }
              const cap = policy.window_cap;
              const pct = cap > 0n ? Number((window.total * 100n) / cap) : null;
              return (
                <div className="grid">
                  <Stat label="Spent in window" value={window.total.toString()} note={pct === null ? "no window cap set" : `${pct}% of the ${cap} cap`} />
                  <Stat label="Window length" value={`${policy.window_secs}s`} note={`${window.entries.length} entry(ies) on the ledger`} />
                </div>
              );
            }}
          />

          <h3>Policy in force</h3>
          <Read
            result={snapshot.policy}
            label="policy()"
            render={(policy) =>
              policy === null ? (
                <p className="tiny muted">No policy installed — the account is in default-deny.</p>
              ) : (
                <>
                  <p className="tiny mono">{describePolicy(policy)}</p>
                  <div className="grid">
                    <Stat label="Per-transaction cap" value={policy.per_tx_cap === 0n ? "off" : policy.per_tx_cap.toString()} />
                    <Stat label="Rolling cap" value={policy.window_cap === 0n ? "off" : `${policy.window_cap} / ${policy.window_secs}s`} />
                    <Stat label="Assets" value={policy.assets.length} note="SAC tokens whose transfers are fully enforced" />
                    <Stat
                      label="Recipients"
                      value={policy.allow_any_recipient ? "any" : policy.recipients.length}
                      note={policy.allow_any_recipient ? "allowlist bypassed" : "allowlisted destinations"}
                    />
                    <Stat label="Protocols" value={policy.protocols.length} note="allowlisted non-asset contracts" />
                    <Stat
                      label="Account"
                      value={policy.paused ? "PAUSED" : "active"}
                      tone={policy.paused ? "warn" : undefined}
                      note={
                        policy.active_from === 0n && policy.active_until === 0n
                          ? "no active window"
                          : `active ${policy.active_from}–${policy.active_until}`
                      }
                    />
                  </div>
                </>
              )
            }
          />

          <h3>Artifact identity</h3>
          <Read
            result={snapshot.identity}
            label="wasm identity"
            render={(identity) => (
              <>
                <div className="grid">
                  <Stat
                    label="Ledger reports"
                    value={
                      <>
                        <span className="mono tiny no-print">{short(identity.reportedWasmHash ?? "-", 10, 6)}</span>
                        <span className="mono tiny print-only">{identity.reportedWasmHash ?? "-"}</span>
                      </>
                    }
                  />
                  <Stat
                    label="Fetched bytes hash to"
                    value={
                      <>
                        <span className="mono tiny no-print">{short(identity.fetchedSha256, 10, 6)}</span>
                        <span className="mono tiny print-only">{identity.fetchedSha256}</span>
                      </>
                    }
                  />
                  <Stat label="Bytecode size" value={identity.bytes} note="bytes" />
                  <Stat
                    label="Pinned Phase 1 artifact"
                    tone={identity.reportedWasmHash === PHASE1_ARTIFACT.wasmHash ? "ok" : "warn"}
                    value={
                      identity.reportedWasmHash === PHASE1_ARTIFACT.wasmHash
                        ? "match"
                        : "different artifact"
                    }
                    note={
                      identity.reportedWasmHash === PHASE1_ARTIFACT.wasmHash
                        ? "byte-for-byte the artifact Phase 1 proved"
                        : "this instance is not the artifact Phase 1 proved"
                    }
                  />
                </div>
              </>
            )}
          />
        </>
      )}

      {printReport && (
        <div className="print-only print-report">
          <h2>Compliance Audit Report</h2>
          <p><strong>Timestamp:</strong> {printReport.timestamp}</p>
          <p><strong>Network:</strong> {printReport.network}</p>
          <p><strong>Contract ID:</strong> <span className="mono">{printReport.contractId}</span></p>
          <p><strong>Bytecode Hash:</strong> <span className="mono">{printReport.bytecodeHash}</span></p>
          <p><strong>Admin Key:</strong> <span className="mono">{printReport.adminKey}</span></p>
          <p><strong>DMS Status:</strong> {printReport.dmsStatus}</p>
          <p><strong>Policy Rules:</strong> {printReport.policyRules}</p>
          <div>
            <strong>Allowlists:</strong>
            <ul>
              <li>Assets: {printReport.allowlists.assets.join(", ") || "None"}</li>
              <li>Recipients: {printReport.allowlists.recipients.join(", ") || "None"}</li>
              <li>Protocols: {printReport.allowlists.protocols.join(", ") || "None"}</li>
            </ul>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Rehearsal state lives in a module-scoped store rather than in StatusPanel's
 * own `useState`: the watermark must wrap the whole panel (so the toggle is
 * inside it) while the state belongs to the rehearsal, not to one render tree
 * position. `useSyncExternalStore` keeps the subscription explicit, and the
 * clock tick lives *in* the store — so every component renders purely from a
 * snapshot and no render ever reads a ref or the wall clock.
 */

interface RehearsalStore {
  active: boolean;
  scenario: SimulationScenario | null;
  startedAt: number | null;
  /** The store's own clock: when the tick loop last advanced, 0 when idle. */
  now: number;
}

const IDLE_REHEARSAL: RehearsalStore = { active: false, scenario: null, startedAt: null, now: 0 };

let rehearsal: RehearsalStore = IDLE_REHEARSAL;
const rehearsalListeners = new Set<() => void>();

function setRehearsal(next: RehearsalStore) {
  rehearsal = next;
  for (const listener of rehearsalListeners) listener();
}

export function startRehearsal(scenario: SimulationScenario, startedAt: number) {
  setRehearsal({ active: true, scenario, startedAt, now: startedAt });
}

export function stopRehearsal() {
  setRehearsal(IDLE_REHEARSAL);
}

/** Advance the store's clock; called from the tick interval, never render. */
function advanceRehearsal(now: number) {
  if (!rehearsal.active) return;
  setRehearsal({ ...rehearsal, now });
}

/** Test seam: read the store without a component. */
export function rehearsalState(): RehearsalStore {
  return rehearsal;
}

function subscribeRehearsal(onStoreChange: () => void): () => void {
  rehearsalListeners.add(onStoreChange);
  return () => rehearsalListeners.delete(onStoreChange);
}

function useRehearsalActive(): boolean {
  return useSyncExternalStore(subscribeRehearsal, () => rehearsal.active, () => false);
}

/** The rehearsal store snapshot; the server snapshot is the stable idle value. */
function useRehearsalStore(): RehearsalStore {
  return useSyncExternalStore(subscribeRehearsal, () => rehearsal, () => IDLE_REHEARSAL);
}

/**
 * The rehearsal toggle, shown only where a rehearsal makes sense.
 *
 * The issue scopes this to development/staging environments; production
 * deployments (where the button would train people against real money) never
 * render it. `NODE_ENV` is inlined by the Next.js build, so the toggle
 * disappears entirely from production bundles.
 */
function RehearsalModeToggle() {
  const store = useRehearsalStore();
  const isProd = process.env.NODE_ENV === "production";

  // The simulation's heartbeat: while a run is active, the store's clock
  // advances once per second, which re-renders exactly the components reading
  // the store. `Date.now()` only ever runs inside this interval callback, so
  // no render is impure.
  useEffect(() => {
    if (!store.active) return;
    const interval = window.setInterval(() => advanceRehearsal(Date.now()), 1000);
    return () => window.clearInterval(interval);
  }, [store.active]);

  if (isProd) return null;

  function start(scenario: SimulationScenario) {
    startRehearsal(scenario, Date.now());
  }

  return (
    <div className="sim-controls no-print" role="group" aria-label="Incident simulation (rehearsal) controls">
      <span className="tiny muted">Rehearsal mode:</span>
      {store.active ? (
        <button className="secondary" type="button" onClick={() => stopRehearsal()}>
          Stop simulation
        </button>
      ) : (
        <>
          <button className="secondary" type="button" onClick={() => start("expiring")} title={SCENARIO_LABELS.expiring}>
            Simulate DMS expiring
          </button>
          <button className="secondary" type="button" onClick={() => start("tripped")} title={SCENARIO_LABELS.tripped}>
            Simulate DMS tripped
          </button>
        </>
      )}
    </div>
  );
}

/**
 * The live DMS stats, real or simulated depending on rehearsal state.
 *
 * When the rehearsal is running, the store's clock advances once per second
 * (see the tick loop in `RehearsalModeToggle`) and this component renders from
 * that snapshot; every other Stat keeps rendering the real reads. The banner,
 * the alert line, and the watermark make it impossible to mistake the two.
 */
function SimulatedDmsStats({ snapshot }: { snapshot: NonNullable<ReturnType<typeof useGuard>["snapshot"]> }) {
  const store = useRehearsalStore();

  const status = snapshot.status.ok ? snapshot.status.value : null;
  if (!status) return <RealDmsStats snapshot={snapshot} />;

  if (!store.active || store.scenario === null || store.startedAt === null) {
    return <RealDmsStats snapshot={snapshot} />;
  }

  const state: SimulationState = tickScenario(store.scenario, store.startedAt, store.now);
  const simulated = simulatedStatus(status, state);
  const alert = simulatedAlert(state);

  return (
    <>
      <div className="sim-banner" role="status">
        <strong>TRAINING / SIMULATION MODE</strong>
        <span className="tiny">
          {describeSimulation(state)} — values below are synthetic; the chain is untouched.
        </span>
      </div>

      <div className="grid" style={{ marginTop: 12 }}>
        <Stat
          label="Admin freeze"
          tone={simulated.admin_frozen ? "danger" : "ok"}
          value={simulated.admin_frozen ? "FROZEN" : "clear"}
          note="Set by the panic button; cleared by unfreeze()"
        />
        <Stat
          label="Dead-man switch"
          tone={state.phase === "fired" ? "danger" : state.phase === "expired" ? "warn" : "ok"}
          value={state.phase === "fired" ? "FIRED" : state.phase === "expired" ? "expired" : "within grace"}
          note={
            <span className="sim-countdown">
              <span
                className="sim-bar"
                role="progressbar"
                aria-valuenow={Math.round(state.percentElapsed)}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-label="Simulated grace consumed"
                style={{ ["--sim-pct" as string]: `${state.percentElapsed}%` }}
              />
              <span className="tiny">
                {state.remaining > 0
                  ? `SIMULATED: ${Math.ceil(state.remaining)}s of grace left`
                  : state.phase === "expired"
                    ? "SIMULATED: grace elapsed; account refuses calls"
                    : "SIMULATED: FIRED"}
              </span>
            </span>
          }
        />
        <Stat
          label="Last heartbeat"
          value={simulated.last_heartbeat === 0n ? "never" : `${Number(simulated.last_heartbeat)} (simulated ledger time)`}
          note={`agent silent ${Math.round(state.elapsed)}s in this scenario`}
        />
        <Stat label="Policy installed" value={status.has_policy ? "yes" : "no — default deny"} note="With no policy the account refuses every call" />
      </div>

      <div className={`sim-alert ${alert.severity === "danger" ? "sim-alert-danger" : "sim-alert-warn"}`} aria-live="polite">
        <span className="tiny mono">{alert.message}</span>
      </div>

      <button className="secondary no-print" type="button" onClick={() => stopRehearsal()} style={{ marginTop: 8 }}>
        End simulation — return to live state
      </button>
    </>
  );
}

/** The untouched, real DMS stats — exactly what the panel showed before. */
function RealDmsStats({ snapshot }: { snapshot: NonNullable<ReturnType<typeof useGuard>["snapshot"]> }) {
  return (
    <div className="grid" style={{ marginTop: 12 }}>
      <Stat
        label="Admin freeze"
        tone={snapshot.status.ok ? (snapshot.status.value.admin_frozen ? "danger" : "ok") : undefined}
        value={
          <Read
            result={snapshot.status}
            label="status()"
            render={(status) => (status.admin_frozen ? "FROZEN" : "clear")}
          />
        }
        note="Set by the panic button; cleared by unfreeze()"
      />
      <Stat
        label="Dead-man switch"
        tone={snapshot.status.ok ? (snapshot.status.value.heartbeat_expired ? "danger" : "ok") : undefined}
        value={
          <Read
            result={snapshot.status}
            label="status()"
            render={(status) =>
              isDeadManFrozen(status) ? "FIRED" : status.heartbeat_expired ? "expired" : "within grace"
            }
          />
        }
        note={
          <Read
            result={snapshot.status}
            label="status()"
            render={(status) => {
              const policy = snapshot.policy.ok ? snapshot.policy.value : null;
              const remaining = deadManRemaining(status, policy);
              if (remaining === null) return "switch disabled (grace 0)";
              if (remaining < 0n) return "grace elapsed; account refuses calls";
              return `${remaining}s of grace left`;
            }}
          />
        }
      />
      <Stat
        label="Policy installed"
        value={<Read result={snapshot.status} label="status()" render={(s) => (s.has_policy ? "yes" : "no — default deny")} />}
        note="With no policy the account refuses every call"
      />
      <Stat
        label="Last heartbeat"
        value={
          <Read
            result={snapshot.status}
            label="status()"
            render={(status) =>
              status.last_heartbeat === 0n ? "never" : `${Number(status.last_heartbeat)} (ledger time)`
            }
          />
        }
        note="Written by the agent's own heartbeat(), not by this console"
      />
    </div>
  );
}
