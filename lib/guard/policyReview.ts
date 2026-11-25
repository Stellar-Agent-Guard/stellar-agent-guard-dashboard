import type { PolicyDraft } from "./policyForm.ts";
import { buildPolicyConfig, describeDraft } from "./policyForm.ts";

export interface PolicyReviewItem {
  label: string;
  value: string;
  status?: "valid" | "warning" | "disabled" | "neutral";
}

export interface PolicyReviewModel {
  isDraft: true;
  draftLabel: "DRAFT - NOT SUBMITTED";
  guardAddress: string;
  network: string;
  validation: {
    ok: boolean;
    statusText: string;
    issues: Array<{ field: string; message: string }>;
  };
  summary: string;
  spendingCaps: PolicyReviewItem[];
  inactivity: PolicyReviewItem[];
  activeWindow: PolicyReviewItem[];
  allowlists: {
    allowAnyRecipient: boolean;
    recipients: string[];
    assets: string[];
    assetCaps: Array<{
      contract: string;
      maxCapStroops: string;
      symbol?: string;
    }>;
    protocols: string[];
  };
  operationalState: {
    pausedOnInstall: boolean;
  };
  generatedAt: string;
}

/**
 * Builds a strict read-only policy review data model from a form draft.
 *
 * Guarantees:
 * 1. Labeled prominently as DRAFT - NOT SUBMITTED.
 * 2. Renders draft parameters, guard ID, network name, and validation status.
 * 3. Contains strictly NO wallet, session, signer, or custodial data.
 * 4. Client-only and read-only: does not execute RPC writes or sign transactions.
 */
export function buildPolicyReviewModel(
  draft: PolicyDraft,
  guard: string,
  network: string,
  validationOverride?: ReturnType<typeof buildPolicyConfig>,
): PolicyReviewModel {
  const validation = validationOverride ?? buildPolicyConfig(draft);
  const issues = !validation.ok ? validation.issues : [];

  return {
    isDraft: true,
    draftLabel: "DRAFT - NOT SUBMITTED",
    guardAddress: guard || "Not selected",
    network: network || "Unknown network",
    validation: {
      ok: validation.ok,
      statusText: validation.ok ? "Valid (Ready for Review)" : "Invalid (Issues Detected)",
      issues,
    },
    summary: describeDraft(draft),
    spendingCaps: [
      {
        label: "Per-Transaction Cap",
        value: draft.perTxCap.trim() ? `${draft.perTxCap} SAC stroops` : "Disabled (unrestricted)",
        status: draft.perTxCap.trim() ? "valid" : "disabled",
      },
      {
        label: "Rolling-Window Cap",
        value: draft.windowCap.trim()
          ? `${draft.windowCap} SAC stroops`
          : "Disabled (unrestricted)",
        status: draft.windowCap.trim() ? "valid" : "disabled",
      },
      {
        label: "Rolling-Window Duration",
        value: draft.windowSecs.trim()
          ? `${draft.windowSecs} seconds`
          : "86400 seconds (1 day default)",
        status: "valid",
      },
    ],
    inactivity: [
      {
        label: "Dead-Man Switch Grace",
        value: draft.dmsGraceSecs.trim()
          ? `${draft.dmsGraceSecs} seconds`
          : "Disabled (no inactivity enforcement)",
        status: draft.dmsGraceSecs.trim() ? "valid" : "disabled",
      },
    ],
    activeWindow: [
      {
        label: "Active From (Unix epoch seconds)",
        value: draft.activeFrom.trim() ? draft.activeFrom : "Unrestricted (Genesis)",
      },
      {
        label: "Active Until (Unix epoch seconds)",
        value: draft.activeUntil.trim() ? draft.activeUntil : "Unrestricted (No expiry)",
      },
    ],
    allowlists: {
      allowAnyRecipient: draft.allowAnyRecipient,
      recipients: draft.allowAnyRecipient
        ? ["* Any recipient permitted (caps still apply)"]
        : draft.recipients
            .split("\n")
            .map((s) => s.trim())
            .filter(Boolean),
      assets: draft.assets
        .split("\n")
        .map((s) => s.trim())
        .filter(Boolean),
      assetCaps: (draft.assetCaps || []).map((c) => ({
        contract: c.assetContractAddress,
        maxCapStroops: c.maxCapStroops,
        symbol: c.symbol,
      })),
      protocols: draft.protocols
        .split("\n")
        .map((s) => s.trim())
        .filter(Boolean),
    },
    operationalState: {
      pausedOnInstall: draft.paused,
    },
    generatedAt: new Date().toISOString(),
  };
}
