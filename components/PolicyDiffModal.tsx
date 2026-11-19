"use client";

import { useRef } from "react";
import type { PolicyDiff, DiffEntry } from "../lib/guard/policyDiff.ts";
import { useModalFocus } from "../lib/guard/useModalFocus.ts";

/**
 * Column labels for the comparison. They are rendered twice on purpose: once
 * as the semantic `<th>` header, and once per cell as `data-label`, which the
 * narrow-screen layout prints in front of each value (issue #537). Below the
 * breakpoint the header row is visually hidden, so without the per-cell label
 * an operator on a phone could not tell the installed value from the new one.
 */
export const DIFF_COLUMN_LABELS = {
  field: "Field",
  before: "Before (installed)",
  after: "After (this draft)",
} as const;

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
 *
 * Below 720px the side-by-side table linearizes (issue #537): each changed
 * field becomes its own card reading Field → Before → After, top to bottom, in
 * DOM order, so reading order, screen-reader order and Tab order all agree and
 * the before/after labels stay attached to their values. The stylesheet never
 * reorders cells visually (no `order`, no `*-reverse`), which is what keeps the
 * keyboard order logical.
 *
 * Focus follows the shared modal contract (`useModalFocus`): focus moves into
 * the dialog on open, Tab is trapped, Escape cancels, and focus returns to the
 * control that opened the review — including when another dialog (such as the
 * secret-key alert) was stacked on top of it in the meantime (issue #540).
 */
export function PolicyDiffModal({
  diff,
  onConfirm,
  onCancel,
}: {
  diff: PolicyDiff;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const changes = diff.entries.filter((entry) => entry.status !== "unchanged");
  const dialogRef = useRef<HTMLDivElement>(null);

  useModalFocus({ open: true, containerRef: dialogRef, onDismiss: onCancel });

  return (
    <div className="modal-backdrop" role="presentation" onClick={onCancel}>
      <div
        ref={dialogRef}
        className="modal policy-diff"
        role="dialog"
        aria-modal="true"
        aria-label="Policy changes"
        tabIndex={-1}
        onClick={(event) => event.stopPropagation()}
      >
        <h2 style={{ marginTop: 0 }}>Policy changes</h2>
        <p className="tiny muted">
          Review what will change before the wallet is prompted to sign. Signing installs the new
          policy and resets the rolling window.
        </p>

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
          <table
            className="diff-table diff-linear"
            style={{ width: "100%", borderCollapse: "collapse" }}
          >
            <caption className="visually-hidden">
              {changes.length} changed policy field{changes.length === 1 ? "" : "s"}, installed
              value before and draft value after
            </caption>
            <thead>
              <tr>
                <th scope="col" style={{ textAlign: "left" }}>
                  {DIFF_COLUMN_LABELS.field}
                </th>
                <th scope="col" style={{ textAlign: "left" }}>
                  {DIFF_COLUMN_LABELS.before}
                </th>
                <th scope="col" style={{ textAlign: "left" }}>
                  {DIFF_COLUMN_LABELS.after}
                </th>
              </tr>
            </thead>
            <tbody>
              {changes.map((entry) => {
                const status = STATUS[entry.status];
                return (
                  <tr key={entry.field} data-status={entry.status}>
                    <td data-label={DIFF_COLUMN_LABELS.field}>
                      <span
                        aria-hidden="true"
                        style={{ color: status.color, fontWeight: 700, marginRight: 6 }}
                      >
                        {status.sign}
                      </span>
                      {entry.field}
                      <span className="tiny muted"> ({status.label})</span>
                    </td>
                    <td className="mono tiny" data-label={DIFF_COLUMN_LABELS.before}>
                      {renderValue(entry.oldValue)}
                    </td>
                    <td className="mono tiny" data-label={DIFF_COLUMN_LABELS.after}>
                      {renderValue(entry.newValue)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}

        <div className="row policy-diff-actions" style={{ marginTop: 14 }}>
          <button onClick={onConfirm}>Confirm and sign</button>
          <button className="secondary" onClick={onCancel}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
