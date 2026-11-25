import { rpc } from "@stellar/stellar-sdk";
import type { Contact } from "./addressBook.ts";
import * as guardOps from "./guardOps.ts";
import type { GuardSnapshot } from "./guardOps.ts";
import { NETWORK, DEFAULT_FLEET_PROBE_CONCURRENCY } from "./network.ts";
import { formatStroops } from "./formatters.ts";
import type { StorageLike } from "./instance.ts";

export type DerivedStatus = "Active" | "Frozen" | "Expired" | "Unknown";

export { DEFAULT_FLEET_PROBE_CONCURRENCY };

export interface PolicyAge {
  derivable: boolean;
  ageSecs: bigint | null;
  display: string;
}

export interface FleetRow {
  contact: Contact;
  snapshot: GuardSnapshot | null;
  error?: string | undefined;
  derivedStatus: DerivedStatus;
  spend24h: bigint;
  dmsCountdownSecs: bigint | null;
  network: string;
  tags?: string[] | undefined;
  displayName?: string | undefined;
  policyAge?: PolicyAge | undefined;
  retry?: (() => Promise<FleetRow>) | undefined;
}

export type ReadSnapshotFn = typeof guardOps.readGuardSnapshot;

export interface PollFleetOptions {
  /** Maximum concurrent probe requests in flight. Defaults to DEFAULT_FLEET_PROBE_CONCURRENCY (5). */
  concurrency?: number;
  /** Optional cancellation signal to abort ongoing and queued probes on context change. */
  signal?: AbortSignal;
  /** Custom read snapshot function, defaults to guardOps.readGuardSnapshot. */
  readSnapshot?: ReadSnapshotFn;
  /** Optional storage interface for tags and display names. */
  storage?: StorageLike | null;
}
function defaultStorage(): StorageLike | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

// ── Policy installation age (issue #474) ───────────────────────────────────

export function formatAge(seconds: bigint): string {
  const s = Number(seconds);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  return `${d}d`;
}

/**
 * Derives the policy installation age strictly from chain data.
 * When either active_from or the status timestamp is unavailable, returns 'unavailable'.
 * Never infers age from client clocks or local edits.
 */
export function derivePolicyAge(snapshot: GuardSnapshot | null): PolicyAge {
  if (
    !snapshot ||
    !snapshot.status ||
    !snapshot.status.ok ||
    !snapshot.status.value ||
    !snapshot.policy ||
    !snapshot.policy.ok ||
    !snapshot.policy.value
  ) {
    return { derivable: false, ageSecs: null, display: "unavailable" };
  }
  const now = snapshot.status.value.now;
  const activeFrom = snapshot.policy.value.active_from;
  if (typeof activeFrom !== "bigint" || activeFrom <= 0n || now < activeFrom) {
    return { derivable: false, ageSecs: null, display: "unavailable" };
  }
  const ageSecs = now - activeFrom;
  return { derivable: true, ageSecs, display: formatAge(ageSecs) };
}

// ── Browser-local operator tags (issue #472) ───────────────────────────────

export const FLEET_TAGS_STORAGE_KEY = "stellar-agent-guard-dashboard.fleet-tags.v1";

export function loadFleetTags(
  network: string,
  storage?: StorageLike | null,
): Record<string, string[]> {
  const s = storage === undefined ? defaultStorage() : storage;
  if (!s) return {};
  try {
    const raw = s.getItem(FLEET_TAGS_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return {};
    const netTags = (parsed as Record<string, unknown>)[network];
    if (typeof netTags !== "object" || netTags === null || Array.isArray(netTags)) return {};
    const result: Record<string, string[]> = {};
    for (const [addr, tags] of Object.entries(netTags as Record<string, unknown>)) {
      if (Array.isArray(tags)) {
        result[addr] = tags.filter(
          (t): t is string => typeof t === "string" && t.trim().length > 0,
        );
      }
    }
    return result;
  } catch {
    return {};
  }
}

export function saveFleetTags(
  network: string,
  tagsByAddress: Record<string, string[]>,
  storage?: StorageLike | null,
): void {
  const s = storage === undefined ? defaultStorage() : storage;
  if (!s) return;
  try {
    let allData: Record<string, Record<string, string[]>> = {};
    const raw = s.getItem(FLEET_TAGS_STORAGE_KEY);
    if (raw) {
      try {
        const parsed = JSON.parse(raw);
        if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
          allData = parsed as Record<string, Record<string, string[]>>;
        }
      } catch {}
    }
    allData[network] = tagsByAddress;
    s.setItem(FLEET_TAGS_STORAGE_KEY, JSON.stringify(allData));
  } catch {}
}

