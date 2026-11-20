/**
 * Transaction progress as a concise status region (issue #539).
 *
 * The first half pins the vocabulary and the state machine in isolation: each
 * stage is reported once and only forwards, every line names the operation,
 * the run always ends with an outcome, and a superseded run goes quiet. The
 * second half drives the real `invokeWithWallet` pipeline against a fake RPC
 * and asserts what the region actually said — including that nothing from the
 * envelope, its hash or the contract address ever reached it.
 */
import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import {
  Account,
  Address,
  Keypair,
  SorobanDataBuilder,
  Transaction,
  TransactionBuilder,
  rpc,
  xdr,
} from "@stellar/stellar-sdk";
import {
  GENERIC_OPERATION,
  IDLE_TX_PROGRESS,
  beginTxProgress,
  operationLabel,
  outcomeMessage,
  outcomeOf,
  resetTxProgress,
  subscribeTxProgress,
  txProgressSnapshot,
  type TxOutcome,
} from "../../lib/guard/txProgress.ts";
import { invokeWithWallet, type InvokeResult, type WalletSigner } from "../../lib/guard/submit.ts";
import { WalletUserRejectedError } from "../../lib/guard/walletConnector.ts";
import { clearAnnouncements, pendingAnnouncements } from "../../lib/guard/useAnnounce.ts";

const GUARD_CONTRACT = "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD2KM";
const PASSPHRASE = "Test SDF Network ; September 2015";
const HASH = "ab".repeat(32);

/** Every non-empty line the region showed, in order. */
function recordMessages(): { lines: string[]; stop: () => void } {
  const lines: string[] = [];
  const stop = subscribeTxProgress(() => {
    const { message } = txProgressSnapshot();
    if (message) lines.push(message);
  });
  return { lines, stop };
}

beforeEach(() => {
  resetTxProgress();
  clearAnnouncements();
});

describe("operation labels", () => {
  it("speaks the guard's entry points in the operator's words", () => {
    assert.equal(operationLabel("set_policy"), "Policy install");
    assert.equal(operationLabel("revoke_policy"), "Policy revoke");
    assert.equal(operationLabel("freeze"), "Freeze");
    assert.equal(operationLabel("unfreeze"), "Unfreeze");
  });

  it("reads an unknown but well-formed function name as words", () => {
    assert.equal(operationLabel("set_daily_cap"), "Set daily cap");
  });

  it("never speaks anything that is not a plain Soroban symbol", () => {
    const envelope = "AAAAAgAAAAB" + "A".repeat(120) + "==";
    for (const suspicious of [
      envelope,
      "a".repeat(33),
      "freeze; drop",
      "set policy",
      "",
      null,
      undefined,
      "9starts_with_digit",
    ]) {
      assert.equal(operationLabel(suspicious), GENERIC_OPERATION, String(suspicious));
    }
  });
});

