"use client";

import { useState } from "react";
import {
  NETWORK,
  redactEndpointUrl,
  safeCopyEndpoint,
  sanitizeEndpointOrigin,
  probeReadOnlyEndpoint,
  rehearseEndpointFailover,
  ENDPOINT_ROLES,
  type FailoverRehearsalResult,
  type ReadOnlyProbeResult,
} from "../lib/guard/network.ts";
import {
  assessEndpointHealth,
  formatObservationPeriod,
  type EndpointHealthQuality,
  type EndpointHealthSample,
} from "../lib/guard/rpcPool.ts";
import {
  detectNetworkMismatch,
  describeMismatch,
  mismatchExplanation,
  type NetworkMismatch,
} from "../lib/guard/networkSwitch.ts";
import { CopyButton } from "./CopyButton.tsx";

export function rpcHostname(rpcUrl: string): string {
  try {
    return new URL(rpcUrl).hostname || rpcUrl;
  } catch (error) {
    if (error instanceof TypeError) return rpcUrl;
    throw error;
  }
}

export const EVALUATE_ENDPOINTS_GUIDE_PATH = "/docs/guides/evaluating-rpc-endpoints.md";
export const EVALUATE_ENDPOINTS_LABEL = "Evaluating third-party endpoints";

export interface ConfigureNetworkContextProps {
  networkName?: string;
  rpcUrl?: string;
  walletPassphrase?: string | null;
  walletNetwork?: string | null;
  interactive?: boolean;
  onConfirmWriteNetwork?: (targetNetwork: string) => void | Promise<void>;
  onProbe?: (result: ReadOnlyProbeResult) => void;
  probeImpl?: (url: string) => Promise<ReadOnlyProbeResult>;
  healthSamples?: readonly EndpointHealthSample[];
  onRehearseFailover?: (result: FailoverRehearsalResult) => void;
  rehearseImpl?: (
    candidateUrl: string,
    expectedPassphrase?: string,
  ) => Promise<FailoverRehearsalResult>;
}

const QUALITY_LABELS: Record<EndpointHealthQuality, string> = {
  unknown: "Unknown",
  insufficient: "Insufficient evidence",
  healthy: "Healthy",
  degraded: "Degraded",
  unhealthy: "Unhealthy",
};