export function getGuardTags(
  network: string,
  address: string,
  storage?: StorageLike | null,
): string[] {
  const map = loadFleetTags(network, storage);
  return map[address] ?? [];
}

export function addGuardTag(
  network: string,
  address: string,
  tag: string,
  storage?: StorageLike | null,
): string[] {
  const clean = tag.trim().toLowerCase();
  if (!clean) return getGuardTags(network, address, storage);
  const map = loadFleetTags(network, storage);
  const existing = map[address] ?? [];
  if (!existing.includes(clean)) {
    const updated = [...existing, clean];
    map[address] = updated;
    saveFleetTags(network, map, storage);
    return updated;
  }
  return existing;
}

export function removeGuardTag(
  network: string,
  address: string,
  tag: string,
  storage?: StorageLike | null,
): string[] {
  const clean = tag.trim().toLowerCase();
  const map = loadFleetTags(network, storage);
  const existing = map[address] ?? [];
  const updated = existing.filter((t) => t !== clean);
  map[address] = updated;
  saveFleetTags(network, map, storage);
  return updated;
}

export function getAllFleetTags(network: string, storage?: StorageLike | null): string[] {
  const map = loadFleetTags(network, storage);
  const tagSet = new Set<string>();
  for (const tags of Object.values(map)) {
    for (const t of tags) tagSet.add(t);
  }
  return Array.from(tagSet).sort();
}

// ── Preferred local display names (issue #473) ─────────────────────────────

export const FLEET_DISPLAY_NAMES_STORAGE_KEY =
  "stellar-agent-guard-dashboard.fleet-display-names.v1";

export function loadFleetDisplayNames(
  network: string,
  storage?: StorageLike | null,
): Record<string, string> {
  const s = storage === undefined ? defaultStorage() : storage;
  if (!s) return {};
  try {
    const raw = s.getItem(FLEET_DISPLAY_NAMES_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return {};
    const netNames = (parsed as Record<string, unknown>)[network];
    if (typeof netNames !== "object" || netNames === null || Array.isArray(netNames)) return {};
    const result: Record<string, string> = {};
    for (const [addr, name] of Object.entries(netNames as Record<string, unknown>)) {
      if (typeof name === "string" && name.trim().length > 0) {
        result[addr] = name.trim();
      }
    }
    return result;
  } catch {
    return {};
  }
}

export function saveFleetDisplayNames(
  network: string,
  namesByAddress: Record<string, string>,
  storage?: StorageLike | null,
): void {
  const s = storage === undefined ? defaultStorage() : storage;
  if (!s) return;
  try {
    let allData: Record<string, Record<string, string>> = {};
    const raw = s.getItem(FLEET_DISPLAY_NAMES_STORAGE_KEY);
    if (raw) {
      try {
        const parsed = JSON.parse(raw);
        if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
          allData = parsed as Record<string, Record<string, string>>;
        }
      } catch {}
    }
    allData[network] = namesByAddress;
    s.setItem(FLEET_DISPLAY_NAMES_STORAGE_KEY, JSON.stringify(allData));
  } catch {}
}

export function getPreferredDisplayName(
  network: string,
  address: string,
  fallback = "",
  storage?: StorageLike | null,
): string {
  const map = loadFleetDisplayNames(network, storage);
  return map[address] || fallback || address;
}

export function setPreferredDisplayName(
  network: string,
  address: string,
  name: string,
  storage?: StorageLike | null,
): void {
  const clean = name.trim();
  const map = loadFleetDisplayNames(network, storage);
  if (!clean) {
    delete map[address];
  } else {
    map[address] = clean;
  }
  saveFleetDisplayNames(network, map, storage);
}

// ── Read-only fleet risk summary (issue #475) ──────────────────────────────

export interface FleetRiskItem {
  address: string;
  label: string;
}

export interface FleetRiskSummary {
  totalGuards: number;
  successfulReads: number;
  frozen: FleetRiskItem[];
  expiredDms: FleetRiskItem[];
  missingPolicy: FleetRiskItem[];
  activeHealthy: FleetRiskItem[];
  failedOrExcluded: Array<{ address: string; label: string; error?: string | undefined }>;
}

