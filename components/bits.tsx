"use client";

import { usePathname } from "next/navigation";
import Link from "next/link";
import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import type { ReadResult } from "../lib/guard/chain.ts";
import { SKELETON_CLASS } from "../lib/guard/statusReadState.ts";
import { ENFORCEMENT_SCOPE_STATEMENT, NETWORK } from "../lib/guard/network.ts";
import { explorerAccountUrl, explorerTxUrl } from "../lib/guard/explorerLinks.ts";
import { networkDisplayName } from "../lib/guard/networkSwitch.ts";
import { lookupLabel, subscribeAddressBook } from "../lib/guard/addressBook.ts";
import { CopyButton } from "./CopyButton.tsx";
import {
  formatRawStroops,
  formatStroopsWithUnit,
  type FormatStroopsOptions,
} from "../lib/guard/formatters.ts";

export function Tabs() {
  const pathname = usePathname();
  const tabs = [
    { href: "/", label: "Console" },
    { href: "/fleet", label: "Fleet" },
    { href: "/configure", label: "Configure" },
  ];
  return (
    <nav className="tabs">
      {tabs.map((tab) => (
        <Link
          key={tab.href}
          href={tab.href}
          aria-current={pathname === tab.href ? "page" : undefined}
        >
          {tab.label}
        </Link>
      ))}
    </nav>
  );
}

/**
 * The enforcement boundary, shown wherever a capability is described.
 *
 * Rendered from the same constant the README and SPEC.md quote, so the interface
 * cannot end up claiming more (or less) than the documents do.
 */
export function ScopeNotice({ compact = false }: { compact?: boolean }) {
  return (
    <div className="notice">
      <strong title="Terminology defined in docs/glossary.md: SAC (Stellar Asset Contract), Soroban Auth Context, __check_auth, Rolling Window">
        What the policy engine enforces
      </strong>
      <span className="tiny">{ENFORCEMENT_SCOPE_STATEMENT}</span>
      {!compact && (
        <div className="tiny muted" style={{ marginTop: 6 }}>
          This boundary is a property of the platform, not a gap this interface hides.
        </div>
      )}
    </div>
  );
}

/**
 * The warning tier: one prominent banner for a state that is *safe* but not
 * doing what the operator probably assumes it is doing.
 *
 * Established here by the default-deny status pass (issue #25) and shared, so
 * the telemetry feed's per-row severity (issue #26) and the pending-status
 * surfaces reuse one set of tokens rather than each inventing a red. `tier`
 * picks the intensity: `warn` for "working as designed, read this", `danger` for
 * "frozen/refused, act now" — the same two tiers as `.notice` and `.error`.
 *
 * `role="status"` announces it politely rather than interrupting: a state that
 * is already true when the page loads is context, not an event.
 */
export function WarningBanner({
  tier = "warn",
  title,
  children,
  action,
}: {
  tier?: "warn" | "danger";
  title: string;
  children?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className={`notice${tier === "danger" ? " danger" : ""}`} data-tier={tier} role="status">
      <strong>{title}</strong>
      {children}
      {action}
    </div>
  );
}

export function ErrorBlock({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="error">
      <span className="t">{title}</span>
      <span className="mono">{detail}</span>
    </div>
  );
}

/**
 * A read's label as a DOM-safe test id slug: `"status()"` → `"status-"`.
 */
function readSlug(label: string): string {
  return label.replace(/[^a-z0-9]+/gi, "-");
}

/**
 * Render a read's value, or its failure — with a retry that re-invokes only
 * that read.
 *
 * There is no third branch on purpose: a read that did not succeed has no value
 * to show, and substituting a zero would make an outage indistinguishable from a
 * genuinely empty policy. While a retry is in flight the retry button is
 * replaced by a status line — one re-read at a time, and a failing retry is
 * never a dead end because the button comes back with the error.
 */
