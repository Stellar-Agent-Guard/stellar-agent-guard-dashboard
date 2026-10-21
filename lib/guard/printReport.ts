import type { GuardSnapshot } from "./guardOps.ts";
import { describePolicy, isDeadManFrozen } from "stellar-agent-guard-sdk";

export interface AuditReport {
  contractId: string;
  bytecodeHash: string;
  policyRules: string;
  allowlists: {
    assets: string[];
    recipients: string[];
    protocols: string[];
  };
  adminKey: string;
  dmsStatus: string;
  network: string;
  timestamp: string;
}

/**
 * Incident handoff summary for emergency situations.
 * Contains only non-sensitive operational state that can be safely shared.
 * Excludes private keys, wallet sessions, and signed transaction envelopes.
 */
export interface IncidentSummary {
  /** Label identifying this as a client-generated snapshot */
  label: string;
  /** Time when the snapshot was captured */
  captureTime: string;
  /** Network identity (e.g., "Testnet", "Public") */
  network: string;
  /** Guard contract address */
  guardAddress: string;
  /** Current freeze status */
  freezeStatus: "frozen" | "unfrozen" | "unknown";
  /** Dead-man switch status */
  dmsStatus: "fired" | "expired" | "ok" | "unknown";
  /** Last successful chain read time, or error indication */
  lastRead: string;
  /** Relevant transaction hash if available */
  txHash?: string;
  /** Policy status (installed/not installed) without revealing details */
  policyInstalled: boolean;
  /** Any errors encountered during reads */
  readErrors: string[];
}

export function compilePrintReport(snapshot: GuardSnapshot, networkName: string, adminKey: string): AuditReport {
  const policy = snapshot.policy.ok ? snapshot.policy.value : null;
  const status = snapshot.status.ok ? snapshot.status.value : null;

  return {
    contractId: snapshot.guard,
    bytecodeHash: snapshot.identity.ok ? snapshot.identity.value.reportedWasmHash ?? "-" : "-",
    policyRules: policy ? describePolicy(policy) : "No policy installed",
    allowlists: {
      assets: policy ? policy.assets : [],
      recipients: policy ? (policy.allow_any_recipient ? ["* (Any)"] : policy.recipients) : [],
      protocols: policy ? policy.protocols.map(p => `${p.contract} ${p.fns ? `(${p.fns.join(", ")})` : "(Any)"}`) : [],
    },
    adminKey,
    dmsStatus: status ? (isDeadManFrozen(status) ? "FIRED" : (status.heartbeat_expired ? "EXPIRED" : "OK")) : "UNKNOWN",
    network: networkName,
    timestamp: new Date().toISOString(),
  };
}

/**
 * Compile an incident handoff summary without sensitive data.
 * 
 * This creates a copyable snapshot containing only operational state that can
 * be safely shared during incident response. It explicitly excludes:
 * - Private keys and wallet session details
 * - Signed transaction envelopes
 * - Detailed policy configuration (only presence/absence)
 * 
 * The summary is labeled as client-generated to make clear it's not an audit record.
 */
export function compileIncidentSummary(
  snapshot: GuardSnapshot | null,
  networkName: string,
  options?: {
    txHash?: string;
    lastReadError?: string;
    lastSuccessfulRead?: string;
  }
): IncidentSummary {
  const now = new Date().toISOString();
  const readErrors: string[] = [];
  
  // Determine freeze status from snapshot or mark unknown
  let freezeStatus: "frozen" | "unfrozen" | "unknown" = "unknown";
  let dmsStatus: "fired" | "expired" | "ok" | "unknown" = "unknown";
  let policyInstalled = false;
  let lastRead = options?.lastSuccessfulRead ?? "never";
  
  if (snapshot) {
    // Freeze status
    if (snapshot.status.ok) {
      freezeStatus = snapshot.status.value.admin_frozen ? "frozen" : "unfrozen";
      
      // DMS status
      if (isDeadManFrozen(snapshot.status.value)) {
        dmsStatus = "fired";
      } else if (snapshot.status.value.heartbeat_expired) {
        dmsStatus = "expired";
      } else {
        dmsStatus = "ok";
      }
    } else {
      readErrors.push(`Status read failed: ${snapshot.status.error}`);
      lastRead = "error on last read";
    }
    
    // Policy presence (not details)
    policyInstalled = snapshot.policy.ok;
    
    // Last successful read time
    if (options?.lastSuccessfulRead) {
      lastRead = options.lastSuccessfulRead;
    } else if (snapshot.fetchedAt) {
      lastRead = snapshot.fetchedAt;
    }
  } else {
    readErrors.push("No snapshot available");
    lastRead = options?.lastReadError ?? "no data available";
  }
  
  // Add any explicit read error
  if (options?.lastReadError) {
    readErrors.push(options.lastReadError);
  }

  return {
    label: "CLIENT-GENERATED SNAPSHOT — Not an audit record",
    captureTime: now,
    network: networkName,
    guardAddress: snapshot?.guard ?? "unknown",
    freezeStatus,
    dmsStatus,
    lastRead,
    txHash: options?.txHash,
    policyInstalled,
    readErrors,
  };
}

/**
 * Format an incident summary as copyable text.
 */
export function formatIncidentSummary(summary: IncidentSummary): string {
  const lines = [
    `=== INCIDENT HANDOFF SUMMARY ===`,
    `Label: ${summary.label}`,
    `Captured: ${summary.captureTime}`,
    ``,
    `Network: ${summary.network}`,
    `Guard: ${summary.guardAddress}`,
    `Freeze Status: ${summary.freezeStatus.toUpperCase()}`,
    `DMS Status: ${summary.dmsStatus.toUpperCase()}`,
    `Last Read: ${summary.lastRead}`,
    summary.txHash ? `Transaction: ${summary.txHash}` : null,
    `Policy Installed: ${summary.policyInstalled ? "Yes" : "No"}`,
    summary.readErrors.length > 0 ? `Read Errors: ${summary.readErrors.join("; ")}` : null,
    ``,
    `=== END SNAPSHOT ===`,
  ].filter((line): line is string => line !== null);
  
  return lines.join("\n");
}
