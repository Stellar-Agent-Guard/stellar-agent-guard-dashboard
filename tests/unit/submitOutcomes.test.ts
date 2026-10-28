import assert from "node:assert/strict";
import { beforeEach, before, test } from "node:test";
import { installDom } from "./domHarness.ts";
import {
  Account,
  Keypair,
  Operation,
  SorobanDataBuilder,
  Transaction,
  rpc,
  xdr,
} from "@stellar/stellar-sdk";
import { invokeWithWallet, type InvokeRequest } from "../../lib/guard/submit.ts";
import { submitOperation } from "../../lib/guard/guardOps.ts";
import { loadTxHistory, TX_HISTORY_STORAGE_KEY } from "../../lib/guard/txHistory.ts";
import { clearAnnouncements, pendingAnnouncements } from "../../lib/guard/useAnnounce.ts";

/**
 * Issue #355: a write whose confirmation never arrived must be classified as
 * *submission unknown* — distinct from "not submitted" (refused) and from
 * "included and rejected" (failed) — recorded as such, and never replayed.
 * These tests drive the real submit paths through a fake RPC boundary and pin
 * that separation, the history rows it produces, and the single-broadcast rule.
 */

installDom();

before(() => {
  installDom();
});

beforeEach(() => {
  localStorage.removeItem(TX_HISTORY_STORAGE_KEY);
  clearAnnouncements();
});

const GUARD_CONTRACT = "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD2KM";
const ADMIN = Keypair.random();

const signer = {
  address: ADMIN.publicKey(),
  // The seam is the wallet's, not the test's: hand the envelope back unsigned
  // (parsing does not require signatures) so no key material is involved.
  signTransaction: async (transactionXdr: string): Promise<string> => transactionXdr,
  signAuthEntry: async (entryXdr: string): Promise<string> => entryXdr,
};

/** A successful simulation response in the shape `assembleFromSimulation` reads. */
function successSimulation(): unknown {
  const data = new SorobanDataBuilder()
    .setReadWrite([])
    .setResourceFee(BigInt(500))
    .setResources(1_000_000, 0, 0)
    .build();
  return {
    id: "1",
    latestLedger: 100,
    events: [],
    transactionData: new SorobanDataBuilder(data),
    minResourceFee: "500",
    result: { auth: [], retval: xdr.ScVal.scvVoid() },
    cost: { cpuInsns: "0", memBytes: "0" },
    stateChanges: [],
  };
}

type SendMode = "pending" | "throw" | "error" | "try-again";
type LookupMode = "not-found" | "success" | "failed";

interface FakeRpc {
  server: rpc.Server;
  calls: { simulate: number; send: number; lookup: number; prepare: number };
  /** The hash the last send attempt carried (acknowledged or locally computed). */
  sentHash: () => string;
}

function fakeServer(options: {
  send?: SendMode;
  lookup?: LookupMode;
  simulateError?: boolean;
}): FakeRpc {
  const calls = { simulate: 0, send: 0, lookup: 0, prepare: 0 };
  let lastHash = "";
  const hashOf = (transaction: Transaction): string => {
    lastHash = Buffer.from(transaction.hash()).toString("hex");
    return lastHash;
  };
  const server = {
    async getAccount(address: string): Promise<Account> {
      return new Account(address, "41");
    },
    async simulateTransaction(): Promise<unknown> {
      calls.simulate += 1;
      if (options.simulateError) {
        return { id: "1", latestLedger: 1, events: [], error: "contract trapped: unauthorized" };
      }
      return successSimulation();
    },
    async prepareTransaction(transaction: Transaction): Promise<Transaction> {
      calls.prepare += 1;
      return transaction;
    },
    async sendTransaction(transaction: Transaction): Promise<unknown> {
      calls.send += 1;
      const hash = hashOf(transaction);
      if (options.send === "throw") throw new Error("network timeout waiting for the response");
      if (options.send === "error") {
        return {
          status: "ERROR",
          hash,
          latestLedger: 1,
          latestLedgerCloseTime: 0,
          errorResult: "txBadSeq",
        };
      }
      if (options.send === "try-again") {
        return { status: "TRY_AGAIN_LATER", hash, latestLedger: 1, latestLedgerCloseTime: 0 };
      }
      return { status: "PENDING", hash, latestLedger: 1, latestLedgerCloseTime: 0 };
    },
    async getTransaction(): Promise<unknown> {
      calls.lookup += 1;
      if (options.lookup === "success") return { status: "SUCCESS", ledger: 7, events: [] };
      if (options.lookup === "failed")
        return { status: "FAILED", ledger: 7, diagnosticEventsXdr: [] };
      return { status: "NOT_FOUND" };
    },
  };
  return { server: server as unknown as rpc.Server, calls, sentHash: () => lastHash };
}

function request(server: rpc.Server): InvokeRequest {
  return {
    server,
    contract: GUARD_CONTRACT,
    fn: "freeze",
    args: [],
    signer,
    // Tiny bounded poll: with attempts=1 the inclusion loop still asks the
    // network twice before giving up, which is the ambiguity under test.
    pollAttempts: 1,
    pollIntervalMs: 1,
  };
}

