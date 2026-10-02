/**
 * Address safety screening: a versioned, embedded registry of known malicious
 * Stellar addresses, and the check that cross-references a policy draft against
 * it before the operator is asked to sign.
 *
 * Why this lives in front of the signature prompt and not in the contract: an
 * allowlist is a standing authorisation. Installing a policy that names a
 * phishing drainer as a recipient, or a rug-pull contract as a protocol, turns
 * a one-off mistake into a permanent door that every later policy inherits. The
 * cheapest moment to catch that is while the operator is still looking at a
 * text box, with a receipt they can check against a public source.
 *
 * Two properties are load-bearing, and both are tested:
 *
 * 1. **Matching is on identity, not on the string.** Addresses are canonicalised
 *    through the SDK before lookup, so a muxed `M…` form of a flagged `G…`
 *    account resolves to the same identity and still matches. A registry keyed
 *    on raw text would be defeated by an encoding the operator never looks at.
 *
 * 2. **A miss is not a clearance.** This is a curated snapshot compiled into the
 *    build, not a live reputation feed, and it is nowhere near complete. The
 *    module therefore reports a hit with its source and a *dated* version, and
 *    the interface states the boundary — the same discipline the enforcement
 *    scope statement in `network.ts` exists to enforce. Absence from this list
 *    means "not known here", never "safe".
 *
 * The registry is data, not logic: adding an entry is a one-line change with a
 * citation, and bumping `REGISTRY_VERSION` is what makes a stale install
 * visible to an operator reading the modal.
 */

import { Address, StrKey } from "@stellar/stellar-sdk";
import type { PolicyDraft } from "./policyForm.ts";

/**
 * The registry's identity, surfaced in the warning modal.
 *
 * A warning an operator cannot date is a warning they cannot weigh: "flagged as
 * of <date>" is checkable, "flagged" alone is a rumour. Bump this on every
 * content change so a reader can tell a current list from a stale one.
 */
export const REGISTRY_VERSION = "2026.09.1";

/** When this registry snapshot was last compiled. ISO 8601. */
export const REGISTRY_UPDATED_AT = "2026-09-29";

/** How the address came to be flagged. Drives the operator-facing wording. */
export type RegistryCategory =
  | "phishing"
  | "drainer"
  | "impersonation"
  | "fraud"
  | "scam";

export interface RegistryEntry {
  /** The flagged address, canonical form. */
  address: string;
  category: RegistryCategory;
  /** One line the operator can act on: what this address is. */
  reason: string;
  /** ISO 8601 date the report was observed. */
  reportedAt: string;
  /** Public URL where the flag can be independently re-checked. */
  source: string;
}

/**
 * The embedded warning registry.
 *
 * Every entry is a publicly reported flag with a link an operator can open, and
 * none of them is asserted on this project's own authority: the interface says
 * "reported", not "verified", because a wrong entry here would block a
 * legitimate destination. The list is deliberately small and dated rather than
 * large and fresh — see the module note on why a miss is not a clearance.
 */
