"use client";

import { useRef, useState } from "react";
import type { GuardStatus } from "stellar-agent-guard-sdk";
import type { rpc } from "@stellar/stellar-sdk";
import type { InvokeResult } from "../lib/guard/submit.ts";
import { freezeGuard, unfreezeGuard } from "../lib/guard/guardOps.ts";
import type { ReadResult } from "../lib/guard/chain.ts";
import { refusedEventsFromDiagnostics } from "../lib/guard/telemetry.ts";
import { useGuard } from "./GuardProvider.tsx";
import { WRITE_DISABLED_HINT, writeControlState } from "../lib/guard/observerMode.ts";
import { ErrorBlock, starLink } from "./bits.tsx";
import { freezeConfirmed, freezeFailed, writeFailureReason, type FreezeAction } from "../lib/guard/announceCopy.ts";
import { useModalFocus } from "../lib/guard/useModalFocus.ts";
import { noteVerifiedOutcome } from "../lib/guard/statusTransitions.ts";
import { announce } from "../lib/guard/useAnnounce.ts";

/**
 * The emergency panic button.
 *
 * The whole point of this panel is that "the UI said it worked" is not the
 * evidence. After a freeze it re-reads `status()` from the chain and shows what
 * the contract itself reports, and it refuses to claim success if the flag did
 * not actually change — a write that was signed and included but did not take
 * effect must not be reported as a freeze.
 *
 * That same reasoning decides what is spoken (issue #30). A screen-reader
 * operator cannot see the badge flip or the notice appear, so the verified
 * outcome is announced: the confirmation, or the failure *with its reason*,
 * which is the part that says whether the account is frozen right now. The write
 * path already announces the transaction itself; this is the announcement about
 * the effect. It leaves through the shell's live region by way of `announce()`,
 * so it survives the dialog being torn down by the very interaction that
 * produced it.
 */

type Phase = "idle" | "confirming" | "signing" | "verifying" | "done";

interface Report {
  action: "freeze" | "unfreeze";
  result: InvokeResult;
  /** `status()` re-read from the chain after the write. */
  adminFrozenAfter: boolean | null;
  /** True only when the re-read confirms the intended effect. */
  confirmed: boolean;
  note: string;
}

/**
 * The announcement for a write that has finished.
 *
 * The reason carried by a failure is whichever one explains it best: what the
 * enforced simulation refused and why, what the network rejected, or — for a
 * write that was included but changed nothing — the note saying the re-read
 * disagreed. "Freeze failed" on its own would leave a screen-reader operator
 * with less than the sighted operator can read, at the exact moment when the
 * only question is whether the account is frozen.
 */
function speakFreezeOutcome(
  action: FreezeAction,
  confirmed: boolean,
  note: string,
  result?: InvokeResult,
): void {
  const spoken = confirmed
    ? freezeConfirmed(action)
    : freezeFailed(action, result ? writeFailureReason(result, note) : note);
  announce(spoken.message, spoken.priority);
}

/**
 * The chain operations this panel drives.
 *
 * Injected rather than imported straight into the handler so the a11y
 * behaviour can be asserted without a wallet or a network: the ordering that
 * matters (announce the result, then let the dialog close and restore focus)
 * is a property of the panel, not of the chain, and it is testable only if the
 * chain behind it can be replaced. Defaults are the real operations, so the
 * console's own pages — and the end-to-end specs that drive them — run the
 * production path unchanged. Same seam discipline as the perf harness's
 * `__guardFeedInject` and `pollFleet`'s `_readSnapshot`.
 */
export interface PanicPanelOps {
  freeze: typeof freezeGuard;
  unfreeze: typeof unfreezeGuard;
  readStatus: (
    server: rpc.Server,
    guard: string,
    source?: string,
  ) => Promise<ReadResult<GuardStatus>>;
}

const DEFAULT_OPS: PanicPanelOps = {
  freeze: freezeGuard,
  unfreeze: unfreezeGuard,
  // Dynamic, as before: `chain.ts` is not needed until a write is verified, and
  // keeping it out of the panel's first-paint graph is the point of the import.
  readStatus: async (server, guard, source) =>
    (await import("../lib/guard/chain.ts")).readStatus(server, guard, source),
};

