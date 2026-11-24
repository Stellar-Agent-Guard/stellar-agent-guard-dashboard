/**
 * Contextual help data and utilities for dashboard screens.
 *
 * Provides screen-specific documentation links, grounded terminology definitions,
 * and safety constraints. Designed to never overstate enforcement: distinguishes
 * client-side checks from authoritative on-chain contract enforcement.
 */

export interface HelpDocLink {
  label: string;
  href: string;
  description: string;
}

export interface TermDefinition {
  term: string;
  definition: string;
  contractEnforced: boolean;
}

export interface ScreenHelpContent {
  id: string;
  title: string;
  summary: string;
  safetyConstraints: string[];
  docLinks: HelpDocLink[];
}

export const GROUNDED_TERMINOLOGY: TermDefinition[] = [
  {
    term: "Non-Custodial",
    definition:
      "The console never stores, generates, or transmits secret keys. All transaction signing is performed through your connected external wallet or hardware device.",
    contractEnforced: false,
  },
  {
    term: "Default-Deny",
    definition:
      "In the absence of an installed and valid policy on-chain, the guard contract rejects all agent invocations.",
    contractEnforced: true,
  },
  {
    term: "Stroop",
    definition:
      "The smallest unit of XLM on Stellar (1 XLM = 10,000,000 Stroops). All policy caps and allowances on-chain are measured in Stroops.",
    contractEnforced: true,
  },
  {
    term: "Rolling Window Cap",
    definition:
      "A sliding time window (specified in seconds) limiting the total cumulative amount an agent can transfer across all transactions within that duration.",
    contractEnforced: true,
  },
  {
    term: "Per-Transaction Cap",
    definition:
      "An upper bound on the amount that can be transferred in a single transaction, regardless of the remaining window balance.",
    contractEnforced: true,
  },
  {
    term: "Dead Man's Switch (DMS)",
    definition:
      "An automated failsafe triggered when regular agent heartbeats cease beyond the configured grace period, permitting administrative recovery.",
    contractEnforced: true,
  },
  {
    term: "Admin Freeze",
    definition:
      "An immediate pause mechanism callable exclusively by the admin key to suspend all agent authorizations without revoking contract code.",
    contractEnforced: true,
  },
  {
    term: "Observation vs Commitment",
    definition:
      "Diagnostic events represent pre-flight simulations and refused invocations observed locally. Only committed events sealed in closed ledgers represent finalized state.",
    contractEnforced: false,
  },
];

export const SCREEN_HELP_MAP: Record<string, ScreenHelpContent> = {
  overview: {
    id: "overview",
    title: "Console Overview",
    summary:
      "High-level monitoring interface displaying active guard status, recent telemetry events, and network health.",
    safetyConstraints: [
      "Status reads are derived directly from Soroban RPC and are authoritative.",
      "Actions here are read-only inspection unless an emergency freeze is explicitly initiated.",
    ],
    docLinks: [
      {
        label: "Overview Screen Guide",
        href: "docs/screens/overview.md",
        description: "Guide to interpreting guard status, active policies, and event timelines.",
      },
      {
        label: "Telemetry Export Schema",
        href: "docs/export-schema.md",
        description: "Specification for exported CSV and JSON forensic logs.",
      },
    ],
  },
  policy: {
    id: "policy",
    title: "Policy Configurator",
    summary:
      "Interface for authoring, reviewing, and staging transaction execution boundaries for automated agents.",
    safetyConstraints: [
      "Empty policy equals default-deny: no agent transactions will be permitted on-chain until an active policy is installed.",
      "Changes require an explicit signature from the Admin key.",
      "Limits are strictly evaluated on-chain in Stroops; client calculations are non-authoritative previews.",
    ],
    docLinks: [
      {
        label: "Policy Configurator Documentation",
        href: "docs/screens/policy-configurator.md",
        description:
          "How to configure per-tx caps, rolling windows, asset allowlists, and protocol rules.",
      },
    ],
  },
  deploy: {
    id: "deploy",
    title: "Deployment & Setup Wizard",
    summary:
      "Step-by-step guidance for deploying, initializing, and verifying guard contracts on Soroban.",
    safetyConstraints: [
      "Initialization must be executed once with admin and agent keys; writes are never replayed automatically.",
      "Setup wizard verification re-reads live chain state to confirm policy activation.",
      "Rehearsal mode uses static fixtures with all write actions disabled.",
    ],
    docLinks: [
      {
        label: "Contributing & Architecture",
        href: "docs/guides/contributing-widgets.md",
        description: "Architecture guidelines for guard setup and non-custodial constraints.",
      },
    ],
  },
  telemetry: {
    id: "telemetry",
    title: "Telemetry & Audit Feed",
    summary:
      "Real-time stream of on-chain authorization decisions, heartbeat pings, and simulation diagnostics.",
    safetyConstraints: [
      "Diagnostic events (blocked simulations) never commit to the ledger.",
      "Audit exports preserve exact string representations to prevent numeric precision loss.",
      "All exports explicitly identify data provenance (live-chain vs demo-fixtures).",
    ],
    docLinks: [
      {
        label: "Telemetry Feed Documentation",
        href: "docs/screens/telemetry-feed.md",
        description: "Filtering, grouping, and exporting audit logs from the telemetry feed.",
      },
      {
        label: "Export Schema Reference",
        href: "docs/export-schema.md",
        description: "NDJSON, CSV, and JSON audit log schema definitions.",
      },
    ],
  },
  fleet: {
    id: "fleet",
    title: "Fleet Overview",
    summary:
      "Multi-guard dashboard for managing and monitoring fleets of agent guards across deployments.",
    safetyConstraints: [
      "Each guard row is polled independently; failures in one guard do not impact peers.",
      "Local metadata (tags, labels) is preserved locally and never overwrites on-chain state.",
    ],
    docLinks: [
      {
        label: "Fleet Overview Guide",
        href: "docs/screens/fleet-overview.md",
        description: "Managing fleets, bulk polling, health checks, and tag filters.",
      },
    ],
  },
  webhooks: {
    id: "webhooks",
    title: "Webhook Alert Settings",
    summary:
      "Configure outbound HTTP webhook notifications for security alerts, blocked transactions, and DMS expirations.",
    safetyConstraints: [
      "Webhooks are dispatched client-side from the operator console.",
      "Delivery history is capped to 50 entries and evicted after 24 hours.",
      "Payloads never include secret keys or private wallet credentials.",
    ],
    docLinks: [
      {
        label: "Webhook Settings Guide",
        href: "docs/screens/webhook-settings.md",
        description: "Webhook payloads, HMAC verification, retry policies, and retention.",
      },
    ],
  },
};

/**
 * Determine screen ID from current URL hash or pathname.
 */
export function detectScreenFromHash(hash: string): ScreenHelpContent {
  const cleanHash = hash.replace(/^[#/]+/, "").toLowerCase();
  if (cleanHash.includes("policy")) return SCREEN_HELP_MAP.policy!;
  if (cleanHash.includes("deploy") || cleanHash.includes("setup")) return SCREEN_HELP_MAP.deploy!;
  if (cleanHash.includes("telemetry") || cleanHash.includes("feed"))
    return SCREEN_HELP_MAP.telemetry!;
  if (cleanHash.includes("fleet")) return SCREEN_HELP_MAP.fleet!;
  if (cleanHash.includes("webhook")) return SCREEN_HELP_MAP.webhooks!;
  return SCREEN_HELP_MAP.overview!;
}
