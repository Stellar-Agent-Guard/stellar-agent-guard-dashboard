import { DEFAULT_FLEET_PROBE_CONCURRENCY } from "./fleet.ts";
import {
  NETWORK,
  probeReadOnlyEndpoint,
  rehearseEndpointFailover,
  sanitizeEndpointOrigin,
  type FailoverRehearsalOptions,
  type FailoverRehearsalResult,
  type ReadOnlyProbeResult,
  redactDiagnosticText,
} from "./network.ts";
import type { RpcProbeOptions } from "../rpc/timeouts.ts";

export interface EndpointContinuityContext {
  endpoint: string;
  passphrase?: string;
  network?: string;
}

// ── Endpoint health history & evidence thresholds (#502, #504) ──────────

export const MAX_HEALTH_HISTORY_SAMPLES = 100;
export const MIN_HEALTH_SAMPLE_COUNT = 5;
export const MIN_HEALTH_OBSERVATION_MS = 60_000;

export type EndpointHealthFailureKind = "timeout" | "malformed" | "unavailable" | "network";

export interface EndpointHealthSample {
  /** Safe origin only (scheme + host + port); never credentials or query strings. */
  endpointOrigin: string;
  /** Active network associated with this sample (e.g. "testnet", "mainnet"). */
  network: string;
  /** Epoch milliseconds when the sample was recorded. */
  recordedAt: number;
  /** Whether the probe or request succeeded. */
  ok: boolean;
  /** Round-trip latency in milliseconds. */
  latencyMs: number;
  /** Optional failure classification when `ok` is false. */
  failure?: EndpointHealthFailureKind;
}

export type EndpointHealthQuality =
  "unknown" | "insufficient" | "healthy" | "degraded" | "unhealthy";

export interface EndpointHealthAssessment {
  endpointOrigin: string;
  network: string;
  quality: EndpointHealthQuality;
  sampleCount: number;
  minSamplesRequired: number;
  observationPeriodMs: number;
  minObservationMs: number;
  sufficient: boolean;
  successRate: number | null;
  averageLatencyMs: number | null;
  warning: string | null;
}

/** Format an observation window duration concisely for operators. */
export function formatObservationPeriod(ms: number): string {
  const safeMs = Math.max(0, Math.round(ms));
  const totalSecs = Math.floor(safeMs / 1000);
  if (totalSecs < 60) return `${totalSecs}s`;
  const mins = Math.floor(totalSecs / 60);
  const secs = totalSecs % 60;
  return secs === 0 ? `${mins}m` : `${mins}m ${secs}s`;
}

/**
 * Evaluate whether recorded health samples provide enough evidence to judge
 * endpoint reliability (#504), strictly distinguishing `unknown` (0 samples)
 * and `insufficient` (short sample or brief observation window) from `healthy`.
 */
export function assessEndpointHealth(
  samples: readonly EndpointHealthSample[],
  options: {
    endpoint?: string;
    network?: string;
    minSamples?: number;
    minObservationMs?: number;
  } = {},
): EndpointHealthAssessment {
  const targetOrigin =
    options.endpoint !== undefined ? sanitizeEndpointOrigin(options.endpoint) : undefined;
  const targetNetwork = options.network;
  const minSamplesRequired = Math.max(1, options.minSamples ?? MIN_HEALTH_SAMPLE_COUNT);
  const minObservationMs = Math.max(0, options.minObservationMs ?? MIN_HEALTH_OBSERVATION_MS);

  const filtered = samples.filter((s) => {
    if (targetOrigin !== undefined && s.endpointOrigin !== targetOrigin) return false;
    if (targetNetwork !== undefined && s.network !== targetNetwork) return false;
    return true;
  });

  const endpointOrigin = targetOrigin ?? filtered[0]?.endpointOrigin ?? "unrecognised-endpoint";
  const network = targetNetwork ?? filtered[0]?.network ?? NETWORK.name;
  const sampleCount = filtered.length;

  if (sampleCount === 0) {
    return {
      endpointOrigin,
      network,
      quality: "unknown",
      sampleCount: 0,
      minSamplesRequired,
      observationPeriodMs: 0,
      minObservationMs,
      sufficient: false,
      successRate: null,
      averageLatencyMs: null,
      warning: `Health unknown: 0 samples recorded for ${endpointOrigin} on ${network} (minimum ${minSamplesRequired} samples over ${formatObservationPeriod(minObservationMs)} required).`,
    };
  }

  let minTime = Infinity;
  let maxTime = -Infinity;
  let okCount = 0;
  let latencySum = 0;

  for (const sample of filtered) {
    if (sample.recordedAt < minTime) minTime = sample.recordedAt;
    if (sample.recordedAt > maxTime) maxTime = sample.recordedAt;
    if (sample.ok) okCount += 1;
    latencySum += sample.latencyMs;
  }

  const observationPeriodMs = sampleCount >= 2 ? Math.max(0, maxTime - minTime) : 0;
  const successRate = okCount / sampleCount;
  const averageLatencyMs = Math.round(latencySum / sampleCount);

  if (sampleCount < minSamplesRequired || observationPeriodMs < minObservationMs) {
    return {
      endpointOrigin,
      network,
      quality: "insufficient",
      sampleCount,
      minSamplesRequired,
      observationPeriodMs,
      minObservationMs,
      sufficient: false,
      successRate,
      averageLatencyMs,
      warning: `Insufficient health history: ${sampleCount}/${minSamplesRequired} samples over ${formatObservationPeriod(observationPeriodMs)} (minimum ${minSamplesRequired} samples over ${formatObservationPeriod(minObservationMs)} required). Do not treat as reliable.`,
    };
  }

  const quality: EndpointHealthQuality =
    successRate >= 0.9 ? "healthy" : successRate >= 0.5 ? "degraded" : "unhealthy";

  return {
    endpointOrigin,
    network,
    quality,
    sampleCount,
    minSamplesRequired,
    observationPeriodMs,
    minObservationMs,
    sufficient: true,
    successRate,
    averageLatencyMs,
    warning: null,
  };
}

