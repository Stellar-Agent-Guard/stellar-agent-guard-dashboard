"use client";

/**
 * Real deployment, from the browser.
 *
 * The panel refuses to deploy anything until it has re-derived the pinned Phase 1
 * artifact's identity from the chain, and it reports the address the contract will
 * have *before* the wallet is prompted. After the create transaction it re-reads
 * the new instance and checks the bytecode it runs — so "deployed" means the
 * proven artifact exists at that address, not that a transaction was signed.
 */

import { useCallback, useEffect, useState } from "react";
import { checkArtifact, deployGuard, initializeGuard, planDeploy } from "../lib/guard/guardOps.ts";
import type { ArtifactCheck, DeployOutcome, DeployPlan } from "../lib/guard/guardOps.ts";
import { deployCostBreakdown } from "../lib/guard/deployCostCalculator.ts";
import type { InvokeResult } from "../lib/guard/submit.ts";
import { PHASE1_ARTIFACT } from "../lib/guard/network.ts";
import { bytesToHex } from "../lib/guard/scval.ts";
import { useGuard } from "./GuardProvider.tsx";
import { ErrorBlock, OutcomeList, starLink } from "./bits.tsx";

function randomSalt(): Uint8Array {
  const salt = new Uint8Array(32);
  crypto.getRandomValues(salt);
  return salt;
}

/** Either the chain's answer about the artifact, or why there is not one. */
type ArtifactFetch = { artifact: ArtifactCheck } | { error: string };

