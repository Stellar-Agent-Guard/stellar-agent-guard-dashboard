import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";
import { SorobanDataBuilder, Transaction, rpc, xdr } from "@stellar/stellar-sdk";
import {
  invokeWithWallet,
  previewAuthorizationSummary,
  type InvokeRequest,
} from "../../lib/guard/submit.ts";
import { WalletCancellationError } from "../../lib/guard/retry.ts";
import { clearAnnouncements, pendingAnnouncements } from "../../lib/guard/useAnnounce.ts";

/**
 * The write path's outcomes, and the one rule issue #344 exists to hold: a read
 * may be repeated, a broadcast may not.
 *
 * Everything here runs against a server stand-in that counts what it is asked
 * for, because the counts *are* the acceptance criterion — "submit and broadcast
 * calls are never repeated solely because a response timed out" is a statement
 * about how many times `sendTransaction` ran, not about the text of a result.
 */

const GUARD = "CAYJZT4XH5SWDXNR7MZJCCUBIDAT2KZDDUTZ7OZQEMKCPJGD4P3X4CU7";
const ADMIN = "GAOBCRXTCO4ZCBNHALJUMJJ5JDXNOUZ7U6VZJX4UBTXAHQEO66IPU6PH";
const PASSPHRASE = "Test SDF Network ; September 2015";

/** A simulation that succeeds and asks for no separate address signatures. */
function successSimulation() {
  return {
    transactionData: new SorobanDataBuilder().setResourceFee(BigInt(500)).build(),
    minResourceFee: "100",
    latestLedger: 4242,
    result: { auth: [], retval: xdr.ScVal.scvVoid() },
  };
}

class FakeServer {
  simulateCalls = 0;
  sendCalls = 0;
  transactionCalls = 0;
  /** Thrown by the broadcast, as a dropped connection or an exhausted timeout would be. */
  sendFailure: Error | null = null;
  /** What the inclusion poll reports, in order; the last entry repeats. */
  transactionStatuses: string[] = ["SUCCESS"];
  sentHash = "aabbccdd".padEnd(64, "0");
  /** The hash of the envelope that actually reached the broadcast call. */
  broadcastHash: string | null = null;

  async getAccount(): Promise<{ sequenceNumber: () => string }> {
    return { sequenceNumber: () => "12345" };
  }

  async simulateTransaction(): Promise<unknown> {
    this.simulateCalls += 1;
    return successSimulation();
  }

  async sendTransaction(transaction: Transaction): Promise<unknown> {
    this.sendCalls += 1;
    this.broadcastHash = Buffer.from(transaction.hash()).toString("hex");
    if (this.sendFailure) throw this.sendFailure;
    return { status: "PENDING", hash: this.sentHash, latestLedger: 4243, latestLedgerHash: "x" };
  }

  async getTransaction(): Promise<unknown> {
    const index = Math.min(this.transactionCalls, this.transactionStatuses.length - 1);
    this.transactionCalls += 1;
    const status = this.transactionStatuses[index] ?? "NOT_FOUND";
    if (status === "SUCCESS") {
      return { status, ledger: 4243, closeTime: "1789481712", events: [] };
    }
    if (status === "FAILED") {
      return { status, ledger: 4243, diagnosticEventsXdr: [{ type: "diagnostic" }], events: [] };
    }
    return { status: "NOT_FOUND" };
  }
}

/** A signer that echoes the envelope back: the dashboard never holds a key. */
function echoingSigner() {
  return {
    address: ADMIN,
    async signTransaction(xdrValue: string): Promise<string> {
      return xdrValue;
    },
    async signAuthEntry(entryXdr: string): Promise<string> {
      return entryXdr;
    },
  };
}

function request(server: FakeServer, signer: InvokeRequest["signer"]): InvokeRequest {
  return {
    server: server as unknown as rpc.Server,
    contract: GUARD,
    fn: "set_policy",
    args: [],
    signer,
    passphrase: PASSPHRASE,
    guardForFootprint: null,
    // The confirmed authorization the write path now demands (issue #343). This
    // file is about what happens *after* that check passes, so it carries the
    // summary the pipeline would itself derive from this request — the same
    // reading of the same transaction, which is what lets these tests reach the
    // broadcast at all.
    authorization: previewAuthorizationSummary({
      contract: GUARD,
      fn: "set_policy",
      admin: ADMIN,
      passphrase: PASSPHRASE,
    }),
    // Fast, deterministic polling: the writes under test are not waiting on a real ledger.
    pollAttempts: 3,
    pollIntervalMs: 1,
  };
}

function walletDecline(): Error {
  const error = new Error("signTransaction failed in the wallet: User rejected the request");
  error.name = "WalletError";
  return error;
}

beforeEach(() => clearAnnouncements());

