"use client";

/**
 * The per-display network label (issue: cross-network address confusion).
 *
 * The console already has a *global* network indicator: `WalletBar` renders a
 * mismatch warning whenever the connected wallet disagrees with the network
 * this console reads. That indicator answers "may I sign?", which is a different
 * question from "which ledger is this value from?" — and it answers it in a
 * place the operator has usually scrolled past. The deploy result, the predicted
 * address and the on-chain status block are hundreds of lines below the wallet
 * bar, so at the moment the operator is reading a `C…` and deciding whether to
 * paste it into a tool, the only statement of which network it belongs to is off
 * screen. This chip is that statement, repeated at the display.
 *
 * So the chip is deliberately *local and additive*, not a replacement: the bar
 * keeps doing its job as the single place that reports a mismatch and offers the
 * one-click fix, while this names the network next to every address and hash an
 * operator can copy out of the page. Two answers to two questions is the
 * complementarity; either alone leaves a gap.
 *
 * The word shown is the network's own configured `name` (`testnet`) rather than a
 * prettified one, so it matches the compliance report's `Network:` line and the
 * network filter's option text verbatim. An operator matching a chip against a
 * runbook or an audit record should not have to bridge "Testnet" and "testnet".
 *
 * `network` is a parameter so the other branch is reachable from a test:
 * `tests/unit/networkChip.test.ts` renders this exact component with a fixed
 * Mainnet config and asserts the chip says `mainnet`, which is what proves the
 * label is read from configuration rather than being the word "testnet" painted
 * into the markup.
 */

import { NETWORK, type NetworkDescriptor } from "../lib/guard/network.ts";

/**
 * The label's accessible description: the network is named, and so is the risk
 * of reading it out of context.
 *
 * The visible word is one token, which on its own does not tell a screen-reader
 * user what the chip is *for*; the title is what makes "testnet" adjacent to a
 * contract id read as a statement about that contract.
 */
export function networkChipTitle(network: NetworkDescriptor): string {
  return `Network: ${network.name} — every address and hash on this console is on ${network.name}`;
}

export function NetworkChip({
  network = NETWORK,
  className,
}: {
  /** The network to name. Defaults to the network this console is configured for. */
  network?: NetworkDescriptor;
  className?: string;
}) {
  return (
    <span
      className={`network-chip${className ? ` ${className}` : ""}`}
      data-testid="network-chip"
      data-network={network.name}
      title={networkChipTitle(network)}
    >
      {network.name}
    </span>
  );
}
