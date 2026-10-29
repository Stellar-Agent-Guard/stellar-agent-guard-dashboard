"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { deadManRemaining, describePolicy, isDeadManFrozen } from "stellar-agent-guard-sdk";
import { useGuard } from "./GuardProvider.tsx";
import {
  ErrorBlock,
  Read,
  ReadSkeleton,
  ReadWithRetry,
  Skeleton,
  Stat,
  TimeAgo,
  WarningBanner,
  short,
} from "./bits.tsx";
import { INITIAL_GRID_LABELS, skeletonSpecFor } from "../lib/guard/statusReadState.ts";
import { CopyButton } from "./CopyButton.tsx";
import { StorageExplorerButton } from "./StorageExplorer.tsx";
import { WebhookAlertBridge } from "./WebhookAlertBridge.tsx";
import { WebhookSettingsButton } from "./WebhookSettings.tsx";
import { PHASE1_ARTIFACT, NETWORK } from "../lib/guard/network.ts";
import { buildReadDiagnostic } from "../lib/rpc/timeouts.ts";
import { configureHref } from "../lib/guard/deeplink.ts";
import { NO_POLICY_CONSEQUENCE, policyStateFrom } from "../lib/guard/policyState.ts";
import { compilePrintReport } from "../lib/guard/printReport.ts";
import {
  SCENARIO_LABELS,
  describeSimulation,
  simulatedAlert,
  simulatedStatus,
  tickScenario,
  type SimulationScenario,
  type SimulationState,
} from "../lib/guard/dmsSimulator.ts";
import { evaluateDmsAlert, formatDmsDuration, type DmsAlert } from "../lib/guard/dmsAlert.ts";
import { calculateVelocity } from "../lib/guard/velocity.ts";
import { useStatusTransitionAnnouncer } from "../lib/guard/statusTransitions.ts";
import { formatRawStroops as formatRemaining } from "../lib/guard/formatters.ts";
import { usePrivacy } from "../lib/guard/privacyStore.ts";

/**
 * The proactive dead-man-switch deadline banner, shown above the on-chain
 * state panel while the switch is counting down to its threshold.
 *
 * Escalates with the remaining grace — yellow warning, red pulsing critical,
 * dark red once tripped — and always states the full ledger-derived timeline:
 * remaining time, time since the last heartbeat, and the estimated calendar
 * moment of expiration. Every number comes from the snapshot's ledger clock,
 * never the browser's, because that is the clock the contract judges.
 */
function DmsAlertBanner({ alert }: { alert: DmsAlert }) {
  const details: string[] = [];
  if (alert.remainingSecs !== null && alert.totalSecs !== null) {
    const pct = Math.max(0, Math.round(alert.fractionRemaining! * 100));
    details.push(
      alert.level === "expired"
        ? `deadline missed by ${formatDmsDuration(-alert.remainingSecs)}`
        : `${formatDmsDuration(alert.remainingSecs)} of grace left (${pct}%)`,
    );
  }
  if (alert.elapsedSecs !== null) {
    details.push(`last heartbeat ${formatDmsDuration(Math.max(0, alert.elapsedSecs))} ago`);
  }
  if (alert.expiresAtMs !== null) {
    const prefix = alert.level === "expired" ? "deadline was ≈" : "expires ≈";
    details.push(`${prefix} ${new Date(alert.expiresAtMs).toLocaleString()}`);
  }

  const title =
    alert.level === "expired"
      ? "Dead-man switch expired — the agent missed its heartbeat; agent activity is blocked until the heartbeat resumes"
      : alert.level === "critical"
        ? "Dead-man switch critical — heartbeat deadline imminent"
        : "Dead-man switch warning — heartbeat deadline approaching";

  return (
    <div className={`dms-banner no-print ${alert.level}`} role="alert">
      <strong>{title}</strong>
      {details.length > 0 && <span className="detail">{details.join(" · ")}</span>}
    </div>
  );
}

