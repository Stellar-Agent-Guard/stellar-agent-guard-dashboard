/**
 * An extension update is a wallet-state event, not a chain event (issue #518).
 *
 * These tests hold the three things the guidance has to say: how to reconnect
 * safely (no secret, no resumed review), how to verify the session afterwards,
 * and the difference between local wallet state and authoritative chain state.
 * The panel's contract is asserted from source so a future refactor cannot drop
 * the block while the constants still exist.
 */

import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { describe, it } from "node:test";
import {
  WALLET_DISCONNECTED_GUIDE,
  WALLET_EXTENSION_UPDATE_GUIDE,
  WALLET_RECOVERY_ANCHOR,
  WALLET_RECOVERY_LINK_LABEL,
  WALLET_VS_CHAIN,
  recoveryAnchorHref,
  walletRecoveryFor,
} from "../../lib/guard/walletRecovery.ts";

const panel = readFileSync("components/WalletBar.tsx", "utf8");
const summary = readFileSync("docs/SUMMARY.md", "utf8");

describe("the extension-update guide", () => {
  const guide = WALLET_EXTENSION_UPDATE_GUIDE;

  it("names the event and says why local state may be stale", () => {
    assert.equal(guide.id, "extension-updated");
    assert.match(guide.headline, /updated/);
    assert.match(guide.why, /stale/);
    assert.match(guide.why, /never a claim about the chain/i);
  });

  it("describes a safe reconnect in order", () => {
    assert.ok(guide.reconnect.length >= 4);
    const steps = guide.reconnect.join(" ");
    assert.match(steps, /Reload this page/);
    assert.match(steps, /approve access/i);
    assert.match(steps, /fresh review/i);
    assert.match(guide.reconnect[guide.reconnect.length - 1]!, /never asks for a seed phrase/i);
  });

  it("separates verification from reconnecting", () => {
    assert.ok(guide.verification.length >= 3);
    const verification = guide.verification.join(" ");
    assert.match(verification, /account you expect/);
    assert.match(verification, /network/);
    assert.match(verification, /Transaction history/);
    assert.match(verification, /never resubmits anything/);
  });

  it("keeps the shorter disconnect guide consistent with it", () => {
    assert.equal(WALLET_DISCONNECTED_GUIDE.id, "disconnected");
    assert.ok(WALLET_DISCONNECTED_GUIDE.reconnect.join(" ").includes("seed phrase"));
    assert.ok(WALLET_DISCONNECTED_GUIDE.verification.length >= 2);
  });
});

describe("wallet state versus chain state", () => {
  it("names both, and says which one is authoritative", () => {
    assert.equal(WALLET_VS_CHAIN.length, 2);
    const [walletState, chainState] = WALLET_VS_CHAIN;
    assert.ok(walletState && chainState);
    assert.match(walletState.label, /Wallet state/);
    assert.match(walletState.detail, /local/i);
    assert.match(walletState.detail, /hint/);
    assert.match(chainState.label, /Chain state/);
    assert.match(chainState.detail, /authoritative/i);
    assert.match(chainState.detail, /Soroban RPC/);
    assert.match(chainState.detail, /unaffected by an extension update/);
  });
});

describe("which errors are linked to the guidance", () => {
  it("recognises the ways providers report an updated or vanished extension", () => {
    for (const message of [
      "Freighter is not available in this browser.",
      "The extension was updated, reload this page",
      "no provider found",
      "Wallet locked",
      "connect was closed",
      "permission denied for this origin",
    ]) {
      assert.equal(
        walletRecoveryFor(message)?.id,
        "extension-updated",
        `${message} must link to the recovery guidance`,
      );
    }
  });

  it("leaves unrelated failures to the panel's own error", () => {
    for (const message of ["insufficient balance", "simulation refused: per_tx_cap_exceeded", ""]) {
      assert.equal(walletRecoveryFor(message), null, `${message} is not a wallet-state failure`);
    }
    assert.equal(walletRecoveryFor(null), null);
    assert.equal(walletRecoveryFor(undefined), null);
  });

  it("exposes one anchor that both the panel and the links use", () => {
    assert.equal(WALLET_RECOVERY_ANCHOR, "wallet-recovery");
    assert.equal(recoveryAnchorHref(), "#wallet-recovery");
    assert.match(WALLET_RECOVERY_LINK_LABEL, /Safe reconnect/);
  });
});

describe("the wallet panel renders the guidance", () => {
  it("links from a wallet error to the recovery block", () => {
    assert.match(
      panel,
      /import \{[\s\S]*walletRecoveryFor[\s\S]*\} from "\.\.\/lib\/guard\/walletRecovery\.ts"/,
    );
    assert.match(panel, /walletRecoveryFor\(walletError\)/);
    assert.match(panel, /href=\{recoveryAnchorHref\(\)\}/);
    assert.match(panel, /data-testid="wallet-error-recovery"/);
  });

  it("renders the block at the anchor with reconnect and verification steps", () => {
    assert.match(panel, /id=\{WALLET_RECOVERY_ANCHOR\}/);
    assert.match(panel, /data-testid="wallet-recovery"/);
    assert.match(panel, /WALLET_EXTENSION_UPDATE_GUIDE\.reconnect\.map/);
    assert.match(panel, /WALLET_EXTENSION_UPDATE_GUIDE\.verification\.map/);
    assert.match(panel, /WALLET_VS_CHAIN\.map/);
  });

  it("also links from an interrupted write", () => {
    const interruption = panel.indexOf('data-testid="write-interruption"');
    const link = panel.indexOf("recoveryAnchorHref()", interruption);
    assert.ok(interruption > 0 && link > interruption);
  });
});

describe("the guidance is part of the documentation", () => {
  it("ships as a guide and is reachable from the GitBook summary", () => {
    assert.ok(existsSync("docs/guides/wallet-recovery.md"));
    assert.match(summary, /guides\/wallet-recovery\.md/);
    const guide = readFileSync("docs/guides/wallet-recovery.md", "utf8");
    assert.match(guide, /## Safe reconnect/);
    assert.match(guide, /## Verify before signing/);
    assert.match(guide, /## Wallet state is not chain state/);
    assert.match(guide, /Chain state \(authoritative\)/);
  });
});
