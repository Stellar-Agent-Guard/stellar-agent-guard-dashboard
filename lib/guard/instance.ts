/**
 * Which guard the operator is looking at, and where that list comes from.
 *
 * The defaults are addresses that already exist on testnet because Phases 1 and 2
 * put them there, and each carries its provenance in the label so an operator can
 * tell evidence apart from a deployment of their own. Nothing about an instance is
 * cached here: only the address and its label are remembered, and every number the
 * UI shows is read from the chain on each refresh.
 */

import { PHASE1_ARTIFACT } from "./network.ts";

export interface GuardInstance {
  guard: string;
  label: string;
  /** Where this address came from, shown in the selector. */
  provenance: string;
}

/**
 * The guard a local standalone sandbox deployed, when this build was pointed at
 * one through `NEXT_PUBLIC_GUARD_CONTRACT_ID`.
 *
 * Without it a sandbox build would open on Phase 1's testnet address, which does
 * not exist on a local network, and the console would report every read as a
 * failure — technically honest, but useless for offline development. The address
 * is still only a *seed*: nothing about it is cached, and every number shown for
 * it is read from the local chain.
 */
function sandboxInstance(): GuardInstance | null {
  const guard = process.env.NEXT_PUBLIC_GUARD_CONTRACT_ID?.trim();
  if (!guard || !looksLikeContractAddress(guard)) return null;
  return {
    guard,
    label: "Local sandbox guard",
    provenance: "Deployed by scripts/start-local-sandbox.sh on the local standalone network.",
  };
}

const SANDBOX_INSTANCE = sandboxInstance();

/** The two addresses the earlier phases proved, offered as starting points. */
export const KNOWN_INSTANCES: readonly GuardInstance[] = [
  ...(SANDBOX_INSTANCE ? [SANDBOX_INSTANCE] : []),
  {
    guard: PHASE1_ARTIFACT.guard,
    label: "Phase 1 guard",
    provenance:
      "Phase 1's live instance. Frozen by its own dead-man switch — kept as evidence and deliberately never touched.",
  },
  {
    guard: "CAPADGEK457RHKN4RYVUMDJTFHDSG7R5HREQONKLYK7MFKC5WFENPP44",
    label: "Phase 2 guard",
    provenance: "Phase 2's enforcement instance: the same artifact, used by the SDK's live tests.",
  },
] as const;

const STORAGE_KEY = "stellar-agent-guard-dashboard.instances.v1";

/** Instances the operator has added, plus the known ones. */
export function loadInstances(): GuardInstance[] {
  const stored = readStored();
  const seen = new Set<string>();
  const combined: GuardInstance[] = [];
  for (const instance of [...stored, ...KNOWN_INSTANCES]) {
    if (seen.has(instance.guard)) continue;
    seen.add(instance.guard);
    combined.push(instance);
  }
  return combined;
}

/** Remember an instance the operator added so it survives a reload. */
export function rememberInstance(guard: string, label: string): void {
  if (KNOWN_INSTANCES.some((instance) => instance.guard === guard)) return;
  const stored = readStored();
  if (stored.some((instance) => instance.guard === guard)) return;
  stored.push({ guard, label, provenance: "Added from this browser." });
  writeStored(stored.slice(-20));
}

function readStored(): GuardInstance[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (entry): entry is GuardInstance =>
        typeof entry === "object" && entry !== null && typeof (entry as GuardInstance).guard === "string",
    );
  } catch {
    // A corrupted entry must not stop the dashboard from loading; the known
    // instances are always available.
    return [];
  }
}

function writeStored(instances: GuardInstance[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(instances));
  } catch {
    // Private-mode storage failures are not worth interrupting the operator for.
  }
}

/** A `C…` contract address, checked without pulling in the SDK. */
export function looksLikeContractAddress(value: string): boolean {
  return /^C[A-Z2-7]{55}$/.test(value.trim());
}
