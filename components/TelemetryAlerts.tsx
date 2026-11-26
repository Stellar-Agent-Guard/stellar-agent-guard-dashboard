"use client";

/**
 * Opt-in auditory and visual alerts for security-critical telemetry (issue #90).
 *
 * The whole feature is a set of refusals, and they are the interesting part:
 *
 *   - It starts silent. Both channels are off until the operator turns them on,
 *     and the state is persisted, so an alert system never ambushes anyone.
 *   - It cannot make noise before a click. `AudioAlerter` is unlocked from the
 *     toggle's own handler — the browser's autoplay rule means a context created
 *     in an effect stays suspended, and a suspended context fails silently,
 *     which is the worst possible failure for an alert.
 *   - It only interrupts for events worth interrupting for. The matching lives
 *     in `lib/guard/audioAlert.ts` and is tested there; this component just
 *     asks each new feed event whether it earns a chime. Which of the three
 *     classes earns one is the operator's own choice, ticked per class (#492),
 *     and a channel that is on with every class unticked is reported as
 *     nothing-will-alert rather than as armed.
 *   - It does not stack. `requireInteraction` plus a stable `tag` means five
 *     blocks in ten seconds are one notification, not five. And one block
 *     re-polled by the feed is one alert, not one per poll (#313).
 *   - It says what it can actually do. The switch is the operator's preference;
 *     the browser's permission and the last delivery are two separate facts, and
 *     the panel states all three instead of implying that an enabled switch is
 *     a working alert (#314).
 *
 * Mounted inside the telemetry panel rather than the page, so the control sits
 * next to the feed whose events it announces.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { GuardEvent } from "stellar-agent-guard-sdk";
import { useGuard, useGuardEvents } from "./GuardProvider.tsx";
import { short } from "./bits.tsx";
import { NETWORK } from "../lib/guard/network.ts";
import {
  AudioAlerter,
  ALERT_CLASS_HINTS,
  ALERT_CLASS_LABELS,
  ALERT_DEDUPE_PERSIST_LIMIT,
  ALERT_REASON_ORDER,
  alertClassEnabled,
  alertDedupeScopeKey,
  alertsArmed,
  alertReasonFor,
  audioEffective,
  buildNotificationPayload,
  createAlertTracker,
  deliverNotification,
  desktopEffective,
  describeAudioEffective,
  describeDesktopEffective,
  describeNotificationDelivery,
  loadAlertDedupe,
  loadAlertSettings,
  notificationPermissionState,
  readBrowserNotificationApi,
  requestNotificationPermission,
  saveAlertDedupe,
  saveAlertSettings,
  type AlertDedupeScope,
  type AlertSettings,
  type AudioPlayReport,
  type NotificationDelivery,
  type NotificationPermissionState,
  type SecurityAlertReason,
} from "../lib/guard/audioAlert.ts";
import {
  DEFAULT_QUIET_HOURS,
  describeQuietHours,
  quietHoursDayNote,
  resolveQuietHours,
  validateQuietHoursClock,
  validateQuietHoursTimeZone,
  type QuietHoursSchedule,
} from "../lib/guard/quietHours.ts";
import {
  DEFAULT_WEBHOOK_SETTINGS,
  getLastWebhookDispatch,
  loadWebhookSettings,
  subscribeLastWebhookDispatch,
  subscribeWebhookSettings,
  type DispatchResult,
  type WebhookSettings,
} from "../lib/guard/webhookDispatcher.ts";
import { buildAlertChannelHealthView } from "../lib/guard/alertChannelHealth.ts";

const REASON_LABEL: Record<NonNullable<ReturnType<typeof alertReasonFor>>, string> = {
  blocked: "a call was blocked",
  frozen: "the account was frozen",
  policy_revoked: "a policy was revoked",
};

/** How often the quiet-hours sentence re-reads the clock, while quiet hours are on. */
const CLOCK_TICK_MS = 10_000;

/**
 * What the class selection can actually do, in one honest line.
 *
 * Everything unticked is the one configuration the two channel switches cannot
 * describe on their own: the switches are on, the pill would read "armed", and
 * nothing will ever interrupt anyone. A control must not imply protection the
 * tab cannot deliver (#314), so that state is named rather than left to the
 * switches.
 */
