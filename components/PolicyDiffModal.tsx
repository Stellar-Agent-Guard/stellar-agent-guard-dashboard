"use client";

import { useRef } from "react";
import type { PolicyDiff, DiffEntry } from "../lib/guard/policyDiff.ts";
import { useGuard } from "./GuardProvider.tsx";
import { short } from "./bits.tsx";

const STATUS: Record<DiffEntry["status"], { sign: string; color: string; label: string }> = {
  added: { sign: "+", color: "#1a7f37", label: "added" },
  removed: { sign: "-", color: "#cf222e", label: "removed" },
  modified: { sign: "~", color: "#9a6700", label: "modified" },
  unchanged: { sign: "=", color: "#57606a", label: "unchanged" },
};

function renderValue(value: unknown): string {
  if (value === undefined || value === null) return "—";
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "boolean") return value ? "yes" : "no";
  if (Array.isArray(value)) {
    return value.length > 0 ? value.map(renderValue).join(", ") : "none";
  }
  return String(value);
}

/**
 * The last look an operator gets before a wallet prompt.
 *
 * `set_policy` is irreversible in the sense that matters: once signed, the new
 * caps are what the guard enforces. This renders the structured diff from
 * `lib/guard/policyDiff.ts` side by side and refuses to call `onConfirm` until
 * the operator has actually seen it.
 */
export function PolicyDiffModal({
  diff,
  expectedAccount,
  currentAccount,
  onConfirm,
  onCancel,
}: {
  diff: PolicyDiff;
  expectedAccount?: string | undefined;
  currentAccount?: string | undefined;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  let liveAddress: string | undefined = currentAccount;
  try {
    const guardContext = useGuard();
    liveAddress = currentAccount ?? guardContext.wallet?.address;
  } catch {
    // Rendered outside GuardProvider (e.g. isolated test)
  }

  const initialAccountRef = useRef<string | undefined>(expectedAccount ?? liveAddress);
  const targetAccount = expectedAccount ?? initialAccountRef.current;
  const accountChanged = Boolean(targetAccount && liveAddress && targetAccount !== liveAddress);

  const changes = diff.entries.filter((entry) => entry.status !== "unchanged");

  return (
    <div className="modal-backdrop" role="presentation" onClick={onCancel}>
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-label="Policy changes"
        onClick={(event) => event.stopPropagation()}
      >
        <h2 style={{ marginTop: 0 }}>Policy changes</h2>
        <p className="tiny muted">
          Review what will change before the wallet is prompted to sign. Signing installs the new
          policy and resets the rolling window.
        </p>

        {accountChanged && (
          <div
            className="notice warn"
            role="alert"
            data-testid="confirmation-account-changed"
            style={{ margin: "10px 0" }}
          >
            <strong>Active account changed during review</strong>
            <p className="tiny" style={{ margin: "4px 0" }}>
              The connected account changed from <span className="mono">{short(targetAccount!, 8, 6)}</span> to{" "}
              <span className="mono">{short(liveAddress!, 8, 6)}</span> while this confirmation was open.
              This policy change was prepared and simulated for the previous account.
            </p>
            <p className="tiny muted" style={{ margin: "4px 0" }}>
              <strong>Recovery:</strong> Cancel this confirmation to re-run policy review with the active account,
              or switch your wallet back to <span className="mono">{short(targetAccount!, 8, 6)}</span>.
            </p>
          </div>
        )}

        {diff.warnings.length > 0 && (
          <div
            className="warning-badge"
            role="alert"
            style={{
              background: "#fff8c5",
              border: "1px solid #d4a72c",
              padding: "8px 10px",
              margin: "10px 0",
            }}
          >
            {diff.warnings.map((warning, index) => (
              <div key={index}>⚠ {warning}</div>
            ))}
          </div>
        )}

        {changes.length === 0 ? (
          <p className="tiny">This policy is identical to the one currently installed.</p>
        ) : (
          <table className="diff-table" style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th style={{ textAlign: "left" }}>Field</th>
                <th style={{ textAlign: "left" }}>Current</th>
                <th style={{ textAlign: "left" }}>New</th>
              </tr>
            </thead>
            <tbody>
              {changes.map((entry) => {
                const status = STATUS[entry.status];
                return (
                  <tr key={entry.field} data-status={entry.status}>
                    <td>
                      <span
                        aria-hidden="true"
                        style={{ color: status.color, fontWeight: 700, marginRight: 6 }}
                      >
                        {status.sign}
                      </span>
                      {entry.field}
                      <span className="tiny muted"> ({status.label})</span>
                    </td>
                    <td className="mono tiny">{renderValue(entry.oldValue)}</td>
                    <td className="mono tiny">{renderValue(entry.newValue)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}

        <div className="row" style={{ marginTop: 14 }}>
          <button
            disabled={changes.length === 0 || accountChanged}
            onClick={() => {
              if (accountChanged) return;
              onConfirm();
            }}
          >
            Confirm and sign
          </button>
          <button className="secondary" onClick={onCancel}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
