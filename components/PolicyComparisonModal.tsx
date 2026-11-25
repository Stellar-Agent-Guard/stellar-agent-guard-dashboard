"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { PolicyConfig } from "stellar-agent-guard-sdk";
import {
  comparePolicyProfiles,
  type DiffEntry,
  type PolicyProfile,
} from "../lib/guard/policyDiff.ts";
import { POLICY_PRESETS } from "../lib/guard/presets.ts";

export interface PolicyComparisonModalProps {
  currentDraftConfig?: PolicyConfig | null;
  installedConfig?: PolicyConfig | null;
  activeGuard: string;
  activeNetwork: string;
  onClose: () => void;
}

const STATUS_META: Record<
  DiffEntry["status"],
  { sign: string; color: string; label: string; pillClass: string }
> = {
  added: { sign: "+", color: "var(--ok, #1a7f37)", label: "added", pillClass: "ok" },
  removed: { sign: "-", color: "var(--danger, #cf222e)", label: "removed", pillClass: "danger" },
  modified: { sign: "~", color: "var(--warn, #9a6700)", label: "modified", pillClass: "warn" },
  unchanged: {
    sign: "=",
    color: "var(--muted, #57606a)",
    label: "unchanged",
    pillClass: "neutral",
  },
};

function formatValue(val: unknown): string {
  if (val === undefined || val === null) return "—";
  if (typeof val === "bigint") return val.toString();
  if (typeof val === "boolean") return val ? "true" : "false";
  if (Array.isArray(val)) {
    if (val.length === 0) return "none";
    return val
      .map((item) => {
        if (typeof item === "object" && item !== null && "contract" in item) {
          const c = item as { contract: string; fns?: string[] };
          return c.fns && c.fns.length > 0 ? `${c.contract}:(${c.fns.join(",")})` : c.contract;
        }
        return String(item);
      })
      .join(", ");
  }
  return String(val);
}

/**
 * Side-by-side policy profile comparison modal.
 *
 * Enables operators and security teams to inspect differences across policy configurations,
 * archetypes, or environments without applying either profile and without any RPC writes.
 */
