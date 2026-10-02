"use client";

import { useEffect, useRef, useState } from "react";
import {
  CLOSED_OVERRIDE,
  CRITICAL_ADDRESS_WARNING,
  OVERRIDE_PHRASE,
  fieldLabel,
  overrideSatisfied,
  type AddressFinding,
  type DraftScreen,
} from "../lib/guard/securityChecker.ts";

/**
 * The high-severity warning an operator sees before a policy containing a
 * flagged address is allowed to reach a signature prompt.
 *
 * It is modal, red, and unmissable by design, but it is not a wall. A registry
 * entry is a *report* with a date and a link, not this project's own verdict,
 * and an operator with a documented reason to trust an address must be able to
 * say so — otherwise the next response to a false positive is to work around the
 * warning entirely, which is the worse failure. So the dialog gives the evidence
 * first, then asks for two deliberate acts before it will let the write through.
 *
 * The accessibility contract is identical to the freeze confirmation in
 * `PanicPanel`: `role="dialog"` with `aria-modal`, focus moved in on open, Tab
 * cycled in both directions, Escape dismisses, and focus returned to the trigger
 * on the way out. A warning the operator cannot reach with a keyboard is not a
 * warning, it is a stall.
 */
export function MaliciousAddressModal({
  screen,
  onCancel,
  onProceed,
  returnFocusTo,
}: {
  screen: DraftScreen;
  onCancel: () => void;
  onProceed: () => void;
  returnFocusTo: React.RefObject<HTMLButtonElement | null>;
}) {
  const [override, setOverride] = useState(CLOSED_OVERRIDE);
  const dialogRef = useRef<HTMLDivElement>(null);
  const proceedRef = useRef<HTMLButtonElement>(null);
  const ready = overrideSatisfied(override);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    const focusables = () =>
      Array.from(
        dialog.querySelectorAll<HTMLElement>(
          'button:not([disabled]), input:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])',
        ),
      );

    dialog.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onCancel();
        return;
      }
      if (event.key !== "Tab") return;
      const items = focusables();
      if (items.length === 0) {
        event.preventDefault();
        dialog.focus();
        return;
      }
      const first = items[0]!;
      const last = items[items.length - 1]!;
      const active = document.activeElement as HTMLElement | null;
      const inside = active !== null && dialog.contains(active);
      if (event.shiftKey && (active === first || !inside)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (active === last || !inside)) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("keydown", onKeyDown, true);
      // Read the ref at cleanup time, not on open: the trigger row is re-created
      // when the dialog closes and React re-attaches refs during the commit, so a
      // snapshot taken here would point at an unmounted node.
      // eslint-disable-next-line react-hooks/exhaustive-deps -- deliberate late ref read, see above
      returnFocusTo.current?.focus();
    };
  }, [onCancel, returnFocusTo]);

  return (
    <div className="modal-backdrop">
      <div
        className="modal security-warning"
        role="dialog"
        aria-modal="true"
        aria-labelledby="malicious-address-title"
        aria-describedby="malicious-address-body"
        ref={dialogRef}
        tabIndex={-1}
      >
        <strong id="malicious-address-title">{CRITICAL_ADDRESS_WARNING}</strong>

        <p className="tiny" id="malicious-address-body">
          {screen.findings.length === 1
            ? "1 address in this policy is on the embedded warning registry. Signing now installs it "
            : `${screen.findings.length} addresses in this policy are on the embedded warning registry. Signing now installs them `}
          as a standing authorisation — every transfer or call the agent makes afterwards inherits
          it. Check each report before you decide.
        </p>

        <ul className="security-findings">
          {screen.findings.map((finding: AddressFinding) => (
            <li key={`${finding.field}-${finding.address}-${finding.entered}`}>
              <span className="pill danger">{finding.entry.category}</span>{" "}
              <span className="tiny">{fieldLabel(finding.field)}</span>
              <div className="mono">{finding.address}</div>
              {finding.viaMuxedAlias && (
                <div className="tiny" style={{ color: "var(--danger)" }}>
                  You entered a muxed form of this account: <span className="mono">{finding.entered}</span>
                </div>
              )}
              <div className="tiny">{finding.entry.reason}</div>
              <div className="tiny muted">
                Reported {finding.entry.reportedAt} ·{" "}
                <a href={finding.entry.source} target="_blank" rel="noreferrer">
                  verify the report
                </a>
              </div>
            </li>
          ))}
        </ul>

        <p className="tiny muted">
          Registry {screen.version}, updated {screen.updatedAt}. This is a curated snapshot compiled
          into the build, not a live feed — an address missing from it has not been cleared, only
          unknown here. Other protocols publish their own lists; a false negative here is expected,
          not ruled out.
        </p>

        <div className="checkline">
          <input
            id="ack-flagged-address"
            type="checkbox"
            checked={override.acknowledged}
            onChange={(event) => setOverride({ ...override, acknowledged: event.target.checked })}
          />
          <label htmlFor="ack-flagged-address">
            I have read the reports above and accept the risk of authorising these addresses.
          </label>
        </div>

        <label className="field">
          <span className="lbl">
            Then type <span className="mono">{OVERRIDE_PHRASE}</span> to continue
          </span>
          <input
            value={override.phrase}
            autoComplete="off"
            spellCheck={false}
            aria-describedby="malicious-address-body"
            onChange={(event) => setOverride({ ...override, phrase: event.target.value })}
          />
        </label>

        <div className="row">
          <button
            className="danger"
            ref={proceedRef}
            disabled={!ready}
            onClick={onProceed}
          >
            Sign with flagged addresses
          </button>
          <button className="secondary" onClick={onCancel}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