export function ReadWithRetry<T>({
  result,
  label,
  onRetry,
  retrying,
  render,
}: {
  result: ReadResult<T>;
  label: string;
  onRetry: () => void;
  retrying: boolean;
  render: (value: T) => ReactNode;
}) {
  if (!result.ok) {
    return (
      <div className="error retryable" data-testid={`retryable-${readSlug(label)}`} role="alert">
        <span className="t">{`${label}: read failed`}</span>
        <span className="mono">{result.error}</span>
        {retrying ? (
          <span className="tiny" role="status">
            Retrying…
          </span>
        ) : (
          <button
            type="button"
            className="secondary"
            aria-label={`Retry ${label} fetch`}
            onClick={onRetry}
          >
            Retry
          </button>
        )}
      </div>
    );
  }
  return <>{render(result.value)}</>;
}

/**
 * The same read-with-retry component under the name call sites use when they
 * are talking about the retry affordance itself; identical props.
 */
export const RetryableRead = ReadWithRetry;

/**
 * Inline pending state for one retried read, so the retried field can show
 * progress without resetting the panels around it.
 */
export function ReadSkeleton({ label }: { label: string }) {
  return <div className="skeleton-row" data-testid={`skeleton-${label}`} aria-hidden="true" />;
}

/**
 * Render a read's value, or its failure.
 *
 * Sized in `em` so it inherits the exact font metrics of the slot it sits in
 * (`.stat .v`, `.stat .n`, …) and occupies the same height the resolved value
 * will — no jump, no shift. `aria-hidden="true"` keeps screen readers out:
 * the surrounding container's `aria-busy` already announces "this region is
 * loading", and a bar with no meaning would only be noise.
 */
export function Skeleton({ lines = 1, className = "" }: { lines?: number; className?: string }) {
  return (
    <>
      {Array.from({ length: lines }, (_, index) => (
        <span
          key={index}
          className={`${SKELETON_CLASS}${index > 0 ? " slim" : ""}${className ? ` ${className}` : ""}`}
          aria-hidden="true"
        />
      ))}
    </>
  );
}

/**
 * Render a read through all three of its states: pending → skeleton, failed →
 * the error, resolved → the value.
 *
 * The failure branch is the same explicit error block it has always been —
 * there is no default-on-failure path, because a substituted zero would make
 * an outage indistinguishable from a genuinely empty policy (README, no mock
 * state). What is new is the first branch: while the read is in flight the slot
 * shows a skeleton instead of nothing, so the panel's height does not collapse
 * and jump when the value lands.
 */
export function Read<T>({
  result,
  label,
  render,
  pendingLines = 1,
}: {
  result: ReadResult<T> | null | undefined;
  label: string;
  render: (value: T) => ReactNode;
  /** Skeleton lines to reserve while the read is pending (value + note slots). */
  pendingLines?: number;
}) {
  if (result === null || result === undefined) {
    return (
      <span aria-busy="true" className="read-pending">
        <Skeleton lines={pendingLines} />
      </span>
    );
  }
  if (!result.ok) {
    return <ErrorBlock title={`${label}: read failed`} detail={result.error} />;
  }
  return <>{render(result.value)}</>;
}

export function Stat({
  label,
  value,
  note,
  tone,
}: {
  label: string;
  value: ReactNode;
  note?: ReactNode | undefined;
  tone?: "ok" | "warn" | "danger" | undefined;
}) {
  return (
    <div className="stat">
      <div className="k">{label}</div>
      <div
        className={`v${tone ? ` ${tone}` : ""}`}
        style={tone ? { color: `var(--${tone})` } : undefined}
      >
        {value}
      </div>
      {note !== undefined && <div className="n">{note}</div>}
    </div>
  );
}

export function short(value: string, head = 6, tail = 4): string {
  if (value.length <= head + tail + 1) return value;
  return `${value.slice(0, head)}…${value.slice(-tail)}`;
}

