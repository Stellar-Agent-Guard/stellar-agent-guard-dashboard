import type { PolicyConfig } from "stellar-agent-guard-sdk";

export interface DiffEntry {
  field: keyof PolicyConfig;
  oldValue: any;
  newValue: any;
  status: "added" | "removed" | "modified" | "unchanged";
}

export interface PolicyDiff {
  entries: DiffEntry[];
  warnings: string[];
}

export function computePolicyDiff(
  oldConfig: PolicyConfig | null,
  newConfig: PolicyConfig,
): PolicyDiff {
  const entries: DiffEntry[] = [];
  const warnings: string[] = [];

  if (!oldConfig) {
    return {
      entries: Object.keys(newConfig).map((k) => ({
        field: k as keyof PolicyConfig,
        oldValue: undefined,
        newValue: (newConfig as any)[k],
        status: "added",
      })),
      warnings: [],
    };
  }

  for (const key of Object.keys(newConfig) as Array<keyof PolicyConfig>) {
    const oldVal = oldConfig[key];
    const newVal = newConfig[key];

    let status: DiffEntry["status"] = "unchanged";
    if (
      JSON.stringify(oldVal, (k, v) => (typeof v === "bigint" ? v.toString() : v)) !==
      JSON.stringify(newVal, (k, v) => (typeof v === "bigint" ? v.toString() : v))
    ) {
      status = "modified";
    }

    entries.push({
      field: key,
      oldValue: oldVal,
      newValue: newVal,
      status,
    });
  }

  if (
    newConfig.window_cap > 0n &&
    oldConfig.window_cap > 0n &&
    newConfig.window_cap < oldConfig.window_cap
  ) {
    warnings.push("New policy lowers the rolling-window cap.");
  }

  if (
    newConfig.dms_grace_secs > 0n &&
    oldConfig.dms_grace_secs > 0n &&
    newConfig.dms_grace_secs < oldConfig.dms_grace_secs
  ) {
    warnings.push("New policy shortens the dead-man switch grace period.");
  }

  return { entries, warnings };
}

/**
 * A named policy configuration profile bundled with optional network and guard context.
 */
export interface PolicyProfile {
  name: string;
  network?: string;
  guard?: string;
  config: PolicyConfig;
  description?: string;
}

/**
 * Side-by-side comparison result between two policy profiles.
 */
export interface PolicyProfileComparison {
  left: PolicyProfile;
  right: PolicyProfile;
  diff: PolicyDiff;
  networkMismatch: boolean;
  networkMismatchWarning?: string | undefined;
  hasChanges: boolean;
  changeCount: number;
}

/**
 * Compares two policy profiles side-by-side without applying either and without RPC writes.
 *
 * Guarantees:
 * - Pure computation with zero side effects or RPC mutations.
 * - Highlights differences between fields.
 * - Prominently flags network mismatches when profiles target different networks (e.g. Testnet vs Mainnet).
 */
export function comparePolicyProfiles(
  profileA: PolicyProfile,
  profileB: PolicyProfile,
): PolicyProfileComparison {
  const diff = computePolicyDiff(profileA.config, profileB.config);
  const changedEntries = diff.entries.filter((entry) => entry.status !== "unchanged");

  const netA = profileA.network?.trim() || "";
  const netB = profileB.network?.trim() || "";
  const networkMismatch = Boolean(netA && netB && netA.toLowerCase() !== netB.toLowerCase());

  let networkMismatchWarning: string | undefined;
  if (networkMismatch) {
    networkMismatchWarning = `Network mismatch detected: "${profileA.name}" targets ${netA}, while "${profileB.name}" targets ${netB}. Token and contract addresses are network-specific and cannot be safely transferred between distinct networks.`;
  }

  return {
    left: profileA,
    right: profileB,
    diff,
    networkMismatch,
    ...(networkMismatchWarning !== undefined ? { networkMismatchWarning } : {}),
    hasChanges: changedEntries.length > 0,
    changeCount: changedEntries.length,
  };
}