export function computeFleetRiskSummary(rows: FleetRow[]): FleetRiskSummary {
  const frozen: FleetRiskItem[] = [];
  const expiredDms: FleetRiskItem[] = [];
  const missingPolicy: FleetRiskItem[] = [];
  const activeHealthy: FleetRiskItem[] = [];
  const failedOrExcluded: Array<{ address: string; label: string; error?: string | undefined }> =
    [];

  for (const row of rows) {
    if (!row.snapshot || !row.snapshot.status || !row.snapshot.status.ok) {
      failedOrExcluded.push({
        address: row.contact.address,
        label: row.displayName || row.contact.label,
        ...(row.error !== undefined ? { error: row.error } : {}),
      });
      continue;
    }

    const item: FleetRiskItem = {
      address: row.contact.address,
      label: row.displayName || row.contact.label,
    };
    let hasRisk = false;

    if (row.derivedStatus === "Frozen") {
      frozen.push(item);
      hasRisk = true;
    }
    if (row.derivedStatus === "Expired") {
      expiredDms.push(item);
      hasRisk = true;
    }
    if (row.snapshot.policy && row.snapshot.policy.ok && row.snapshot.policy.value === null) {
      missingPolicy.push(item);
      hasRisk = true;
    }
    if (!hasRisk && row.derivedStatus === "Active") {
      activeHealthy.push(item);
    }
  }

  return {
    totalGuards: rows.length,
    successfulReads: rows.length - failedOrExcluded.length,
    frozen,
    expiredDms,
    missingPolicy,
    activeHealthy,
    failedOrExcluded,
  };
}

// ── Polling & Filtering ────────────────────────────────────────────────────