export const MALICIOUS_ADDRESS_REGISTRY: readonly RegistryEntry[] = [
  {
    address: "GDPDCU4UL7RMDMJSV2QNUWEVWVVZUNUQ5427YE33BYHQCGWVJR2JAFEB",
    category: "impersonation",
    reason:
      "Issuer of the AMEC \"sse.cn.com\" asset, reported as impersonating the Shanghai Stock Exchange to sell tokenised equities. Carries a fraud report on Stellar Expert.",
    reportedAt: "2026-09-29",
    source:
      "https://stellar.expert/explorer/public/asset/AMEC-GDPDCU4UL7RMDMJSV2QNUWEVWVVZUNUQ5427YE33BYHQCGWVJR2JAFEB",
  },
  {
    address: "GD2KE7XPL2BK4CJODN33OO5I3PRIBXE3KKHHBW3O65TM4EM2PDUFSRTX",
    category: "fraud",
    reason:
      "Issuer of the SOROSWAP asset, reported for illicit or fraudulent activity after an unexplained switch to a Soroban contract front end. The account is now locked.",
    reportedAt: "2026-09-29",
    source:
      "https://stellar.expert/explorer/public/asset/SOROSWAP-GD2KE7XPL2BK4CJODN33OO5I3PRIBXE3KKHHBW3O65TM4EM2PDUFSRTX",
  },
  {
    address: "GA2IZUQLK56OCXMRPAUL4R46CN62D2MHPHXLOPUL6F6G3JJFHAZF6CYS",
    category: "scam",
    reason:
      "Issuer of the CondorAI asset, reported for illicit or fraudulent activity.",
    reportedAt: "2026-09-29",
    source:
      "https://stellar.expert/explorer/public/asset/CondorAI-GA2IZUQLK56OCXMRPAUL4R46CN62D2MHPHXLOPUL6F6G3JJFHAZF6CYS",
  },
  {
    address: "GA2K4HINJ2PJ4SKVY2TGB5HBKUWQ3IVMJK6TCGCXMHUA67PSI22UOE3Q",
    category: "scam",
    reason:
      "Issuer of the SPACEXAI asset on the unattested domain defi.stellarlumenx.org, reported for illicit or fraudulent activity.",
    reportedAt: "2026-09-29",
    source:
      "https://stellar.expert/explorer/public/asset/SPACEXAI-GA2K4HINJ2PJ4SKVY2TGB5HBKUWQ3IVMJK6TCGCXMHUA67PSI22UOE3Q",
  },
  {
    address: "GBNLJIYH34UWO5YZFA3A3HD3N76R6DOI33N4JONUOHEEYZYCAYTEJ5AK",
    category: "scam",
    reason:
      "Issuer of the RIO \"realio.fund\" asset, reported for illicit or fraudulent activity. The account is flagged as deprecated.",
    reportedAt: "2026-09-29",
    source:
      "https://stellar.expert/explorer/public/asset/RIO-GBNLJIYH34UWO5YZFA3A3HD3N76R6DOI33N4JONUOHEEYZYCAYTEJ5AK",
  },
  {
    address: "GBC7NIEHS6Q4EKHQAB7GPPNUPVVXX43D4VPWNO44X5YTLN4WKZZ53SAR",
    category: "scam",
    reason:
      "Issuer of the BRICS asset, reported for illicit or fraudulent activity.",
    reportedAt: "2026-09-29",
    source:
      "https://stellar.expert/explorer/public/asset/BRICS-GBC7NIEHS6Q4EKHQAB7GPPNUPVVXX43D4VPWNO44X5YTLN4WKZZ53SAR",
  },
];

/**
 * The one wording the interface uses for a registry hit.
 *
 * Duplicated as a constant so the modal, the inline warning and the tests cannot
 * drift: an operator who sees two different severities for the same registry has
 * no way to know which one to trust.
 */
export const CRITICAL_ADDRESS_WARNING =
  "CRITICAL: This address has been flagged as malicious or compromised.";

/**
 * The phrase the operator must type to clear the second gate.
 *
 * A checkbox alone is a click that muscle memory supplies. Requiring a typed
 * phrase makes the override a deliberate act with a visible cost, which is the
 * difference between a warning and a speed bump.
 */
export const OVERRIDE_PHRASE = "PROCEED";

/** Which box on the form an address came from, for the finding's own display. */
export type AddressField = "assets" | "recipients" | "protocols" | "assetCaps";

export interface AddressFinding {
  /** Canonical identity that matched — the underlying `G…` for a muxed entry. */
  address: string;
  /** Exactly what the operator typed, kept so the warning names their input. */
  entered: string;
  field: AddressField;
  entry: RegistryEntry;
  /**
   * True when the operator entered a muxed `M…` form of a flagged `G…` account.
   * Worth calling out on its own: the two strings share no characters, so this
   * is invisible to a character-by-character comparison and is exactly the shape
   * a deliberately obfuscated paste would take.
   */
  viaMuxedAlias: boolean;
}

export interface DraftScreen {
  /** How many address-bearing fields were parsed. */
  checked: number;
  findings: AddressFinding[];
  /** True when at least one entry matched — the modal's trigger condition. */
  flagged: boolean;
  /** Registry identity, echoed in the modal so a reader can date the check. */
  version: string;
  updatedAt: string;
}

/**
 * Canonical identity for a Stellar address, or `null` when it is not one.
 *
 * Muxed accounts resolve to the ed25519 account underneath, because a muxed
 * address is a different string for the same owner and a registry keyed on text
 * would miss it. Contract addresses have no muxed form and pass through
 * unchanged. Anything the SDK cannot parse is rejected rather than passed
 * through: an unparseable string has no identity to compare.
 */
export function canonicalIdentity(raw: string): string | null {
  const trimmed = raw.trim();
  if (trimmed === "") return null;
  let address: Address;
  try {
    address = Address.fromString(trimmed);
  } catch {
    return null;
  }
  if (address.type !== "muxedAccount") return address.toString();
  try {
    return StrKey.encodeEd25519PublicKey(address.toBuffer().subarray(0, 32));
  } catch {
    return null;
  }
}