/**
 * Copyable failure context (issue #347).
 *
 * A bare RPC error is hard to report and easy to over-share, so each failed read
 * contributes a four-line diagnostic — operation, endpoint origin, network and
 * correlation time — with signed payloads and credentials already removed by
 * the chain layer. It is a report about a failure, never a stand-in for a value.
 */
function ReadDiagnostics({ entries }: { entries: Array<{ label: string; text: string }> }) {
  if (entries.length === 0) return null;
  return (
    <section className="no-print" aria-label="Read diagnostics" style={{ marginTop: 16 }}>
      <h3 style={{ marginTop: 0 }}>
        Diagnostics for the failed {entries.length === 1 ? "read" : "reads"}
      </h3>
      <p className="tiny muted">
        Safe to paste into a report: the operation, endpoint origin, network and correlation time.
        Signed XDR, authorization payloads and key material are removed.
      </p>
      {entries.map((entry) => (
        <div key={entry.label} style={{ marginTop: 8 }}>
          <div className="row" style={{ justifyContent: "space-between" }}>
            <span className="tiny">{entry.label}</span>
            <CopyButton value={entry.text} label={`${entry.label} diagnostics`} />
          </div>
          <pre className="mono tiny" style={{ whiteSpace: "pre-wrap", margin: 0 }}>
            {entry.text}
          </pre>
        </div>
      ))}
    </section>
  );
}

/**
 * The guard's live state, every field read from the chain on each refresh.
 *
 * The two freezes are shown separately rather than as one "frozen" light,
 * because they have different causes and the same single reversal is worth
 * knowing about: an admin freeze is something the operator just did, while a
 * dead-man-switch freeze is the account having gone quiet. `unfreeze()` clears
 * both, which is why it sits next to the panic button.
 *
 * The no-policy state gets a banner of its own, for the opposite reason: it is
 * the one state that is safe and useless at the same time, and a quiet
 * `has_policy: false` line is what a fresh deploy (or a just-revoked policy)
 * looks like when the operator needs to know that nothing can move.
 *
 * Incident Simulation Mode (rehearsal) overlays synthetic dead-man states on
 * this panel for training. The overlay is render-only: it wraps the same read
 * results in a `simulatedStatus` projection and stamps a striped watermark
 * across the panel, so no write path can be reached while it is active.
 */