export async function pollFleet(
  server: rpc.Server,
  contacts: Contact[],
  optionsOrReadSnapshot?: PollFleetOptions | ReadSnapshotFn,
  storageOrLegacyOptions?: StorageLike | null | PollFleetOptions,
): Promise<FleetRow[]> {
  const isFn = typeof optionsOrReadSnapshot === "function";
  let _readSnapshot: ReadSnapshotFn;
  let opts: PollFleetOptions = {};
  let storage: StorageLike | null = defaultStorage();

  if (isFn) {
    _readSnapshot = optionsOrReadSnapshot;
    if (storageOrLegacyOptions) {
      if ("getItem" in storageOrLegacyOptions || "setItem" in storageOrLegacyOptions) {
        storage = storageOrLegacyOptions as StorageLike;
      } else if (
        "concurrency" in storageOrLegacyOptions ||
        "signal" in storageOrLegacyOptions ||
        "readSnapshot" in storageOrLegacyOptions ||
        "storage" in storageOrLegacyOptions
      ) {
        opts = storageOrLegacyOptions as PollFleetOptions;
        if (opts.storage !== undefined) {
          storage = opts.storage;
        }
      } else {
        storage = storageOrLegacyOptions as StorageLike | null;
      }
    } else if (storageOrLegacyOptions === null) {
      storage = null;
    }
  } else {
    opts = optionsOrReadSnapshot ?? {};
    _readSnapshot = opts.readSnapshot ?? guardOps.readGuardSnapshot;
    if (opts.storage !== undefined) {
      storage = opts.storage;
    } else if (
      storageOrLegacyOptions &&
      ("getItem" in storageOrLegacyOptions || "setItem" in storageOrLegacyOptions)
    ) {
      storage = storageOrLegacyOptions as StorageLike;
    } else if (storageOrLegacyOptions === null) {
      storage = null;
    }
  }

  const concurrency = Math.max(1, opts.concurrency ?? DEFAULT_FLEET_PROBE_CONCURRENCY);
  const signal = opts.signal;

  const rows: FleetRow[] = new Array(contacts.length);
  let nextIndex = 0;

  async function probeContact(contact: Contact, index: number): Promise<void> {
    const tags = getGuardTags(NETWORK.name, contact.address, storage);
    const displayName = getPreferredDisplayName(
      NETWORK.name,
      contact.address,
      contact.label,
      storage,
    );

    if (signal?.aborted) {
      rows[index] = {
        contact,
        snapshot: null,
        error: "Probe cancelled on context change",
        derivedStatus: "Unknown",
        spend24h: 0n,
        dmsCountdownSecs: null,
        network: NETWORK.name,
        tags,
        displayName,
        policyAge: { derivable: false, ageSecs: null, display: "unavailable" },
        retry: async (): Promise<FleetRow> => {
          const results = await pollFleet(server, [contact], {
            readSnapshot: _readSnapshot,
            storage,
          });
          return results[0]!;
        },
      };
      return;
    }

    try {
      const snapshot = await _readSnapshot(server, contact.address);
      if (signal?.aborted) {
        rows[index] = {
          contact,
          snapshot: null,
          error: "Probe cancelled on context change",
          derivedStatus: "Unknown",
          spend24h: 0n,
          dmsCountdownSecs: null,
          network: NETWORK.name,
          tags,
          displayName,
          policyAge: { derivable: false, ageSecs: null, display: "unavailable" },
          retry: async (): Promise<FleetRow> => {
            const results = await pollFleet(server, [contact], {
              readSnapshot: _readSnapshot,
              storage,
            });
            return results[0]!;
          },
        };
        return;
      }

      let derivedStatus: DerivedStatus = "Unknown";
      let dmsCountdownSecs: bigint | null = null;
      let spend24h = 0n;

      if (snapshot.status.ok) {
        const s = snapshot.status.value;
        if (
          s &&
          typeof s === "object" &&
          typeof s.admin_frozen === "boolean" &&
          typeof s.heartbeat_expired === "boolean"
        ) {
          if (s.admin_frozen) {
            derivedStatus = "Frozen";
          } else if (s.heartbeat_expired) {
            derivedStatus = "Expired";
          } else {
            derivedStatus = "Active";
          }

          if (snapshot.policy.ok && snapshot.policy.value) {
            const grace = snapshot.policy.value.dms_grace_secs;
            const lastHb = s.last_heartbeat;
            const now = s.now;
            if (
              typeof grace === "bigint" &&
              typeof lastHb === "bigint" &&
              typeof now === "bigint"
            ) {
              if (grace > 0n && lastHb > 0n) {
                const remaining = lastHb + grace - now;
                dmsCountdownSecs = remaining > 0n ? remaining : 0n;
              }
            }
          }
        } else {
          derivedStatus = "Unknown";
        }
      }

      if (snapshot.window.ok && snapshot.window.value) {
        spend24h = snapshot.window.value.total;
      }

      rows[index] = {
        contact,
        snapshot,
        derivedStatus,
        spend24h,
        dmsCountdownSecs,
        network: NETWORK.name,
        tags: getGuardTags(NETWORK.name, contact.address, storage),
        displayName: getPreferredDisplayName(NETWORK.name, contact.address, contact.label, storage),
        policyAge: derivePolicyAge(snapshot),
        retry: async (): Promise<FleetRow> => {
          const results = await pollFleet(server, [contact], _readSnapshot, storage);
          return results[0]!;
        },
      };
    } catch (error) {
      rows[index] = {
        contact,
        snapshot: null,
        error: error instanceof Error ? error.message : String(error),
        derivedStatus: "Unknown",
        spend24h: 0n,
        dmsCountdownSecs: null,
        network: NETWORK.name,
        tags: getGuardTags(NETWORK.name, contact.address, storage),
        displayName: getPreferredDisplayName(NETWORK.name, contact.address, contact.label, storage),
        policyAge: { derivable: false, ageSecs: null, display: "unavailable" },
        retry: async (): Promise<FleetRow> => {
          const results = await pollFleet(server, [contact], _readSnapshot, storage);
          return results[0]!;
        },
      };
    }
  }

  const workerCount = Math.min(concurrency, contacts.length);
  if (workerCount === 0) return [];

  const workers = Array.from({ length: workerCount }, async () => {
    while (nextIndex < contacts.length) {
      if (signal?.aborted) {
        while (nextIndex < contacts.length) {
          const i = nextIndex++;
          await probeContact(contacts[i]!, i);
        }
        break;
      }
      const i = nextIndex++;
      await probeContact(contacts[i]!, i);
    }
  });

  await Promise.all(workers);
  return rows;
}

