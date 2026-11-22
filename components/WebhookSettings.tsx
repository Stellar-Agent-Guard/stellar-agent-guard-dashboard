"use client";

/**
 * Webhook settings for high-priority security events (issue #141).
 *
 * Where an operator points the guard's alerts and which of them they want sent.
 * The dialog follows the focus discipline the rest of the console's modals
 * established (`AddressBookModal`, `PanicPanel`): focus moves in on open,
 * Escape closes.
 *
 * The "Test webhook" button is the point of the dialog as much as the fields
 * are. A configured URL that has never sent anything is a configuration the
 * operator cannot trust — the failure mode is discovered during the incident
 * instead of before it — so the button sends a real verification ping through
 * exactly the same signing, headers and error handling as a live alert, and
 * reports the outcome in words rather than a status code.
 */

import { useEffect, useRef, useState } from "react";
import { useGuard } from "./GuardProvider.tsx";
import { ErrorBlock } from "./bits.tsx";
import { NETWORK } from "../lib/guard/network.ts";
import { announce } from "../lib/guard/useAnnounce.ts";
import {
  deliveryTracker,
  clearDeliveryHistory,
  type DeliveryRecord,
} from "../lib/guard/WebhookAlertBridge.tsx";
import {
  DEFAULT_WEBHOOK_SETTINGS,
  WEBHOOK_EVENT_HINTS,
  WEBHOOK_EVENT_LABELS,
  WEBHOOK_EVENT_TYPES,
  WEBHOOK_TIMEOUT_MS,
  buildVerificationPing,
  describeDispatch,
  dispatchWebhook,
  loadWebhookSettings,
  normalizeWebhookSettings,
  saveWebhookSettings,
  validateWebhookUrl,
  webhookConfigProblem,
  type DispatchResult,
  type WebhookEventType,
  type WebhookSettings,
} from "../lib/guard/webhookDispatcher.ts";

/** The cooldowns the UI offers, in words rather than milliseconds. */
const COOLDOWN_OPTIONS: Array<{ valueMs: number; label: string }> = [
  { valueMs: 0, label: "every time (no cooldown)" },
  { valueMs: 15_000, label: "at most every 15 seconds" },
  { valueMs: 60_000, label: "at most every minute" },
  { valueMs: 300_000, label: "at most every 5 minutes" },
  { valueMs: 900_000, label: "at most every 15 minutes" },
];

/**
 * The result headline, worded no stronger than the outcome warrants (#315).
 *
 * A timeout is the one failure that cannot be reported as "was not delivered":
 * the request may have reached the endpoint and only the response was lost. For
 * a security alert, a false "nothing got through" is worse than an honest
 * "unknown" — the operator would conclude their endpoint is dead when it may be
 * sitting on the alert.
 */
export function pingHeadline(ping: DispatchResult): string {
  if (ping.ok) return "Test webhook delivered";
  if (ping.outcome === "timeout") return "Test webhook outcome unknown";
  return "Test webhook was not delivered";
}

export function WebhookSettingsButton() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button className="secondary no-print" onClick={() => setOpen(true)}>
        Webhook alerts
      </button>
      {open && <WebhookSettingsModal onClose={() => setOpen(false)} />}
    </>
  );
}

