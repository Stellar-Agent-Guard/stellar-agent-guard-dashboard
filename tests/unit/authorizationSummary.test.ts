import assert from "node:assert/strict";
import { beforeEach, describe, test } from "node:test";
import {
  Account,
  Operation,
  SorobanDataBuilder,
  TransactionBuilder,
  rpc,
  xdr,
} from "@stellar/stellar-sdk";
import {
  AUTHORIZATION_FIELDS,
  authorizationId,
  changedAuthorizationFields,
  checkPresignAuthorization,
  contextFromTransaction,
  missingAuthorizationFields,
  summarizeAuthorizationContext,
  type AuthorizationContext,
} from "../../lib/guard/authorizationSummary.ts";
import {
  buildInitialEnvelope,
  invokeWithWallet,
  previewAuthorizationSummary,
  type InvokeRequest,
  type WalletSigner,
} from "../../lib/guard/submit.ts";
import { freezeGuard } from "../../lib/guard/guardOps.ts";
import { clearAnnouncements, pendingAnnouncements } from "../../lib/guard/useAnnounce.ts";

/**
 * The pre-signature authorization summary (issue #343).
 *
 * Two claims are tested, and the second is the one that matters: the summary is
 * read out of the transaction rather than recited from the caller's arguments, and
 * a write whose summary is missing or no longer true reaches neither the RPC nor
 * the wallet. The second is proven by counting — a signer that throws the moment
 * it is asked for anything, and a server that counts simulations — because "no
 * signing prompt was invoked" is a statement about calls that did not happen, not
 * about the text of a refusal.
 */

const GUARD = "CAYJZT4XH5SWDXNR7MZJCCUBIDAT2KZDDUTZ7OZQEMKCPJGD4P3X4CU7";
const OTHER_GUARD = "CBQLJAG72M4XQRJMQHSKYIFVHQD7LNTNOQH2GRMCMBWMSLBSLTGTJC7";
const ADMIN = "GAOBCRXTCO4ZCBNHALJUMJJ5JDXNOUZ7U6VZJX4UBTXAHQEO66IPU6PH";
const OTHER_ADMIN = "GD5S5O2MZ6FSMFH6QILG37KSQNRVR3RPSWBTTV4JOUJ7J6TWLLL5LAVS";
const PASSPHRASE = "Test SDF Network ; September 2015";
const PUBLIC_PASSPHRASE = "Public Network ; April 2015";

function freezeTransaction(admin = ADMIN, guard = GUARD, passphrase = PASSPHRASE) {
  return buildInitialEnvelope({
    source: new Account(admin, "12345"),
    operation: Operation.invokeContractFunction({ contract: guard, function: "freeze", args: [] }),
    passphrase,
    guard: null,
  });
}

const FREEZE = {
  operation: "freeze",
  guard: GUARD,
  networkPassphrase: PASSPHRASE,
  admin: ADMIN,
} satisfies AuthorizationContext;

// ── The derivation ─────────────────────────────────────────────────────────

describe("contextFromTransaction", () => {
  test("reads the four facts out of the encoded transaction", () => {
    const context = contextFromTransaction(freezeTransaction(), PASSPHRASE);
    assert.deepEqual(context, FREEZE);
  });

  test("reports the admin the envelope actually carries, not the one the caller named", () => {
    // The point of deriving: a caller that says one account while building another
    // is contradicted by the transaction, and the contradiction is what refuses.
    const context = contextFromTransaction(freezeTransaction(OTHER_ADMIN), PASSPHRASE);
    assert.equal(context?.admin, OTHER_ADMIN);
  });

  test("has no answer for an operation that is not a contract call", () => {
    const transaction = new TransactionBuilder(new Account(ADMIN, "1"), {
      fee: "100",
      networkPassphrase: PASSPHRASE,
    })
      .addOperation(Operation.extendFootprintTtl({ extendTo: 10 }))
      .setTimeout(60)
      .build();
    assert.equal(contextFromTransaction(transaction, PASSPHRASE), null);
  });

  test("has no answer for a host function that is not a contract call", () => {
    // Uploading wasm is an invokeHostFunction too, but it names no contract and no
    // function, so there would be no honest operation or guard line to print.
    const transaction = new TransactionBuilder(new Account(ADMIN, "1"), {
      fee: "100",
      networkPassphrase: PASSPHRASE,
    })
      .addOperation(
        Operation.invokeHostFunction({
          func: xdr.HostFunction.hostFunctionTypeUploadContractWasm(new Uint8Array([1, 2, 3, 4])),
          auth: [],
        }),
      )
      .setTimeout(60)
      .build();
    assert.equal(contextFromTransaction(transaction, PASSPHRASE), null);
  });

  test("has no answer for an envelope that does not describe exactly one call", () => {
    const transaction = new TransactionBuilder(new Account(ADMIN, "1"), {
      fee: "100",
      networkPassphrase: PASSPHRASE,
    })
      .addOperation(
        Operation.invokeContractFunction({ contract: GUARD, function: "freeze", args: [] }),
      )
      .addOperation(
        Operation.invokeContractFunction({ contract: GUARD, function: "unfreeze", args: [] }),
      )
      .setTimeout(60)
      .build();
    assert.equal(contextFromTransaction(transaction, PASSPHRASE), null);
  });

  test("the preview a panel prints is the reading of the probe the pipeline builds", () => {
    // The panel has no sequence number and never gets one: what makes its copy
    // trustworthy is that the four facts do not depend on it. Args do not either,
    // which is why the preview carries none and still matches a real call.
    const probe = buildInitialEnvelope({
      source: new Account(ADMIN, "987"),
      operation: Operation.invokeContractFunction({
        contract: GUARD,
        function: "set_policy",
        args: [xdr.ScVal.scvU32(1)],
      }),
      passphrase: PASSPHRASE,
      guard: GUARD,
    });
    assert.deepEqual(
      previewAuthorizationSummary({ contract: GUARD, fn: "set_policy", admin: ADMIN }),
      contextFromTransaction(probe, PASSPHRASE),
    );
  });

  test("an account the console cannot name yields no summary rather than a crash", () => {
    // No wallet connected is the ordinary case for this, and the answer has to be
    // "there is nothing to show" so the panel can refuse to offer a prompt.
    assert.equal(previewAuthorizationSummary({ contract: GUARD, fn: "freeze", admin: "" }), null);
    assert.equal(
      previewAuthorizationSummary({ contract: "not-an-address", fn: "freeze", admin: ADMIN }),
      null,
    );
  });
});