export function filterFleet(
  rows: FleetRow[],
  search: string,
  networkFilter: string | null,
  statusFilter: DerivedStatus | null,
  tagFilter?: string | null | undefined,
): FleetRow[] {
  const q = search.toLowerCase().trim();
  return rows.filter((row) => {
    if (networkFilter && row.network !== networkFilter) return false;
    if (statusFilter && row.derivedStatus !== statusFilter) return false;
    if (tagFilter && (!row.tags || !row.tags.includes(tagFilter))) return false;
    if (q) {
      const displayNameMatch = row.displayName ? row.displayName.toLowerCase().includes(q) : false;
      const labelMatch = row.contact.label.toLowerCase().includes(q);
      const addressMatch = row.contact.address.toLowerCase().includes(q);
      const tagMatch = row.tags ? row.tags.some((t) => t.toLowerCase().includes(q)) : false;
      if (!displayNameMatch && !labelMatch && !addressMatch && !tagMatch) return false;
    }
    return true;
  });
}

export type SortKey = "label" | "address" | "status" | "spend" | "expiration" | "age";

export type SortDirection = "asc" | "desc";

/** Every sort key, in the order the table's sort control lists them. */
export const SORT_KEYS: readonly SortKey[] = [
  "label",
  "address",
  "status",
  "spend",
  "expiration",
  "age",
];

/**
 * The direction a key sorts in before the operator flips it: spend is
 * "biggest first" (the existing behaviour), everything else reads ascending.
 */
export function defaultSortDirection(key: SortKey): SortDirection {
  return key === "spend" ? "desc" : "asc";
}

/**
 * Where each live status sits when sorting by status, ascending: the rows that
 * need an operator first. `Unknown` (the read failed or was never made) has its
 * own rank between the unhealthy states and `Active`, so an unread guard is
 * never grouped with — or mistaken for — a guard confirmed healthy.
 */
export const STATUS_SORT_RANK: Readonly<Record<DerivedStatus, number>> = {
  Frozen: 0,
  Expired: 1,
  Unknown: 2,
  Active: 3,
};

/**
 * Label order that is the same on every machine and reads the way people expect:
 * case-insensitive, with digit runs compared as numbers ("Guard 2" before
 * "Guard 10").
 */
const LABEL_COLLATOR = new Intl.Collator("en", { sensitivity: "base", numeric: true });

function compareBigint(a: bigint, b: bigint): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function compareByKey(a: FleetRow, b: FleetRow, key: SortKey): number {
  switch (key) {
    case "label": {
      const nameA = a.displayName || a.contact.label;
      const nameB = b.displayName || b.contact.label;
      return LABEL_COLLATOR.compare(nameA, nameB);
    }
    case "address":
      return a.contact.address < b.contact.address
        ? -1
        : a.contact.address > b.contact.address
          ? 1
          : 0;
    case "status":
      return STATUS_SORT_RANK[a.derivedStatus] - STATUS_SORT_RANK[b.derivedStatus];
    case "spend":
      return compareBigint(a.spend24h, b.spend24h);
    case "expiration":
      // Callers handle missing countdowns before reaching here.
      return compareBigint(a.dmsCountdownSecs ?? 0n, b.dmsCountdownSecs ?? 0n);
    case "age":
      return compareBigint(a.policyAge?.ageSecs ?? -1n, b.policyAge?.ageSecs ?? -1n);
  }
}

/**
 * Sort fleet rows deterministically, without mutating the input.
 */
export function sortFleet(
  rows: FleetRow[],
  sortKey: SortKey | null,
  direction: SortDirection = sortKey ? defaultSortDirection(sortKey) : "asc",
): FleetRow[] {
  if (!sortKey) return rows;
  const sign = direction === "desc" ? -1 : 1;
  return rows
    .map((row, index) => ({ row, index }))
    .sort((a, b) => {
      if (sortKey === "expiration") {
        const aMissing = a.row.dmsCountdownSecs === null;
        const bMissing = b.row.dmsCountdownSecs === null;
        if (aMissing !== bMissing) return aMissing ? 1 : -1;
        if (aMissing && bMissing) return a.index - b.index;
      }
      if (sortKey === "age") {
        const aMissing =
          a.row.policyAge?.ageSecs === null || a.row.policyAge?.ageSecs === undefined;
        const bMissing =
          b.row.policyAge?.ageSecs === null || b.row.policyAge?.ageSecs === undefined;
        if (aMissing !== bMissing) return aMissing ? 1 : -1;
        if (aMissing && bMissing) return a.index - b.index;
      }
      const byKey = compareByKey(a.row, b.row, sortKey) * sign;
      return byKey !== 0 ? byKey : a.index - b.index;
    })
    .map((entry) => entry.row);
}

// ── Multi-Guard Policy Review Report (Issue #477) ──────────────────────────