function classStateLine(classes: readonly SecurityAlertReason[]): string {
  if (classes.length === 0) {
    return "No event class is selected, so nothing will alert even with a channel on.";
  }
  return `Interrupts for: ${classes.map((reason) => REASON_LABEL[reason]).join(", ")}.`;
}

export function TelemetryAlerts() {
  const events = useGuardEvents();
  const { guard, feed } = useGuard();
  const [settings, setSettings] = useState<AlertSettings>({
    audio: false,
    desktop: false,
    volume: 0.4,
    classes: [...ALERT_REASON_ORDER],
    // The zone is the one part of the schedule that is only knowable in the
    // browser, so the seed pins UTC and the restore effect below replaces it:
    // the same reason the channels start off, and a schedule whose window is
    // read in a zone the server guessed is exactly the kind of silent lie this
    // panel is not allowed to print (#494).
    quiet: { ...DEFAULT_QUIET_HOURS, timeZone: "UTC" },
  });
  const [permission, setPermission] = useState<NotificationPermissionState>("unsupported");
  const [lastAlert, setLastAlert] = useState<string | null>(null);
  // The two things the panel can only know by trying (#314): what the browser
  // did with the last notification, and whether the last chime actually played.
  const [lastDelivery, setLastDelivery] = useState<NotificationDelivery | null>(null);
  const [lastPlay, setLastPlay] = useState<AudioPlayReport | null>(null);
  const [webhookSettings, setWebhookSettings] = useState<WebhookSettings>(
    () => DEFAULT_WEBHOOK_SETTINGS,
  );
  const [lastWebhookDispatch, setLastWebhookDispatch] = useState<DispatchResult | null>(null);

  // One alerter and one seen-set per tab. The alerter owns the AudioContext, so
  // recreating it on a re-render would drop the unlocked state and go silent
  // again without saying so.
  const alerter = useMemo(() => AudioAlerter.forBrowser(), []);
  const notificationApi = useMemo(() => readBrowserNotificationApi(), []);

  // The seen-set lives in a ref for the same reason: `feed.guards` is a fresh
  // array on every poll, so a `useMemo` keyed on it would rebuild the tracker
  // every five seconds and re-chime the block it just announced. It is replaced
  // only when the *scope* changes, below (#313).
  const trackerRef = useRef(createAlertTracker());
  const scopedKeyRef = useRef<string | null>(null);

  const scope = useMemo<AlertDedupeScope>(
    () => ({
      network: NETWORK.name,
      guards: [guard, ...feed.guards.map((source) => source.guard)],
    }),
    [guard, feed.guards],
  );
  const scopeKey = alertDedupeScopeKey(scope);

  // Settings and permission are only knowable in the browser, so both settle in
  // an effect. Rendering the stored value during the first render would produce
  // a hydration mismatch the moment an operator turned alerts on in a previous
  // session.
  useEffect(() => {
    // Named rather than inlined, matching `useAddressLabel`: the browser's state
    // is read in a callback, so hydration always shows the defaults.
    const restore = () => {
      setSettings(loadAlertSettings());
      setPermission(notificationPermissionState(notificationApi));
      setWebhookSettings(loadWebhookSettings());
      setLastWebhookDispatch(getLastWebhookDispatch());
    };
    restore();

    const syncPermission = () => {
      const live = notificationPermissionState(notificationApi);
      setPermission((prev) => (prev === live ? prev : live));
      if (live !== "granted") {
        setLastDelivery((prev) => (prev?.delivered ? null : prev));
      }
    };

    const unsubWebhook = subscribeWebhookSettings(() => {
      setWebhookSettings(loadWebhookSettings());
    });
    const unsubDispatch = subscribeLastWebhookDispatch(() => {
      setLastWebhookDispatch(getLastWebhookDispatch());
    });
    window.addEventListener("focus", syncPermission);
    document.addEventListener("visibilitychange", syncPermission);

    return () => {
      unsubWebhook();
      unsubDispatch();
      window.removeEventListener("focus", syncPermission);
      document.removeEventListener("visibilitychange", syncPermission);
      alerter.close();
    };
  }, [alerter, notificationApi]);

  useEffect(() => {
    saveAlertSettings(settings);
  }, [settings]);

  // Fresh, security-critical events only. `trackerRef` is what keeps a 5s poll
  // from re-announcing the same block; without it a single refusal chimes once
  // per poll until it ages out of the feed.
  useEffect(() => {
    if (scopedKeyRef.current !== scopeKey) {
      // A different network or a different watched guard set is a different
      // stream of identities, so the memory is dropped and re-primed from that
      // scope's own record: switching never replays another scope's alerts, and
      // a reload never re-chimes this tab's history (#313).
      scopedKeyRef.current = scopeKey;
      trackerRef.current = createAlertTracker(ALERT_DEDUPE_PERSIST_LIMIT, loadAlertDedupe(scope));
    }
    const tracker = trackerRef.current;

    const announce = () => {
      // Re-read live permission on every poll without prompting (#498), so
      // external revocation in browser site settings is reflected immediately.
      const livePermission = notificationPermissionState(notificationApi);
      setPermission((prev) => (prev === livePermission ? prev : livePermission));
      if (livePermission !== "granted") {
        setLastDelivery((prev) => (prev?.delivered ? null : prev));
      }

      if (!alertsArmed(settings)) return;
      const fresh = tracker.unseen(events).filter((event) => alertReasonFor(event) !== null);
      if (fresh.length === 0) return;
      // The fresh events that were allowed to interrupt, as opposed to the
      // fresh ones that simply arrived: `lastAlert` reports the first, and the
      // two are not the same list once the operator has unticked a class.
      const announced: GuardEvent[] = [];

      for (const event of fresh) {
        const reason = alertReasonFor(event);
        if (!reason) continue;
        // A class the operator unticked stays a row in the feed and nothing
        // more. It is still recorded as seen, so ticking it back on never
        // replays a week of history at them — alerts are for what happens next,
        // which is the same rule the reload follows (#313).
        if (!alertClassEnabled(settings, reason)) continue;
        // #494: inside the quiet window the tab keeps its silence, apart from
        // the classes the operator put on the exception list. Like an unticked
        // class, a suppressed event is still recorded as seen — quiet hours hold
        // an alert back, they do not queue it up for the morning, and the feed
        // is where the operator reads it.
        if (resolveQuietHours(Date.now(), settings.quiet, reason).suppresses) continue;
        announced.push(event);
        if (settings.audio) setLastPlay(alerter.play());
        if (settings.desktop) {
          setLastDelivery(
            deliverNotification(buildNotificationPayload(event, guard), notificationApi),
          );
        }
      }
      // The identities survive a reload only if they are written down; the
      // write is best-effort (private mode and quota are handled in the store).
      saveAlertDedupe(scope, tracker.keys());

      // Only what actually interrupted counts as the last alert: a refusal
      // whose class is off is a row the operator read for themselves, and
      // claiming it as an alert would be reporting something that did not
      // happen (#314).
      const newest = announced[announced.length - 1];
      const newestReason = newest ? alertReasonFor(newest) : null;
      if (newestReason) setLastAlert(`${REASON_LABEL[newestReason]} · ${short(guard, 6, 4)}`);
    };
    announce();
  }, [events, settings, scope, scopeKey, alerter, guard, notificationApi]);

  /** Turn the chime on. The click is what unlocks audio, so this cannot be a checkbox. */
  const toggleAudio = useCallback(() => {
    setSettings((current) => {
      const next = { ...current, audio: !current.audio };
      if (next.audio) {
        const status = alerter.unlock();
        if (status === "unsupported") {
          setLastAlert("This browser has no Web Audio, so chimes are unavailable.");
          return { ...current, audio: false };
        }
        setLastPlay(alerter.play());
      }
      return next;
    });
  }, [alerter]);

  const toggleDesktop = useCallback(() => {
    // A new preference is a new question, so the previous answer stops being
    // the one on screen: an old delivery failure would otherwise read as a
    // broken channel the operator has just re-enabled.
    setLastDelivery(null);
    setSettings((current) => {
      const next = { ...current, desktop: !current.desktop };
      if (next.desktop) {
        void requestNotificationPermission(notificationApi).then((state) => {
          setPermission(state);
          if (state !== "granted") {
            setSettings((latest) => ({ ...latest, desktop: false }));
            setLastAlert(
              state === "unsupported"
                ? "This browser does not offer desktop notifications."
                : "Notifications were not granted, so the desktop channel stays off.",
            );
          }
        });
      }
      return next;
    });
  }, [notificationApi]);

  /**
   * Tick one event class.
   *
   * The declared order is kept rather than the clicking order, the same rule
   * the webhook event list follows: one selection has to read and write as one
   * thing, whatever sequence it was arrived at in.
   */
  const toggleClass = useCallback((reason: SecurityAlertReason) => {
    setSettings((current) => {
      const classes = current.classes.includes(reason)
        ? current.classes.filter((item) => item !== reason)
        : [...current.classes, reason].sort(
            (a, b) => ALERT_REASON_ORDER.indexOf(a) - ALERT_REASON_ORDER.indexOf(b),
          );
      return { ...current, classes };
    });
  }, []);

  /**
   * Change one part of the quiet-hours schedule.
   *
   * `Partial`, because a schedule is four independent fields and one click does
   * not rewrite the others. The clocks and the zone are validated by the caller
   * before reaching here: a half-typed time or a mistyped zone must never become
   * a different window on its own, and the field keeps showing what the operator
   * has typed while `normalizeQuietHours` keeps the *stored* record readable.
   */
  const updateQuiet = useCallback((patch: Partial<QuietHoursSchedule>): void => {
    setSettings((current) => ({ ...current, quiet: { ...current.quiet, ...patch } }));
  }, []);

  const toggleQuietHours = useCallback(() => {
    setSettings((current) => ({
      ...current,
      quiet: { ...current.quiet, enabled: !current.quiet.enabled },
    }));
  }, []);

  /**
   * Tick one class onto the break-through list.
   *
   * The declared order again, exactly as `toggleClass` keeps it, so a stored
   * schedule written in one tab reads identically in another.
   */
  const toggleQuietBreakThrough = useCallback((reason: SecurityAlertReason) => {
    setSettings((current) => {
      const breakThrough = current.quiet.breakThrough.includes(reason)
        ? current.quiet.breakThrough.filter((item) => item !== reason)
        : [...current.quiet.breakThrough, reason].sort(
            (a, b) => ALERT_REASON_ORDER.indexOf(a) - ALERT_REASON_ORDER.indexOf(b),
          );
      return { ...current, quiet: { ...current.quiet, breakThrough } };
    });
  }, []);

  // The sentence below names the local clock, so it needs an instant, and
  // render cannot call `Date.now()` itself — that is an impure read the
  // `react-hooks` purity rule refuses, and the last render's clock would be a
  // lie after a minute had passed anyway. So the clock is ticked into state by
  // an interval, the shape `TelemetryChart` uses for its sliding window: the
  // read happens in the callback, never in the effect body, and the value is
  // never more than a tick old when quiet hours are switched on. The announce
  // path is independent of all this — it reads the real clock in its own effect.
  const [quietNowMs, setQuietNowMs] = useState<number>(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setQuietNowMs(Date.now()), CLOCK_TICK_MS);
    return () => clearInterval(timer);
  }, []);

  // `blocked` is the reference class because it is the one quiet hours exist
  // for, and the sentence describes the window rather than any particular event.
  const quietDecision = resolveQuietHours(quietNowMs, settings.quiet, "blocked");
  const zoneProblem = validateQuietHoursTimeZone(settings.quiet.timeZone);
  const quietDayNote = settings.quiet.enabled
    ? quietHoursDayNote(quietNowMs, settings.quiet.timeZone)
    : null;

  const desktopState = desktopEffective(settings.desktop, permission, lastDelivery);
  const audioState = audioEffective(settings.audio, lastPlay);
  const armed = alertsArmed(settings);
  const channelHealth = buildAlertChannelHealthView({
    desktopEnabled: settings.desktop,
    permission,
    lastDelivery,
    audioEnabled: settings.audio,
    lastPlay,
    webhookSettings,
    network: NETWORK.name,
    lastWebhookDispatch,
  });

  return (
    <div
      className="row"
      style={{ justifyContent: "space-between", alignItems: "flex-start" }}
      data-testid="telemetry-alerts"
    >
      <div>
        <div className="row">
          <span className="lbl" style={{ margin: 0 }}>
            Security alerts
          </span>
          <span className={`pill${armed ? " ok" : ""}`}>{armed ? "armed" : "off"}</span>
        </div>
        <p className="tiny muted" style={{ marginTop: 4 }}>
          A short chime and a desktop notification when the guard blocks a call, or when an admin
          freezes the account or revokes a policy. Off until you turn it on.
        </p>
        <p className="tiny muted" style={{ marginTop: 4 }} data-testid="chime-alert-state">
          {describeAudioEffective(audioState)}
        </p>
        <p className="tiny muted" style={{ marginTop: 4 }} data-testid="desktop-alert-state">
          {describeDesktopEffective(desktopState)}
        </p>
        <p className="tiny muted" style={{ marginTop: 4 }} data-testid="alert-class-state">
          {classStateLine(settings.classes)}
        </p>
        {lastDelivery && (
          <p
            className={lastDelivery.delivered ? "tiny muted" : "tiny"}
            style={
              lastDelivery.delivered ? { marginTop: 4 } : { marginTop: 4, color: "var(--danger)" }
            }
            data-testid="notification-delivery"
          >
            {describeNotificationDelivery(lastDelivery)}
          </p>
        )}
        {lastAlert && (
          <p className="tiny" style={{ marginTop: 4 }}>
            Last alert: {lastAlert}
          </p>
        )}
        <section
          className="stack"
          style={{ marginTop: 10, gap: 6 }}
          data-testid="alert-channel-health"
          aria-label="Alert channel health"
        >
          <span className="lbl" style={{ margin: 0 }}>
            Channel health
          </span>
          {channelHealth.map((item) => (
            <div key={item.channel} className="tiny" data-testid={`channel-health-${item.channel}`}>
              <span
                className={`pill ${
                  item.status === "ready"
                    ? "ok"
                    : item.status === "failed" || item.status === "unavailable"
                      ? "warn"
                      : ""
                }`}
                style={{ marginRight: 6 }}
                data-testid={`channel-health-${item.channel}-status`}
              >
                {item.label}: {item.statusLabel}
              </span>
              <span className="muted">{item.detail}</span>
              {item.recovery && (
                <div
                  className="tiny"
                  style={{ color: "var(--muted)", marginTop: 2 }}
                  data-testid={`channel-health-${item.channel}-recovery`}
                >
                  Recovery: {item.recovery}
                </div>
              )}
            </div>
          ))}
        </section>
      </div>

      <div style={{ display: "grid", gap: 6, justifyItems: "end" }}>
        <button
          type="button"
          className={settings.audio ? undefined : "secondary"}
          onClick={toggleAudio}
          aria-pressed={settings.audio}
          title="Clicking is what lets the browser start audio"
        >
          {settings.audio ? "Mute chime" : "Enable chime"}
        </button>

        <button
          type="button"
          className={settings.desktop ? undefined : "secondary"}
          onClick={toggleDesktop}
          aria-pressed={settings.desktop}
          disabled={permission === "unsupported" || permission === "denied"}
          title={
            permission === "denied"
              ? "The browser has blocked notifications for this site; re-allow them in site settings."
              : "Asks the browser for notification permission"
          }
        >
          {settings.desktop ? "Disable notifications" : "Enable notifications"}
        </button>

        <label className="tiny muted row" style={{ gap: 6 }}>
          Volume
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={settings.volume}
            onChange={(event) => {
              const volume = Number(event.target.value);
              alerter.setVolume(volume);
              setSettings((current) => ({ ...current, volume }));
            }}
            aria-label="Alert chime volume"
          />
        </label>

        {/*
          The classes are the other half of the opt-in, and they are the half
          the operator is most likely to want to narrow: a console that tails
          three guards may want refusals but not the routine policy revocations
          it is making itself. All three are on by default, so this is a choice
          being offered rather than a warning being hidden.
        */}
        <div
          className="stack"
          role="group"
          aria-label="Alert event classes"
          data-testid="alert-class-options"
          style={{ justifySelf: "stretch", marginTop: 4 }}
        >
          <span className="lbl">Alert me for</span>
          {ALERT_REASON_ORDER.map((reason) => (
            <label className="checkline" key={reason} style={{ marginBottom: 0 }}>
              <input
                type="checkbox"
                checked={settings.classes.includes(reason)}
                onChange={() => toggleClass(reason)}
                aria-label={ALERT_CLASS_LABELS[reason]}
              />
              <span>
                <strong style={{ fontSize: 13 }}>{ALERT_CLASS_LABELS[reason]}</strong>{" "}
                <span className="mono tiny muted">{reason}</span>
                <div className="tiny muted">{ALERT_CLASS_HINTS[reason]}</div>
              </span>
            </label>
          ))}
        </div>

        {/*
          Quiet hours (#494). The window is local wall clock in one named zone,
          which is why the zone is a field rather than an assumption: "quiet from
          22:00" means something different in two offices, and across a
          daylight-saving transition the same window covers 23 or 25 real hours.
          The note below says which. Nothing here can silence the guard or the
          feed — it silences this tab's chime and its notifications, and the
          exception list is the operator's, not ours.
        */}
        <div
          className="stack"
          role="group"
          aria-label="Quiet hours"
          data-testid="quiet-hours"
          style={{ justifySelf: "stretch", marginTop: 8 }}
        >
          <button
            type="button"
            className={settings.quiet.enabled ? undefined : "secondary"}
            onClick={toggleQuietHours}
            aria-pressed={settings.quiet.enabled}
            data-testid="quiet-hours-toggle"
            title="Hold this tab's own alerts back during a local window"
          >
            {settings.quiet.enabled ? "Disable quiet hours" : "Enable quiet hours"}
          </button>

          <label className="tiny muted row" style={{ gap: 6 }}>
            From
            <input
              type="time"
              value={settings.quiet.start}
              onChange={(event) => {
                const start = event.target.value;
                if (validateQuietHoursClock(start) === null) updateQuiet({ start });
              }}
              aria-label="Quiet hours start (local time)"
            />
          </label>

          <label className="tiny muted row" style={{ gap: 6 }}>
            Until
            <input
              type="time"
              value={settings.quiet.end}
              onChange={(event) => {
                const end = event.target.value;
                if (validateQuietHoursClock(end) === null) updateQuiet({ end });
              }}
              aria-label="Quiet hours end (local time)"
            />
          </label>

          <label className="tiny muted row" style={{ gap: 6 }}>
            Zone
            <input
              type="text"
              value={settings.quiet.timeZone}
              onChange={(event) => updateQuiet({ timeZone: event.target.value })}
              aria-label="Quiet hours IANA time zone, for example America/New_York"
              aria-invalid={zoneProblem !== null}
              spellCheck={false}
            />
          </label>
          {zoneProblem && (
            <p className="tiny" style={{ margin: 0, color: "var(--danger)" }}>
              {zoneProblem}
            </p>
          )}

          <div className="stack" role="group" aria-label="Alert through quiet hours">
            <span className="lbl" style={{ margin: 0 }}>
              Interrupt me anyway for
            </span>
            <div data-testid="quiet-hours-break-through" className="row" style={{ gap: 12 }}>
              {ALERT_REASON_ORDER.map((reason) => (
                <label className="checkline" key={reason} style={{ marginBottom: 0 }}>
                  <input
                    type="checkbox"
                    checked={settings.quiet.breakThrough.includes(reason)}
                    onChange={() => toggleQuietBreakThrough(reason)}
                    aria-label={`Alert during quiet hours when ${REASON_LABEL[reason]}`}
                  />
                  <span className="tiny">{REASON_LABEL[reason]}</span>
                </label>
              ))}
            </div>
          </div>

          <p className="tiny muted" style={{ marginTop: 4 }} data-testid="quiet-hours-state">
            {describeQuietHours(quietDecision, settings.quiet)}
            {quietDayNote ? ` ${quietDayNote}` : ""}
          </p>
        </div>
      </div>
    </div>
  );
}