export function PanicPanel({ ops }: { ops?: Partial<PanicPanelOps> }) {
  const { signer, guard, server, refresh, snapshot, pushEvents, wallet, notifyTabs } = useGuard();
  const { freeze, unfreeze, readStatus: readStatusAfter } = { ...DEFAULT_OPS, ...ops };
  const [phase, setPhase] = useState<Phase>("idle");
  const [report, setReport] = useState<Report | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [acknowledged, setAcknowledged] = useState(false);

  const dialogRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const confirming = phase === "confirming";

  // Focus management for the confirmation dialog: move focus in on open, keep
  // Tab cycling inside it, close on Escape, and restore focus to the trigger
  // whenever the dialog goes away. Without this a modal is either a keyboard
  // trap (focus escapes into the page behind it) or a dead end (focus lands
  // nowhere on dismissal) — both fail WCAG 2.1 AA keyboard requirements.
  useModalFocus({
    open: confirming,
    containerRef: dialogRef,
    returnFocusRef: triggerRef,
    onDismiss: () => {
      setPhase("idle");
      setAcknowledged(false);
    },
  });

  const alreadyFrozen = snapshot?.status.ok ? snapshot.status.value.admin_frozen : null;
  // The panic button is the write an operator reaches for under pressure, so an
  // inert one has to say why in the same words as every other control (#101).
  const freezeControl = writeControlState(wallet, {
    extraDisabled: alreadyFrozen === true,
    label: "freeze this account",
  });
  const unfreezeControl = writeControlState(wallet, {
    extraDisabled: alreadyFrozen === false,
    label: "unfreeze this account",
  });

  async function run(action: FreezeAction, exportOnly = false) {
    setError(null);
    setReport(null);
    setPhase("signing");
    try {
      const walletSigner = signer();
      const result =
        action === "freeze"
          ? await freeze({ server, signer: walletSigner, guard, exportOnly })
          : await unfreeze({ server, signer: walletSigner, guard, exportOnly });

      // Surface any refused-decision diagnostics the write produced, so a refusal
      // appears in the feed rather than only in this panel.
      if (result.kind === "refused") {
        pushEvents(refusedEventsFromDiagnostics(result.diagnosticEvents, guard));
      }

      if (result.kind === "exported") {
        setReport({
          action,
          result,
          adminFrozenAfter: null,
          confirmed: false,
          note: "Transaction XDR exported for offline signing"
        });
        setPhase("done");
        return;
      }

      // Re-read the contract's own view. This is the step that makes the claim
      // real: the UI is not the source of truth, `status()` is.
      setPhase("verifying");
      const after = await readStatusAfter(server, guard, wallet?.address);
      const adminFrozenAfter = after.ok ? after.value.admin_frozen : null;
      const expected = action === "freeze";
      const confirmed = adminFrozenAfter !== null && adminFrozenAfter === expected;
      const note = !after.ok
        ? `the write returned, but status() could not be re-read to confirm its effect: ${after.error}`
        : confirmed
          ? `status().admin_frozen now reads ${adminFrozenAfter}, which is the ${action} taking effect`
          : `status().admin_frozen reads ${adminFrozenAfter} — the intended effect is NOT visible on chain`;

      setReport({ action, result, adminFrozenAfter, confirmed, note });

      // Announced before the phase change that closes the dialog, so the message
      // is already in the shell's queue when the dialog is torn down and focus
      // moves back to the trigger. A write that was included but did not take
      // effect is announced as the failure it is, with the reason.
      speakFreezeOutcome(action, confirmed, note, result);
      if (confirmed) {
        // The effect is now on chain and has been announced. Recorded so the
        // next poll does not repeat the same fact back at the operator — and
        // recorded *only* when confirmed, so a freeze that lands anyway after a
        // failed write is still announced when the poll finds it.
        noteVerifiedOutcome({ adminFrozen: expected });
      }

      setPhase("done");
      // Only a broadcast write can have moved the chain. Tell the other tabs so
      // they re-read instead of showing the pre-freeze world for up to a poll
      // interval — the one delay that matters when the agent is misbehaving.
      if (result.kind === "submitted") notifyTabs("FREEZE_STATE_CHANGED", { payload: { action } });
      await refresh();
    } catch (caught) {
      const detail = caught instanceof Error ? caught.message : String(caught);
      setError(detail);
      // The dialog is about to reopen in its idle state, so the failure has to be
      // spoken now: nothing else on screen will change once focus is restored.
      speakFreezeOutcome(action, false, detail);
      setPhase("idle");
      setAcknowledged(false);
    }
  }

  return (
    <div className="panel">
      <h2>Emergency</h2>

      <p className="tiny muted">
        Freezing sets the account&apos;s admin freeze, after which <code>__check_auth</code> refuses
        every call the account would make — the agent stops being able to move anything. The freeze is
        reversible: <code>unfreeze()</code> clears it and restarts the heartbeat clock, so it is also
        the way back from a dead-man-switch freeze.
      </p>

      {alreadyFrozen !== null && (
        <p className="tiny">
          Chain currently reports:{" "}
          {alreadyFrozen ? <span className="pill danger">FROZEN</span> : <span className="pill ok">clear</span>}
        </p>
      )}

      {!wallet && (
        <p className="tiny muted" data-testid="observer-notice">
          {WRITE_DISABLED_HINT}: freeze, unfreeze and heartbeat are all signed writes.
        </p>
      )}

      {phase !== "confirming" && (
        <div className="row" style={{ marginTop: 12 }}>
          <button
            className="danger"
            ref={triggerRef}
            disabled={freezeControl.disabled}
            title={freezeControl.title}
            onClick={() => {
              setAcknowledged(false);
              setPhase("confirming");
              setReport(null);
            }}
          >
            Freeze this account
          </button>
          <button
            className="secondary"
            disabled={unfreezeControl.disabled}
            title={unfreezeControl.title}
            onClick={() => void run("unfreeze")}
          >
            Unfreeze
          </button>
          <button
            className="secondary"
            disabled={unfreezeControl.disabled}
            title={unfreezeControl.title}
            onClick={() => void run("unfreeze", true)}
          >
            Export Unfreeze XDR
          </button>
        </div>
      )}

      {phase === "confirming" && (
        <div className="modal-backdrop">
          <div
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="freeze-confirm-title"
            ref={dialogRef}
            tabIndex={-1}
          >
            <strong id="freeze-confirm-title">
              Confirm the freeze — this stops the agent immediately
            </strong>
            <p className="tiny">
              The agent will not be able to make any call that requires its authorization until the
              account is unfrozen. This will prompt your wallet to sign an <code>unfreeze</code>-able{" "}
              <code>freeze()</code> call on{" "}
              <span className="mono">{guard.slice(0, 10)}…</span>.
            </p>
            <div className="checkline">
              <input
                id="ack-freeze"
                type="checkbox"
                checked={acknowledged}
                onChange={(event) => setAcknowledged(event.target.checked)}
              />
              <label htmlFor="ack-freeze">
                I understand this halts the agent&apos;s spending, and that undoing it needs a second
                signed <code>unfreeze()</code>.
              </label>
            </div>
            <div className="row">
              <button className="danger" disabled={!acknowledged} onClick={() => void run("freeze")}>
                Sign freeze
              </button>
              <button className="secondary" disabled={!acknowledged} onClick={() => void run("freeze", true)}>
                Export XDR
              </button>
              <button className="secondary" onClick={() => setPhase("idle")}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {(phase === "signing" || phase === "verifying") && (
        <div className="notice info">
          <strong>{phase === "signing" ? "Waiting for the wallet…" : "Verifying on chain…"}</strong>
          <span className="tiny">
            {phase === "signing"
              ? "Two signatures may be requested: one for the authorization entry, one for the transaction envelope."
              : "Re-reading status() to confirm the account's own view changed."}
          </span>
        </div>
      )}

      {error && <ErrorBlock title="The freeze could not be completed" detail={error} />}

      {report?.result.kind === "exported" && (
        <div className="modal-backdrop" onClick={() => { setReport(null); setPhase("idle"); }}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px" }}>
              <h2 style={{ margin: 0 }}>Exported Transaction XDR</h2>
              <button className="secondary" onClick={() => { setReport(null); setPhase("idle"); }}>Close</button>
            </div>
            <p className="tiny" style={{ marginBottom: "16px" }}>
              This unsigned transaction envelope is ready for external multi-sig signing.
            </p>
            <textarea
              readOnly
              value={report.result.kind === "exported" ? report.result.xdr : ""}
              style={{ width: "100%", height: "120px", marginBottom: "16px", fontSize: "12px", fontFamily: "monospace" }}
            />
            <div className="row">
              <button onClick={() => navigator.clipboard.writeText(report.result.kind === "exported" ? report.result.xdr : "")}>Copy to Clipboard</button>
              <button
                onClick={() => {
                  const blob = new Blob([report.result.kind === "exported" ? report.result.xdr : ""], { type: "text/plain" });
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement("a");
                  a.href = url;
                  a.download = `unsigned-${report.action}-${Date.now()}.tx`;
                  a.click();
                  URL.revokeObjectURL(url);
                }}
              >
                Download .tx
              </button>
            </div>
          </div>
        </div>
      )}

      {report && report.result.kind !== "exported" && (
        <div className={report.confirmed ? "notice info" : "error"}>
          <strong>
            {report.confirmed
              ? `${report.action === "freeze" ? "Freeze" : "Unfreeze"} confirmed on chain`
              : `${report.action === "freeze" ? "Freeze" : "Unfreeze"} NOT confirmed`}
          </strong>
          <span className="tiny">{report.note}</span>

          {report.result.kind === "submitted" && (
            <p className="tiny" style={{ marginTop: 6 }}>
              transaction {starLink(report.result.hash)} · included in ledger{" "}
              {report.result.ledger ?? "—"}
            </p>
          )}
          {report.result.kind === "refused" && (
            <p className="tiny" style={{ marginTop: 6 }}>
              Nothing was broadcast. Refused during {report.result.stage}:{" "}
              <span className="mono">{report.result.detail}</span>
            </p>
          )}
          {report.result.kind === "failed" && (
            <p className="tiny" style={{ marginTop: 6 }}>
              Transaction {starLink(report.result.hash)} was included and rejected:{" "}
              <span className="mono">{report.result.detail}</span>
            </p>
          )}

          {report.result.kind !== "submitted" && (
            <p className="tiny muted" style={{ marginTop: 6 }}>
              A refused call has no transaction hash by construction — it was never broadcast. That is
              the pre-flight path working, not a missing receipt.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