export interface FleetPolicyReportEntry {
  guard: string;
  label: string;
  network: string;
  readOutcome: "success" | "failed";
  error: string | null;
  hasPolicy: boolean | null;
  policySummary: string;
  adminFrozen: boolean | null;
  heartbeatExpired: boolean | null;
  dmsGraceSecs: string | null;
}

export interface FleetPolicyReport {
  capturedAt: string;
  totalGuards: number;
  successfulReads: number;
  failedReads: number;
  isPartial: boolean;
  network: string;
  entries: FleetPolicyReportEntry[];
}

/**
 * Generate a safe multi-guard policy review report from fleet rows.
 *
 * Failed reads are surfaced explicitly as failures with their respective error messages,
 * ensuring auditors never mistake an unread contract for an empty policy.
 */
export function generateFleetPolicyReport(
  rows: readonly FleetRow[],
  capturedAt: Date = new Date(),
): FleetPolicyReport {
  const entries: FleetPolicyReportEntry[] = rows.map((row) => {
    const snap = row.snapshot;
    const statusResult = snap?.status;
    const readFailed = Boolean(row.error || !statusResult || !statusResult.ok);
    if (readFailed || !statusResult || !statusResult.ok) {
      const errorMsg =
        row.error || (!statusResult?.ok ? statusResult?.error : undefined) || "Read failed";
      return {
        guard: row.contact.address,
        label: row.contact.label,
        network: row.network,
        readOutcome: "failed",
        error: errorMsg,
        hasPolicy: null,
        policySummary: `[READ FAILED: ${errorMsg}]`,
        adminFrozen: null,
        heartbeatExpired: null,
        dmsGraceSecs: null,
      };
    }

    const statusVal = statusResult.value;
    const policyOk = snap?.policy.ok;
    const policyVal = snap?.policy.ok ? snap.policy.value : null;
    const policyErr = snap && !snap.policy.ok ? snap.policy.error : null;

    let policySummary = "No Policy (Default-Deny)";
    if (statusVal.has_policy && policyVal) {
      const perTx = formatStroops(policyVal.per_tx_cap);
      const windowCap = formatStroops(policyVal.window_cap);
      policySummary = `Per-Tx: ${perTx} XLM, Window: ${windowCap} XLM (${policyVal.window_secs}s)`;
    } else if (!policyOk && policyErr) {
      policySummary = `[POLICY READ ERROR: ${policyErr}]`;
    }

    return {
      guard: row.contact.address,
      label: row.contact.label,
      network: row.network,
      readOutcome: "success",
      error: null,
      hasPolicy: statusVal.has_policy,
      policySummary,
      adminFrozen: statusVal.admin_frozen,
      heartbeatExpired: statusVal.heartbeat_expired,
      dmsGraceSecs: policyVal ? String(policyVal.dms_grace_secs) : null,
    };
  });

  const failedReads = entries.filter((e) => e.readOutcome === "failed").length;
  const successfulReads = entries.length - failedReads;

  return {
    capturedAt: capturedAt.toISOString(),
    totalGuards: entries.length,
    successfulReads,
    failedReads,
    isPartial: failedReads > 0,
    network: rows[0]?.network ?? NETWORK.name,
    entries,
  };
}

/**
 * Render policy report in human-readable Markdown format for forensic review.
 */
export function formatFleetPolicyReportMarkdown(report: FleetPolicyReport): string {
  const lines: string[] = [
    `# Fleet Policy Review Report`,
    ``,
    `- Captured At: ${report.capturedAt}`,
    `- Network: ${report.network}`,
    `- Total Guards: ${report.totalGuards}`,
    `- Successful Reads: ${report.successfulReads}`,
    `- Failed Reads: ${report.failedReads}`,
    `- Report Status: ${report.isPartial ? "PARTIAL (One or more guard reads failed)" : "COMPLETE"}`,
    ``,
    `| Guard Address | Label | Read Outcome | Has Policy | Policy Summary | Freeze | DMS Grace |`,
    `| --- | --- | --- | --- | --- | --- | --- |`,
  ];

  for (const e of report.entries) {
    lines.push(
      `| \`${e.guard}\` | ${e.label} | ${e.readOutcome} | ${e.hasPolicy === null ? "N/A" : e.hasPolicy ? "Yes" : "No"} | ${e.policySummary} | ${e.adminFrozen ? "FROZEN" : "No"} | ${e.dmsGraceSecs ?? "N/A"} |`,
    );
  }
  return lines.join("\n");
}
