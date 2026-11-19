/**
 * Network identity in the signed-XDR review (issue #520).
 *
 * The pure helpers are checked against real signed envelopes, then the panel
 * is rendered so the identity the operator reads, the refusal of a mismatched
 * envelope, and the byte-for-byte broadcast are asserted through the UI.
 */

import assert from "node:assert/strict";
import { afterEach, before, describe, test } from "node:test";
import {
  Account,
  Keypair,
  Networks,
  Operation,
  TransactionBuilder,
  hash,
  xdr,
} from "@stellar/stellar-sdk";
import { installDom, loadReact, sleep, type Act } from "./domHarness.ts";
import {
  confirmReviewedEnvelope,
  decodeEnvelopeIdentity,
  networkIdOf,
  networkIdentity,
} from "../../lib/guard/envelopeIdentity.ts";
import { NETWORK } from "../../lib/guard/network.ts";
import { GuardContext } from "../../components/GuardProvider.tsx";
import { SubmitSignedXDRPanel } from "../../components/SubmitSignedXDRPanel.tsx";

installDom();

let react: typeof import("react");
let createRoot: typeof import("react-dom/client").createRoot;
let act: Act;
let root: ReturnType<typeof createRoot> | null = null;

before(async () => {
  const loaded = await loadReact();
  react = loaded.react;
  createRoot = loaded.createRoot;
  act = loaded.act;
});

afterEach(async () => {
  if (root) {
    await act(async () => {
      root!.unmount();
    });
    root = null;
  }
  document.body.innerHTML = "";
});

const CONTRACT = "CAYJZT4XH5SWDXNR7MZJCCUBIDAT2KZDDUTZ7OZQEMKCPJGD4P3X4CU7";
const TESTNET = { name: "Testnet", passphrase: Networks.TESTNET };

function signedEnvelope(passphrase: string, signer = Keypair.random()) {
  const account = new Account(signer.publicKey(), "1000");
  const tx = new TransactionBuilder(account, { fee: "150", networkPassphrase: passphrase })
    .addOperation(
      Operation.invokeContractFunction({
        contract: CONTRACT,
        function: "set_policy",
        args: [xdr.ScVal.scvU32(50)],
      }),
    )
    .setTimeout(300)
    .build();
  tx.sign(signer);
  return { tx, xdr: tx.toXDR(), signer };
}

describe("decodeEnvelopeIdentity", () => {
  test("names the selected network, its network ID, the transaction hash and the operations", () => {
    const { tx, xdr: envelope, signer } = signedEnvelope(Networks.TESTNET);
    const identity = decodeEnvelopeIdentity(envelope, TESTNET);
    assert.ok(identity.ok);
    assert.equal(identity.selected.name, "Testnet");
    assert.equal(identity.selected.passphrase, Networks.TESTNET);
    assert.equal(
      identity.selected.networkId,
      Buffer.from(hash(Buffer.from(Networks.TESTNET))).toString("hex"),
    );
    assert.equal(identity.matches, true);
    assert.deepEqual(identity.signedFor, identity.selected);
    assert.equal(identity.transactionHash, Buffer.from(tx.hash()).toString("hex"));
    assert.equal(identity.source, signer.publicKey());
    assert.equal(identity.sequence, "1001");
    assert.equal(identity.operations.length, 1);
    assert.match(identity.operations[0]!, /set_policy/);
  });

  test("names the network a mismatched envelope is actually signed for", () => {
    const { xdr: envelope } = signedEnvelope(Networks.PUBLIC);
    const identity = decodeEnvelopeIdentity(envelope, TESTNET);
    assert.ok(identity.ok);
    assert.equal(identity.matches, false);
    assert.equal(identity.signedFor?.name, "Public");
    assert.equal(identity.signedFor?.networkId, networkIdOf(Networks.PUBLIC));
    assert.notEqual(identity.signedFor?.networkId, identity.selected.networkId);
  });

  test("reports no network when no signature verifies", () => {
    const { tx } = signedEnvelope(Networks.TESTNET);
    tx.signatures.splice(0);
    const identity = decodeEnvelopeIdentity(tx.toXDR(), TESTNET);
    assert.ok(identity.ok);
    assert.equal(identity.matches, false);
    assert.equal(identity.signedFor, null);
  });

  test("refuses empty and malformed input with a reason", () => {
    assert.deepEqual(decodeEnvelopeIdentity("  ", TESTNET), {
      ok: false,
      error: "No envelope to review",
    });
    const malformed = decodeEnvelopeIdentity("not-xdr", TESTNET);
    assert.equal(malformed.ok, false);
    if (!malformed.ok) assert.match(malformed.error, /Malformed envelope XDR/);
  });

  test("names unknown passphrases honestly", () => {
    assert.equal(networkIdentity("Some Private Network ; 2026").name, "Unknown network");
  });
});

