"use client";

import { useEffect, useRef } from "react";
import { short } from "./bits.tsx";
import { CopyButton } from "./CopyButton.tsx";
import { announce } from "../lib/guard/useAnnounce.ts";
import {
  validatePendingActionBinding,
  type PendingActionSnapshot,
} from "../lib/guard/walletConnector.ts";

export interface PendingActionSummaryProps {
  snapshot: PendingActionSnapshot;
  currentAccount?: string | null;
  currentNetwork?: string;
  onCancel?: (reason: string) => void;
  className?: string;
}

/**
 * Renders the bound signer account, copy action, and network for every pending action approval.
 * Automatically verifies account binding and cancels the action safely if the account or network moves.
 */
export function PendingActionSummary({
  snapshot,
  currentAccount,
  currentNetwork,
  onCancel,
  className = "",
}: PendingActionSummaryProps) {
  const cancelledRef = useRef(false);

  useEffect(() => {
    if (cancelledRef.current) return;
    const validation = validatePendingActionBinding(snapshot, currentAccount, currentNetwork);
    if (!validation.valid && validation.reason) {
      cancelledRef.current = true;
      announce(validation.reason, "assertive");
      onCancel?.(validation.reason);
    }
  }, [snapshot, currentAccount, currentNetwork, onCancel]);

  return (
    <div
      className={`pending-action-summary panel-sub ${className}`}
      data-testid="pending-action-summary"
      role="region"
      aria-label="Pending action signer summary"
      style={{
        marginTop: 8,
        marginBottom: 8,
        padding: "8px 12px",
        borderRadius: "4px",
        background: "var(--bg-subtle, rgba(255, 255, 255, 0.05))",
        border: "1px solid var(--border-subtle, rgba(255, 255, 255, 0.1))",
      }}
    >
      <div
        className="row"
        style={{ alignItems: "center", justifyContent: "space-between", gap: 8 }}
      >
        <span className="tiny muted" style={{ fontWeight: 600 }}>
          Signer for <strong data-testid="pending-action-name">{snapshot.actionName}</strong>:
        </span>
        <span className="pill" data-testid="pending-network">
          {snapshot.network}
        </span>
      </div>

      <div className="row" style={{ alignItems: "center", gap: 8, marginTop: 4 }}>
        <code
          className="mono"
          data-testid="pending-account"
          title={snapshot.account}
          style={{ fontSize: "13px" }}
        >
          {short(snapshot.account, 6, 4)}
        </code>
        <CopyButton value={snapshot.account} label="signer account" className="secondary" />
      </div>
    </div>
  );
}
