import type { PolicyConfig } from "stellar-agent-guard-sdk";

export interface DiffEntry {
  field: keyof PolicyConfig;
  oldValue: unknown;
  newValue: unknown;
  status: "added" | "removed" | "modified" | "unchanged";
}

export interface PolicyDiff {
  entries: DiffEntry[];
  warnings: string[];
  highImpact: boolean;
  highImpactReasons: string[];
}

function sameValue(left: unknown, right: unknown): boolean {
  return (
    JSON.stringify(left, (_key, value) => (typeof value === "bigint" ? value.toString() : value)) ===
    JSON.stringify(right, (_key, value) => (typeof value === "bigint" ? value.toString() : value))
  );
}

/** Zero disables a cap, so moving from a positive cap to zero broadens authority. */
function capIncreased(previous: bigint, next: bigint): boolean {
  return next === 0n ? previous > 0n : previous > 0n && next > previous;
}

function setGrowth(previous: readonly string[], next: readonly string[]): boolean {
  return next.some((value) => !previous.includes(value));
}

export function computePolicyDiff(
  oldConfig: PolicyConfig | null,
  newConfig: PolicyConfig,
): PolicyDiff {
  const entries: DiffEntry[] = [];
  const warnings: string[] = [];
  const highImpactReasons: string[] = [];

  if (!oldConfig) {
    return {
      entries: Object.keys(newConfig).map((key) => ({
        field: key as keyof PolicyConfig,
        oldValue: undefined,
        newValue: newConfig[key as keyof PolicyConfig],
        status: "added",
      })),
      warnings: [],
      highImpact: true,
      highImpactReasons: ["No policy is currently installed; review the authority this policy will grant."],
    };
  }

  for (const key of Object.keys(newConfig) as Array<keyof PolicyConfig>) {
    const oldValue = oldConfig[key];
    const newValue = newConfig[key];
    entries.push({
      field: key,
      oldValue,
      newValue,
      status: sameValue(oldValue, newValue) ? "unchanged" : "modified",
    });
  }

  if (capIncreased(oldConfig.per_tx_cap, newConfig.per_tx_cap)) {
    highImpactReasons.push("The per-transaction spending cap increases or becomes unlimited.");
  }
  if (capIncreased(oldConfig.window_cap, newConfig.window_cap)) {
    highImpactReasons.push("The rolling-window spending cap increases or becomes unlimited.");
  }

  if (newConfig.window_cap > 0n && oldConfig.window_cap > 0n && newConfig.window_cap < oldConfig.window_cap) {
    warnings.push("New policy lowers the rolling-window cap.");
  }
  if (
    oldConfig.window_secs > 0n &&
    newConfig.window_secs > 0n &&
    newConfig.window_secs < oldConfig.window_secs
  ) {
    highImpactReasons.push("The rolling-window duration is shortened, allowing the cap to reset sooner.");
  }
  if (
    newConfig.dms_grace_secs > 0n &&
    oldConfig.dms_grace_secs > 0n &&
    newConfig.dms_grace_secs < oldConfig.dms_grace_secs
  ) {
    warnings.push("New policy shortens the dead-man switch grace period.");
    highImpactReasons.push("The dead-man switch grace period is shortened.");
  }
  if (oldConfig.dms_grace_secs > 0n && newConfig.dms_grace_secs === 0n) {
    warnings.push("New policy disables the dead-man switch grace period.");
    highImpactReasons.push("The dead-man switch is disabled.");
  }

  if (oldConfig.paused && !newConfig.paused) {
    highImpactReasons.push("The policy will no longer start paused.");
  }

  if (!oldConfig.allow_any_recipient && newConfig.allow_any_recipient) {
    highImpactReasons.push("Transfers to any recipient will be allowed.");
  } else if (oldConfig.allow_any_recipient && !newConfig.allow_any_recipient) {
    warnings.push("The policy restricts transfers to the configured recipient allowlist.");
  } else if (!newConfig.allow_any_recipient && setGrowth(oldConfig.recipients, newConfig.recipients)) {
    highImpactReasons.push("The recipient allowlist is expanded.");
  }

  if (setGrowth(oldConfig.assets, newConfig.assets)) {
    highImpactReasons.push("The asset allowlist is expanded.");
  }

  const protocolGrowth = newConfig.protocols.some((nextRule) => {
    const previousRule = oldConfig.protocols.find((rule) => rule.contract === nextRule.contract);
    if (!previousRule) return true;
    if (previousRule.fns === null) return false;
    if (nextRule.fns === null) return true;
    return nextRule.fns.some((fn) => !previousRule.fns?.includes(fn));
  });
  if (protocolGrowth) {
    highImpactReasons.push("The protocol allowlist is expanded.");
  }

  // Expanding a bounded active window can authorize calls at times previously excluded.
  const startsEarlier =
    oldConfig.active_from > 0n && (newConfig.active_from === 0n || newConfig.active_from < oldConfig.active_from);
  const endsLater =
    oldConfig.active_until > 0n &&
    (newConfig.active_until === 0n || newConfig.active_until > oldConfig.active_until);
  if (startsEarlier || endsLater) {
    highImpactReasons.push("The active execution window is broadened.");
  }

  return {
    entries,
    warnings,
    highImpact: highImpactReasons.length > 0,
    highImpactReasons,
  };
}
