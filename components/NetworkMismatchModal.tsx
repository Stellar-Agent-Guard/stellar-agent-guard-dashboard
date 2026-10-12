'use client';

/**
 * NetworkMismatchModal — blocking modal for write-path network mismatch.
 *
 * Shown by write-action handlers when assertCorrectNetwork() throws
 * NetworkMismatchError. The modal is blocking: the operator cannot interact
 * with anything beneath it until they dismiss or fix the issue.
 *
 * The copy names both networks (pulled from the error's NetworkMismatch object
 * or from the error message directly) and gives the exact Freighter instruction,
 * satisfying issue #18's UX requirement.
 */

import type { NetworkMismatch } from '../lib/guard/networkGuard.ts';
import { networkDisplayName } from '../lib/guard/networkSwitch.ts';
import { NETWORK } from '../lib/guard/network.ts';

export interface NetworkMismatchModalProps {
  /** The mismatch detail (may be null when the error is "cannot verify"). */
  mismatch: NetworkMismatch | null;
  /** Raw error message, used when mismatch is null. */
  message?: string;
  /** Called when the operator acknowledges and closes. */
  onClose: () => void;
}

export function NetworkMismatchModal({
  mismatch,
  message,
  onClose,
}: NetworkMismatchModalProps) {
  const targetName = mismatch
    ? networkDisplayName({
        passphrase: mismatch.targetPassphrase,
        name: mismatch.targetNetwork,
      })
    : networkDisplayName({ passphrase: NETWORK.passphrase, name: NETWORK.name });

  const walletName = mismatch
    ? networkDisplayName({
        passphrase: mismatch.walletPassphrase,
        name: mismatch.walletNetwork,
      })
    : null;

  const headline =
    mismatch && walletName
      ? `Your wallet is on ${walletName}, this dashboard targets ${targetName}`
      : 'Cannot verify wallet network';

  const body =
    mismatch && walletName
      ? `A signature made on ${walletName} cannot authorize a transaction on ${targetName}. ` +
        `No wallet popup has been shown and nothing has been broadcast.`
      : message ??
        `The wallet network could not be verified. No wallet popup has been shown and nothing has been broadcast.`;

  return (
    <div
      className="modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="network-mismatch-title"
      data-testid="network-mismatch-modal"
    >
      <div
        className="modal"
        tabIndex={-1}
      >
        <strong id="network-mismatch-title" data-testid="network-mismatch-headline">
          {headline}
        </strong>
        <p className="tiny" data-testid="network-mismatch-body" style={{ marginTop: 8 }}>
          {body}
        </p>
        {mismatch && walletName && (
          <div
            className="notice warn"
            role="note"
            data-testid="network-mismatch-instruction"
            style={{ marginTop: 12 }}
          >
            <strong>How to fix:</strong>{' '}
            In Freighter, click the network chip at the top of the popup and choose{' '}
            <strong data-testid="network-mismatch-target-name">{targetName}</strong>.
            Then reconnect your wallet and retry.
          </div>
        )}
        {!mismatch && (
          <div
            className="notice warn"
            role="note"
            data-testid="network-mismatch-instruction"
            style={{ marginTop: 12 }}
          >
            Ensure <strong data-testid="network-mismatch-target-name">{targetName}</strong> is
            selected in your wallet, then retry.
          </div>
        )}
        <div className="row" style={{ marginTop: 16 }}>
          <button onClick={onClose} data-testid="network-mismatch-close">
            Dismiss
          </button>
          <span className="tiny muted">
            No transaction was signed or broadcast.
          </span>
        </div>
      </div>
    </div>
  );
}