export function PolicyComparisonModal({
  currentDraftConfig,
  installedConfig,
  activeGuard,
  activeNetwork,
  onClose,
}: PolicyComparisonModalProps) {
  const modalRef = useRef<HTMLDivElement>(null);

  // Keyboard accessibility: Escape to dismiss
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  // Available comparison profiles
  const profiles: PolicyProfile[] = useMemo(() => {
    const list: PolicyProfile[] = [];

    if (currentDraftConfig) {
      list.push({
        name: "Current Form Draft",
        network: activeNetwork,
        guard: activeGuard,
        config: currentDraftConfig,
        description: "The draft currently configured in the local editor.",
      });
    }

    if (installedConfig) {
      list.push({
        name: "Installed On-Chain",
        network: activeNetwork,
        guard: activeGuard,
        config: installedConfig,
        description: "The live policy currently active on the selected guard account.",
      });
    }

    for (const preset of POLICY_PRESETS) {
      list.push({
        name: `Preset: ${preset.name}`,
        network: activeNetwork,
        config: preset.config,
        description: preset.explanation,
      });
    }

    // Add a cross-network archetype profile to allow testing/verifying network mismatch
    list.push({
      name: "Mainnet Vetted Archive",
      network: activeNetwork.toLowerCase().includes("mainnet") ? "Testnet" : "Mainnet",
      config: POLICY_PRESETS[0]!.config,
      description: "Archived production profile for cross-network parity inspection.",
    });

    return list;
  }, [currentDraftConfig, installedConfig, activeGuard, activeNetwork]);

  const [leftIndex, setLeftIndex] = useState<number>(0);
  const [rightIndex, setRightIndex] = useState<number>(() => (profiles.length > 1 ? 1 : 0));
  const [showChangedOnly, setShowChangedOnly] = useState<boolean>(false);

  const leftProfile = profiles[leftIndex] ?? profiles[0]!;
  const rightProfile = profiles[rightIndex] ?? (profiles[1] || profiles[0]!);

  const comparison = useMemo(
    () => comparePolicyProfiles(leftProfile, rightProfile),
    [leftProfile, rightProfile],
  );

  const visibleEntries = useMemo(() => {
    if (!showChangedOnly) return comparison.diff.entries;
    return comparison.diff.entries.filter((entry) => entry.status !== "unchanged");
  }, [comparison.diff.entries, showChangedOnly]);

  return (
    <div className="modal-backdrop" role="presentation" onClick={onClose}>
      <div
        className="modal policy-comparison-modal"
        role="dialog"
        aria-modal="true"
        aria-label="Side-by-side policy comparison"
        ref={modalRef}
        style={{ maxWidth: 880, width: "95vw", maxHeight: "90vh", overflowY: "auto" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
          <h2 style={{ margin: 0 }}>Side-by-Side Policy Profile Comparison</h2>
          <button
            type="button"
            className="secondary"
            onClick={onClose}
            aria-label="Close comparison"
          >
            Close
          </button>
        </div>

        <p className="tiny muted" style={{ margin: "6px 0 16px" }}>
          Compare policy configurations across drafts, presets, and environments. Comparison is
          strictly read-only; neither profile is applied and no network calls are dispatched.
        </p>

        {/* Network Mismatch Alert */}
        {comparison.networkMismatch && (
          <div
            className="notice danger"
            role="alert"
            data-testid="network-mismatch-alert"
            style={{ marginBottom: 16 }}
          >
            <strong>Network Mismatch Warning</strong>
            <p className="tiny" style={{ margin: "4px 0 0" }}>
              {comparison.networkMismatchWarning}
            </p>
          </div>
        )}

        {/* Warnings from policy diff */}
        {comparison.diff.warnings.length > 0 && (
          <div
            className="notice warn"
            role="alert"
            data-testid="policy-comparison-warning"
            style={{ marginBottom: 16 }}
          >
            <strong>Security Boundary Warnings</strong>
            <ul style={{ margin: "4px 0 0 16px", padding: 0 }}>
              {comparison.diff.warnings.map((warn, i) => (
                <li key={i} className="tiny">
                  {warn}
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Profile Selectors */}
        <div className="split" style={{ gap: 16, marginBottom: 16 }}>
          <div className="panel" style={{ padding: 12 }}>
            <label className="field">
              <span className="lbl">Left Profile (Base)</span>
              <select
                value={leftIndex}
                onChange={(e) => setLeftIndex(Number(e.target.value))}
                data-testid="left-profile-select"
                aria-label="Select left profile"
              >
                {profiles.map((p, idx) => (
                  <option key={`${p.name}-${idx}`} value={idx}>
                    {p.name} {p.network ? `(${p.network})` : ""}
                  </option>
                ))}
              </select>
            </label>
            <div className="tiny muted" style={{ marginTop: 4 }}>
              Network: <strong>{leftProfile.network || "Unspecified"}</strong>
              {leftProfile.guard && (
                <span>
                  {" "}
                  | Guard: <code className="mono">{leftProfile.guard.slice(0, 8)}…</code>
                </span>
              )}
            </div>
          </div>

          <div className="panel" style={{ padding: 12 }}>
            <label className="field">
              <span className="lbl">Right Profile (Target)</span>
              <select
                value={rightIndex}
                onChange={(e) => setRightIndex(Number(e.target.value))}
                data-testid="right-profile-select"
                aria-label="Select right profile"
              >
                {profiles.map((p, idx) => (
                  <option key={`${p.name}-${idx}`} value={idx}>
                    {p.name} {p.network ? `(${p.network})` : ""}
                  </option>
                ))}
              </select>
            </label>
            <div className="tiny muted" style={{ marginTop: 4 }}>
              Network: <strong>{rightProfile.network || "Unspecified"}</strong>
              {rightProfile.guard && (
                <span>
                  {" "}
                  | Guard: <code className="mono">{rightProfile.guard.slice(0, 8)}…</code>
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Filter Controls & Summary */}
        <div
          className="row"
          style={{ justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}
        >
          <div className="tiny">
            <strong>{comparison.changeCount}</strong> differences detected between profiles.
          </div>
          <div className="checkline" style={{ margin: 0 }}>
            <input
              id="show-changed-only"
              type="checkbox"
              checked={showChangedOnly}
              onChange={(e) => setShowChangedOnly(e.target.checked)}
              data-testid="show-changed-only-checkbox"
            />
            <label htmlFor="show-changed-only" className="tiny">
              Show differences only
            </label>
          </div>
        </div>

        {/* Side-by-Side Comparison Table */}
        <div style={{ overflowX: "auto" }}>
          <table className="review-table" style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th style={{ width: "25%" }}>Rule Field</th>
                <th style={{ width: "32%" }}>{leftProfile.name}</th>
                <th style={{ width: "32%" }}>{rightProfile.name}</th>
                <th style={{ width: "11%", textAlign: "center" }}>Status</th>
              </tr>
            </thead>
            <tbody>
              {visibleEntries.length === 0 ? (
                <tr>
                  <td
                    colSpan={4}
                    className="tiny muted"
                    style={{ textAlign: "center", padding: 16 }}
                  >
                    No field differences found between these profiles.
                  </td>
                </tr>
              ) : (
                visibleEntries.map((entry) => {
                  const meta = STATUS_META[entry.status];
                  const isDiff = entry.status !== "unchanged";
                  return (
                    <tr
                      key={entry.field}
                      data-status={entry.status}
                      style={{
                        background: isDiff
                          ? "color-mix(in srgb, var(--surface-muted) 50%, transparent)"
                          : undefined,
                      }}
                    >
                      <td>
                        <strong>{entry.field}</strong>
                      </td>
                      <td className="mono tiny">{formatValue(entry.oldValue)}</td>
                      <td className="mono tiny">{formatValue(entry.newValue)}</td>
                      <td style={{ textAlign: "center" }}>
                        <span className={`pill ${meta.pillClass}`} title={meta.label}>
                          {meta.sign} {meta.label}
                        </span>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Non-custodial, no-apply footer */}
        <div className="row" style={{ marginTop: 20, justifyContent: "flex-end" }}>
          <button type="button" className="secondary" onClick={onClose}>
            Close Comparison
          </button>
        </div>
      </div>
    </div>
  );
}
