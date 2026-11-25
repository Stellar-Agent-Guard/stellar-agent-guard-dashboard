"use client";

import { useRef, useState } from "react";
import type { PolicyDiff, DiffEntry } from "../lib/guard/policyDiff.ts";
import type { AuthorizationContext } from "../lib/guard/authorizationSummary.ts";
import { AuthorizationSummaryBlock } from "./AuthorizationSummary.tsx";
import { useGuard } from "./GuardProvider.tsx";
import { short } from "./bits.tsx";
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

/**
 * Each status three ways: a glyph, a word, and the class the stylesheet paints.
 *
 * No hex lives here on purpose. The row used to carry its own GitHub-light
 * palette, which this dark console cannot use — `#57606a` on `--panel` measures
 * 2.84:1 and the badge's `#fff8c5` panel put `--text` at 1.11:1, i.e. unreadable
 * for everyone and invisible for a screen reader either way. Colour now comes
 * from `--ok` / `--danger` / `--warn` / `--muted` through `.diff-table` in
 * `app/globals.css`, the same tiers the feed rows and the status pills use, so
 * the palette cannot drift out of contrast here without drifting everywhere —
 * and `tests/unit/policyDiffLabels.test.ts` measures the tokens it resolves to.
 *
 * The word is the part that survives assistive technology, a monochrome display
 * and a printed copy, so it is always rendered: `aria-hidden` on the glyph keeps
 * it a redundant cue rather than a duplicate announcement.
 */
const STATUS: Record<DiffEntry["status"], { glyph: string; label: string; className: string }> = {
  added: { glyph: "+", label: "added", className: "diff-added" },
  removed: { glyph: "−", label: "removed", className: "diff-removed" },
  modified: { glyph: "~", label: "changed", className: "diff-modified" },
  unchanged: { glyph: "=", label: "unchanged", className: "diff-unchanged" },
};

/** "3 changes: 1 added, 2 changed" — the shape of the diff without opening it. */
function summarize(entries: readonly DiffEntry[]): string {
  const counts = entries.reduce<Record<string, number>>((tally, entry) => {
    tally[entry.status] = (tally[entry.status] ?? 0) + 1;
    return tally;
  }, {});
  const parts = (["added", "removed", "modified"] as const)
    .filter((status) => (counts[status] ?? 0) > 0)
    .map((status) => `${counts[status]} ${STATUS[status].label}`);
  const noun = entries.length === 1 ? "change" : "changes";
  return `${entries.length} ${noun}: ${parts.join(", ")}.`;
}

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
 *
 * The diff says *what* changes; the authorization block beneath it says *who is
 * signing what, and where* (issue #343) — the two halves of the same question,
 * which is why they share this dialog rather than sitting in separate panels. An
 * install with no summary to show has no confirmed signer, so the confirm button
 * stays disabled instead of offering a prompt the operator cannot evaluate.
 */
export function PolicyDiffModal({
  diff,
  authorization,
  expectedAccount,
  currentAccount,
  onConfirm,
  onCancel,
}: {
  diff: PolicyDiff;
  authorization: AuthorizationContext | null;
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

  // Capture the account the dialog was opened for, once, so a wallet switch
  // while it is open is reported instead of silently retargeting the change.
  const [initialAccount] = useState<string | undefined>(() => expectedAccount ?? liveAddress);
  const targetAccount = expectedAccount ?? initialAccount;
  const accountChanged = Boolean(targetAccount && liveAddress && targetAccount !== liveAddress);

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

        {accountChanged && (
          <div
            className="notice warn"
            role="alert"
            data-testid="confirmation-account-changed"
            style={{ margin: "10px 0" }}
          >
            <strong>Active account changed during review</strong>
            <p className="tiny" style={{ margin: "4px 0" }}>
              The connected account changed from{" "}
              <span className="mono">{short(targetAccount!, 8, 6)}</span> to{" "}
              <span className="mono">{short(liveAddress!, 8, 6)}</span> while this confirmation was
              open. This policy change was prepared and simulated for the previous account.
            </p>
            <p className="tiny muted" style={{ margin: "4px 0" }}>
              <strong>Recovery:</strong> Cancel this confirmation to re-run policy review with the
              active account, or switch your wallet back to{" "}
              <span className="mono">{short(targetAccount!, 8, 6)}</span>.
            </p>
          </div>
        )}

        {diff.warnings.length > 0 && (
          <div className="notice diff-warnings" role="alert">
            <strong>Warning</strong>
            {diff.warnings.map((warning, index) => (
              <div key={index}>
                <span aria-hidden="true">⚠ </span>
                {warning}
              </div>
            ))}
          </div>
        )}

        {changes.length === 0 ? (
          <p className="tiny">This policy is identical to the one currently installed.</p>
        ) : (
          <>
            <p className="tiny muted diff-summary">{summarize(changes)}</p>
            <table className="diff-table diff-linear">
              <caption className="visually-hidden">
                {changes.length} changed policy field{changes.length === 1 ? "" : "s"}, installed
                value before and draft value after
              </caption>
              <thead>
                <tr>
                  <th scope="col">{DIFF_COLUMN_LABELS.field}</th>
                  <th scope="col">{DIFF_COLUMN_LABELS.before}</th>
                  <th scope="col">{DIFF_COLUMN_LABELS.after}</th>
                </tr>
              </thead>
              <tbody>
                {changes.map((entry) => {
                  const status = STATUS[entry.status];
                  return (
                    <tr key={entry.field} className={status.className} data-status={entry.status}>
                      <th scope="row" data-label={DIFF_COLUMN_LABELS.field}>
                        <span className="diff-glyph" aria-hidden="true">
                          {status.glyph}
                        </span>
                        <span className="diff-field">{entry.field}</span>
                        <span className="diff-status">{` (${status.label})`}</span>
                      </th>
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
          </>
        )}
        <div style={{ marginTop: 14 }}>
          <AuthorizationSummaryBlock authorization={authorization} purpose="this policy install" />
        </div>

        <div className="row policy-diff-actions" style={{ marginTop: 14 }}>
          <button
            disabled={authorization === null || changes.length === 0 || accountChanged}
            title={
              authorization === null
                ? "This console cannot name the account and guard that would sign, so it will not ask your wallet to."
                : undefined
            }
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
