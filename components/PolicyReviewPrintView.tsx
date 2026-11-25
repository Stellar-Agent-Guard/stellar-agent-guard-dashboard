"use client";

import { useEffect, useRef } from "react";
import type { PolicyDraft } from "../lib/guard/policyForm.ts";
import { buildPolicyConfig } from "../lib/guard/policyForm.ts";
import { buildPolicyReviewModel } from "../lib/guard/policyReview.ts";

export interface PolicyReviewPrintViewProps {
  draft: PolicyDraft;
  guard: string;
  network: string;
  validationOverride?: ReturnType<typeof buildPolicyConfig>;
  onClose: () => void;
}

/**
 * Read-only, printable proposed policy review view.
 *
 * Designed for reviewers and auditors to inspect proposed smart account guardrail
 * configurations before wallet authorization or chain submission.
 *
 * Key guarantees:
 * - Prominently stamped as "DRAFT - NOT SUBMITTED"
 * - Displays draft configuration, network target, guard address, and validation status
 * - Omits all editable form controls (no inputs, textareas, or modification controls)
 * - Omits all wallet and session data (no private keys, signer tokens, or custodial data)
 * - Optimized for clean print and PDF export via @media print styles
 */
export function PolicyReviewPrintView({
  draft,
  guard,
  network,
  validationOverride,
  onClose,
}: PolicyReviewPrintViewProps) {
  const model = buildPolicyReviewModel(draft, guard, network, validationOverride);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  return (
    <div
      className="modal-backdrop policy-review-print-backdrop"
      role="presentation"
      onClick={onClose}
    >
      <div
        className="modal policy-review-print-modal"
        role="dialog"
        aria-modal="true"
        aria-label="Read-only policy review"
        ref={containerRef}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Print controls (hidden during print) */}
        <div
          className="policy-review-actions no-print row"
          style={{ justifyContent: "space-between", marginBottom: 16 }}
        >
          <div className="row" style={{ gap: 8 }}>
            <button
              type="button"
              onClick={() => window.print()}
              title="Print or save as PDF"
              aria-label="Print review"
            >
              Print / Save PDF
            </button>
            <button
              type="button"
              className="secondary"
              onClick={onClose}
              title="Close review"
              aria-label="Close review"
            >
              Close
            </button>
          </div>
          <span className="tiny muted">Press Esc to close</span>
        </div>

        {/* Printable Document Container */}
        <article className="policy-review-document" data-testid="policy-review-document">
          {/* Draft Watermark & Title Header */}
          <header className="policy-review-header">
            <div className="policy-review-draft-badge" data-testid="draft-label" role="status">
              {model.draftLabel}
            </div>
            <h1 style={{ margin: "12px 0 4px", fontSize: "1.4rem" }}>Proposed Policy Review</h1>
            <p className="tiny muted" style={{ margin: 0 }}>
              Read-only pre-flight inspection of guardrail configuration. No transaction has been
              submitted.
            </p>
          </header>

          {/* Metadata Grid: Guard, Network, Validation Status, Timestamp */}
          <section className="policy-review-meta-grid" aria-label="Review Metadata">
            <div className="meta-cell">
              <span className="meta-label">Target Network</span>
              <span className="meta-value" data-testid="review-network">
                {model.network}
              </span>
            </div>
            <div className="meta-cell">
              <span className="meta-label">Guard Address</span>
              <span className="meta-value mono tiny" data-testid="review-guard">
                {model.guardAddress}
              </span>
            </div>
            <div className="meta-cell">
              <span className="meta-label">Validation Status</span>
              <span
                className={`meta-value pill ${model.validation.ok ? "ok" : "danger"}`}
                data-testid="review-validation-status"
              >
                {model.validation.statusText}
              </span>
            </div>
            <div className="meta-cell">
              <span className="meta-label">Review Generated</span>
              <span className="meta-value tiny muted">{model.generatedAt}</span>
            </div>
          </section>

          {/* Validation Issues (if invalid) */}
          {!model.validation.ok && model.validation.issues.length > 0 && (
            <section className="notice danger policy-review-issues" role="alert">
              <strong>Validation Issues (Refused Prior to Signing)</strong>
              <ul style={{ margin: "6px 0 0 16px", padding: 0 }}>
                {model.validation.issues.map((issue) => (
                  <li key={`${issue.field}-${issue.message}`} className="tiny">
                    <strong>{issue.field}:</strong> {issue.message}
                  </li>
                ))}
              </ul>
            </section>
          )}

          {/* Plain-language Summary */}
          <section className="policy-review-section">
            <h2 className="section-title">Operational Summary</h2>
            <p className="mono tiny policy-summary-box">{model.summary}</p>
          </section>

          {/* Spending Caps & Rate Limits */}
          <section className="policy-review-section">
            <h2 className="section-title">Spending Caps & Rate Limits</h2>
            <table className="review-table">
              <thead>
                <tr>
                  <th>Limit Rule</th>
                  <th>Configured Value</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {model.spendingCaps.map((cap) => (
                  <tr key={cap.label}>
                    <td>
                      <strong>{cap.label}</strong>
                    </td>
                    <td className="mono tiny">{cap.value}</td>
                    <td>
                      <span className={`pill ${cap.status === "valid" ? "ok" : "neutral"}`}>
                        {cap.status === "valid" ? "Enforced" : "Uncapped"}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>

          {/* Heartbeat & Inactivity Dead-Man Switch */}
          <section className="policy-review-section">
            <h2 className="section-title">Heartbeat & Liveness Safety</h2>
            <table className="review-table">
              <thead>
                <tr>
                  <th>Safety Control</th>
                  <th>Configured Value</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {model.inactivity.map((item) => (
                  <tr key={item.label}>
                    <td>
                      <strong>{item.label}</strong>
                    </td>
                    <td className="mono tiny">{item.value}</td>
                    <td>
                      <span className={`pill ${item.status === "valid" ? "ok" : "neutral"}`}>
                        {item.status === "valid" ? "Monitored" : "Disabled"}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>

          {/* Execution Time Boundaries */}
          <section className="policy-review-section">
            <h2 className="section-title">Execution Interval Bounds</h2>
            <table className="review-table">
              <thead>
                <tr>
                  <th>Boundary</th>
                  <th>Epoch Timestamp</th>
                </tr>
              </thead>
              <tbody>
                {model.activeWindow.map((win) => (
                  <tr key={win.label}>
                    <td>
                      <strong>{win.label}</strong>
                    </td>
                    <td className="mono tiny">{win.value}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>

          {/* Allowlists: Recipients, Assets, Protocols */}
          <section className="policy-review-section">
            <h2 className="section-title">Recipient Controls</h2>
            {model.allowlists.allowAnyRecipient ? (
              <p className="tiny">
                <span className="pill warn">Unrestricted Recipients</span> SAC transfers may target
                any destination account; spend caps still apply.
              </p>
            ) : model.allowlists.recipients.length > 0 ? (
              <ul className="review-list mono tiny">
                {model.allowlists.recipients.map((recipient, i) => (
                  <li key={`${recipient}-${i}`}>{recipient}</li>
                ))}
              </ul>
            ) : (
              <p className="tiny muted">
                No recipients allowlisted (Default Deny: SAC transfers locked out).
              </p>
            )}
          </section>

          <section className="policy-review-section">
            <h2 className="section-title">Asset Contracts & Cap Overrides</h2>
            {model.allowlists.assets.length > 0 ? (
              <div style={{ marginBottom: 10 }}>
                <span className="lbl tiny">Base SAC Token Contracts:</span>
                <ul className="review-list mono tiny">
                  {model.allowlists.assets.map((asset, i) => (
                    <li key={`${asset}-${i}`}>{asset}</li>
                  ))}
                </ul>
              </div>
            ) : (
              <p className="tiny muted">No base assets declared.</p>
            )}

            {model.allowlists.assetCaps.length > 0 && (
              <table className="review-table" style={{ marginTop: 8 }}>
                <thead>
                  <tr>
                    <th>Asset Contract Address</th>
                    <th>Max Cap (Stroops)</th>
                    <th>Symbol</th>
                  </tr>
                </thead>
                <tbody>
                  {model.allowlists.assetCaps.map((override, i) => (
                    <tr key={`${override.contract}-${i}`}>
                      <td className="mono tiny">{override.contract}</td>
                      <td className="mono tiny">{override.maxCapStroops}</td>
                      <td>{override.symbol || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>

          <section className="policy-review-section">
            <h2 className="section-title">Protocol & Contract Method Allowlists</h2>
            {model.allowlists.protocols.length > 0 ? (
              <ul className="review-list mono tiny">
                {model.allowlists.protocols.map((protocol, i) => (
                  <li key={`${protocol}-${i}`}>{protocol}</li>
                ))}
              </ul>
            ) : (
              <p className="tiny muted">
                No external protocols allowlisted (arbitrary contract calls denied).
              </p>
            )}
          </section>

          <section className="policy-review-section">
            <h2 className="section-title">Initial Execution State</h2>
            <p className="tiny">
              State on install:{" "}
              {model.operationalState.pausedOnInstall ? (
                <span className="pill warn">Start Paused (Refuses calls until resumed)</span>
              ) : (
                <span className="pill ok">Active (Operational immediately upon install)</span>
              )}
            </p>
          </section>

          {/* Compliance & Attestation Notice */}
          <footer className="policy-review-footer tiny muted">
            <p style={{ margin: "16px 0 4px" }}>
              <strong>Notice:</strong> This document represents an uncommitted policy draft
              generated in the Stellar Agent Guard Console. It does not certify on-chain
              installation or signature validity. Wallet addresses and session keys are excluded
              from this record.
            </p>
          </footer>
        </article>
      </div>
    </div>
  );
}