describe("the progress state machine", () => {
  it("starts idle and silent", () => {
    assert.deepEqual(txProgressSnapshot(), IDLE_TX_PROGRESS);
    assert.equal(txProgressSnapshot().message, "");
  });

  it("reports each stage once, in order, naming the operation", () => {
    const { lines, stop } = recordMessages();
    const run = beginTxProgress("set_policy");
    assert.equal(run.stage("simulating"), true);
    assert.equal(run.stage("simulating"), false, "a repeat is not news");
    assert.equal(run.stage("signing"), true);
    assert.equal(run.stage("signing"), false, "a second wallet prompt is not a second stage");
    assert.equal(run.stage("simulating"), false, "stages never move backwards");
    assert.equal(run.stage("submitting"), true);
    stop();
    assert.deepEqual(lines, [
      "Policy install: simulating",
      "Policy install: waiting for wallet approval",
      "Policy install: submitted, waiting for confirmation",
    ]);
  });

  it("ends with exactly one outcome and ignores anything after it", () => {
    const run = beginTxProgress("freeze");
    run.stage("simulating");
    assert.equal(run.finish({ kind: "confirmed", ledger: 201 }), true);
    assert.equal(txProgressSnapshot().message, "Freeze confirmed on ledger 201");
    assert.equal(txProgressSnapshot().tone, "success");
    assert.equal(run.finish({ kind: "failed" }), false, "only the first outcome counts");
    assert.equal(run.stage("submitting"), false, "a finished run reports no more stages");
    assert.equal(txProgressSnapshot().message, "Freeze confirmed on ledger 201");
  });

  it("lets a newer write replace an older one, and silences the older handle", () => {
    const older = beginTxProgress("freeze");
    older.stage("signing");
    const newer = beginTxProgress("unfreeze");
    newer.stage("simulating");
    assert.equal(older.finish({ kind: "confirmed", ledger: 5 }), false);
    assert.equal(older.stage("submitting"), false);
    assert.equal(txProgressSnapshot().message, "Unfreeze: simulating");
    assert.equal(txProgressSnapshot().run, newer.id);
  });

  it("words every outcome with the operation, and flags the ones that need attention", () => {
    const cases: [TxOutcome, string, "success" | "failure"][] = [
      [{ kind: "confirmed", ledger: 7 }, "Freeze confirmed on ledger 7", "success"],
      [{ kind: "confirmed", ledger: null }, "Freeze confirmed on the network", "success"],
      [{ kind: "failed" }, "Freeze failed on chain", "failure"],
      [
        { kind: "refused", stage: "enforcement" },
        "Freeze refused during the guard's enforcement check — nothing was broadcast",
        "failure",
      ],
      [
        { kind: "refused", stage: "something-new" },
        "Freeze refused during pre-flight checks — nothing was broadcast",
        "failure",
      ],
      [{ kind: "cancelled" }, "Freeze declined in the wallet — nothing was broadcast", "failure"],
      [
        { kind: "exported" },
        "Freeze exported for offline signing — nothing was broadcast",
        "success",
      ],
      [
        { kind: "interrupted", phase: "envelope" },
        "Freeze interrupted during transaction signing — nothing was broadcast; review and retry",
        "failure",
      ],
      [
        { kind: "interrupted", phase: "submission" },
        "Freeze interrupted during submission — verify on chain before retrying",
        "failure",
      ],
      [{ kind: "errored" }, "Freeze did not complete — see the panel for details", "failure"],
    ];
    for (const [outcome, message, tone] of cases) {
      assert.deepEqual(outcomeMessage("Freeze", outcome), { message, tone });
    }
  });

  it("reduces a result to its outcome without reading envelope, detail or hash", () => {
    const secretish = "AAAAAgAAAAB-ENVELOPE-XDR";
    const results: InvokeResult[] = [
      { kind: "exported", xdr: secretish, detail: secretish },
      { kind: "failed", hash: HASH, detail: secretish, diagnosticEvents: [] },
      { kind: "refused", stage: "submission", detail: secretish, diagnosticEvents: [] },
      { kind: "cancelled", detail: secretish },
      { kind: "submitted", hash: HASH, status: "SUCCESS", ledger: 9, events: secretish },
      { kind: "submitted", hash: HASH, status: "DUPLICATE", ledger: 9, events: null },
    ];
    for (const result of results) {
      const spoken = outcomeMessage("Freeze", outcomeOf(result)).message;
      assert.equal(spoken.includes(secretish), false, spoken);
      assert.equal(spoken.includes(HASH), false, spoken);
    }
    assert.deepEqual(outcomeOf(results[5]!), { kind: "confirmed", ledger: null });
  });
});

// ── The real pipeline ───────────────────────────────────────────────────────

function makeServer(
  options: {
    auth?: xdr.SorobanAuthorizationEntry[];
    sendCalls?: string[];
    included?: boolean;
  } = {},
): rpc.Server {
  const simulation = () => ({
    transactionData: new SorobanDataBuilder(
      new SorobanDataBuilder()
        .setReadWrite([])
        .setResourceFee(BigInt(500))
        .setResources(1_000_000, 0, 0)
        .build(),
    ),
    minResourceFee: "500",
    result: { auth: options.auth ?? [], retval: xdr.ScVal.scvVoid() },
    events: [],
    latestLedger: 200,
    cost: { cpuInsns: "0", memBytes: "0" },
    stateChanges: [],
  });
  return {
    getAccount: async (address: string) => new Account(address, "1"),
    simulateTransaction: async () => simulation(),
    sendTransaction: async () => {
      options.sendCalls?.push("sent");
      return { status: "PENDING", hash: HASH, latestLedger: 200 };
    },
    getTransaction: async () =>
      options.included === false
        ? {
            status: rpc.Api.GetTransactionStatus.FAILED,
            ledger: 201,
            hash: HASH,
            resultXdr: undefined,
          }
        : { status: rpc.Api.GetTransactionStatus.SUCCESS, ledger: 201, hash: HASH },
  } as unknown as rpc.Server;
}