test("an inclusion-poll timeout is submission unknown, not failed — and is never replayed", async () => {
  const fake = fakeServer({ lookup: "not-found" });
  const result = await invokeWithWallet(request(fake.server));

  assert.equal(result.kind, "unknown");
  if (result.kind === "unknown") {
    assert.equal(
      result.hash,
      fake.sentHash(),
      "the unconfirmed outcome carries the hash to verify",
    );
    assert.match(result.detail, /verify this hash on chain/i);
    assert.match(result.detail, /may still be included/i);
  }
  assert.equal(fake.calls.send, 1, "a timeout must never trigger an automatic replay of the write");

  const rows = loadTxHistory();
  assert.equal(rows.length, 1, "the ambiguity is recorded so it stays visible");
  assert.equal(rows[0]?.status, "unknown");
  assert.equal(rows[0]?.hash, fake.sentHash());

  const announcement = pendingAnnouncements().find((entry) =>
    entry.message.includes("verify the hash on chain before retrying"),
  );
  assert.ok(announcement, "the verify-before-retry instruction is announced");
  assert.equal(announcement.priority, "assertive");
});

test("a send request that ends without a response is submission unknown with the local hash", async () => {
  const fake = fakeServer({ send: "throw" });
  const result = await invokeWithWallet(request(fake.server));

  assert.equal(result.kind, "unknown");
  if (result.kind === "unknown") {
    assert.equal(
      result.hash,
      fake.sentHash(),
      "the locally computed hash is what the operator verifies",
    );
    assert.match(result.detail, /may or may not have reached the network/i);
  }
  assert.equal(fake.calls.send, 1, "an unanswered send is not retried");
  assert.equal(loadTxHistory()[0]?.status, "unknown");
});

test("TRY_AGAIN_LATER is not submitted: refused, with no history row", async () => {
  const fake = fakeServer({ send: "try-again" });
  const result = await invokeWithWallet(request(fake.server));

  assert.equal(result.kind, "refused");
  if (result.kind === "refused") {
    assert.equal(result.stage, "submission");
    assert.match(result.detail, /nothing was queued for inclusion/i);
  }
  assert.equal(
    loadTxHistory().length,
    0,
    "a write that never entered the queue leaves no transaction",
  );
});

test("an ERROR response at submission is refused: nothing was broadcast, nothing recorded", async () => {
  const fake = fakeServer({ send: "error" });
  const result = await invokeWithWallet(request(fake.server));

  assert.equal(result.kind, "refused");
  if (result.kind === "refused") assert.equal(result.stage, "submission");
  assert.equal(fake.calls.lookup, 0, "a rejected submission is not polled for inclusion");
  assert.equal(loadTxHistory().length, 0);
});

test("a refused enforced simulation never reaches the network", async () => {
  const fake = fakeServer({ simulateError: true });
  const result = await invokeWithWallet(request(fake.server));

  assert.equal(result.kind, "refused");
  if (result.kind === "refused") assert.equal(result.stage, "discovery");
  assert.equal(fake.calls.send, 0, "not submitted means not broadcast");
  assert.equal(loadTxHistory().length, 0);
});

test("a confirmed inclusion still resolves to submitted with a confirmed row", async () => {
  const fake = fakeServer({ lookup: "success" });
  const result = await invokeWithWallet(request(fake.server));

  assert.equal(result.kind, "submitted");
  if (result.kind === "submitted") {
    assert.equal(result.hash, fake.sentHash());
    assert.equal(result.ledger, 7);
  }
  const rows = loadTxHistory();
  assert.equal(rows[0]?.status, "confirmed");
  assert.equal(rows[0]?.hash, fake.sentHash());
});

test("an inclusion the network rejected is failed — a verdict, not an ambiguity", async () => {
  const fake = fakeServer({ lookup: "failed" });
  const result = await invokeWithWallet(request(fake.server));

  assert.equal(result.kind, "failed");
  if (result.kind === "failed") {
    assert.match(result.detail, /included and rejected by the network/);
  }
  assert.equal(loadTxHistory()[0]?.status, "failed");
  assert.equal(fake.calls.send, 1);
});

test("a deploy-path inclusion timeout is also submission unknown (submitOperation)", async () => {
  const fake = fakeServer({ lookup: "not-found" });
  const result = await submitOperation({
    server: fake.server,
    signer,
    operation: Operation.uploadContractWasm({ wasm: new Uint8Array([1, 2, 3]) }),
    label: "upload_contract_wasm",
    pollAttempts: 1,
    pollIntervalMs: 1,
  });

  assert.equal(result.kind, "unknown");
  if (result.kind === "unknown") {
    assert.equal(result.hash, fake.sentHash());
    assert.match(result.detail, /verify this hash on chain/i);
  }
  assert.equal(fake.calls.send, 1, "the deploy flow does not re-upload on a timeout");
  const rows = loadTxHistory();
  assert.equal(rows[0]?.status, "unknown");
  assert.equal(rows[0]?.operation, "upload_contract_wasm");
});

test("a deploy-path send without a response is submission unknown, recorded once", async () => {
  const fake = fakeServer({ send: "throw" });
  const result = await submitOperation({
    server: fake.server,
    signer,
    operation: Operation.uploadContractWasm({ wasm: new Uint8Array([1, 2, 3]) }),
    label: "upload_contract_wasm",
    pollAttempts: 1,
    pollIntervalMs: 1,
  });

  assert.equal(result.kind, "unknown");
  if (result.kind === "unknown") assert.equal(result.hash, fake.sentHash());
  assert.equal(fake.calls.send, 1);
  const rows = loadTxHistory();
  assert.equal(rows.length, 1);
  assert.equal(rows[0]?.status, "unknown");
});
