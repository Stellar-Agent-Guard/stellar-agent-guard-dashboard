"use client";

/**
 * Recovery guidance after a wallet extension update (issue #518).
 *
 * An extension update is not a transaction event. It can invalidate the
 * permission this tab was granted, change the injected provider's shape, or
 * silently drop the wallet back to its lock screen — and every one of those
 * surfaces as some provider-specific error string in whichever panel asked
 * next. Without a shared explanation the operator's likely move is to re-enter
 * a seed phrase into whatever page is in front of them, which is the one thing
 * a non-custodial console must never invite.
 *
 * This module owns the vocabulary for that recovery:
 *
 *   - safe reconnect steps (reload, re-grant, no seed phrase, fresh review);
 *   - verification, so a reconnect is not mistaken for a working session;
 *   - the boundary between *wallet state* (local, disposable, possibly stale
 *     after an update) and *chain state* (authoritative, read from Soroban RPC).
 *
 * The UI renders it from these constants, and every wallet error links to it,
 * so the guidance cannot drift between the panels.
 */

/** The `id` the recovery block renders under; wallet errors link to it. */
export const WALLET_RECOVERY_ANCHOR = "wallet-recovery";

/** The link text shown under a wallet error. */
export const WALLET_RECOVERY_LINK_LABEL = "Wallet updated or not responding? Safe reconnect steps";

export type WalletRecoveryId = "extension-updated" | "disconnected" | "wrong-network";

export interface WalletRecoveryGuide {
  id: WalletRecoveryId;
  headline: string;
  /** What the operator is looking at, in plain words. */
  why: string;
  /** Safe reconnect, in order. Never includes a secret. */
  reconnect: readonly string[];
  /** How to know the session is really usable again. */
  verification: readonly string[];
}

const NO_SECRET_RULE =
  "This console never asks for a seed phrase or a secret key. If any page does, close it — the recovery here is re-granting access, not re-importing a wallet.";

/**
 * The full update-recovery guide.
 *
 * `reconnect` and `verification` are separate on purpose: reconnecting only
 * proves the provider answers, while verification proves it answers as the
 * account and network the operator intended to operate.
 */
export const WALLET_EXTENSION_UPDATE_GUIDE: WalletRecoveryGuide = {
  id: "extension-updated",
  headline: "Your wallet extension was updated, locked or reloaded",
  why:
    "An extension update can revoke this page's permission, change the provider it injects, " +
    "or lock itself. The console keeps its last known wallet state until it is told otherwise, " +
    "so that state may be stale — it is never a claim about the chain.",
  reconnect: [
    "Finish or dismiss the wallet's own update/reload prompt, then unlock it.",
    "Reload this page so the console re-reads the extension instead of a cached provider object.",
    "Choose Change wallet (or Connect admin wallet) and approve access for this site again.",
    "If the provider is not listed, confirm the extension is enabled for this origin, or pick another provider from the same picker.",
    "Do not resume an interrupted review: reconnect first, then start a fresh review from the beginning.",
    NO_SECRET_RULE,
  ],
  verification: [
    "The header shows the account you expect, and the network chip agrees with this console's target network.",
    "A status refresh returns the same guard address you were operating — reads need no permission, so they are the cheapest check.",
    "Transaction history, or the chain itself, is the only authority on whether an earlier write landed. A reconnect never resubmits anything.",
  ],
};

/** The shorter guide for a wallet that simply went away. */
export const WALLET_DISCONNECTED_GUIDE: WalletRecoveryGuide = {
  id: "disconnected",
  headline: "The wallet disconnected",
  why:
    "The provider stopped answering — it was locked, closed, updated or removed from this " +
    "browser. Nothing was signed by the console, and nothing is resubmitted automatically.",
  reconnect: [
    "Unlock or reopen the wallet extension.",
    "Reconnect from the wallet panel and approve access for this site.",
    "Start a fresh review rather than assuming the previous write completed.",
    NO_SECRET_RULE,
  ],
  verification: [
    "The header address matches the account the review was built for.",
    "The wallet's network matches this console's target network.",
    "Check Transaction history before retrying anything that may already have been broadcast.",
  ],
};

/**
 * Wallet state versus chain state.
 *
 * An operator who believes a stale header is a chain fact will either retry a
 * write that already landed or trust a policy that is not deployed. Keeping the
 * two named side by side is the point of this table.
 */
export const WALLET_VS_CHAIN: readonly { label: string; detail: string }[] = [
  {
    label: "Wallet state (local)",
    detail:
      "Connection, account and network as the extension last reported them — local state that " +
      "only this tab holds. An update can invalidate all three while this tab stays open, so " +
      "treat them as a hint until re-read.",
  },
  {
    label: "Chain state (authoritative)",
    detail:
      "Policy, freeze status, rolling window, telemetry and transaction outcomes are the " +
      "authoritative state, read from Soroban RPC. They are unaffected by an extension update, " +
      "and they are what this console reports as fact.",
  },
];

/**
 * Does this provider message look like a wallet that changed state under us?
 *
 * The matching is deliberately loose: every provider words this differently and
 * the value of the guidance is that it appears at all. Unrelated failures (an
 * insufficient balance, a refused simulation) return `null` so the panel keeps
 * its own, more specific error instead of blaming the extension.
 */
export function walletRecoveryFor(message: string | null | undefined): WalletRecoveryGuide | null {
  if (!message) return null;
  const normalised = message.toLowerCase();
  if (
    /extension|updated|update|reload|permission|not (be )?(found|installed|available)|no provider|disconnected|connect(ion)? (was )?(closed|lost)|locked|no wallet|unauthori[sz]ed/.test(
      normalised,
    )
  ) {
    return WALLET_EXTENSION_UPDATE_GUIDE;
  }
  return null;
}

/** The in-page link every wallet error renders. */
export function recoveryAnchorHref(): string {
  return `#${WALLET_RECOVERY_ANCHOR}`;
}
