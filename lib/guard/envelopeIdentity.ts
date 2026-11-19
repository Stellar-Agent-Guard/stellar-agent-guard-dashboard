/**
 * Network identity for the signed-XDR review (issue #520).
 *
 * A transaction envelope does not carry its network: the network passphrase is
 * mixed into the hash every signature covers. So the only honest way to say
 * which network a signed envelope belongs to is to check the signatures against
 * a network's hash. `inspectSignedEnvelope` already does that check; this
 * module turns its answer into the identity the operator reviews — the selected
 * network's name, passphrase and network ID, the network the signature verifies
 * on, and the transaction hash for the selected network — and re-checks that
 * identity on the exact reviewed bytes immediately before broadcast.
 *
 * Nothing here signs, edits or re-builds an envelope. The bytes submitted are
 * the bytes the operator reviewed, or nothing is submitted.
 */

import { Networks, Transaction, TransactionBuilder, hash } from "@stellar/stellar-sdk";
import { inspectSignedEnvelope } from "./submit.ts";

/** Names for the passphrases the console knows, so a mismatch can be named. */
const NETWORK_NAMES: Readonly<Record<string, string>> = {
  [Networks.PUBLIC]: "Public",
  [Networks.TESTNET]: "Testnet",
  [Networks.FUTURENET]: "Futurenet",
  "Standalone Network ; February 2017": "Standalone",
};

export interface NetworkIdentity {
  name: string;
  passphrase: string;
  /** SHA-256 of the passphrase, hex — the network ID signatures commit to. */
  networkId: string;
}

/** The network ID (SHA-256 of the passphrase, hex) that every signature commits to. */
export function networkIdOf(passphrase: string): string {
  return Buffer.from(hash(Buffer.from(passphrase, "utf8"))).toString("hex");
}

export function networkIdentity(passphrase: string, name?: string): NetworkIdentity {
  return {
    name: name ?? NETWORK_NAMES[passphrase] ?? "Unknown network",
    passphrase,
    networkId: networkIdOf(passphrase),
  };
}

export type EnvelopeIdentity =
  | {
      ok: true;
      /** The network this console is configured for, which every check is made against. */
      selected: NetworkIdentity;
      /**
       * The network the source signature verifies on, or null when no known
       * network's hash verifies it (unsigned, or not signed by the source).
       */
      signedFor: NetworkIdentity | null;
      matches: boolean;
      /** Transaction hash for the selected network, hex. */
      transactionHash: string;
      source: string;
      sequence: string;
      operations: string[];
    }
  | { ok: false; error: string };

/**
 * Decode the identity of a signed envelope against the selected network.
 * Pure and read-only: the envelope is parsed, never modified.
 */
export function decodeEnvelopeIdentity(
  envelopeXdr: string,
  selected: { name: string; passphrase: string },
): EnvelopeIdentity {
  const clean = (envelopeXdr ?? "").trim();
  if (!clean) return { ok: false, error: "No envelope to review" };
  const inspection = inspectSignedEnvelope(clean, selected.passphrase);
  if (!inspection.valid) {
    return { ok: false, error: inspection.blockReasons[0] ?? "The envelope could not be decoded" };
  }
  const tx = TransactionBuilder.fromXDR(clean, selected.passphrase) as Transaction;
  const selectedIdentity = networkIdentity(selected.passphrase, selected.name);
  const signedFor = inspection.networkMatch
    ? selectedIdentity
    : inspection.detectedNetwork
      ? networkIdentity(inspection.detectedNetwork)
      : null;
  return {
    ok: true,
    selected: selectedIdentity,
    signedFor,
    matches: inspection.networkMatch,
    transactionHash: Buffer.from(tx.hash()).toString("hex"),
    source: tx.source,
    sequence: tx.sequence,
    operations: inspection.operations.map((operation) => operation.summary),
  };
}

/** What the operator reviewed, captured when the envelope was checked. */
export interface ReviewedEnvelope {
  xdr: string;
  passphrase: string;
  transactionHash: string;
}

export type SubmitConfirmation =
  { ok: true; transaction: Transaction } | { ok: false; reason: string };

/**
 * The last gate before broadcast: the candidate must be the reviewed envelope,
 * byte for byte, for the same selected network, still signed for that network,
 * and must decode to the same transaction hash. Any difference refuses the
 * submission instead of correcting anything.
 */
export function confirmReviewedEnvelope(
  reviewed: ReviewedEnvelope | null,
  candidateXdr: string,
  selectedPassphrase: string,
): SubmitConfirmation {
  if (!reviewed) {
    return { ok: false, reason: "Check this envelope before submitting." };
  }
  const candidate = candidateXdr.trim();
  if (candidate !== reviewed.xdr) {
    return {
      ok: false,
      reason:
        "The envelope changed after it was reviewed. Check the new envelope before submitting.",
    };
  }
  if (selectedPassphrase !== reviewed.passphrase) {
    return {
      ok: false,
      reason: "The selected network changed after the review. Check the envelope again.",
    };
  }
  const identity = decodeEnvelopeIdentity(candidate, {
    name: NETWORK_NAMES[selectedPassphrase] ?? "selected network",
    passphrase: selectedPassphrase,
  });
  if (!identity.ok) return { ok: false, reason: identity.error };
  if (!identity.matches) {
    return {
      ok: false,
      reason: identity.signedFor
        ? `Network mismatch: the envelope is signed for ${identity.signedFor.name}, but the console is on ${identity.selected.name}. Nothing was submitted.`
        : `Network mismatch: no signature on this envelope verifies on ${identity.selected.name}. Nothing was submitted.`,
    };
  }
  if (identity.transactionHash !== reviewed.transactionHash) {
    return {
      ok: false,
      reason: "The transaction hash differs from the reviewed one. Nothing was submitted.",
    };
  }
  const transaction = TransactionBuilder.fromXDR(candidate, selectedPassphrase) as Transaction;
  // Decoding must be lossless: the bytes broadcast are the bytes reviewed.
  if (transaction.toXDR() !== candidate) {
    return {
      ok: false,
      reason:
        "The envelope does not re-encode to the reviewed bytes, so it cannot be broadcast unchanged. Nothing was submitted.",
    };
  }
  return { ok: true, transaction };
}