export class RpcPool {
  primaryUrl: string;
  fallbackUrls: string[];
  currentUrl: string;
  currentNetwork: string;
  failureCount: number = 0;
  rtt: number = 0;
  maxConcurrency: number = DEFAULT_FLEET_PROBE_CONCURRENCY;
  private activeRequests: number = 0;
  private healthCheckTimer: any;
  /** Cursors mapped by endpoint URL or network name. */
  private cursors: Map<string, string | null> = new Map();
  private healthHistory: EndpointHealthSample[] = [];
  private endpointListeners: Array<(newUrl: string, oldUrl: string) => void> = [];
  private networkListeners: Array<(newNetwork: string, oldNetwork: string) => void> = [];

  constructor(
    primaryUrl: string,
    fallbackUrls: string[],
    networkOrOptions?: string | { maxConcurrency?: number; network?: string },
    options?: { maxConcurrency?: number },
  ) {
    this.primaryUrl = primaryUrl;
    this.fallbackUrls = fallbackUrls;
    this.currentUrl = primaryUrl;
    if (typeof networkOrOptions === "string") {
      this.currentNetwork = networkOrOptions;
      if (options?.maxConcurrency) {
        this.maxConcurrency = Math.max(1, options.maxConcurrency);
      }
    } else {
      this.currentNetwork = networkOrOptions?.network ?? NETWORK.name;
      const opts = networkOrOptions ?? options;
      if (opts?.maxConcurrency) {
        this.maxConcurrency = Math.max(1, opts.maxConcurrency);
      }
    }
  }

  /**
   * Retrieve the active cursor for a specific endpoint or network context.
   * Defaults to `this.currentUrl`.
   */
  getCursor(endpointOrNetwork?: string): string | null {
    const key = endpointOrNetwork ?? this.currentUrl;
    return this.cursors.get(key) ?? null;
  }

  /**
   * Associate a cursor with a specific endpoint or network context.
   */
  setCursor(cursor: string | null, endpointOrNetwork?: string): void {
    const key = endpointOrNetwork ?? this.currentUrl;
    this.cursors.set(key, cursor);
  }

  /**
   * Clear tracked cursors for a given endpoint/network scope, or all cursors if omitted.
   * Essential when switching networks or endpoints to prevent stale event attribution.
   */
  clearCursors(scope?: string): void {
    if (scope) {
      this.cursors.delete(scope);
    } else {
      this.cursors.clear();
    }
  }

  /**
   * Validate whether a cursor from `source` can safely carry over to `target`.
   * Cross-network or mismatched-passphrase transitions NEVER have continuity.
   * Separate endpoints without explicit synchronization require a cursor reset.
   */
  validateContinuity(
    source: EndpointContinuityContext,
    target: EndpointContinuityContext,
  ): boolean {
    if (source.passphrase && target.passphrase && source.passphrase !== target.passphrase) {
      return false;
    }
    if (source.network && target.network && source.network !== target.network) {
      return false;
    }
    if (source.endpoint !== target.endpoint) {
      return false;
    }
    return true;
  }

