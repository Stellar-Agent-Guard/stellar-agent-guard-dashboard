/**
 * The hardware-wallet signing guide (issue #99).
 *
 * When an operator signs a high-value admin transaction with Freighter backed by
 * a Ledger, the thing that must be verified is on the *device* screen, not in the
 * browser: the contract ID, the method, and — most importantly — the transaction
 * hash, which Ledger shows in chunks specifically so it can be compared against
 * what the app is asking to be signed. This module holds that in-flight signing
 * context (framework- and DOM-free, so it is unit-testable) so the guide modal
 * can render it, and owns the hash-formatting rule used for that comparison.
 *
 * It is a small external store: `submit.ts` opens a session when the wallet is
 * about to be prompted, records the hash once the transaction is assembled, and
 * closes it when signing resolves. Because dismissal is driven by the store being
 * cleared, the guide disappears the instant a signature is confirmed — the "auto
 * dismiss on confirmation" requirement falls out of the same mechanism that
 * starts it, rather than a second timer that could drift.
 */

export interface SigningSession {
  /** The contract whose function is being invoked — shown for on-device comparison. */
  contractId: string;
  /** The Soroban function name. */
  method: string;
  /** The transaction hash being signed, once known; `null` while assembling. */
  txHash: string | null;
  startedAt: number;
}

export interface GuideSnapshot {
  active: boolean;
  session: SigningSession | null;
}

const IDLE_SNAPSHOT: GuideSnapshot = Object.freeze({ active: false, session: null });

function beginSession(contractId: string, method: string): SigningSession {
  return { contractId, method, txHash: null, startedAt: Date.now() };
}

function signingSnapshot(session: SigningSession): GuideSnapshot {
  return Object.freeze({ active: true, session });
}

/**
 * The signing-guide store. `getSnapshot` returns a stable object between changes
 * (required by `useSyncExternalStore`); a fresh frozen snapshot is produced only
 * when the session actually changes.
 */
export class HardwareGuideStore {
  private session: SigningSession | null = null;
  private snapshot: GuideSnapshot = IDLE_SNAPSHOT;
  private listeners = new Set<() => void>();

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getSnapshot = (): GuideSnapshot => this.snapshot;

  private commit(session: SigningSession | null): void {
    this.session = session;
    this.snapshot = session ? signingSnapshot(session) : IDLE_SNAPSHOT;
    for (const listener of [...this.listeners]) listener();
  }

  /** The wallet is about to be prompted for a signature. */
  begin(contractId: string, method: string): void {
    this.commit(beginSession(contractId, method));
  }

  /** Record the transaction hash once it is assembled; ignored if not signing. */
  setTxHash(hash: string): void {
    if (!this.session) return;
    this.commit({ ...this.session, txHash: hash });
  }

  /** A signature was obtained (or signing failed); close the guide. */
  clear(): void {
    if (!this.session) return;
    this.commit(null);
  }
}

export const hardwareGuide = new HardwareGuideStore();

/** Hex characters per on-device chunk. Ledger and the guide break the hash here. */
const HASH_CHUNK = 8;

/**
 * Format a transaction hash for eyeball comparison against the device screen:
 * uppercased and grouped into 8-character blocks. A short / lowercase hash is
 * hard to match digit-for-digit against a hardware display; grouping is the one
 * thing that makes the comparison reliable.
 *
 * Non-hex or empty input is returned unchanged (trimmed) rather than dropped, so
 * an unexpected value still surfaces instead of vanishing.
 */
export function formatHashForDevice(hash: string | null): string {
  if (hash === null) return "";
  const cleaned = hash.replace(/^0x/, "").trim();
  if (cleaned === "" || /[^0-9a-fA-F]/.test(cleaned)) return cleaned;
  const upper = cleaned.toUpperCase();
  const chunks: string[] = [];
  for (let index = 0; index < upper.length; index += HASH_CHUNK) {
    chunks.push(upper.slice(index, index + HASH_CHUNK));
  }
  return chunks.join(" ");
}