export function ConfigureNetworkContext({
  networkName = NETWORK.name,
  rpcUrl = NETWORK.rpcUrl,
  walletPassphrase,
  walletNetwork,
  interactive = false,
  onConfirmWriteNetwork,
  onProbe,
  probeImpl,
  healthSamples: externalHealthSamples,
  onRehearseFailover,
  rehearseImpl,
}: ConfigureNetworkContextProps) {
  const [probing, setProbing] = useState(false);
  const [probeResult, setProbeResult] = useState<ReadOnlyProbeResult | null>(null);
  const [recordedSamples, setRecordedSamples] = useState<EndpointHealthSample[]>([]);
  const [candidateUrl, setCandidateUrl] = useState("");
  const [rehearsing, setRehearsing] = useState(false);
  const [rehearsalResult, setRehearsalResult] = useState<FailoverRehearsalResult | null>(null);
  const [confirmingWriteSwitch, setConfirmingWriteSwitch] = useState(false);

  const safeRpcUrl = redactEndpointUrl(rpcUrl);
  const safeOrigin = sanitizeEndpointOrigin(rpcUrl);
  const allSamples = externalHealthSamples
    ? [...externalHealthSamples, ...recordedSamples]
    : recordedSamples;
  const healthAssessment = assessEndpointHealth(allSamples, {
    endpoint: rpcUrl,
    network: networkName,
  });

  const mismatch: NetworkMismatch | null =
    walletPassphrase !== undefined
      ? detectNetworkMismatch(walletPassphrase, undefined, {
          targetNetwork: networkName,
          walletNetwork: walletNetwork ?? null,
        })
      : null;

  async function handleProbe() {
    setProbing(true);
    try {
      const probeFn = probeImpl ?? probeReadOnlyEndpoint;
      const res = await probeFn(rpcUrl);
      setProbeResult(res);
      setRecordedSamples((prev) => [
        ...prev,
        {
          endpointOrigin: safeOrigin,
          network: networkName,
          recordedAt: Date.now(),
          ok: res.ok,
          latencyMs: res.latencyMs,
          ...(!res.ok ? { failure: res.failure } : {}),
        },
      ]);
      onProbe?.(res);
    } catch (err) {
      const res: ReadOnlyProbeResult = {
        ok: false,
        endpointOrigin: safeOrigin,
        latencyMs: 0,
        failure: "network",
        detail: err instanceof Error ? err.message : String(err),
      };
      setProbeResult(res);
      setRecordedSamples((prev) => [
        ...prev,
        {
          endpointOrigin: safeOrigin,
          network: networkName,
          recordedAt: Date.now(),
          ok: false,
          latencyMs: 0,
          failure: "network",
        },
      ]);
      onProbe?.(res);
    } finally {
      setProbing(false);
    }
  }

  async function handleRehearseFailover() {
    setRehearsing(true);
    try {
      const expectedPassphrase = walletPassphrase ?? NETWORK.passphrase;
      const res = rehearseImpl
        ? await rehearseImpl(candidateUrl, expectedPassphrase)
        : await rehearseEndpointFailover(candidateUrl, { expectedPassphrase });
      setRehearsalResult(res);
      onRehearseFailover?.(res);
    } catch (err) {
      const res: FailoverRehearsalResult = {
        candidateOrigin: sanitizeEndpointOrigin(candidateUrl),
        expectedNetwork: networkName,
        ready: false,
        promoted: false,
        issuedWrites: false,
        checks: [
          {
            check: "network_identity",
            label: "Network identity (getNetwork)",
            ok: false,
            latencyMs: 0,
            detail: err instanceof Error ? err.message : String(err),
          },
        ],
        summary: "Rehearsal failed before completing checks. Active endpoint was not promoted.",
      };
      setRehearsalResult(res);
      onRehearseFailover?.(res);
    } finally {
      setRehearsing(false);
    }
  }

  async function handleConfirmWriteSwitch() {
    if (onConfirmWriteNetwork) {
      await onConfirmWriteNetwork(networkName);
    }
    setConfirmingWriteSwitch(false);
  }

  if (!interactive) {
    return (
      <div className="configure-network-context" aria-label="Configured network">
        <span className="pill" data-testid="configure-network-name">
          {networkName}
        </span>
        <code
          className="configure-network-host"
          data-testid="configure-rpc-hostname"
          title={safeRpcUrl}
        >
          {rpcHostname(rpcUrl)}
        </code>
        <a
          href={EVALUATE_ENDPOINTS_GUIDE_PATH}
          className="tiny rpc-checklist-link"
          data-testid="rpc-checklist-link"
          title="Safe checklist for evaluating third-party endpoints"
          target="_blank"
          rel="noopener noreferrer"
          style={{ marginLeft: 8 }}
        >
          {EVALUATE_ENDPOINTS_LABEL}
        </a>
      </div>
    );
  }

  return (
    <div
      className="configure-network-context-interactive"
      aria-label="Network and RPC configuration"
    >
      <div className="configure-network-context">
        <span className="pill" data-testid="configure-network-name">
          {networkName}
        </span>
        <code
          className="configure-network-host"
          data-testid="configure-rpc-hostname"
          title={safeRpcUrl}
        >
          {rpcHostname(rpcUrl)}
        </code>
        <CopyButton value={safeCopyEndpoint(rpcUrl)} label="RPC endpoint" className="tiny" />
        <a
          href={EVALUATE_ENDPOINTS_GUIDE_PATH}
          className="tiny rpc-checklist-link"
          data-testid="rpc-checklist-link"
          title="Safe checklist for evaluating third-party endpoints"
          target="_blank"
          rel="noopener noreferrer"
          style={{ marginLeft: 8 }}
        >
          {EVALUATE_ENDPOINTS_LABEL}
        </a>
      </div>

      {/* Role explanation (Issue #508) */}
      <section className="network-roles-explanation" data-testid="network-roles-explanation">
        <div className="role-card" data-testid="role-read-only">
          <span className="role-title">Read-Only RPC: </span>
          <span className="role-desc">{ENDPOINT_ROLES.readOnly.description}</span>
        </div>
        <div className="role-card" data-testid="role-write-network">
          <span className="role-title">Write Network: </span>
          <span className="role-desc">{ENDPOINT_ROLES.writeNetwork.description}</span>
        </div>
      </section>

      {/* Operator-controlled read-only endpoint probe (Issue #506) */}
      <section className="endpoint-probe-section" data-testid="endpoint-probe-section">
        <button
          type="button"
          className="btn-secondary probe-btn"
          data-testid="probe-endpoint-button"
          onClick={handleProbe}
          disabled={probing}
        >
          {probing ? "Probing endpoint..." : "Probe Endpoint"}
        </button>

        {probeResult && (
          <div className="probe-result" data-testid="probe-result">
            {probeResult.ok ? (
              <>
                <span className="pill ok" data-testid="probe-latency">
                  {probeResult.latencyMs} ms
                </span>
                <span className="pill info" data-testid="probe-network-identity">
                  {probeResult.networkName} ({probeResult.passphrase})
                </span>
              </>
            ) : (
              <span className="pill warn" data-testid="probe-error">
                {probeResult.detail}
              </span>
            )}
          </div>
        )}
      </section>

      {/* Endpoint identity & health history with minimum evidence warning (#502, #504) */}
      <section className="endpoint-health-history" data-testid="endpoint-health-history">
        <div className="health-history-header">
          <strong className="tiny">Health History: </strong>
          <code data-testid="health-history-origin">{healthAssessment.endpointOrigin}</code>
          <span className="pill" data-testid="health-history-network">
            {healthAssessment.network}
          </span>
          <span
            className={`pill ${healthAssessment.quality === "healthy" ? "ok" : "warn"}`}
            data-testid="health-quality-badge"
          >
            {QUALITY_LABELS[healthAssessment.quality]}
          </span>
          <span className="tiny muted" data-testid="health-evidence-summary">
            {healthAssessment.sampleCount}/{healthAssessment.minSamplesRequired} samples ·{" "}
            {formatObservationPeriod(healthAssessment.observationPeriodMs)} observed
          </span>
        </div>
        {healthAssessment.warning && (
          <p className="tiny warn" data-testid="health-insufficiency-warning">
            {healthAssessment.warning}
          </p>
        )}
        {allSamples.length > 0 && (
          <ul className="health-history-list" data-testid="health-history-list">
            {allSamples
              .filter((s) => s.endpointOrigin === safeOrigin && s.network === networkName)
              .slice(-5)
              .map((sample, idx) => (
                <li key={`${sample.recordedAt}-${idx}`} data-testid="health-history-item">
                  <span>{sample.endpointOrigin}</span> · <span>{sample.network}</span> ·{" "}
                  <span>{sample.ok ? "ok" : (sample.failure ?? "failed")}</span> ·{" "}
                  <span>{sample.latencyMs} ms</span>
                </li>
              ))}
          </ul>
        )}
      </section>

      {/* Read-only failover rehearsal (#503) */}
      <section className="failover-rehearsal-section" data-testid="failover-rehearsal-section">
        <div className="rehearsal-controls">
          <input
            type="url"
            value={candidateUrl}
            onChange={(event) => setCandidateUrl(event.target.value)}
            placeholder="https://alternate-rpc.example.org"
            aria-label="Alternate RPC endpoint URL"
            data-testid="rehearsal-candidate-input"
          />
          <button
            type="button"
            className="btn-secondary"
            data-testid="rehearse-failover-button"
            onClick={handleRehearseFailover}
            disabled={rehearsing || candidateUrl.trim() === ""}
          >
            {rehearsing ? "Rehearsing…" : "Rehearse Failover (Read-Only)"}
          </button>
        </div>
        {rehearsalResult && (
          <div className="failover-rehearsal-result" data-testid="failover-rehearsal-result">
            <p className="tiny" data-testid="rehearsal-summary">
              {rehearsalResult.summary}
            </p>
            <p className="tiny muted" data-testid="rehearsal-no-promotion-note">
              Read-only rehearsal only — active endpoint was not changed and no writes were issued.
            </p>
            <ul className="rehearsal-checks" data-testid="rehearsal-checks">
              {rehearsalResult.checks.map((c) => (
                <li key={c.check} data-testid={`rehearsal-check-${c.check}`}>
                  <span className={`pill ${c.ok ? "ok" : "warn"}`}>{c.ok ? "PASS" : "FAIL"}</span>{" "}
                  <span>{c.label}</span>: <span>{c.detail}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>

      {/* Network mismatch & confirmation before changing write network (Issue #508) */}
      {mismatch && (
        <section className="network-mismatch-banner" data-testid="network-mismatch-banner">
          <p className="mismatch-headline" data-testid="mismatch-headline">
            {describeMismatch(mismatch)}
          </p>
          <p className="mismatch-explanation" data-testid="mismatch-explanation">
            {mismatchExplanation(mismatch)}
          </p>

          {!confirmingWriteSwitch ? (
            <button
              type="button"
              className="btn-warn"
              data-testid="request-write-network-switch"
              onClick={() => setConfirmingWriteSwitch(true)}
            >
              Change Write Network to {networkName}
            </button>
          ) : (
            <div
              className="write-network-confirm-dialog"
              data-testid="write-network-confirm-dialog"
            >
              <p data-testid="write-network-confirm-warning">
                Explicit confirmation required: Are you sure you want to change the write network to{" "}
                {networkName}? Signatures produced on {networkName} cannot authorize calls on other
                networks.
              </p>
              <div className="confirm-actions">
                <button
                  type="button"
                  className="btn-primary"
                  data-testid="confirm-write-network-switch"
                  onClick={handleConfirmWriteSwitch}
                >
                  Confirm Change to {networkName}
                </button>
                <button
                  type="button"
                  className="btn-secondary"
                  data-testid="cancel-write-network-switch"
                  onClick={() => setConfirmingWriteSwitch(false)}
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </section>
      )}
    </div>
  );
}