/**
 * The network a value belongs to, stated on the value's own row.
 *
 * The WalletBar already states the build's network once, at the top of the page,
 * and that is the right *global* answer — it is what the mismatch banner (#97)
 * hangs off, and it stays exactly that. It is the wrong local one: the deploy
 * result is hundreds of pixels down a long panel, so scroll position puts the bar
 * off-screen at precisely the moment an operator is copying an address out of the
 * result and pasting it into a mainnet tool. A network chip repeated at every site
 * that shows an address, a contract id or a transaction hash closes that gap, and
 * the two are complementary rather than duplicate — the bar answers "what is this
 * console connected to", this answers "which network is *this* value from".
 *
 * `network` defaults to the build's own network, which is right for every value
 * the console read itself. A surface that is showing values from somewhere else
 * — a fleet row, a saved instance's own network — passes its own name instead,
 * so the chip reports the value's network rather than the reader's.
 *
 * The wording comes from `networkDisplayName`, the same function the mismatch
 * banner uses, so "Mainnet" here and "Mainnet" there cannot disagree.
 */
export function NetworkChip({
  network,
  className = "",
}: {
  /** Defaults to this build's configured network. */
  network?: string;
  className?: string;
}): ReactNode {
  const label = networkDisplayName({ passphrase: null, name: network ?? NETWORK.name });
  return (
    <span
      className={`net-chip${className ? ` ${className}` : ""}`}
      data-network={network ?? NETWORK.name}
      title={`Network: ${label}`}
    >
      {label}
    </span>
  );
}

/**
 * The operator's nickname for an address, or `null` when it is not in the book.
 *
 * Resolves to `null` during server render (there is no `localStorage` to read)
 * and again on the first client render, then settles once mounted, so it never
 * causes a hydration mismatch — an unlabelled address looks identical on both.
 * It re-reads whenever the book changes anywhere in the tab.
 */
export function useAddressLabel(address: string): string | null {
  // Always start `null` — the same on server and client's first render — then
  // resolve from the book in an effect. Reading `localStorage` during the first
  // render would desynchronise hydration whenever an address happens to be
  // labelled.
  const [label, setLabel] = useState<string | null>(null);
  useEffect(() => {
    const refresh = () => setLabel(lookupLabel(address));
    refresh();
    return subscribeAddressBook(refresh);
  }, [address]);
  return label;
}

/**
 * Render an address the way an operator reads it: `Nickname (XXXX…YYYY)` when it
 * is in the address book, otherwise the bare truncated form. The full address
 * stays on `title` so nothing is lost — the nickname is a convenience over the
 * real key, never a replacement for it.
 */
export function AddressText({
  address,
  className,
}: {
  address: string;
  className?: string;
}): ReactNode {
  const label = useAddressLabel(address);
  const truncated = label ? short(address, 4, 4) : short(address);
  return (
    <span className={className ?? "mono"} title={address}>
      {label ? `${label} (${truncated})` : truncated}
    </span>
  );
}

import { formatTimeAgo } from "../lib/guard/time.ts";

export function TimeAgo({ iso, suffix = "" }: { iso: string | null; suffix?: string }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 5000);
    return () => clearInterval(id);
  }, []);

  if (!iso) return <span>never</span>;

  const ts = Math.floor(new Date(iso).getTime() / 1000);
  const nowSecs = Math.floor(now / 1000);
  const rel = formatTimeAgo(ts, nowSecs);

  return (
    <time dateTime={iso} title={iso} className="timeago">
      {rel}
      {suffix}
    </time>
  );
}

/**
 * A deploy's transaction log.
 *
 * Each line states its own outcome, including the ones with no hash: a refused
 * step was never broadcast, and showing a blank where a hash would go would read
 * as a missing receipt rather than as the pre-flight path doing its job.
 */
export function OutcomeList({
  steps,
}: {
  steps: Array<{
    label: string;
    result: { kind: string; hash?: string; ledger?: number | null; detail?: string };
  }>;
}) {
  return (
    <div style={{ marginTop: 8 }}>
      {steps.map((step) => (
        <div key={step.label} className="tiny" style={{ marginBottom: 5 }}>
          <span
            className="pill"
            style={{
              color: step.result.kind === "submitted" ? "var(--ok)" : "var(--danger)",
            }}
          >
            {step.result.kind}
          </span>{" "}
          <span className="mono">{step.label}</span>
          {step.result.hash && (
            <div className="mono" style={{ marginLeft: 4 }}>
              tx {starLink(step.result.hash)} ledger {step.result.ledger ?? "-"}{" "}
              <CopyButton value={step.result.hash} label={`${step.label} transaction hash`} />{" "}
              <NetworkChip />
            </div>
          )}
          {step.result.detail && <div className="mono muted">{step.result.detail}</div>}
        </div>
      ))}
    </div>
  );
}