function makeSigner(
  options: {
    keypair?: ReturnType<typeof Keypair.random>;
    declineEnvelope?: boolean;
    seenEnvelopes?: string[];
    prompts?: string[];
  } = {},
): WalletSigner {
  const keypair = options.keypair ?? Keypair.random();
  return {
    address: keypair.publicKey(),
    currentAddress: async () => keypair.publicKey(),
    async signTransaction(transactionXdr: string): Promise<string> {
      options.prompts?.push("envelope");
      options.seenEnvelopes?.push(transactionXdr);
      if (options.declineEnvelope) {
        throw new WalletUserRejectedError("freighter", "sign this transaction");
      }
      const transaction = TransactionBuilder.fromXDR(transactionXdr, PASSPHRASE) as Transaction;
      transaction.sign(keypair);
      const signed = transaction.toXDR();
      options.seenEnvelopes?.push(signed);
      return signed;
    },
    async signAuthEntry(entryXdr: string): Promise<string> {
      options.prompts?.push("auth-entry");
      options.seenEnvelopes?.push(entryXdr);
      return entryXdr;
    },
  };
}

function addressAuthEntry(signerAddress: string): xdr.SorobanAuthorizationEntry {
  return new xdr.SorobanAuthorizationEntry({
    credentials: xdr.SorobanCredentials.sorobanCredentialsAddress(
      new xdr.SorobanAddressCredentials({
        address: Address.fromString(signerAddress).toScAddress(),
        nonce: BigInt(0),
        signatureExpirationLedger: 100,
        signature: xdr.ScVal.scvVoid(),
      }),
    ),
    rootInvocation: new xdr.SorobanAuthorizedInvocation({
      function: xdr.SorobanAuthorizedFunction.sorobanAuthorizedFunctionTypeContractFn(
        new xdr.InvokeContractArgs({
          contractAddress: Address.fromString(GUARD_CONTRACT).toScAddress(),
          functionName: "set_policy",
          args: [],
        }),
      ),
      subInvocations: [],
    }),
  });
}

const REQUEST = {
  contract: GUARD_CONTRACT,
  fn: "set_policy",
  args: [xdr.ScVal.scvSymbol("secret_looking_argument")] as xdr.ScVal[],
  passphrase: PASSPHRASE,
  pollAttempts: 1,
  pollIntervalMs: 1,
};

/** Nothing the wallet saw, nor the hash, address or args, may reach the region. */
function assertNoEnvelopeContents(lines: string[], seenEnvelopes: string[]): void {
  for (const line of lines) {
    for (const blob of seenEnvelopes) {
      assert.equal(line.includes(blob), false, `the region spoke an envelope: ${line}`);
    }
    assert.equal(line.includes(HASH), false, `the region spoke the hash: ${line}`);
    assert.equal(line.includes(GUARD_CONTRACT), false, `the region spoke the address: ${line}`);
    assert.equal(line.includes("secret_looking_argument"), false, `args leaked: ${line}`);
    assert.doesNotMatch(line, /[A-Za-z0-9+/=]{40,}/, `a base64-looking blob leaked: ${line}`);
  }
}