  /**
   * Switch the active endpoint.
   * Unless explicit continuity is validated, network-specific cursors are reset
   * to guarantee that events from the new endpoint are not skipped or misattributed.
   */
  switchEndpoint(
    newUrl: string,
    options: { resetCursor?: boolean; targetNetwork?: string } = {},
  ): void {
    const oldUrl = this.currentUrl;
    this.currentUrl = newUrl;
    if (options.targetNetwork) {
      this.currentNetwork = options.targetNetwork;
    }
    const shouldReset = options.resetCursor ?? true;
    if (shouldReset) {
      this.cursors.delete(oldUrl);
      this.cursors.delete(newUrl);
    }
    for (const listener of this.endpointListeners) {
      try {
        listener(newUrl, oldUrl);
      } catch {
        // Safe listener execution
      }
    }
  }

  /**
   * Switch the active network context.
   * This immediately wipes all cursors, since cursors from one network
   * must NEVER be sent to or interpreted by another network.
   */
  switchNetwork(newNetwork: string, newUrl?: string): void {
    const oldNetwork = this.currentNetwork;
    this.currentNetwork = newNetwork;
    if (newUrl) {
      this.currentUrl = newUrl;
    }
    this.clearCursors();
    for (const listener of this.networkListeners) {
      try {
        listener(newNetwork, oldNetwork);
      } catch {
        // Safe listener execution
      }
    }
  }

  onEndpointChange(listener: (newUrl: string, oldUrl: string) => void): () => void {
    this.endpointListeners.push(listener);
    return () => {
      this.endpointListeners = this.endpointListeners.filter((l) => l !== listener);
    };
  }

  onNetworkChange(listener: (newNetwork: string, oldNetwork: string) => void): () => void {
    this.networkListeners.push(listener);
    return () => {
      this.networkListeners = this.networkListeners.filter((l) => l !== listener);
    };
  }

  /**
   * Record a health sample associated with safe origin metadata and the active
   * network (#502). Credentials and secret-bearing URLs are never stored.
   */
  recordHealthSample(input: {
    endpoint?: string;
    network?: string;
    recordedAt?: number;
    ok: boolean;
    latencyMs: number;
    failure?: EndpointHealthFailureKind;
  }): EndpointHealthSample {
    const sample: EndpointHealthSample = {
      endpointOrigin: sanitizeEndpointOrigin(input.endpoint ?? this.currentUrl),
      network: input.network ?? this.currentNetwork,
      recordedAt: input.recordedAt ?? Date.now(),
      ok: input.ok,
      latencyMs: Math.max(0, Math.round(input.latencyMs)),
      ...(input.failure !== undefined ? { failure: input.failure } : {}),
    };
    this.healthHistory.push(sample);
    if (this.healthHistory.length > MAX_HEALTH_HISTORY_SAMPLES) {
      this.healthHistory.splice(0, this.healthHistory.length - MAX_HEALTH_HISTORY_SAMPLES);
    }
    return sample;
  }

  /**
   * Retrieve recorded health samples, optionally filtered by endpoint (sanitized
   * to origin) and/or network (#502).
   */
  getHealthHistory(filter?: { endpoint?: string; network?: string }): EndpointHealthSample[] {
    const targetOrigin =
      filter?.endpoint !== undefined ? sanitizeEndpointOrigin(filter.endpoint) : undefined;
    const targetNetwork = filter?.network;
    return this.healthHistory.filter((s) => {
      if (targetOrigin !== undefined && s.endpointOrigin !== targetOrigin) return false;
      if (targetNetwork !== undefined && s.network !== targetNetwork) return false;
      return true;
    });
  }

  /** Clear recorded health history, optionally scoped to an endpoint or network. */
  clearHealthHistory(filter?: { endpoint?: string; network?: string }): void {
    if (!filter?.endpoint && !filter?.network) {
      this.healthHistory = [];
      return;
    }
    const targetOrigin =
      filter.endpoint !== undefined ? sanitizeEndpointOrigin(filter.endpoint) : undefined;
    this.healthHistory = this.healthHistory.filter((s) => {
      const originMatch = targetOrigin === undefined || s.endpointOrigin === targetOrigin;
      const networkMatch = filter.network === undefined || s.network === filter.network;
      return !(originMatch && networkMatch);
    });
  }

  /** Assess health history sufficiency and reliability for an endpoint (#504). */
  getHealthAssessment(options?: {
    endpoint?: string;
    network?: string;
    minSamples?: number;
    minObservationMs?: number;
  }): EndpointHealthAssessment {
    return assessEndpointHealth(this.healthHistory, {
      endpoint: options?.endpoint ?? this.currentUrl,
      network: options?.network ?? this.currentNetwork,
      ...(options?.minSamples !== undefined ? { minSamples: options.minSamples } : {}),
      ...(options?.minObservationMs !== undefined
        ? { minObservationMs: options.minObservationMs }
        : {}),
    });
  }

