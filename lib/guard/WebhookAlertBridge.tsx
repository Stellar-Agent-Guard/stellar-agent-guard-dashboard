/**
 * Webhook delivery tracking bridge.
 *
 * This module tracks the bounded delivery status of recent webhook alerts,
 * distinguishing between:
 * - **pending**: Alert queued but not yet dispatched
 * - **delivered**: Remote endpoint returned 2xx (HTTP accepted)
 * - **failed**: Remote endpoint returned error or network failure
 * - **retrying**: Temporary failure, scheduled for retry
 *
 * The tracker maintains a bounded queue (most recent 50 deliveries) and
 * automatically evicts entries older than 24 hours. Records are persisted in
 * local browser storage so troubleshooting history survives tab refreshes.
 */

export type DeliveryStatus = "pending" | "delivered" | "failed" | "retrying";

export interface DeliveryRecord {
  id: string;
  url: string;
  status: DeliveryStatus;
  timestamp: number; // epoch ms
  attempts: number;
  lastAttemptAt?: number | undefined;
  statusCode?: number | undefined;
  errorMessage?: string | undefined;
  nextRetryAt?: number | undefined;
  event?: string | undefined;
}

export const MAX_QUEUE_SIZE = 50;
export const EVICTION_AGE_MS = 24 * 60 * 60 * 1000; // 24 hours
export const WEBHOOK_DELIVERY_STORAGE_KEY = "stellar-agent-guard-dashboard.webhook-history.v1";

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem?(key: string): void;
}

function defaultStorage(): StorageLike | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export class WebhookDeliveryTracker {
  private records: DeliveryRecord[] = [];
  private storage: StorageLike | null = null;

  constructor(storage: StorageLike | null = defaultStorage()) {
    this.storage = storage;
    this.loadFromStorage();
  }

  private loadFromStorage(): void {
    if (!this.storage) return;
    try {
      const raw = this.storage.getItem(WEBHOOK_DELIVERY_STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        this.records = parsed;
        this.evictOldRecords();
      }
    } catch {
      this.records = [];
    }
  }

  private persist(): void {
    if (!this.storage) return;
    try {
      this.storage.setItem(WEBHOOK_DELIVERY_STORAGE_KEY, JSON.stringify(this.records));
    } catch {
      // Ignore quota / private-mode write errors
    }
  }

  /** Record a new webhook alert as pending */
  enqueue(url: string, alertId: string, event?: string): DeliveryRecord {
    const record: DeliveryRecord = {
      id: `${alertId}-${Date.now()}`,
      url,
      status: "pending",
      timestamp: Date.now(),
      attempts: 0,
      event: event ?? undefined,
    };

    this.records.unshift(record);
    this.evictOldRecords();
    this.persist();
    return record;
  }

  /** Mark a delivery as successfully accepted by the remote */
  markDelivered(id: string, statusCode: number): void {
    const record = this.records.find((r) => r.id === id);
    if (!record) return;

    record.status = "delivered";
    record.statusCode = statusCode;
    record.lastAttemptAt = Date.now();
    record.attempts += 1;
    this.persist();
  }

  /** Mark a delivery as failed with an error */
  markFailed(id: string, statusCode: number | undefined, errorMessage: string): void {
    const record = this.records.find((r) => r.id === id);
    if (!record) return;

    record.status = "failed";
    if (statusCode !== undefined) {
      record.statusCode = statusCode;
    } else {
      delete record.statusCode;
    }
    record.errorMessage = errorMessage;
    record.lastAttemptAt = Date.now();
    record.attempts += 1;
    this.persist();
  }

  /** Schedule a delivery for retry */
  markRetrying(id: string, nextRetryAt: number): void {
    const record = this.records.find((r) => r.id === id);
    if (!record) return;

    record.status = "retrying";
    record.nextRetryAt = nextRetryAt;
    record.lastAttemptAt = Date.now();
    record.attempts += 1;
    this.persist();
  }

  /** Get all delivery records, newest first */
  getRecords(): DeliveryRecord[] {
    return [...this.records];
  }

  /** Get records filtered by status */
  getByStatus(status: DeliveryStatus): DeliveryRecord[] {
    return this.records.filter((r) => r.status === status);
  }

  /** Clear all records without modifying webhook configuration */
  clear(): void {
    this.records = [];
    if (this.storage) {
      try {
        if (typeof this.storage.removeItem === "function") {
          this.storage.removeItem(WEBHOOK_DELIVERY_STORAGE_KEY);
        } else {
          this.storage.setItem(WEBHOOK_DELIVERY_STORAGE_KEY, JSON.stringify([]));
        }
      } catch {
        // ignore
      }
    }
  }

  /** Remove records older than eviction threshold and enforce max size */
  private evictOldRecords(): void {
    const cutoff = Date.now() - EVICTION_AGE_MS;

    // Remove old records
    this.records = this.records.filter((r) => r.timestamp > cutoff);

    // Enforce max queue size (keep most recent)
    if (this.records.length > MAX_QUEUE_SIZE) {
      this.records = this.records.slice(0, MAX_QUEUE_SIZE);
    }
  }
}

/** Singleton instance for the dashboard */
export const deliveryTracker = new WebhookDeliveryTracker();

/** Explicit helper to clear delivery history from storage */
export function clearDeliveryHistory(storage: StorageLike | null = defaultStorage()): void {
  deliveryTracker.clear();
  if (storage) {
    try {
      if (typeof storage.removeItem === "function") {
        storage.removeItem(WEBHOOK_DELIVERY_STORAGE_KEY);
      } else {
        storage.setItem(WEBHOOK_DELIVERY_STORAGE_KEY, JSON.stringify([]));
      }
    } catch {
      // ignore
    }
  }
}