describe("invokeWithWallet reports through the status region", () => {
  it("speaks each stage once and ends with the confirmed outcome, even with two wallet prompts", async () => {
    const keypair = Keypair.random();
    const seenEnvelopes: string[] = [];
    const prompts: string[] = [];
    const { lines, stop } = recordMessages();
    const result = await invokeWithWallet({
      ...REQUEST,
      server: makeServer({ auth: [addressAuthEntry(keypair.publicKey())] }),
      signer: makeSigner({ keypair, seenEnvelopes, prompts }),
    });
    stop();

    assert.equal(result.kind, "submitted");
    assert.deepEqual(prompts, ["auth-entry", "envelope"], "the wallet really prompted twice");
    assert.deepEqual(lines, [
      "Policy install: simulating",
      "Policy install: waiting for wallet approval",
      "Policy install: submitted, waiting for confirmation",
      "Policy install confirmed on ledger 201",
    ]);
    assert.equal(new Set(lines).size, lines.length, "no line is spoken twice");
    assertNoEnvelopeContents(lines, seenEnvelopes);
  });

  it("no longer duplicates the milestones into the general announcer queue", async () => {
    await invokeWithWallet({ ...REQUEST, server: makeServer(), signer: makeSigner() });
    const transactionChatter = pendingAnnouncements().filter((entry) =>
      /simulation|approve|submitted|confirmed/i.test(entry.message),
    );
    assert.deepEqual(transactionChatter, [], "progress has exactly one channel");
  });

  it("ends a declined signature as declined, without a broadcast", async () => {
    const sendCalls: string[] = [];
    const { lines, stop } = recordMessages();
    const result = await invokeWithWallet({
      ...REQUEST,
      cancelOnDecline: true,
      server: makeServer({ sendCalls }),
      signer: makeSigner({ declineEnvelope: true }),
    });
    stop();
    assert.equal(result.kind, "cancelled");
    assert.deepEqual(sendCalls, []);
    assert.equal(lines.at(-1), "Policy install declined in the wallet — nothing was broadcast");
    assert.equal(txProgressSnapshot().tone, "failure");
  });

  it("still ends the run when a decline is thrown back to the caller", async () => {
    await assert.rejects(
      invokeWithWallet({
        ...REQUEST,
        server: makeServer(),
        signer: makeSigner({ declineEnvelope: true }),
      }),
      /declined/i,
    );
    assert.equal(
      txProgressSnapshot().message,
      "Policy install declined in the wallet — nothing was broadcast",
      "the region never sits on 'waiting for wallet approval'",
    );
  });

  it("ends a thrown, non-decline error as incomplete rather than hanging", async () => {
    const signer = makeSigner();
    signer.signTransaction = async () => {
      throw new Error("provider crashed with AAAAAgAAAAB" + "Q".repeat(60));
    };
    await assert.rejects(
      invokeWithWallet({ ...REQUEST, server: makeServer(), signer }),
      /provider crashed/,
    );
    const { message, tone } = txProgressSnapshot();
    assert.equal(message, "Policy install did not complete — see the panel for details");
    assert.equal(tone, "failure");
  });

  it("reports a refused simulation as refused, naming the operation and not the error payload", async () => {
    const server = {
      getAccount: async (address: string) => new Account(address, "1"),
      simulateTransaction: async () => ({
        id: "1",
        latestLedger: 200,
        events: [],
        _parsed: true,
        error: "host invocation failed: Error(Contract, InvalidAction) AAAAAgAAAAB",
      }),
      sendTransaction: async () => assert.fail("never broadcast"),
    } as unknown as rpc.Server;
    const { lines, stop } = recordMessages();
    await invokeWithWallet({ ...REQUEST, fn: "freeze", server, signer: makeSigner() });
    stop();
    assert.deepEqual(lines, [
      "Freeze: simulating",
      "Freeze refused during simulation — nothing was broadcast",
    ]);
  });

  it("reports an on-chain failure as failed", async () => {
    const { lines, stop } = recordMessages();
    const result = await invokeWithWallet({
      ...REQUEST,
      fn: "unfreeze",
      server: makeServer({ included: false }),
      signer: makeSigner(),
    });
    stop();
    assert.equal(result.kind, "failed");
    assert.equal(lines.at(-1), "Unfreeze failed on chain");
  });

  it("reports a wallet that disconnects mid-write once, as the outcome", async () => {
    const keypair = Keypair.random();
    const signer = makeSigner({ keypair });
    signer.currentAddress = async () => null;
    const { lines, stop } = recordMessages();
    const result = await invokeWithWallet({ ...REQUEST, server: makeServer(), signer });
    stop();
    assert.equal(result.kind, "refused");
    assert.equal(
      lines.at(-1),
      "Policy install interrupted during transaction signing — nothing was broadcast; review and retry",
    );
    assert.deepEqual(
      pendingAnnouncements().filter((entry) => /interrupted/i.test(entry.message)),
      [],
      "the interruption is not announced a second time through the general queue",
    );
  });

  it("reports an export as exported, without speaking the exported XDR", async () => {
    const { lines, stop } = recordMessages();
    const result = await invokeWithWallet({
      ...REQUEST,
      exportOnly: true,
      server: makeServer(),
      signer: makeSigner(),
    });
    stop();
    assert.equal(result.kind, "exported");
    assert.deepEqual(lines, [
      "Policy install: simulating",
      "Policy install exported for offline signing — nothing was broadcast",
    ]);
    if (result.kind === "exported") assertNoEnvelopeContents(lines, [result.xdr]);
  });
});
