"use client";

import { useState } from "react";
import { useGuard } from "./GuardProvider.tsx";
import { ErrorBlock, OutcomeList, starLink } from "./bits.tsx";
import { TransactionBuilder } from "@stellar/stellar-sdk";
import { NETWORK } from "../lib/guard/network.ts";
import { preflightSignedEnvelope, type SignedEnvelopePreflight } from "../lib/guard/submit.ts";
import { announce } from "../lib/guard/useAnnounce.ts";
import { usePwaActivity } from "../lib/guard/usePwaActivity.ts";

export function SubmitSignedXDRPanel() {
  const { server } = useGuard();
  const [xdr, setXdr] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successHash, setSuccessHash] = useState<string | null>(null);
  const [preflight, setPreflight] = useState<SignedEnvelopePreflight | null>(null);
  const [checkedEnvelope, setCheckedEnvelope] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  // A pending write is work an app-shell update must not interrupt (#398).
  usePwaActivity(busy, "write");

  async function checkEnvelope() {
    setChecking(true);
    setError(null);
    setPreflight(null);
    setCheckedEnvelope(null);
    try {
      const envelope = TransactionBuilder.fromXDR(xdr.trim(), NETWORK.passphrase);
      const result = await preflightSignedEnvelope(server, envelope);
      setPreflight(result);
      setCheckedEnvelope(xdr.trim());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setChecking(false);
    }
  }

  async function submit() {
    if (!preflight || checkedEnvelope !== xdr.trim()) {
      setError("Check this envelope against the latest account and ledger before submitting.");
      return;
    }
    setBusy(true);
    setError(null);
    setSuccessHash(null);
    try {
      const tx = TransactionBuilder.fromXDR(xdr.trim(), NETWORK.passphrase);
      // Wait, TransactionBuilder.fromXDR parses it. Then we submit it.
      const response = await server.sendTransaction(tx as any);
      if (response.status === "ERROR") {
        throw new Error(JSON.stringify(response.errorResult || response));
      }
      setSuccessHash(response.hash);
      announce("Externally signed transaction submitted to network");
      setXdr("");
      setPreflight(null);
      setCheckedEnvelope(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="panel">
      <h2>Submit Signed XDR</h2>
      <p className="tiny muted">
        Broadcast an externally assembled and signed transaction envelope. Use this for offline or
        multi-sig operations.
      </p>
      <textarea
        value={xdr}
        onChange={(e) => {
          setXdr(e.target.value);
          setPreflight(null);
          setCheckedEnvelope(null);
          setError(null);
        }}
        placeholder="Paste signed transaction XDR here (base64)"
        style={{ width: "100%", height: "80px", marginBottom: "12px", fontFamily: "monospace" }}
      />
      <div className="row">
        <button className="secondary" disabled={busy || checking || !xdr.trim()} onClick={() => void checkEnvelope()}>
          {checking ? "Checking latest ledger…" : "Check envelope"}
        </button>
        <button disabled={busy || checking || !xdr.trim() || checkedEnvelope !== xdr.trim()} onClick={() => void submit()}>
          {busy ? "Submitting..." : "Submit to Network"}
        </button>
      </div>
      {preflight && checkedEnvelope === xdr.trim() && (
        <div className="notice info" role="status" style={{ marginTop: 12 }}>
          <strong>Read-only preflight, checked {new Date(preflight.checkedAt).toLocaleString()}</strong>
          <span className="tiny">
            Sequence: {preflight.sequence.status.replaceAll("_", " ")} — {preflight.sequence.detail}
          </span>
          <span className="tiny">
            Expiration: {preflight.expiration.status.replaceAll("_", " ")} — {preflight.expiration.detail}
          </span>
          <span className="tiny muted">
            Advisory only. No envelope fields were changed; the network&apos;s final RPC response is authoritative.
          </span>
        </div>
      )}
      {error && <ErrorBlock title="Submission failed" detail={error} />}
      {successHash && (
        <div className="notice info" style={{ marginTop: "16px" }}>
          <strong>Transaction submitted — {starLink(successHash)}</strong>
        </div>
      )}
    </div>
  );
}