  /**
   * Execute an operator-controlled read-only probe of an endpoint using `getNetwork`,
   * and record the resulting health sample with safe origin + active network (#502).
   */
  async probeEndpoint(url?: string, options?: RpcProbeOptions): Promise<ReadOnlyProbeResult> {
    const targetUrl = url ?? this.currentUrl;
    const res = await probeReadOnlyEndpoint(targetUrl, options);
    this.recordHealthSample({
      endpoint: targetUrl,
      network: this.currentNetwork,
      ok: res.ok,
      latencyMs: res.latencyMs,
      ...(!res.ok ? { failure: res.failure } : {}),
    });
    return res;
  }

  /**
   * Rehearse failing over to an alternate endpoint using strictly read-only,
   * bounded probes (#503). Never promotes the candidate endpoint automatically
   * and never issues writes or changes the active network.
   */
  async rehearseFailover(
    candidateUrl: string,
    options?: FailoverRehearsalOptions,
  ): Promise<FailoverRehearsalResult> {
    const res = await rehearseEndpointFailover(candidateUrl, options);
    this.recordHealthSample({
      endpoint: candidateUrl,
      network: this.currentNetwork,
      ok: res.ready,
      latencyMs: res.checks[0]?.latencyMs ?? 0,
      ...(!res.ready ? { failure: "unavailable" as const } : {}),
    });
    return res;
  }

  async fetch(endpoint: string, options: RequestInit = {}): Promise<Response> {
    const start = Date.now();
    this.activeRequests++;
    try {
      const response = await fetch(`${this.currentUrl}${endpoint}`, options);
      const latency = Date.now() - start;
      this.rtt = latency;

      if (response.status === 429 || response.status === 503) {
        this.recordHealthSample({
          endpoint: this.currentUrl,
          network: this.currentNetwork,
          ok: false,
          latencyMs: latency,
          failure: "unavailable",
        });
        this.handleFailure();
      } else {
        this.recordHealthSample({
          endpoint: this.currentUrl,
          network: this.currentNetwork,
          ok: response.ok,
          latencyMs: latency,
          ...(!response.ok ? { failure: "unavailable" as const } : {}),
        });
        this.failureCount = 0;
      }
      return response;
    } catch (error) {
      const latency = Date.now() - start;
      this.recordHealthSample({
        endpoint: this.currentUrl,
        network: this.currentNetwork,
        ok: false,
        latencyMs: latency,
        failure: "network",
      });
      this.handleFailure();
      const msg = error instanceof Error ? error.message : String(error);
      const safeMsg = redactDiagnosticText(msg);
      if (error instanceof Error && error.message !== safeMsg) {
        error.message = safeMsg;
      }
      throw error;
    } finally {
      this.activeRequests = Math.max(0, this.activeRequests - 1);
    }
  }

  /**
   * Run operations across an array of items bounded by maxConcurrency.
   * Cancels cleanly on AbortSignal and maintains original item ordering.
   */
  async mapConcurrent<T, R>(
    items: T[],
    fn: (item: T, index: number) => Promise<R>,
    concurrency: number = this.maxConcurrency,
    signal?: AbortSignal,
  ): Promise<R[]> {
    const results: R[] = new Array(items.length);
    const limit = Math.max(1, concurrency);
    let nextIndex = 0;

    const workerCount = Math.min(limit, items.length);
    if (workerCount === 0) return [];

    const workers = Array.from({ length: workerCount }, async () => {
      while (nextIndex < items.length) {
        if (signal?.aborted) {
          break;
        }
        const index = nextIndex++;
        results[index] = await fn(items[index]!, index);
      }
    });

    await Promise.all(workers);
    return results;
  }

  private handleFailure() {
    this.failureCount++;
    if (this.failureCount >= 3) {
      this.failover();
    }
  }

  private failover() {
    this.failureCount = 0;
    const oldUrl = this.currentUrl;
    const nextUrl = this.fallbackUrls.shift();
    if (nextUrl) {
      this.fallbackUrls.push(this.currentUrl);
      this.currentUrl = nextUrl;
      // Failover endpoint change clears cursor to avoid stale pagination
      this.cursors.delete(oldUrl);
      this.cursors.delete(nextUrl);
      for (const listener of this.endpointListeners) {
        try {
          listener(nextUrl, oldUrl);
        } catch {
          // Safe listener execution
        }
      }
    }
  }

  startHealthCheck(interval: number = 10000) {
    if (this.healthCheckTimer) clearTimeout(this.healthCheckTimer);
    this.healthCheckTimer = setTimeout(() => {
      this.fetch("/health").catch(() => {});
      this.startHealthCheck(interval);
    }, interval);
  }

  stopHealthCheck() {
    if (this.healthCheckTimer) {
      clearTimeout(this.healthCheckTimer);
      this.healthCheckTimer = null;
    }
  }
}
