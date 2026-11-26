/**
 * Late provider callbacks must never re-enable a session (issue #519).
 *
 * The fixtures below are deliberately *delayed*: every provider answer is a
 * deferred promise that the test resolves by hand, so the disconnect or the
 * second connect happens while the first attempt is genuinely in flight. That
 * is the only ordering in which the bug exists — an answer that arrives after
 * the operator left, or after they chose another wallet.
 *
 * The second half proves the write boundary asks the same question at signing
 * time: the live account *and* the live network must both still be the ones the
 * review was built for.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { createWalletSessionGuard } from "../../lib/guard/walletSession.ts";
import { isObserverSession, signingAllowed } from "../../lib/guard/observerMode.ts";
import {
  WriteInterruptionError,
  recoveryGuidance,
  revalidateWallet,
  type WriteInterruption,
} from "../../lib/guard/writeReview.ts";

const TESTNET = "Test SDF Network ; September 2015";
const PUBLIC = "Public Global Stellar Network ; September 2015";
const REVIEWED = "GD5S5O2MZ6FSMFH6QILG37KSQNRVR3RPSWBTTV4JOUJ7J6TWLLL5LAVS";
const OTHER = "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

async function interruptionOf(run: () => Promise<void>): Promise<WriteInterruption> {
  try {
    await run();
  } catch (error) {
    if (!(error instanceof WriteInterruptionError)) {
      throw new Error(`expected an interruption, got ${String(error)}`);
    }
    return error.interruption;
  }
  throw new Error("the write boundary should have refused");
}

describe("wallet session generations", () => {
  it("stamps every attempt and invalidates earlier ones", () => {
    const guard = createWalletSessionGuard();
    assert.equal(guard.generation, 0);
    const first = guard.begin();
    assert.equal(guard.isCurrent(first), true);
    const second = guard.begin();
    assert.equal(guard.isCurrent(first), false, "a superseding attempt makes the old one stale");
    assert.equal(guard.isCurrent(second), true);
    guard.invalidate();
    assert.equal(guard.isCurrent(second), false, "a disconnect makes every token stale");
  });

  it("drops a connection that resolves after the operator disconnected", async () => {
    const guard = createWalletSessionGuard();
    const token = guard.begin();
    const providerAnswer = deferred<{ address: string; passphrase: string }>();
    const adopted: string[] = [];

    const applyLateAnswer = providerAnswer.promise.then((connection) => {
      const current = guard.accept(token, connection);
      if (current !== null) adopted.push(current.address);
    });

    // The operator disconnects while the extension still has the prompt open.
    guard.invalidate();
    providerAnswer.resolve({ address: REVIEWED, passphrase: TESTNET });
    await applyLateAnswer;

    assert.deepEqual(adopted, [], "a late callback must not re-adopt a disconnected session");
  });

  it("adopts the reconnect and ignores the superseded provider's answer", async () => {
    const guard = createWalletSessionGuard();
    const firstAttempt = guard.begin();
    const firstAnswer = deferred<string>();
    const secondAttempt = guard.begin();
    const secondAnswer = deferred<string>();
    const adopted: string[] = [];

    const apply = (token: number, pending: Promise<string>) =>
      pending.then((address) => {
        const current = guard.accept(token, address);
        if (current !== null) adopted.push(current);
      });

    const first = apply(firstAttempt, firstAnswer.promise);
    const second = apply(secondAttempt, secondAnswer.promise);

    // Freighter answers *after* Albedo/xBull was chosen and connected.
    secondAnswer.resolve(OTHER);
    await second;
    firstAnswer.resolve(REVIEWED);
    await first;

    assert.deepEqual(adopted, [OTHER]);
  });

  it("drops a late network read from an attempt that was replaced mid-stage", async () => {
    const guard = createWalletSessionGuard();
    const token = guard.begin();
    const address = deferred<string>();
    const network = deferred<string>();

    const settle = (async () => {
      const liveAddress = await address.promise;
      if (!guard.isCurrent(token)) return null;
      const liveNetwork = await network.promise;
      if (!guard.isCurrent(token)) return null;
      return `${liveAddress}@${liveNetwork}`;
    })();

    address.resolve(REVIEWED);
    await Promise.resolve();
    // A new attempt begins while the first provider is still reading its network.
    guard.begin();
    network.resolve(TESTNET);

    assert.equal(await settle, null, "the staged read of a superseded attempt is discarded");
  });

  it("leaves the console in observer mode when only a stale callback arrives", async () => {
    // Issue #519's headline case: an auditor watching (no wallet) triggers a
    // connect, disconnects, and the provider answers afterwards. The honest
    // state is still "observer", and every write control still explains why.
    const guard = createWalletSessionGuard();
    const token = guard.begin();
    let wallet: { address: string } | null = null;
    guard.invalidate();
    const late = guard.accept(token, { address: REVIEWED });
    if (late !== null) wallet = late;

    assert.equal(wallet, null);
    assert.equal(isObserverSession(wallet), true);
    assert.equal(signingAllowed(wallet).allowed, false);
  });

  it("treats a rejected provider answer as nothing to adopt", async () => {
    const guard = createWalletSessionGuard();
    const token = guard.begin();
    const answer = deferred<string>();
    const adopted = answer.promise.then(
      (address) => guard.accept(token, address),
      () => "rejected",
    );
    answer.reject(new Error("extension went away"));
    assert.equal(await adopted, "rejected");
    guard.invalidate();
    assert.equal(guard.accept(token, REVIEWED), null);
  });
});

describe("a write requires the current account and network", () => {
  it("continues when both live reads match the review", async () => {
    await revalidateWallet({
      boundAddress: REVIEWED,
      boundNetwork: TESTNET,
      phase: "envelope",
      readAddress: async () => REVIEWED,
      readNetwork: async () => TESTNET,
    });
  });

  it("refuses, and explains, a wallet that moved network mid-write", async () => {
    const interruption = await interruptionOf(() =>
      revalidateWallet({
        boundAddress: REVIEWED,
        boundNetwork: TESTNET,
        phase: "envelope",
        readAddress: async () => REVIEWED,
        readNetwork: async () => PUBLIC,
      }),
    );
    assert.deepEqual(interruption, {
      kind: "network-changed",
      phase: "envelope",
      expected: TESTNET,
      actual: PUBLIC,
    });

    const guidance = recoveryGuidance(interruption);
    assert.match(guidance.headline, /network changed/);
    assert.match(guidance.detail, /nothing was signed and nothing was broadcast/);
    assert.match(guidance.nextStep, /fresh review/);
    assert.equal(guidance.writeMayHaveLanded, false);
    assert.equal(guidance.autoResubmit, false);
    assert.equal(guidance.persistEnvelope, false);
  });

  it("does not treat an unreadable or empty network as agreement", async () => {
    const empty = await interruptionOf(() =>
      revalidateWallet({
        boundAddress: REVIEWED,
        boundNetwork: TESTNET,
        phase: "authorization",
        readNetwork: async () => "",
      }),
    );
    assert.equal(empty.kind, "network-changed");
    assert.equal(empty.kind === "network-changed" && empty.actual, "");
    assert.match(recoveryGuidance(empty).headline, /an unknown network/);

    const gone = await interruptionOf(() =>
      revalidateWallet({
        boundAddress: REVIEWED,
        boundNetwork: TESTNET,
        phase: "authorization",
        readNetwork: async () => null,
      }),
    );
    assert.equal(gone.kind, "wallet-disconnected");

    const threw = await interruptionOf(() =>
      revalidateWallet({
        boundAddress: REVIEWED,
        boundNetwork: TESTNET,
        phase: "authorization",
        readNetwork: async () => {
          throw new Error("extension is gone");
        },
      }),
    );
    assert.equal(threw.kind, "wallet-disconnected");
  });

  it("checks the account before the network, so a moved account wins", async () => {
    const interruption = await interruptionOf(() =>
      revalidateWallet({
        boundAddress: REVIEWED,
        boundNetwork: TESTNET,
        phase: "envelope",
        readAddress: async () => OTHER,
        readNetwork: async () => PUBLIC,
      }),
    );
    assert.equal(interruption.kind, "account-changed");
  });

  it("treats a network change during submission as possibly landed", async () => {
    const interruption = await interruptionOf(() =>
      revalidateWallet({
        boundAddress: REVIEWED,
        boundNetwork: TESTNET,
        phase: "submission",
        readAddress: async () => REVIEWED,
        readNetwork: async () => PUBLIC,
      }),
    );
    const guidance = recoveryGuidance(interruption);
    assert.equal(guidance.writeMayHaveLanded, true);
    assert.match(guidance.nextStep, /Transaction history/);
  });

  it("ignores a whitespace-only difference in the passphrase", async () => {
    await revalidateWallet({
      boundAddress: REVIEWED,
      boundNetwork: ` ${TESTNET} `,
      phase: "discovery",
      readNetwork: async () => TESTNET,
    });
  });

  it("is a no-op for headless signers that cannot move underneath a review", async () => {
    await revalidateWallet({ boundAddress: REVIEWED, phase: "discovery" });
    await revalidateWallet({
      boundAddress: REVIEWED,
      phase: "discovery",
      boundNetwork: TESTNET,
    });
  });
});

describe("the console wires the guard rather than relying on the tests", () => {
  const provider = readFileSync("components/GuardProvider.tsx", "utf8");
  const submit = readFileSync("lib/guard/submit.ts", "utf8");
  const connector = readFileSync("lib/guard/walletConnector.ts", "utf8");
  const wallet = readFileSync("lib/guard/wallet.ts", "utf8");

  it("increments the session generation for connect, reconnect and disconnect", () => {
    assert.match(provider, /createWalletSessionGuard\(\)/);
    const begins = provider.match(/sessionGuardRef\.current\.begin\(\)/g) ?? [];
    assert.ok(begins.length >= 2, "both connect() and the silent reconnect must stamp an attempt");
    assert.match(provider, /sessionGuardRef\.current\.invalidate\(\)/);
    const invalidations = provider.match(/sessionGuardRef\.current\.invalidate\(\)/g) ?? [];
    assert.ok(invalidations.length >= 2, "a local and a cross-tab disconnect both invalidate");
  });

  it("checks the generation immediately after the provider answers", () => {
    const awaited = provider.indexOf("const connection = await connector.connect();");
    const checked = provider.indexOf(
      "if (!sessionGuardRef.current.isCurrent(attempt)) return;",
      awaited,
    );
    assert.ok(awaited > 0, "connect() must await the provider");
    assert.ok(
      checked > awaited,
      "the stale check must sit between the provider's answer and the first state write",
    );
    assert.ok(
      provider.indexOf("setWallet({", awaited) > checked,
      "no wallet state may be adopted before the generation check",
    );
    assert.match(
      provider,
      /if \(sessionGuardRef\.current\.isCurrent\(attempt\)\) setConnecting\(false\)/,
      "a stale attempt must not clear a live attempt's spinner",
    );
  });

  it("passes the account and network readers into every write boundary", () => {
    assert.match(submit, /readNetwork:\s*signer\.currentNetwork/);
    assert.match(submit, /boundNetwork:\s*signer\.networkPassphrase/);
    assert.match(connector, /currentNetwork:\s*async \(\): Promise<string \| null>/);
    assert.match(connector, /networkPassphrase,/);
    assert.match(wallet, /currentNetwork:\s*async \(\): Promise<string \| null>/);
  });
});