// ── The comparison ─────────────────────────────────────────────────────────

describe("checkPresignAuthorization", () => {
  test("a summary that matches the transaction passes, and is reported from the transaction", () => {
    const check = checkPresignAuthorization({ derived: FREEZE, confirmed: FREEZE });
    assert.equal(check.ok, true);
    if (!check.ok) return;
    assert.equal(check.summary.id, authorizationId(FREEZE));
    assert.deepEqual(
      check.summary.lines.map((line) => line.field),
      AUTHORIZATION_FIELDS.map((row) => row.field),
    );
  });

  test("no confirmed context is a missing authorization, naming all four facts", () => {
    for (const confirmed of [null, undefined]) {
      const check = checkPresignAuthorization({ derived: FREEZE, confirmed });
      assert.equal(check.ok, false);
      if (check.ok) continue;
      assert.equal(check.reason, "missing");
      assert.deepEqual(
        check.missing,
        AUTHORIZATION_FIELDS.map((row) => row.field),
      );
      assert.match(check.detail, /authorization was never confirmed/);
      assert.match(check.detail, /no signature was requested/);
    }
  });

  test("one blank field is enough to make the authorization missing", () => {
    // The common real case: the guard and the operation are known, the wallet is
    // not, and a summary with a blank admin is not a description of a signer.
    const check = checkPresignAuthorization({
      derived: FREEZE,
      confirmed: { ...FREEZE, admin: "  " },
    });
    assert.equal(check.ok, false);
    if (check.ok) return;
    assert.equal(check.reason, "missing");
    assert.deepEqual(check.missing, ["admin"]);
    assert.match(check.detail, /admin account that signs is not filled in/);
  });

  test("a transaction that yields no summary cannot be authorized at all", () => {
    const check = checkPresignAuthorization({ derived: null, confirmed: FREEZE });
    assert.equal(check.ok, false);
    if (check.ok) return;
    assert.equal(check.reason, "missing");
    assert.match(check.detail, /could not read a single contract call/);
  });

  test("a guard that moved under the summary is stale, and the sentence says which", () => {
    const check = checkPresignAuthorization({
      derived: FREEZE,
      confirmed: { ...FREEZE, guard: OTHER_GUARD },
    });
    assert.equal(check.ok, false);
    if (check.ok) return;
    assert.equal(check.reason, "stale");
    assert.deepEqual(check.changed, ["guard"]);
    assert.match(check.detail, /no longer matches the transaction about to be signed/);
    // Addresses are quoted short so the difference is readable, but both sides of
    // it are there — "something changed" is not an actionable sentence.
    assert.match(check.detail, /confirmed "CBQLJ…TJC7", the transaction says "CAYJZ…4CU7"/);
    assert.ok(!check.detail.includes(`${OTHER_GUARD}${""}`.repeat(0) + PASSPHRASE));
  });

  test("a different account, operation or network is stale in its own field", () => {
    const cases: { override: Partial<AuthorizationContext>; field: string }[] = [
      { override: { admin: OTHER_ADMIN }, field: "admin" },
      { override: { operation: "unfreeze" }, field: "operation" },
      { override: { networkPassphrase: PUBLIC_PASSPHRASE }, field: "networkPassphrase" },
    ];
    for (const { override, field } of cases) {
      const check = checkPresignAuthorization({
        derived: FREEZE,
        confirmed: { ...FREEZE, ...override },
      });
      assert.equal(check.ok, false, `${field} differs, so the write must be refused`);
      if (check.ok) continue;
      assert.equal(check.reason, "stale");
      assert.deepEqual(check.changed, [field]);
    }
  });

  test("every field that moved is listed, in display order", () => {
    const changed = changedAuthorizationFields(
      { ...FREEZE, guard: OTHER_GUARD, admin: OTHER_ADMIN, operation: "unfreeze" },
      FREEZE,
    );
    assert.deepEqual(changed, ["operation", "guard", "admin"]);
  });

  test("trailing space on a confirmed value is not a difference", () => {
    const check = checkPresignAuthorization({
      derived: FREEZE,
      confirmed: { ...FREEZE, guard: ` ${GUARD} ` },
    });
    assert.equal(check.ok, true);
  });
});

