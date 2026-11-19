/**
 * First-read verification before deployment (issue #522).
 *
 * A new operator benefits from confirming three things before the first
 * deploy: that the RPC endpoint serves the network this console is configured
 * for, that the connected wallet is on that network, and that the admin account
 * exists there. Each is answered by one read, and each outcome is independent —
 * a failed endpoint read does not hide the wallet's state, and a missing wallet
 * is "skipped", never "failed", so observer exploration is not blocked.
 *
 * No check here can request a signature: the inputs are a read-only RPC
 * surface and the wallet state the console already holds. Nothing is
 * persisted; a reload asks again.
 */

import { describeMismatch, type NetworkMismatch } from "./networkSwitch.ts";

export type FirstReadCheckId = "endpoint" | "wallet" | "account";
export type FirstReadState = "pass" | "fail" | "skipped";

export interface FirstReadOutcome {
  id: FirstReadCheckId;
  label: string;
  state: FirstReadState;
  detail: string;
}

export const FIRST_READ_CHECKS: ReadonlyArray<{ id: FirstReadCheckId; label: string }> = [
  { id: "endpoint", label: "RPC endpoint serves the selected network" },
  { id: "wallet", label: "Wallet is on the selected network" },
  { id: "account", label: "Admin account exists on the selected network" },
];

/** The only RPC calls the checks make. Both are reads. */
export interface FirstReadServer {
  getNetwork(): Promise<{ passphrase: string }>;
  getAccount(address: string): Promise<{ sequenceNumber(): string }>;
}

export interface FirstReadInputs {
  server: FirstReadServer;
  network: { name: string; passphrase: string };
  /** The wallet the console already holds; null in observer mode. Never prompted. */
  wallet: { address: string; networkPassphrase: string; network: string } | null;
  /** A connect attempt that was refused for being on another network. */
  networkMismatch: NetworkMismatch | null;
  demo?: boolean;
}

function labelOf(id: FirstReadCheckId): string {
  return FIRST_READ_CHECKS.find((check) => check.id === id)!.label;
}

function outcome(id: FirstReadCheckId, state: FirstReadState, detail: string): FirstReadOutcome {
  return { id, label: labelOf(id), state, detail };
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function checkEndpoint(inputs: FirstReadInputs): Promise<FirstReadOutcome> {
  try {
    const { passphrase } = await inputs.server.getNetwork();
    if (passphrase !== inputs.network.passphrase) {
      return outcome(
        "endpoint",
        "fail",
        `The endpoint serves "${passphrase}", but this console is configured for ${inputs.network.name} ("${inputs.network.passphrase}"). Fix NEXT_PUBLIC_RPC_URL or the network settings before deploying.`,
      );
    }
    return outcome(
      "endpoint",
      "pass",
      `The endpoint reports ${inputs.network.name} ("${passphrase}").`,
    );
  } catch (error) {
    return outcome("endpoint", "fail", `The endpoint could not be read: ${messageOf(error)}`);
  }
}

function checkWallet(inputs: FirstReadInputs): FirstReadOutcome {
  if (inputs.networkMismatch) {
    return outcome("wallet", "fail", describeMismatch(inputs.networkMismatch));
  }
  if (!inputs.wallet) {
    return outcome(
      "wallet",
      "skipped",
      "No wallet connected. Observing works without one; connect a wallet only to deploy.",
    );
  }
  if (inputs.wallet.networkPassphrase !== inputs.network.passphrase) {
    return outcome(
      "wallet",
      "fail",
      `The wallet is on ${inputs.wallet.network}, but this console is configured for ${inputs.network.name}.`,
    );
  }
  return outcome("wallet", "pass", `The connected wallet is on ${inputs.network.name}.`);
}

async function checkAccount(inputs: FirstReadInputs): Promise<FirstReadOutcome> {
  if (!inputs.wallet) {
    return outcome(
      "account",
      "skipped",
      "No wallet connected, so there is no admin account to read yet.",
    );
  }
  try {
    const account = await inputs.server.getAccount(inputs.wallet.address);
    return outcome(
      "account",
      "pass",
      `${inputs.wallet.address} exists on ${inputs.network.name} (sequence ${account.sequenceNumber()}).`,
    );
  } catch (error) {
    const message = messageOf(error);
    return outcome(
      "account",
      "fail",
      /not found|404/i.test(message)
        ? `${inputs.wallet.address} was not found on ${inputs.network.name}. Fund it on this network before deploying.`
        : `The account could not be read: ${message}`,
    );
  }
}

/**
 * Run the three read-only checks. Each settles on its own: a failure in one is
 * reported in that outcome and never prevents the others from answering.
 */
export async function runFirstReadChecks(inputs: FirstReadInputs): Promise<FirstReadOutcome[]> {
  if (inputs.demo) {
    return FIRST_READ_CHECKS.map((check) =>
      outcome(check.id, "skipped", "Demo mode shows static fixture data and makes no RPC calls."),
    );
  }
  return Promise.all([checkEndpoint(inputs), checkWallet(inputs), checkAccount(inputs)]);
}
