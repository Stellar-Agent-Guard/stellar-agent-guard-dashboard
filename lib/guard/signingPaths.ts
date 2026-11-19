/**
 * Which signing paths can complete a guard write, per provider (issue #517).
 *
 * A guard write asks for up to two kinds of signature, in this order (SPEC.md §5,
 * ADR 003): one per Soroban **authorization entry** the host returns with
 * address credentials, then one over the **transaction envelope**. Not every
 * provider can produce both, and the operator should see that — and the
 * alternatives — before a write starts rather than at the wallet prompt.
 *
 * Every path listed here signs *outside* the console. The dashboard only hands a
 * payload to a wallet (or exports it for an external signer) and receives a
 * signature back; there is no path through which a secret key reaches it.
 *
 * Pure: the answer is a function of the descriptors, the probe result and the
 * injected wallet scope, so it is tested headlessly with object literals.
 */

import { WALLET_PROVIDERS, type WalletProviderId, type WalletScope } from "./walletConnector.ts";

/** The two signatures a guard write can need. */
export type SigningStep = "auth-entry" | "transaction";

export const SIGNING_STEPS: ReadonlyArray<{ id: SigningStep; label: string }> = [
  { id: "auth-entry", label: "Authorization entries" },
  { id: "transaction", label: "Transaction envelope" },
];

/** `unknown` is reserved for a capability that can only be read from a provider that is not present. */
export type SigningSupport = "supported" | "unsupported" | "unknown";

export interface SigningStepSupport {
  support: SigningSupport;
  /** Why a step is unsupported or unknown; null when it is supported. */
  reason: string | null;
}

export type SigningPathId = WalletProviderId | "external-xdr";

export interface SigningPath {
  id: SigningPathId;
  name: string;
  kind: "wallet" | "external";
  /** Whether the provider was detected in this browser (always true for the external path). */
  detected: boolean;
  /** Whether this is the provider the session is connected through. */
  current: boolean;
  /** Where the signature is produced, in one sentence. */
  how: string;
  steps: Record<SigningStep, SigningStepSupport>;
}

/** Shown wherever the paths are listed: the boundary every path shares. */
export const SIGNING_PATH_BOUNDARY =
  "Every path signs outside this console. The dashboard passes the payload to the signer and receives a signature back; no field, path or setting here accepts a secret key.";

const SUPPORTED: SigningStepSupport = { support: "supported", reason: null };

export interface SigningPathInputs {
  /** Providers the non-prompting probe found. */
  availableProviders: readonly WalletProviderId[];
  /** The provider this session connected through, if any. */
  currentProvider: WalletProviderId | null;
  /** The injected wallet objects; used only to read whether a method exists. */
  scope?: Pick<WalletScope, "xbull"> | null;
}

/**
 * xBull exposes `signAuthEntry` only in some builds; `createXbullConnector`
 * refuses an auth entry with `WalletUnsupportedError` when it is missing, so
 * the same check decides what is shown here.
 */
function xbullAuthEntrySupport(scope: SigningPathInputs["scope"]): SigningStepSupport {
  const provider = scope?.xbull ?? null;
  if (!provider) {
    return {
      support: "unknown",
      reason:
        "xBull is not detected, so this build cannot be checked. Only xBull builds that expose signAuthEntry can sign authorization entries.",
    };
  }
  if (typeof provider.signAuthEntry !== "function") {
    return {
      support: "unsupported",
      reason:
        "This xBull build does not expose signAuthEntry, so a write that needs an authorization entry cannot be signed with it. Use Freighter or Albedo for that write.",
    };
  }
  return SUPPORTED;
}

/**
 * The paths a guard write can take, in the order the picker lists them: the
 * three wallet providers, then the external-signer path.
 */
export function signingPathsFor(inputs: SigningPathInputs): SigningPath[] {
  const wallets: SigningPath[] = WALLET_PROVIDERS.map((descriptor) => ({
    id: descriptor.id,
    name: descriptor.name,
    kind: "wallet",
    detected: inputs.availableProviders.includes(descriptor.id),
    current: inputs.currentProvider === descriptor.id,
    how:
      descriptor.kind === "extension"
        ? `Signs inside the ${descriptor.name} extension, which shows the payload before you approve.`
        : `Signs in the ${descriptor.name} pop-up, which shows the payload before you approve.`,
    steps: {
      "auth-entry": descriptor.id === "xbull" ? xbullAuthEntrySupport(inputs.scope) : SUPPORTED,
      transaction: SUPPORTED,
    },
  }));

  const external: SigningPath = {
    id: "external-xdr",
    name: "External signer (signed XDR)",
    kind: "external",
    detected: true,
    current: false,
    how: "Export the unsigned envelope from a write, sign it in another wallet or on an offline machine, then paste it into Submit Signed XDR.",
    steps: {
      "auth-entry": {
        support: "unsupported",
        reason:
          "The console has no import for separately signed authorization entries. A write that needs one is signed in a connected wallet.",
      },
      transaction: {
        support: "supported",
        reason: null,
      },
    },
  };

  return [...wallets, external];
}

/**
 * Whether a path can complete an operation that needs `required` signatures,
 * and, when it cannot, the first reason why.
 */
export function pathCanSign(
  path: SigningPath,
  required: readonly SigningStep[],
): { ok: boolean; reason: string | null } {
  for (const step of required) {
    const support = path.steps[step];
    if (support.support !== "supported") {
      return { ok: false, reason: support.reason };
    }
  }
  return { ok: true, reason: null };
}

/** The picker's one-word label for a step's support. */
export function supportLabel(support: SigningSupport): string {
  switch (support) {
    case "supported":
      return "supported";
    case "unsupported":
      return "not supported";
    case "unknown":
      return "not checked";
  }
}