describe("authorizationId", () => {
  test("is the same for the same authorization and different for any change", () => {
    assert.equal(authorizationId(FREEZE), authorizationId({ ...FREEZE }));
    assert.notEqual(authorizationId(FREEZE), authorizationId({ ...FREEZE, operation: "unfreeze" }));
  });

  test("is readable rather than a digest", () => {
    // A digest here would have to be awaited (`sha256Hex` is async Web Crypto),
    // and an authorization gate with an in-flight window is the thing this issue
    // exists to prevent.
    const id = authorizationId(FREEZE);
    assert.ok(id.includes("freeze"));
    assert.ok(id.includes(GUARD));
    assert.equal(id, summarizeAuthorizationContext(FREEZE).id);
  });

  test("reports the fields a partial context is missing", () => {
    assert.deepEqual(missingAuthorizationFields(null), [
      "operation",
      "guard",
      "networkPassphrase",
      "admin",
    ]);
    assert.deepEqual(missingAuthorizationFields({ ...FREEZE, networkPassphrase: "" }), [
      "networkPassphrase",
    ]);
    assert.deepEqual(missingAuthorizationFields(FREEZE), []);
  });
});

// ── The pipeline: nothing is signed, and nothing is even simulated ────────

/** A simulation that succeeds and asks for no separate address signatures. */
function successSimulation() {
  return {
    transactionData: new SorobanDataBuilder().setResourceFee(BigInt(500)).build(),
    minResourceFee: "100",
    latestLedger: 4242,
    result: { auth: [], retval: xdr.ScVal.scvVoid() },
  };
}

class RecordingServer {
  simulateCalls = 0;
  sendCalls = 0;
  getAccountCalls = 0;

  async getAccount(): Promise<{ sequenceNumber: () => string }> {
    this.getAccountCalls += 1;
    return { sequenceNumber: () => "12345" };
  }

  async simulateTransaction(): Promise<unknown> {
    this.simulateCalls += 1;
    return successSimulation();
  }

  async sendTransaction(): Promise<unknown> {
    this.sendCalls += 1;
    return {
      status: "PENDING",
      hash: "aabbccdd".padEnd(64, "0"),
      latestLedger: 4243,
      latestLedgerHash: "x",
    };
  }

  async getTransaction(): Promise<unknown> {
    return { status: "SUCCESS", ledger: 4243, closeTime: "1789481712", events: [] };
  }
}

/**
 * A signer that fails the test the instant it is asked for anything.
 *
 * The counters say the same thing, and both are kept: a refusal that merely
 * *happened* to skip the prompt would pass a counter assertion, while a prompt
 * that arrives anyway throws with a message that says which rule broke.
 */
function neverPromptedSigner(calls: { signTransaction: number; signAuthEntry: number }) {
  return {
    address: ADMIN,
    async signTransaction(): Promise<string> {
      calls.signTransaction += 1;
      throw new Error("the wallet was prompted before the authorization was confirmed");
    },
    async signAuthEntry(): Promise<string> {
      calls.signAuthEntry += 1;
      throw new Error("the wallet was prompted to sign an auth entry before confirmation");
    },
  } satisfies WalletSigner;
}

function request(
  server: RecordingServer,
  signer: WalletSigner,
  authorization: AuthorizationContext | null,
): InvokeRequest {
  return {
    server: server as unknown as rpc.Server,
    contract: GUARD,
    fn: "freeze",
    args: [],
    signer,
    passphrase: PASSPHRASE,
    guardForFootprint: null,
    authorization,
    pollAttempts: 2,
    pollIntervalMs: 1,
  };
}