export function WebhookSettingsModal({ onClose }: { onClose: () => void }) {
  const { guard } = useGuard();
  const [settings, setSettings] = useState<WebhookSettings>(() => loadWebhookSettings());
  const [error, setError] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);
  const [ping, setPing] = useState<DispatchResult | null>(null);
  const [deliveries, setDeliveries] = useState<DeliveryRecord[]>(() => deliveryTracker.getRecords());
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    dialogRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    };
    document.addEventListener("keydown", onKeyDown, true);
    return () => document.removeEventListener("keydown", onKeyDown, true);
  }, [onClose]);

  const urlError = settings.url.trim() === "" ? null : validateWebhookUrl(settings.url);

  function update(patch: Partial<WebhookSettings>) {
    setSettings((current) => ({ ...current, ...patch }));
    setError(null);
    setPing(null);
  }

  function toggleEvent(event: WebhookEventType) {
    setSettings((current) => {
      const events = current.events.includes(event)
        ? current.events.filter((item) => item !== event)
        : // Keep the declared order, so the saved list is not reordered by
          // clicking the boxes in a different sequence.
          [...current.events, event].sort(
            (a, b) => WEBHOOK_EVENT_TYPES.indexOf(a) - WEBHOOK_EVENT_TYPES.indexOf(b),
          );
      return { ...current, events };
    });
    setPing(null);
  }

  function save() {
    const problem = webhookConfigProblem(normalizeWebhookSettings(settings));
    if (problem) {
      setError(problem);
      return;
    }
    saveWebhookSettings(settings);
    setError(null);
    announce("Webhook settings saved.");
    onClose();
  }

  async function testWebhook() {
    setTesting(true);
    setError(null);
    setPing(null);
    // The ping is built and sent from the *form's* current values, not the
    // stored ones: an operator testing a URL they have not saved yet is
    // testing that URL, and a test that silently used the old one would be a
    // worse lie than no test at all.
    const candidate = normalizeWebhookSettings({ ...settings, enabled: true });
    const problem = validateWebhookUrl(candidate.url);
    if (problem) {
      setError(problem);
      setTesting(false);
      return;
    }
    const record = deliveryTracker.enqueue(candidate.url, `test-${Date.now()}`, "WEBHOOK_TEST");
    const result = await dispatchWebhook(
      buildVerificationPing({ guard, network: NETWORK.name }),
      candidate,
    );
    if (result.ok) {
      deliveryTracker.markDelivered(record.id, result.status ?? 200);
    } else {
      deliveryTracker.markFailed(
        record.id,
        result.status ?? undefined,
        result.error ?? result.outcome,
      );
    }
    setDeliveries(deliveryTracker.getRecords());
    setPing(result);
    setTesting(false);
    announce(
      result.ok ? "Test webhook delivered" : `${pingHeadline(result)}: ${describeDispatch(result)}`,
      result.ok ? "polite" : "assertive",
    );
  }

  function handleClearHistory() {
    clearDeliveryHistory();
    setDeliveries([]);
    announce("Webhook delivery history cleared.");
  }

  return (
    <div className="modal-backdrop">
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="webhook-settings-title"
        ref={dialogRef}
        tabIndex={-1}
        data-testid="webhook-settings"
      >
        <strong id="webhook-settings-title">Webhook alerts</strong>
        <p className="tiny muted">
          Send high-priority guard events to Slack, PagerDuty, a SIEM or any HTTP endpoint. The
          request goes from this browser straight to the URL below — there is no server in between
          that could hold or log the signing secret.
        </p>

        <label className="checkline" style={{ marginTop: 10 }}>
          <input
            type="checkbox"
            checked={settings.enabled}
            onChange={(event) => update({ enabled: event.target.checked })}
            aria-label="Enable webhook dispatch"
          />
          <span>Dispatch webhooks for the selected events</span>
        </label>

        <label className="field">
          <span className="lbl">Webhook URL</span>
          <input
            value={settings.url}
            onChange={(event) => update({ url: event.target.value })}
            placeholder="https://hooks.slack.com/services/…"
            aria-label="Webhook URL"
            aria-invalid={urlError !== null}
          />
          {urlError ? (
            <span className="hint" style={{ color: "var(--danger)" }}>
              {urlError}
            </span>
          ) : (
            <span className="hint">
              Use https:// (plain http only on localhost) and no username, password or{" "}
              <span className="mono">@</span> in the host. The POST leaves this browser directly for
              the URL you enter, so whether the destination accepts it is governed by the remote
              service and its own CORS policy and how it treats the request — this dashboard cannot
              proxy, restrict or verify it. Slack and Discord incoming-webhook URLs work as-is.
            </span>
          )}
        </label>

        <label className="field">
          <span className="lbl">Signing secret (optional)</span>
          <input
            type="password"
            value={settings.secret}
            onChange={(event) => update({ secret: event.target.value })}
            placeholder="Shared secret"
            aria-label="Webhook signing secret"
            autoComplete="off"
          />
          <span className="hint">
            When set, each body is signed with HMAC-SHA256 and carries{" "}
            <span className="mono">X-Agent-Guard-Signature</span> so the receiver can prove it came
            from this console and was not replayed. With no secret the payload is sent unsigned, and
            says so in its own body.
          </span>
        </label>

        <div className="stack" style={{ marginTop: 8 }}>
          {WEBHOOK_EVENT_TYPES.map((event) => (
            <label className="checkline" key={event}>
              <input
                type="checkbox"
                checked={settings.events.includes(event)}
                onChange={() => toggleEvent(event)}
                aria-label={WEBHOOK_EVENT_LABELS[event]}
              />
              <span>
                <strong style={{ fontSize: 13 }}>{WEBHOOK_EVENT_LABELS[event]}</strong>{" "}
                <span className="mono tiny muted">{event}</span>
                <div className="tiny muted">{WEBHOOK_EVENT_HINTS[event]}</div>
              </span>
            </label>
          ))}
        </div>

        <div className="row" style={{ marginTop: 10, gap: 12 }}>
          <label className="field">
            <span className="lbl">Cooldown per event</span>
            <select
              value={String(settings.minIntervalMs)}
              onChange={(event) => update({ minIntervalMs: Number(event.target.value) })}
              aria-label="Cooldown per event"
            >
              {/* A stored cooldown outside the offered set still renders as
                  itself rather than snapping to a different number than the
                  operator chose. */}
              {!COOLDOWN_OPTIONS.some((entry) => entry.valueMs === settings.minIntervalMs) && (
                <option value={String(settings.minIntervalMs)}>
                  at most every {Math.round(settings.minIntervalMs / 1000)}s (saved value)
                </option>
              )}
              {COOLDOWN_OPTIONS.map((option) => (
                <option key={option.valueMs} value={String(option.valueMs)}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span className="lbl">Refusals before the block alert</span>
            <input
              type="number"
              min={1}
              max={100}
              value={settings.blockThreshold}
              onChange={(event) => update({ blockThreshold: Number(event.target.value) })}
              aria-label="Block threshold"
              style={{ maxWidth: 110 }}
            />
            <span className="hint">within {settings.blockWindowSecs}s of feed history</span>
          </label>
        </div>

        {error && <ErrorBlock title="Webhook settings" detail={error} />}

        {ping && (
          <div
            className={ping.ok ? "notice info" : "notice warn"}
            role="status"
            data-testid="webhook-test-result"
          >
            <strong>{pingHeadline(ping)}</strong>
            <div className="tiny">{describeDispatch(ping)}</div>
            {ping.outcome === "timeout" && (
              <div className="tiny">
                The console gives up after {Math.round(WEBHOOK_TIMEOUT_MS / 1000)}s. An endpoint
                that answers slower than that still counts as unreachable from this page.
              </div>
            )}
          </div>
        )}

        <div className="stack" style={{ marginTop: 14 }} data-testid="webhook-delivery-history">
          <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
            <span className="lbl" style={{ margin: 0 }}>
              Delivery history
            </span>
            {deliveries.length > 0 && (
              <button
                type="button"
                className="secondary"
                style={{ padding: "2px 8px", fontSize: "0.8em" }}
                onClick={handleClearHistory}
                aria-label="Clear local delivery history"
              >
                Clear history
              </button>
            )}
          </div>
          <span className="hint">
            Recent delivery history is retained locally in your browser for 24 hours (up to 50
            records) for troubleshooting. Clearing history does not alter your endpoint or alert
            configuration.
          </span>
          {deliveries.length === 0 ? (
            <p className="tiny muted" style={{ margin: "4px 0" }}>
              No webhook deliveries recorded yet.
            </p>
          ) : (
            <div
              className="scrolly"
              style={{ maxHeight: 150, overflowY: "auto", border: "1px solid var(--border)", borderRadius: 4 }}
            >
              <table className="tiny stack" style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr>
                    <th style={{ textAlign: "left", padding: "4px 8px" }}>Time</th>
                    <th style={{ textAlign: "left", padding: "4px 8px" }}>Event</th>
                    <th style={{ textAlign: "left", padding: "4px 8px" }}>Status</th>
                    <th style={{ textAlign: "left", padding: "4px 8px" }}>Details</th>
                  </tr>
                </thead>
                <tbody>
                  {deliveries.map((record) => (
                    <tr key={record.id} style={{ borderTop: "1px solid var(--border)" }}>
                      <td style={{ padding: "4px 8px" }}>
                        <time dateTime={new Date(record.timestamp).toISOString()}>
                          {new Date(record.timestamp).toLocaleTimeString()}
                        </time>
                      </td>
                      <td style={{ padding: "4px 8px" }} className="mono">
                        {record.event ?? "ALERT"}
                      </td>
                      <td style={{ padding: "4px 8px" }}>
                        <span
                          className={`pill ${record.status === "delivered" ? "ok" : record.status === "pending" ? "" : "danger"}`}
                          style={{ fontSize: "0.75em", padding: "1px 5px" }}
                        >
                          {record.status}
                          {record.statusCode ? ` (${record.statusCode})` : ""}
                        </span>
                      </td>
                      <td style={{ padding: "4px 8px" }} className="tiny muted">
                        {record.errorMessage ?? "OK"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="row" style={{ marginTop: 12 }}>
          <button onClick={save}>Save</button>
          <button className="secondary" onClick={() => void testWebhook()} disabled={testing}>
            {testing ? "Sending…" : "Test webhook"}
          </button>
          <button
            className="secondary"
            onClick={() => {
              setSettings({ ...DEFAULT_WEBHOOK_SETTINGS });
              setError(null);
              setPing(null);
            }}
          >
            Reset
          </button>
          <button className="secondary" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