/** The registry entry for an address's identity, or `null` when it is not listed. */
export function lookupRegistry(raw: string): RegistryEntry | null {
  const identity = canonicalIdentity(raw);
  if (identity === null) return null;
  return MALICIOUS_ADDRESS_REGISTRY.find((entry) => entry.address === identity) ?? null;
}

/** Split a `C…:fnA,fnB` protocol line into its address, mirroring `policyForm`. */
function protocolAddress(line: string): string {
  const colon = line.indexOf(":");
  return (colon < 0 ? line : line.slice(0, colon)).trim();
}

interface Candidate {
  field: AddressField;
  entered: string;
}

/**
 * Every address the draft puts into an allowlist, in the order the form shows
 * them. Exported because the operator-facing count in the modal and the check
 * itself must agree on what was screened.
 */
export function draftAddressCandidates(draft: PolicyDraft): Candidate[] {
  const out: Candidate[] = [];
  const pushLines = (field: AddressField, value: string, map?: (line: string) => string) => {
    for (const line of value.split(/[\n,]/)) {
      const trimmed = line.trim();
      if (trimmed === "") continue;
      out.push({ field, entered: map ? map(trimmed) : trimmed });
    }
  };
  pushLines("assets", draft.assets);
  pushLines("recipients", draft.recipients);
  pushLines("protocols", draft.protocols, protocolAddress);
  for (const row of draft.assetCaps) {
    const trimmed = row.assetContractAddress.trim();
    if (trimmed !== "") out.push({ field: "assetCaps", entered: trimmed });
  }
  return out;
}

/**
 * Cross-reference a draft against the registry.
 *
 * Runs over assets, recipients, protocols and per-asset cap overrides — every
 * box that ends up in a contract-enforced allowlist — rather than over the
 * fields that happen to be called "addresses". It is pure and offline: no
 * lookup leaves the tab, because a check that needs the network to run is a
 * check that fails exactly when it is needed.
 */
export function screenDraft(draft: PolicyDraft): DraftScreen {
  const candidates = draftAddressCandidates(draft);
  const findings: AddressFinding[] = [];
  for (const candidate of candidates) {
    const identity = canonicalIdentity(candidate.entered);
    if (identity === null) continue;
    const entry = MALICIOUS_ADDRESS_REGISTRY.find((item) => item.address === identity);
    if (!entry) continue;
    findings.push({
      address: identity,
      entered: candidate.entered,
      field: candidate.field,
      entry,
      viaMuxedAlias: identity !== candidate.entered.trim(),
    });
  }
  return {
    checked: candidates.length,
    findings,
    flagged: findings.length > 0,
    version: REGISTRY_VERSION,
    updatedAt: REGISTRY_UPDATED_AT,
  };
}

/**
 * A stable fingerprint of the draft's address set.
 *
 * An override is consent to *these* addresses. Binding the cleared state to this
 * key means editing the form after confirming re-arms the gate, so a confirmation
 * cannot be spent on one list of addresses and then spent again on a longer one.
 */
export function screenKey(draft: PolicyDraft): string {
  return draftAddressCandidates(draft)
    .map((candidate) => `${candidate.field}:${canonicalIdentity(candidate.entered) ?? candidate.entered}`)
    .join("|");
}

export interface OverrideState {
  /** First gate: the operator has read and accepted the finding. */
  acknowledged: boolean;
  /** Second gate: what they have typed so far. */
  phrase: string;
}

export const CLOSED_OVERRIDE: OverrideState = { acknowledged: false, phrase: "" };

/**
 * Whether both gates are cleared.
 *
 * Both, not either: a single checkbox is one click, and one click is what this
 * modal exists to interrupt. Whitespace and case are forgiven on the phrase so
 * the gate is about deliberateness rather than about the keyboard.
 */
export function overrideSatisfied(state: OverrideState): boolean {
  return state.acknowledged && state.phrase.trim().toUpperCase() === OVERRIDE_PHRASE;
}

/** The human label for the box a finding came from, in the form's own words. */
export function fieldLabel(field: AddressField): string {
  switch (field) {
    case "assets":
      return "Assets";
    case "recipients":
      return "Recipients";
    case "protocols":
      return "Protocols";
    case "assetCaps":
      return "Per-asset cap overrides";
  }
}
