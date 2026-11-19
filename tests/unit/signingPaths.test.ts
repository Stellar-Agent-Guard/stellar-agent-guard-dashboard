/**
 * Supported signing paths for a guard write (issue #517).
 *
 * The pure capability table is checked first; the picker modal is then
 * rendered so the explanation an operator reads before choosing a path is the
 * one these tests assert, not just the data behind it.
 */

import assert from "node:assert/strict";
import { afterEach, before, describe, test } from "node:test";
import { installDom, loadReact, sleep, type Act } from "./domHarness.ts";
import {
  SIGNING_PATH_BOUNDARY,
  pathCanSign,
  signingPathsFor,
  supportLabel,
  type SigningPath,
} from "../../lib/guard/signingPaths.ts";
import { WALLET_PROVIDERS, type XbullProvider } from "../../lib/guard/walletConnector.ts";
import { WalletPickerModal } from "../../components/WalletBar.tsx";

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

function xbull(withAuthEntry: boolean): XbullProvider {
  return {
    connect: async () => "GXBULL",
    signTransaction: async () => "signed",
    ...(withAuthEntry ? { signAuthEntry: async () => "entry" } : {}),
  };
}

function byId(paths: SigningPath[], id: SigningPath["id"]): SigningPath {
  const found = paths.find((path) => path.id === id);
  assert.ok(found, `expected a ${id} path`);
  return found;
}

describe("signingPathsFor", () => {
  test("lists every wallet provider, then the external-signer alternative", () => {
    const paths = signingPathsFor({ availableProviders: [], currentProvider: null });
    assert.deepEqual(
      paths.map((path) => path.id),
      [...WALLET_PROVIDERS.map((provider) => provider.id), "external-xdr"],
    );
    assert.equal(paths.at(-1)!.kind, "external");
  });

  test("Freighter and Albedo sign both authorization entries and envelopes", () => {
    const paths = signingPathsFor({ availableProviders: ["freighter"], currentProvider: null });
    for (const id of ["freighter", "albedo"] as const) {
      const path = byId(paths, id);
      assert.equal(path.steps["auth-entry"].support, "supported");
      assert.equal(path.steps.transaction.support, "supported");
      assert.equal(pathCanSign(path, ["auth-entry", "transaction"]).ok, true);
    }
  });

  test("marks the detected and the current provider", () => {
    const paths = signingPathsFor({
      availableProviders: ["freighter", "xbull"],
      currentProvider: "xbull",
      scope: { xbull: xbull(true) },
    });
    assert.equal(byId(paths, "freighter").detected, true);
    assert.equal(byId(paths, "albedo").detected, false);
    assert.equal(byId(paths, "xbull").current, true);
    assert.equal(byId(paths, "freighter").current, false);
  });

  test("an xBull build with signAuthEntry supports both steps", () => {
    const path = byId(
      signingPathsFor({
        availableProviders: ["xbull"],
        currentProvider: null,
        scope: { xbull: xbull(true) },
      }),
      "xbull",
    );
    assert.equal(path.steps["auth-entry"].support, "supported");
    assert.equal(path.steps["auth-entry"].reason, null);
  });

  test("an xBull build without signAuthEntry explains why auth entries are unsupported", () => {
    const path = byId(
      signingPathsFor({
        availableProviders: ["xbull"],
        currentProvider: "xbull",
        scope: { xbull: xbull(false) },
      }),
      "xbull",
    );
    assert.equal(path.steps["auth-entry"].support, "unsupported");
    assert.match(path.steps["auth-entry"].reason ?? "", /signAuthEntry/);
    assert.match(path.steps["auth-entry"].reason ?? "", /Freighter or Albedo/);
    assert.equal(path.steps.transaction.support, "supported");
    const verdict = pathCanSign(path, ["auth-entry", "transaction"]);
    assert.equal(verdict.ok, false);
    assert.equal(verdict.reason, path.steps["auth-entry"].reason);
    assert.equal(pathCanSign(path, ["transaction"]).ok, true);
  });

  test("an undetected xBull is reported as not checked rather than guessed", () => {
    const path = byId(
      signingPathsFor({ availableProviders: [], currentProvider: null, scope: { xbull: null } }),
      "xbull",
    );
    assert.equal(path.steps["auth-entry"].support, "unknown");
    assert.match(path.steps["auth-entry"].reason ?? "", /not detected/);
    assert.equal(supportLabel("unknown"), "not checked");
  });

  test("the external path signs envelopes only, and says so", () => {
    const external = byId(
      signingPathsFor({ availableProviders: [], currentProvider: null }),
      "external-xdr",
    );
    assert.equal(external.steps.transaction.support, "supported");
    assert.equal(external.steps["auth-entry"].support, "unsupported");
    assert.match(external.steps["auth-entry"].reason ?? "", /connected wallet/);
    assert.match(external.how, /Submit Signed XDR/);
  });

  test("no path describes a secret key as an input", () => {
    const paths = signingPathsFor({ availableProviders: [], currentProvider: null });
    for (const path of paths) {
      const text = [path.how, ...Object.values(path.steps).map((step) => step.reason ?? "")].join(
        " ",
      );
      assert.doesNotMatch(text, /secret|seed|private key|mnemonic/i, path.id);
    }
    assert.match(SIGNING_PATH_BOUNDARY, /no field, path or setting here accepts a secret key/);
  });
});

describe("WalletPickerModal signing paths", () => {
  async function render(scope: { xbull: XbullProvider | null }): Promise<HTMLElement> {
    const container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => {
      root!.render(
        react.createElement(WalletPickerModal, {
          availableProviders: scope.xbull ? ["freighter", "xbull"] : ["freighter"],
          currentProvider: null,
          connecting: false,
          onClose: () => {},
          onChoose: () => {},
          scope,
        }),
      );
      await sleep(0);
    });
    return container;
  }

  test("shows each provider's capability and the external alternative before connecting", async () => {
    const container = await render({ xbull: xbull(true) });
    for (const id of ["freighter", "albedo", "xbull", "external-xdr"]) {
      const list = container.querySelector(`[data-testid="signing-steps-${id}"]`);
      assert.ok(list, `expected the ${id} signing steps`);
      assert.equal(list.querySelectorAll("li").length, 2);
    }
    const external = container.querySelector('[data-testid="signing-path-external-xdr"]');
    assert.match(external?.textContent ?? "", /Submit Signed XDR/);
    assert.equal(
      container.querySelector('[data-testid="signing-path-boundary"]')?.textContent,
      SIGNING_PATH_BOUNDARY,
    );
  });

  test("explains an unsupported path inline", async () => {
    const container = await render({ xbull: xbull(false) });
    const entry = container.querySelector(
      '[data-testid="signing-steps-xbull"] [data-step="auth-entry"]',
    );
    assert.equal(entry?.getAttribute("data-support"), "unsupported");
    assert.match(entry?.textContent ?? "", /not supported — .*signAuthEntry/);
    const externalEntry = container.querySelector(
      '[data-testid="signing-steps-external-xdr"] [data-step="auth-entry"]',
    );
    assert.match(externalEntry?.textContent ?? "", /not supported — /);
  });

  test("the modal renders no input that could take a secret", async () => {
    const container = await render({ xbull: null });
    assert.equal(container.querySelectorAll("input, textarea").length, 0);
  });
});