/**
 * A G... account as an explorer link, with the network beside it.
 *
 * An account and a transaction are different explorer pages, so this is a
 * separate builder from `starLink` rather than a flag on it: the fleet table used
 * to hand an account address to the transaction builder, which produced a
 * perfectly well-formed URL under `/tx/` that could only ever resolve to "not
 * found". `network` is passed through to both the link and the chip so a row
 * describing a network other than the build's own cannot end up with a URL and a
 * label that disagree.
 */
export function AccountLink({
  address,
  network,
  className,
}: {
  address: string;
  /** Defaults to this build's network. */
  network?: string;
  className?: string;
}): ReactNode {
  return (
    <span className={className ?? "mono tiny"}>
      <a
        href={explorerAccountUrl(address, { name: network ?? NETWORK.name })}
        target="_blank"
        rel="noreferrer"
      >
        {short(address, 6, 4)}
      </a>{" "}
      <NetworkChip {...(network !== undefined ? { network } : {})} />
    </span>
  );
}

/**
 * A transaction hash as a link to the explorer page for *this* network.
 *
 * The URL is composed by `explorerTxUrl`, which takes the network segment from
 * the build's configuration instead of hardcoding `/testnet/`. That hardcoding
 * was the bug: on any non-testnet build it opened a testnet page, and a testnet
 * page for a transaction that landed on mainnet reads as "this never happened".
 *
 * The network chip is deliberately *not* part of this function. Eight call sites
 * embed the link in a sentence ("transaction <link> included in ledger 42"), and
 * a chip inside the link would land mid-sentence; the chip belongs to the row or
 * block that shows the value, which is where it can be read without being read
 * aloud between words.
 */
export function starLink(hash: string): ReactNode {
  return (
    <a href={explorerTxUrl(hash)} target="_blank" rel="noreferrer">
      <span className="mono">{short(hash, 10, 6)}</span>
    </a>
  );
}

/**
 * A transaction hash as an explorer link plus a copy button (issue #33).
 *
 * The link is for looking the transaction up; the button is for taking the
 * exact hash somewhere else — support tickets, other explorers, runbook
 * records. Both, because each alone loses the other use.
 *
 * This is a whole *cell*, not a link inside a sentence, so unlike `starLink` it
 * carries the network chip itself: the telemetry feed and the tx history table
 * both render hashes with nothing else naming the network they came from.
 */
export function TxHashCell({ hash }: { hash: string }): ReactNode {
  return (
    <span className="copyable">
      {starLink(hash)}
      <CopyButton value={hash} label="transaction hash" />
      <NetworkChip />
    </span>
  );
}

export interface AmountDisplayProps extends FormatStroopsOptions {
  /** Amount in stroops (BigInt-safe). */
  stroops: bigint | number | string;
}

/**
 * Render a stroop amount human-readably, with a one-click toggle to the
 * exact raw stroops. A button (not a bare click target) so the toggle is
 * keyboard-operable and announced.
 */
export function AmountDisplay({ stroops, symbol, decimals }: AmountDisplayProps) {
  const [showRaw, setShowRaw] = useState(false);
  const human = formatStroopsWithUnit(stroops, {
    ...(symbol !== undefined ? { symbol } : {}),
    ...(decimals !== undefined ? { decimals } : {}),
  });
  const raw = formatRawStroops(stroops);
  return (
    <button
      type="button"
      className="mono"
      onClick={() => setShowRaw((v) => !v)}
      aria-label={
        showRaw ? `Raw amount: ${raw}` : `Amount: ${human}. Activate to show raw stroops.`
      }
      title={
        showRaw
          ? "Show human-readable amount"
          : "Show raw stroops — the smallest unit of an asset (docs/glossary.md — Stroop)"
      }
    >
      {showRaw ? raw : human}
    </button>
  );
}