export function DeployPanel() {
  const { server, signer, wallet, refresh, addInstance } = useGuard();
  const [artifact, setArtifact] = useState<ArtifactCheck | null>(null);
  const [artifactError, setArtifactError] = useState<string | null>(null);
  const [salt, setSalt] = useState<Uint8Array>(() => randomSalt());
  // The plan is stored together with the inputs it was computed for, so a plan
  // that no longer matches the wallet or salt is simply not shown. Deriving
  // staleness by key avoids the synchronous clear-in-an-effect that would
  // otherwise render a plan for the wrong account for one frame.
  const [planFor, setPlanFor] = useState<{ key: string; plan: DeployPlan } | null>(null);
  const [deploying, setDeploying] = useState(false);
  const [outcome, setOutcome] = useState<DeployOutcome | null>(null);
  const [liveSteps, setLiveSteps] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [agentPubkey, setAgentPubkey] = useState("");
  const [initResult, setInitResult] = useState<InvokeResult | null>(null);
  const [balance, setBalance] = useState<string | null>(null);

  useEffect(() => {
    if (!wallet) return;
    let cancelled = false;
    void (async () => {
      try {
        const account = (await server.getAccount(wallet.address)) as unknown as {
          balances?: Array<{ asset_type?: string; balance?: string }>;
        };
        const native = account.balances?.find((entry) => entry.asset_type === "native");
        if (!cancelled) setBalance(native?.balance ?? "0");
      } catch {
        if (!cancelled) setBalance("0");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [server, wallet]);

  // Fetching and applying are separate: `fetchArtifact` touches no state, so the
  // effect below has nothing synchronous to write, and the panel is never blanked
  // for a frame while a re-check is in flight. Both states are applied together,
  // and only once the chain has answered.
  const fetchArtifact = useCallback(async (): Promise<ArtifactFetch> => {
    try {
      return { artifact: await checkArtifact(server) };
    } catch (caught) {
      return { error: caught instanceof Error ? caught.message : String(caught) };
    }
  }, [server]);

  const applyArtifact = useCallback((result: ArtifactFetch) => {
    if ("artifact" in result) {
      setArtifact(result.artifact);
      setArtifactError(null);
    } else {
      setArtifact(null);
      setArtifactError(result.error);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const result = await fetchArtifact();
      if (!cancelled) applyArtifact(result);
    })();
    return () => {
      cancelled = true;
    };
  }, [fetchArtifact, applyArtifact]);

  const planKey = wallet ? `${wallet.address}:${bytesToHex(salt)}` : "";
  const plan = planFor?.key === planKey ? planFor.plan : null;
  const deployCost =
    wallet && balance !== null
      ? deployCostBreakdown({
          uploadWasm: plan ? !plan.codePresent : false,
          wasmBytes: PHASE1_ARTIFACT.wasmBytes,
          contractInstanceBytes: 64,
          accountBalanceXlm: balance,
        })
      : null;

  useEffect(() => {
    if (!wallet) return;
    let cancelled = false;
    void (async () => {
      try {
        const next = await planDeploy(server, wallet.address, salt);
        if (!cancelled) setPlanFor({ key: planKey, plan: next });
      } catch {
        // A plan that cannot be computed leaves the panel saying so, rather than
        // showing a plan for a different account.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [server, wallet, salt, planKey]);

  async function deploy() {
    setDeploying(true);
    setError(null);
    setOutcome(null);
    setLiveSteps([]);
    try {
      const result = await deployGuard({
        server,
        signer: signer(),
        salt,
        onStep: (step) => setLiveSteps((current) => [...current, step.label]),
      });
      setOutcome(result);
      if (result.verified) addInstance(result.guard, "Deployed from this console");
      await refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setDeploying(false);
    }
  }

  async function initialize(target: string) {
    setError(null);
    setInitResult(null);
    try {
      const result = await initializeGuard({
        server,
        signer: signer(),
        guard: target,
        agentPubkeyHex: agentPubkey,
      });
      setInitResult(result);
      await refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    }
  }

  return (
    <div className="panel">
      <h2>Deploy a guard</h2>

      <p className="tiny muted">
        Deploys the artifact Phase 1 proved. The bytecode is fetched from the chain and hashed here
        before anything is signed, so this cannot ship a different binary than the one that was
        verified.
      </p>

      <div className="grid" style={{ marginTop: 12 }}>
        <div className="stat">
          <div className="k">Pinned artifact</div>
          <div className="v small mono">{PHASE1_ARTIFACT.wasmHash.slice(0, 16)}...</div>
          <div className="n">{PHASE1_ARTIFACT.wasmBytes} bytes</div>
        </div>
        {artifactError && (
          <div className="stat">
            <div className="k">On-chain artifact</div>
            <div className="v small" style={{ color: "var(--danger)" }}>
              unreadable
            </div>
            <div className="n">{artifactError}</div>
          </div>
        )}
        {artifact && (
          <>
            <div className="stat">
              <div className="k">Fetched from chain</div>
              <div className="v small mono">{artifact.live.fetchedSha256.slice(0, 16)}...</div>
              <div className="n">{artifact.live.bytes} bytes</div>
            </div>
            <div className="stat">
              <div className="k">Identity</div>
              <div
                className="v small"
                style={{ color: artifact.ok ? "var(--ok)" : "var(--danger)" }}
              >
                {artifact.ok ? "matches" : "MISMATCH"}
              </div>
              <div className="n">
                {artifact.ok ? "deploy is permitted" : "deploy is refused"}
              </div>
            </div>
          </>
        )}
      </div>

      {artifact && !artifact.ok && <ErrorBlock title="Deploy refused" detail={artifact.detail} />}
      {artifact && artifact.ok && (
        <p className="tiny muted" style={{ marginTop: 8 }}>
          {artifact.detail}
        </p>
      )}

      <h3>What this deploy will do</h3>
      {!wallet ? (
        <p className="tiny muted">Connect the admin wallet to compute the contract address.</p>
      ) : plan ? (
        <div className="grid">
          <div className="stat">
            <div className="k">Predicted guard address</div>
            <div className="v small mono">{plan.predicted}</div>
            <div className="n">computed before signing, then confirmed by reading the instance back</div>
          </div>
          <div className="stat">
            <div className="k">Pinned bytecode already on chain</div>
            <div className="v small">{plan.codePresent ? "yes" : "no"}</div>
            <div className="n">
              {plan.codePresent
                ? "one transaction: the create"
                : "two transactions: upload, then create"}
            </div>
          </div>
        </div>
      ) : (
        <p className="tiny muted">Working out the deploy plan...</p>
      )}

      {wallet && plan && deployCost && (
        <div className={deployCost.warning ? "error" : "notice info"} style={{ marginTop: 12 }}>
          <strong>Deployment reserve check</strong>
          <div className="tiny"
            style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 10, marginTop: 8 }}>
            <div>
              <div className="tiny muted">Base tx fee</div>
              <div className="mono">{deployCost.baseFeeXlm} XLM</div>
            </div>
            <div>
              <div className="tiny muted">WASM upload</div>
              <div className="mono">{deployCost.wasmUploadFeeXlm} XLM</div>
            </div>
            <div>
              <div className="tiny muted">Contract instance</div>
              <div className="mono">{deployCost.contractInstanceFeeXlm} XLM</div>
            </div>
            <div>
              <div className="tiny muted">Initial rent</div>
              <div className="mono">{deployCost.initialRentDepositXlm} XLM</div>
            </div>
            <div>
              <div className="tiny muted">Required total</div>
              <div className="mono">{deployCost.totalRequiredXlm} XLM</div>
            </div>
            <div>
              <div className="tiny muted">Wallet balance</div>
              <div className="mono">{deployCost.balanceXlm} XLM</div>
            </div>
          </div>
          <div className="tiny muted" style={{ marginTop: 8 }}>
            Remaining after required spend: <span className="mono">{deployCost.balanceAfterRequiredXlm} XLM</span>
          </div>
          {deployCost.warning && (
            <div className="tiny" style={{ marginTop: 8 }}>
              Balance is below the reserve safety threshold ({deployCost.safetyBufferXlm} XLM cushion):
              fund at least {(Number(deployCost.totalRequiredXlm) + Number(deployCost.safetyBufferXlm)).toFixed(7)} XLM before signing.
            </div>
          )}
        </div>
      )}

      <div className="row" style={{ marginTop: 14 }}>
        <button
          disabled={!wallet || deploying || artifact?.ok !== true}
          onClick={() => void deploy()}
        >
          {deploying ? "Deploying..." : "Deploy guard"}
        </button>
        <button className="secondary" onClick={() => setSalt(randomSalt())} disabled={deploying}>
          New salt
        </button>
        <button
          className="secondary"
          onClick={() => {
            void fetchArtifact().then(applyArtifact);
          }}
          disabled={deploying}
        >
          Re-check artifact
        </button>
      </div>

      {liveSteps.length > 0 && deploying && (
        <div className="notice info">
          <strong>Deploy in progress</strong>
          {liveSteps.map((step) => (
            <div key={step} className="tiny mono">
              {step}
            </div>
          ))}
        </div>
      )}

      {error && <ErrorBlock title="The deploy could not be completed" detail={error} />}

      {outcome && (
        <div className={outcome.verified ? "notice info" : "error"}>
          <strong>
            {outcome.verified
              ? "Deployed and verified against the pinned artifact"
              : "A contract was created, but it is NOT the pinned artifact"}
          </strong>
          <span className="tiny mono">{outcome.guard}</span>
          <OutcomeList steps={outcome.steps} />
          {outcome.identity && (
            <p className="tiny muted">
              Instance runs {outcome.identity.fetchedSha256.slice(0, 20)}... ({outcome.identity.bytes}{" "}
              bytes), ledger reports {outcome.identity.reportedWasmHash?.slice(0, 20) ?? "none"}...
            </p>
          )}
        </div>
      )}

      <h3>Initialize a guard</h3>
      <p className="tiny muted">
        Registers the connected wallet as admin and the agent&apos;s raw Ed25519 public key. One-time:
        the account is default-deny until a policy is installed on the Configure step.
      </p>
      <label className="field">
        <span className="lbl">Agent public key (32 raw Ed25519 bytes, hex)</span>
        <input
          value={agentPubkey}
          onChange={(event) => setAgentPubkey(event.target.value)}
          placeholder="53b093e0281a2d8f4276b77fd21e3380b3329f09097ace3d9e60cf0f2f9039e2"
        />
        <span className="hint">
          This is the raw 32-byte key the agent signs with, not its G... strkey form. The SDK derives
          it from the agent keypair.
        </span>
      </label>
      <div className="row">
        <button
          disabled={!wallet || agentPubkey.trim().length === 0}
          onClick={() => void initialize(outcome?.guard ?? "")}
        >
          Sign and initialize
        </button>
      </div>

      {initResult && (
        <div className={initResult.kind === "submitted" ? "notice info" : "error"}>
          <strong>
            {initResult.kind === "submitted"
              ? "initialize landed on chain"
              : initResult.kind === "refused"
                ? "initialize was refused before broadcast"
                : "initialize was broadcast and rejected"}
          </strong>
          {initResult.kind === "submitted" ? (
            <span className="tiny">
              {starLink(initResult.hash)} - ledger {initResult.ledger ?? "-"}
            </span>
          ) : (
            <span className="tiny mono">{initResult.detail}</span>
          )}
        </div>
      )}
    </div>
  );
}