test("a broadcast that never answers is reported once, and is never re-sent", async () => {
  const server = new FakeServer();
  // The exact message the retry vocabulary calls transient — for a read, it is.
  server.sendFailure = new Error("RPC TIMEOUT");

  const result = await invokeWithWallet(request(server, echoingSigner()));

  assert.equal(server.sendCalls, 1, "the whole point: a timeout did not cause a second broadcast");
  assert.equal(result.kind, "ambiguous");
  if (result.kind !== "ambiguous") return;
  assert.match(result.detail, /not known whether the network took this transaction/);
  assert.match(result.detail, /RPC TIMEOUT/, "and it still says why");
  // Not a hash the network handed back — it never answered. The receipt names the
  // envelope that was actually broadcast, so the operator has something to look up.
  assert.equal(result.hash, server.broadcastHash);
  assert.match(result.hash, /^[0-9a-f]{64}$/, "a transaction hash, in the form explorers take");
});

test("an inclusion poll that runs out reports the unknown, after retrying only its reads", async () => {
  const server = new FakeServer();
  server.transactionStatuses = ["NOT_FOUND"];

  const result = await invokeWithWallet(request(server, echoingSigner()));

  assert.equal(server.sendCalls, 1, "one broadcast");
  assert.ok(server.transactionCalls > 1, "the lookups were reads, so they were retried");
  assert.equal(result.kind, "ambiguous");
  if (result.kind !== "ambiguous") return;
  assert.equal(result.hash, server.sentHash, "the hash the network was given is the hash to check");
  assert.match(result.detail, /timed out after 3 attempts/);
  assert.match(result.detail, /without the ledger reporting an outcome/);
});

test("a transaction the ledger says was included and rejected is still a failure, not a maybe", async () => {
  const server = new FakeServer();
  server.transactionStatuses = ["FAILED"];

  const result = await invokeWithWallet(request(server, echoingSigner()));

  assert.equal(result.kind, "failed");
  if (result.kind !== "failed") return;
  assert.match(result.detail, /included and rejected by the network/);
});

test("a confirmed write is announced and reported exactly once, however the reads went", async () => {
  const server = new FakeServer();
  server.transactionStatuses = ["NOT_FOUND", "NOT_FOUND", "SUCCESS"];

  const result = await invokeWithWallet(request(server, echoingSigner()));

  assert.equal(result.kind, "submitted");
  if (result.kind !== "submitted") return;
  assert.equal(result.ledger, 4243);
  assert.equal(server.sendCalls, 1, "the two missed lookups never re-broadcast anything");
  const spoken = pendingAnnouncements().map((entry) => entry.message);
  assert.ok(
    spoken.some((message) => /confirmed on ledger 4243/.test(message)),
    `the confirmed write is announced, got: ${spoken.join(" | ")}`,
  );
});

test("an unanswered broadcast is announced as unknown, never as a rejection", async () => {
  const server = new FakeServer();
  server.sendFailure = new Error("RPC TIMEOUT");

  await invokeWithWallet(request(server, echoingSigner()));

  const spoken = pendingAnnouncements().map((entry) => entry.message);
  assert.ok(
    spoken.some((message) => /outcome unknown/.test(message)),
    `the operator is told it is unknown, got: ${spoken.join(" | ")}`,
  );
  assert.ok(
    !spoken.some((message) => /failed on chain/.test(message)),
    "and is not told the network rejected something it never answered for",
  );
});

test("declining in the wallet is a cancellation, and nothing is broadcast after it", async () => {
  const server = new FakeServer();
  const signer = {
    address: ADMIN,
    async signTransaction(): Promise<string> {
      throw walletDecline();
    },
    async signAuthEntry(entryXdr: string): Promise<string> {
      return entryXdr;
    },
  };

  await assert.rejects(
    () => invokeWithWallet(request(server, signer)),
    (error: unknown) =>
      error instanceof WalletCancellationError &&
      error.message === "signTransaction failed in the wallet: User rejected the request",
    "the wallet's own words survive the retype",
  );
  assert.equal(server.sendCalls, 0, "a declined prompt never reaches the network");
});

test("an error that merely says rejected is not retyped as a cancellation", async () => {
  const server = new FakeServer();
  const signer = {
    address: ADMIN,
    async signTransaction(): Promise<string> {
      const error = new Error("the wallet could not sign: network rejected the payload");
      error.name = "WalletError";
      throw error;
    },
    async signAuthEntry(entryXdr: string): Promise<string> {
      return entryXdr;
    },
  };

  await assert.rejects(
    () => invokeWithWallet(request(server, signer)),
    (error: unknown) =>
      !(error instanceof WalletCancellationError) &&
      error instanceof Error &&
      error.message.includes("network rejected the payload"),
    "a signing fault stays the fault the wallet reported",
  );
});

test("a refusal at submission is definitive, and is not the ambiguous category", async () => {
  const server = new FakeServer();
  server.simulateTransaction = async () => ({
    error: "HostError: Error(Contract, #4)",
    events: [],
  });

  const result = await invokeWithWallet(request(server, echoingSigner()));

  assert.equal(result.kind, "refused");
  if (result.kind !== "refused") return;
  assert.equal(result.stage, "discovery");
  assert.equal(server.sendCalls, 0, "a refused call never broadcasts");
});