export function StatusPanel() {
  const { snapshot, snapshotError, refreshing, refresh, guard, wallet, retryRead, retryingField } =
    useGuard();

  useStatusTransitionAnnouncer(snapshot);

  const printReport = snapshot
    ? compilePrintReport(snapshot, NETWORK.name, wallet?.address || "Disconnected")
    : null;
  // Derived from this render's read, never from an event: a revoke done here, in
  // another tab, or by the agent's own tooling shows up on the next poll. An
  // unreadable `status()` yields `unknown`, which claims nothing.
  const policyState = policyStateFrom(snapshot?.status);

  // Proactive deadline alert: evaluated only from a successful status read (a
  // failed read must never fabricate a countdown), with a failed policy read
  // degrading to "no countdown numbers" rather than a guessed one.
  const dmsAlert =
    snapshot && snapshot.status.ok
      ? evaluateDmsAlert(snapshot.status.value, snapshot.policy.ok ? snapshot.policy.value : null)
      : null;

  // The panel is `aria-busy` exactly while the first read is in flight (no
  // snapshot yet, no failure yet). A background refresh is NOT busy: the values
  // on screen are the previous successful read (stale-while-revalidate), so
  // re-announcing "busy" on every poll would only be noise.
  const initialLoadPending = snapshot === null && snapshotError === null;

  // Watermark only: the panel gains the striped training tint while a rehearsal
  // is running. Read from the store as a snapshot, never as a ref.
  const rehearsalActive = useRehearsalActive();
  const { masked } = usePrivacy();

  // Safe failure context (issue #347). The chain layer attaches a diagnostic to
  // each failed read; a refresh that never produced a snapshot contributes one
  // built from the configured endpoint. Nothing here carries chain values, so a
  // diagnostic can never be mistaken for state.
  const readDiagnostics: Array<{ label: string; text: string }> = [];
  if (snapshot) {
    const results = [
      ["status()", snapshot.status],
      ["policy()", snapshot.policy],
      ["window", snapshot.window],
      ["wasm identity", snapshot.identity],
    ] as const;
    for (const [label, result] of results) {
      if (!result.ok && result.diagnostic) readDiagnostics.push({ label, text: result.diagnostic });
    }
  } else if (snapshotError) {
    readDiagnostics.push({
      label: "guard snapshot",
      text: buildReadDiagnostic({
        operation: "readSnapshot",
        endpoint: NETWORK.rpcUrl,
        network: NETWORK.name,
      }).text,
    });
  }

  return (
    <>
      {dmsAlert && dmsAlert.level !== "none" && <DmsAlertBanner alert={dmsAlert} />}
      <div
        className={`panel${rehearsalActive ? " sim-active" : ""}`}
        aria-busy={initialLoadPending}
      >
        <div className="row" style={{ justifyContent: "space-between" }}>
          <h2 style={{ margin: 0 }}>On-chain state</h2>

          <div className="row">
            {snapshot && (
              <span className="tiny muted">
                read <TimeAgo iso={snapshot.fetchedAt} />
              </span>
            )}
            <StorageExplorerButton />
            <WebhookSettingsButton />
            <WebhookAlertBridge />
            <button className="secondary no-print" onClick={() => window.print()}>
              Print Compliance Report
            </button>
            <button
              className="secondary no-print"
              onClick={() => void refresh()}
              disabled={refreshing}
            >
              {refreshing ? "Reading…" : "Refresh"}
            </button>
          </div>
        </div>

        <p className="tiny muted" style={{ marginTop: 10 }}>
          <span className="mono" aria-label={masked ? "Masked guard address" : undefined}>
            {masked ? "••••••••••••••••" : guard}
          </span>{" "}
          <CopyButton value={guard} label="guard address" />
        </p>

        <RehearsalModeToggle />

        {snapshotError && (
          <ErrorBlock
            title="The guard's state could not be read"
            detail={`${snapshotError} — no values are shown, because a failed read is not an empty policy.`}
          />
        )}

        {!snapshot && !snapshotError && (
          /* First-paint skeleton, before the first snapshot lands. The grid is
             shaped like the resolved one — same labels, same value/note slots
             (via skeletonSpecFor) — so the panel's height does not collapse
             and jump when the reads resolve. The placeholders carry no values:
             pending text is skeleton geometry, never a number (no fake zeros). */
          <div className="grid" style={{ marginTop: 12 }}>
            {INITIAL_GRID_LABELS.map((label) => (
              <div className="stat" key={label} aria-hidden="true">
                <div className="k">{label}</div>
                <div className="v">
                  <Skeleton lines={skeletonSpecFor(label).lines} />
                </div>
              </div>
            ))}
          </div>
        )}

        {policyState === "default-deny" && (
          <WarningBanner
            title="No policy installed — this account is in default-deny"
            action={
              <Link className="cta" href={configureHref(guard)}>
                Configure a policy for this account
              </Link>
            }
          >
            <span className="tiny">{NO_POLICY_CONSEQUENCE}</span>
          </WarningBanner>
        )}

        {snapshot && (
          <>
            <SimulatedDmsStats
              snapshot={snapshot}
              policyState={policyState}
              retryRead={retryRead}
              retryingField={retryingField}
            />

            <h3>Rolling window</h3>
            {retryingField === "window" && <ReadSkeleton label="window" />}
            <ReadWithRetry
              result={snapshot.window}
              label="Window"
              onRetry={() => retryRead("window")}
            />
          </>
        )}

        <ReadDiagnostics entries={readDiagnostics} />
      </div>
    </>
  );
}