describe("confirmReviewedEnvelope", () => {
  function reviewOf(envelope: string) {
    const identity = decodeEnvelopeIdentity(envelope, TESTNET);
    assert.ok(identity.ok);
    return {
      xdr: envelope,
      passphrase: Networks.TESTNET,
      transactionHash: identity.transactionHash,
    };
  }

  test("returns the transaction for the exact reviewed bytes", () => {
    const { xdr: envelope } = signedEnvelope(Networks.TESTNET);
    const confirmation = confirmReviewedEnvelope(reviewOf(envelope), envelope, Networks.TESTNET);
    assert.ok(confirmation.ok);
    if (confirmation.ok) assert.equal(confirmation.transaction.toXDR(), envelope);
  });

  test("refuses without a review", () => {
    const { xdr: envelope } = signedEnvelope(Networks.TESTNET);
    const confirmation = confirmReviewedEnvelope(null, envelope, Networks.TESTNET);
    assert.equal(confirmation.ok, false);
  });

  test("refuses an envelope that differs from the reviewed one", () => {
    const reviewed = signedEnvelope(Networks.TESTNET);
    const other = signedEnvelope(Networks.TESTNET);
    const confirmation = confirmReviewedEnvelope(
      reviewOf(reviewed.xdr),
      other.xdr,
      Networks.TESTNET,
    );
    assert.equal(confirmation.ok, false);
    if (!confirmation.ok) assert.match(confirmation.reason, /changed after it was reviewed/);
  });

  test("refuses when the selected network changed after the review", () => {
    const { xdr: envelope } = signedEnvelope(Networks.TESTNET);
    const confirmation = confirmReviewedEnvelope(reviewOf(envelope), envelope, Networks.PUBLIC);
    assert.equal(confirmation.ok, false);
    if (!confirmation.ok) assert.match(confirmation.reason, /selected network changed/);
  });

  test("refuses a mismatched network before submit and names it", () => {
    const { tx, xdr: envelope } = signedEnvelope(Networks.PUBLIC);
    const reviewed = {
      xdr: envelope,
      passphrase: Networks.TESTNET,
      transactionHash: Buffer.from(tx.hash()).toString("hex"),
    };
    const confirmation = confirmReviewedEnvelope(reviewed, envelope, Networks.TESTNET);
    assert.equal(confirmation.ok, false);
    if (!confirmation.ok)
      assert.match(confirmation.reason, /signed for Public.*Nothing was submitted/);
  });

  test("refuses a reviewed hash that does not match the bytes", () => {
    const { xdr: envelope } = signedEnvelope(Networks.TESTNET);
    const reviewed = { ...reviewOf(envelope), transactionHash: "00".repeat(32) };
    const confirmation = confirmReviewedEnvelope(reviewed, envelope, Networks.TESTNET);
    assert.equal(confirmation.ok, false);
    if (!confirmation.ok) assert.match(confirmation.reason, /hash differs/);
  });
});

describe("SubmitSignedXDRPanel network identity", () => {
  function serverRecording(sent: string[]) {
    return {
      getAccount: async (address: string) => new Account(address, "1000"),
      getLatestLedger: async () => ({ sequence: 100, id: "x", protocolVersion: 22 }),
      sendTransaction: async (tx: { toXDR(): string; hash(): Buffer }) => {
        sent.push(tx.toXDR());
        return { status: "PENDING", hash: Buffer.from(tx.hash()).toString("hex") };
      },
    };
  }

  async function render(server: unknown): Promise<HTMLElement> {
    const container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => {
      root!.render(
        react.createElement(
          GuardContext.Provider,
          { value: { server, wallet: null } as never },
          react.createElement(SubmitSignedXDRPanel),
        ),
      );
      await sleep(0);
    });
    return container;
  }

  async function paste(container: HTMLElement, value: string): Promise<void> {
    const textarea = container.querySelector(
      'textarea[aria-label="Signed transaction XDR"]',
    ) as HTMLTextAreaElement;
    const setter = Object.getOwnPropertyDescriptor(
      window.HTMLTextAreaElement.prototype,
      "value",
    )!.set!;
    await act(async () => {
      setter.call(textarea, value);
      textarea.dispatchEvent(new window.Event("input", { bubbles: true }));
      await sleep(0);
    });
  }

  function button(container: HTMLElement, text: string): HTMLButtonElement {
    const found = [...container.querySelectorAll("button")].find((candidate) =>
      (candidate.textContent ?? "").includes(text),
    );
    assert.ok(found, `expected a "${text}" button`);
    return found as HTMLButtonElement;
  }

  async function click(target: HTMLButtonElement): Promise<void> {
    await act(async () => {
      target.click();
      await sleep(20);
    });
  }

  test("shows the decoded identity and broadcasts exactly the reviewed bytes", async () => {
    const sent: string[] = [];
    const container = await render(serverRecording(sent));
    const { xdr: envelope } = signedEnvelope(NETWORK.passphrase);
    await paste(container, envelope);

    const identity = container.querySelector('[data-testid="network-identity"]');
    assert.ok(identity, "the identity block is shown for a decodable envelope");
    assert.match(identity.textContent ?? "", new RegExp(networkIdOf(NETWORK.passphrase)));
    assert.match(
      container.querySelector('[data-testid="identity-signed-for"]')?.textContent ?? "",
      new RegExp(NETWORK.passphrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
    );
    assert.match(
      container.querySelector('[data-testid="identity-operations"]')?.textContent ?? "",
      /set_policy/,
    );

    await click(button(container, "Check envelope"));
    await click(button(container, "Submit to Network"));
    assert.deepEqual(sent, [envelope]);
  });

  test("rejects a mismatched network before submit", async () => {
    const sent: string[] = [];
    const container = await render(serverRecording(sent));
    const other = NETWORK.passphrase === Networks.PUBLIC ? Networks.TESTNET : Networks.PUBLIC;
    const { xdr: envelope } = signedEnvelope(other);
    await paste(container, envelope);

    assert.ok(container.querySelector('[data-testid="network-mismatch-badge"]'));
    assert.match(
      container.querySelector('[data-testid="identity-signed-for"]')?.textContent ?? "",
      other === Networks.PUBLIC ? /Public/ : /Testnet/,
    );
    await click(button(container, "Check envelope"));
    assert.equal(button(container, "Submit to Network").disabled, true);
    assert.deepEqual(sent, []);
  });
});
