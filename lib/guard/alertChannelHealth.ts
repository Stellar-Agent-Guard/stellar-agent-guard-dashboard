import {
  audioEffective,
  describeAudioEffective,
  describeDesktopEffective,
  desktopEffective,
  type AudioPlayReport,
  type NotificationDelivery,
  type NotificationPermissionState,
} from "./audioAlert.ts";
import {
  describeDispatch,
  getScopedGuardsForNetwork,
  validateWebhookUrl,
  type DispatchResult,
  type WebhookSettings,
} from "./webhookDispatcher.ts";

export type ChannelId = "browser" | "audio" | "webhook";
export type ChannelReadiness = "ready" | "off" | "needs-action" | "failed" | "unavailable";

export interface AlertChannelHealthItem {
  channel: ChannelId;
  label: string;
  status: ChannelReadiness;
  statusLabel: string;
  detail: string;
  recovery: string | null;
}

export interface AlertChannelHealthInput {
  desktopEnabled: boolean;
  permission: NotificationPermissionState;
  lastDelivery: NotificationDelivery | null;
  audioEnabled: boolean;
  lastPlay: AudioPlayReport | null;
  webhookSettings: WebhookSettings;
  network: string;
  lastWebhookDispatch: DispatchResult | null;
}

function browserChannelHealth(input: AlertChannelHealthInput): AlertChannelHealthItem {
  const effective = desktopEffective(input.desktopEnabled, input.permission, input.lastDelivery);
  const detail = describeDesktopEffective(effective);

  switch (effective) {
    case "off":
      return {
        channel: "browser",
        label: "Browser notifications",
        status: "off",
        statusLabel: "off",
        detail,
        recovery: null,
      };
    case "unsupported":
      return {
        channel: "browser",
        label: "Browser notifications",
        status: "unavailable",
        statusLabel: "unavailable",
        detail,
        recovery: "Use audio chimes or webhook alerts in this browser.",
      };
    case "blocked-by-browser":
      return {
        channel: "browser",
        label: "Browser notifications",
        status: "failed",
        statusLabel: "blocked",
        detail,
        recovery: "Re-allow notifications for this origin in your browser site settings.",
      };
    case "awaiting-permission":
      return {
        channel: "browser",
        label: "Browser notifications",
        status: "needs-action",
        statusLabel: "needs permission",
        detail,
        recovery: "Click Enable notifications to grant browser permission.",
      };
    case "failing":
      return {
        channel: "browser",
        label: "Browser notifications",
        status: "failed",
        statusLabel: "failing",
        detail,
        recovery: "Verify OS/browser notification permissions and toggle notifications.",
      };
    case "ready":
    case "delivering":
      return {
        channel: "browser",
        label: "Browser notifications",
        status: "ready",
        statusLabel: "ready",
        detail,
        recovery: null,
      };
  }
}

function audioChannelHealth(input: AlertChannelHealthInput): AlertChannelHealthItem {
  const effective = audioEffective(input.audioEnabled, input.lastPlay);
  const detail = describeAudioEffective(effective);

  switch (effective) {
    case "off":
      return {
        channel: "audio",
        label: "Audio chime",
        status: "off",
        statusLabel: "off",
        detail,
        recovery: null,
      };
    case "unsupported":
      return {
        channel: "audio",
        label: "Audio chime",
        status: "unavailable",
        statusLabel: "unavailable",
        detail,
        recovery: "Use browser notifications or webhook alerts instead.",
      };
    case "needs-unlock":
      return {
        channel: "audio",
        label: "Audio chime",
        status: "needs-action",
        statusLabel: "needs click",
        detail,
        recovery:
          "Click Mute chime then Enable chime (or interact with the toggle) to unlock audio.",
      };
    case "ready":
      return {
        channel: "audio",
        label: "Audio chime",
        status: "ready",
        statusLabel: "ready",
        detail,
        recovery: null,
      };
  }
}

function webhookRecoveryFor(result: DispatchResult): string {
  switch (result.outcome) {
    case "cors":
      return "Allow this console's origin in the webhook receiver's CORS headers.";
    case "rejected":
      return "Check the webhook URL, payload schema, and signing secret, then run Test webhook.";
    case "timeout":
      return "Ensure the webhook endpoint responds within 10s, then run Test webhook.";
    case "network":
      return "Check network connectivity and the destination host, then run Test webhook.";
    default:
      return "Open Webhook alerts and run Test webhook to verify delivery.";
  }
}

function webhookChannelHealth(input: AlertChannelHealthInput): AlertChannelHealthItem {
  const { webhookSettings: settings, network, lastWebhookDispatch } = input;

  if (!settings.enabled) {
    return {
      channel: "webhook",
      label: "Webhook dispatch",
      status: "off",
      statusLabel: "off",
      detail: "Webhook dispatch is switched off.",
      recovery: null,
    };
  }

  const urlProblem = validateWebhookUrl(settings.url);
  if (urlProblem) {
    return {
      channel: "webhook",
      label: "Webhook dispatch",
      status: "failed",
      statusLabel: "misconfigured",
      detail: urlProblem,
      recovery: "Open Webhook alerts and enter a valid credential-free https:// URL.",
    };
  }

  if (settings.events.length === 0) {
    return {
      channel: "webhook",
      label: "Webhook dispatch",
      status: "needs-action",
      statusLabel: "no events selected",
      detail: "No webhook alert event types are selected.",
      recovery: "Open Webhook alerts and select at least one alert type.",
    };
  }

  const scoped = getScopedGuardsForNetwork(settings, network);
  if (scoped.length === 0) {
    return {
      channel: "webhook",
      label: "Webhook dispatch",
      status: "needs-action",
      statusLabel: "no guards scoped",
      detail: `No guards are scoped for webhook delivery on ${network}.`,
      recovery: `Open Webhook alerts and select at least one guard for ${network}.`,
    };
  }

  if (lastWebhookDispatch && !lastWebhookDispatch.ok && lastWebhookDispatch.outcome !== "skipped") {
    return {
      channel: "webhook",
      label: "Webhook dispatch",
      status: "failed",
      statusLabel: lastWebhookDispatch.outcome,
      detail: describeDispatch(lastWebhookDispatch),
      recovery: webhookRecoveryFor(lastWebhookDispatch),
    };
  }

  return {
    channel: "webhook",
    label: "Webhook dispatch",
    status: "ready",
    statusLabel: "ready",
    detail: `Webhook dispatch is configured for ${scoped.length} guard(s) on ${network}.`,
    recovery: null,
  };
}

/**
 * Build an independent per-channel readiness, failure, and recovery summary
 * for browser notifications, audio chimes, and webhook dispatch (#499).
 */
export function buildAlertChannelHealthView(
  input: AlertChannelHealthInput,
): AlertChannelHealthItem[] {
  return [browserChannelHealth(input), audioChannelHealth(input), webhookChannelHealth(input)];
}
