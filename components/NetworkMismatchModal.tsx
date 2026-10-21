"use client";

/**
 * NetworkMismatchModal — blocking write-guard modal (issue #18).
 *
 * Rendered when a write action is attempted with the wallet on the wrong
 * network. The modal is **blocking**: it must be dismissed before another
 * write can be attempted, and every subsequent write attempt re-triggers the
 * guard and re-renders this modal if the network is still wrong.
 *
 * The copy names both networks explicitly — the wallet's active network and
 * the dashboard's configured target — so an operator who sees this during an
 * emergency knows *exactly* which setting to change rather than hunting for
 * context in a generic error message.
 *
 * The close button dismisses the modal. No write was signed (the guard
 * blocked before any signTransaction() call was made), so dismissing is
 * always safe. The operator must switch the wallet network and retry.
 */

import { type NetworkMismatchError } from "../lib/guard/networkGuard.ts";
import { networkDisplayName, manualSwitchInstructions } from "../lib/guard/networkSwitch.ts";

export interface NetworkMismatchModalProps {
  error: NetworkMismatchError;
  onClose: () => void;
}

export function NetworkMismatchModal({ error, onClose }: NetworkMismatchModalProps) {
  const walletLabel = networkDisplayName({
    passphrase: error.walletPassphrase,
    name: error.walletNetwork,
  });
  const targetLabel = networkDisplayName({
    passphrase: error.targetPassphrase,
    name: error.targetNetwork,
  });

  // Derive the mismatch object that manualSwitchInstructions expects.
  const mismatch = {
    walletNetwork: error.walletNetwork,
    walletPassphrase: error.walletPassphrase,
    targetNetwork: error.targetNetwork,
    targetPassphrase: error.targetPassphrase,
  };

  const steps = manualSwitchInstructions(mismatch);

  return (
    <div
      className="modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="network-mismatch-title"
      data-testid="network-mismatch-modal"
      // Clicking the backdrop dismisses: no write was made, so this is safe.
      onClick={onClose}
    >
      <div
        className="modal"
        style={{ maxWidth: 480 }}
        // Stop propagation so clicks inside the panel don't close it.
        onClick={(e) => e.stopPropagation()}
      >
        <strong
          id="network-mismatch-title"
          data-testid="network-mismatch-modal-title"
          style={{ color: "var(--color-warn, #c47a00)", display: "block", marginBottom: 8 }}
        >
          {error.unverifiable
            ? "Cannot verify wallet network"
            : `Wallet on ${walletLabel} — dashboard targets ${targetLabel}`}
        </strong>

        {error.unverifiable ? (
          <p className="tiny">
            The wallet&apos;s active network could not be read. This dashboard targets{" "}
            <strong data-testid="network-mismatch-modal-target">{targetLabel}</strong>. Confirm that
            Freighter is installed and unlocked, then retry.
          </p>
        ) : (
          <>
            <p className="tiny" data-testid="network-mismatch-modal-body">
              Your wallet is on{" "}
              <strong data-testid="network-mismatch-modal-wallet">{walletLabel}</strong>, but this
              dashboard targets{" "}
              <strong data-testid="network-mismatch-modal-target">{targetLabel}</strong>.
            </p>
            <p className="tiny" style={{ marginTop: 6 }}>
              A signature produced for{" "}
              <strong>{walletLabel}</strong> cannot authorize a call on{" "}
              <strong>{targetLabel}</strong>. Nothing was signed — no wallet popup was shown, and
              nothing was broadcast.
            </p>
          </>
        )}

        <div
          style={{
            background: "var(--color-surface-2, rgba(0,0,0,.06))",
            borderRadius: 6,
            padding: "10px 12px",
            marginTop: 12,
          }}
        >
          <strong className="tiny">Switch your wallet to {targetLabel}:</strong>
          <ol className="tiny muted" style={{ marginTop: 6, paddingLeft: 18 }}>
            {steps.map((step) => (
              <li key={step} style={{ marginTop: 4 }}>
                {step}
              </li>
            ))}
          </ol>
        </div>

        <p className="tiny muted" style={{ marginTop: 10 }}>
          Once you have switched to{" "}
          <strong>{targetLabel}</strong>, dismiss this modal and retry the action.
        </p>

        <div className="row" style={{ marginTop: 14 }}>
          <button onClick={onClose} data-testid="network-mismatch-modal-close">
            Dismiss
          </button>
        </div>
      </div>
    </div>
  );
}