beforeEach(() => clearAnnouncements());

describe("the write path refuses before it prompts", () => {
  test("a missing authorization stops the write before the first simulation", async () => {
    const calls = { signTransaction: 0, signAuthEntry: 0 };
    const server = new RecordingServer();

    const result = await invokeWithWallet(request(server, neverPromptedSigner(calls), null));

    assert.equal(result.kind, "refused");
    if (result.kind !== "refused") return;
    assert.equal(result.stage, "discovery");
    assert.match(result.detail, /authorization was never confirmed/);
    assert.deepEqual(result.diagnosticEvents, []);
    assert.deepEqual(calls, { signTransaction: 0, signAuthEntry: 0 });
    assert.equal(server.simulateCalls, 0, "a refusal costs no simulation either");
    assert.equal(server.sendCalls, 0);
    assert.ok(
      !pendingAnnouncements().some((item) => /approve/i.test(item.message)),
      "the operator is never told to approve a transaction the console refused",
    );
  });

  test("a stale authorization is refused with the same zero prompts", async () => {
    const calls = { signTransaction: 0, signAuthEntry: 0 };
    const server = new RecordingServer();
    // The summary was true when it was shown, and the guard changed afterwards.
    const confirmed = { ...FREEZE, guard: OTHER_GUARD };

    const result = await invokeWithWallet(request(server, neverPromptedSigner(calls), confirmed));

    assert.equal(result.kind, "refused");
    if (result.kind !== "refused") return;
    assert.match(result.detail, /no longer matches the transaction/);
    assert.deepEqual(calls, { signTransaction: 0, signAuthEntry: 0 });
    assert.equal(server.simulateCalls, 0);
    assert.equal(server.sendCalls, 0);
  });

  test("an authorization for another network is refused even though the call is well-formed", async () => {
    const calls = { signTransaction: 0, signAuthEntry: 0 };
    const server = new RecordingServer();
    const confirmed = { ...FREEZE, networkPassphrase: PUBLIC_PASSPHRASE };

    const result = await invokeWithWallet(request(server, neverPromptedSigner(calls), confirmed));

    assert.equal(result.kind, "refused");
    if (result.kind !== "refused") return;
    assert.deepEqual(calls, { signTransaction: 0, signAuthEntry: 0 });
  });

  test("a confirmed authorization that matches lets the write through", async () => {
    // The control, and the reason the checks above mean anything: the gate is not
    // a blanket refusal, so a matching summary reaches the simulation and lands.
    const calls = { signTransaction: 0, signAuthEntry: 0 };
    const server = new RecordingServer();
    const signer = {
      ...neverPromptedSigner(calls),
      async signTransaction(value: string): Promise<string> {
        calls.signTransaction += 1;
        return value;
      },
    };

    const result = await invokeWithWallet(request(server, signer, FREEZE));

    assert.equal(result.kind, "submitted");
    assert.deepEqual(calls, { signTransaction: 1, signAuthEntry: 0 });
    assert.equal(server.simulateCalls, 2, "a discovery pass and an enforced pass");
    assert.equal(server.sendCalls, 1);
  });

  test("an operation asked for without any summary derives the same reading and proceeds", async () => {
    // The headless callers — the sandbox script, the Phase 3 proof harness — have
    // no panel to print a summary, so the operation derives its own from the same
    // transaction and the check still runs.
    const calls = { signTransaction: 0, signAuthEntry: 0 };
    const server = new RecordingServer();
    const signer = {
      ...neverPromptedSigner(calls),
      async signTransaction(value: string): Promise<string> {
        calls.signTransaction += 1;
        return value;
      },
    };

    const result = await freezeGuard({
      server: server as unknown as rpc.Server,
      signer,
      guard: GUARD,
      passphrase: PASSPHRASE,
    });

    assert.equal(result.kind, "submitted");
    assert.deepEqual(calls, { signTransaction: 1, signAuthEntry: 0 });
  });

  test("an operation handed an explicit nothing-to-confirm is refused before prompting", async () => {
    // `null` from a panel means the summary could not be built — no wallet, no
    // guard — and that is a refusal, not a licence to go and work it out alone.
    const calls = { signTransaction: 0, signAuthEntry: 0 };
    const server = new RecordingServer();

    const result = await freezeGuard({
      server: server as unknown as rpc.Server,
      signer: neverPromptedSigner(calls),
      guard: GUARD,
      passphrase: PASSPHRASE,
      authorization: null,
    });

    assert.equal(result.kind, "refused");
    if (result.kind !== "refused") return;
    assert.match(result.detail, /authorization was never confirmed/);
    assert.deepEqual(calls, { signTransaction: 0, signAuthEntry: 0 });
    assert.equal(server.simulateCalls, 0);
  });
});
