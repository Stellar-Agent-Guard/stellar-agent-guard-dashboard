"use client";

import { useMemo, useState } from "react";
import { useGuard } from "./GuardProvider.tsx";
import { ErrorBlock, starLink } from "./bits.tsx";
import { TransactionBuilder } from "@stellar/stellar-sdk";
import { NETWORK } from "../lib/guard/network.ts";
import { announce } from "../lib/guard/useAnnounce.ts";
import { usePwaActivity } from "../lib/guard/usePwaActivity.ts";
import { inspectSignedEnvelope } from "../lib/guard/submit.ts";

export function SubmitSignedXDRPanel() {
  const { server } = useGuard();
  const [xdr, setXdr] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successHash, setSuccessHash] = useState<string | null>(null);
  // A pending write is work an app-shell update must not interrupt (#398).
  usePwaActivity(busy, "write");

  const inspection = useMemo(
    () => inspectSignedEnvelope(xdr.trim(), NETWORK.passphrase),
    [xdr],
  );

  async function submit() {
    if (!inspection.canSubmit) {
      setError("Cannot submit: envelope validation or network check failed.");
      return;
    }
    setBusy(true);
    setError(null);
    setSuccessHash(null);
    try {
      const tx = TransactionBuilder.fromXDR(xdr.trim(), NETWORK.passphrase);
      const response = await server.sendTransaction(tx as any);
      if (response.status === "ERROR") {
        throw new Error(JSON.stringify(response.errorResult || response));
      }
      setSuccessHash(response.hash);
      announce("Externally signed transaction submitted to network");
      setXdr("");
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
        Broadcast an externally assembled and signed transaction envelope. Inspect its network
        binding, source, operation types, and context before broadcast.
      </p>
      <textarea
        value={xdr}
        onChange={(e) => setXdr(e.target.value)}
        placeholder="Paste signed transaction XDR here (base64)"
        style={{ width: "100%", height: "80px", marginBottom: "12px", fontFamily: "monospace" }}
        aria-label="Signed transaction XDR"
      />

      {xdr.trim().length > 0 && (
        <div
          className="review-box"
          style={{
            marginBottom: "16px",
            padding: "12px",
            border: "1px solid var(--border-subtle, #333)",
            borderRadius: "6px",
          }}
          data-testid="signed-xdr-review"
        >
          <div className="row" style={{ gap: "8px", flexWrap: "wrap", marginBottom: "8px" }}>
            {inspection.networkMatch ? (
              <span className="pill ok" data-testid="network-match-badge">
                Network: Verified match ({NETWORK.name})
              </span>
            ) : (
              <span className="pill danger" data-testid="network-mismatch-badge">
                Network mismatch: {inspection.detectedNetwork ? `Signed for ${inspection.detectedNetwork}` : "Does not match current network"}
              </span>
            )}

            {inspection.timeBounds?.expired ? (
              <span className="pill danger" data-testid="expired-badge">
                Expired (maxTime: {inspection.timeBounds.maxTime})
              </span>
            ) : inspection.timeBounds?.maxTime ? (
              <span className="pill ok" data-testid="valid-time-badge">
                Valid timebounds
              </span>
            ) : null}

            <span className="pill info" data-testid="signatures-badge">
              {inspection.signaturesCount} signature{inspection.signaturesCount === 1 ? "" : "s"}
            </span>
          </div>

          {inspection.verifiedFields.length > 0 && (
            <div style={{ marginTop: "8px" }}>
              <div className="tiny muted">
                <strong>Verified fields:</strong>
              </div>
              <ul style={{ margin: "4px 0", paddingLeft: "20px" }}>
                {inspection.verifiedFields.map((field, idx) => (
                  <li key={idx} className="tiny mono">
                    {field}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {inspection.unsupportedFields.length > 0 && (
            <div className="notice danger" style={{ marginTop: "8px", padding: "8px" }}>
              <div className="tiny">
                <strong>Unsupported fields (submission blocked):</strong>
              </div>
              <ul style={{ margin: "4px 0", paddingLeft: "20px" }}>
                {inspection.unsupportedFields.map((field, idx) => (
                  <li key={idx} className="tiny mono">
                    {field}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {inspection.blockReasons.length > 0 && (
            <div style={{ marginTop: "8px" }}>
              <ErrorBlock
                title="Submission blocked before broadcast"
                detail={inspection.blockReasons.join(" · ")}
              />
            </div>
          )}
        </div>
      )}

      <div className="row">
        <button disabled={busy || !inspection.canSubmit} onClick={submit}>
          {busy ? "Submitting..." : "Submit to Network"}
        </button>
      </div>
      {error && <ErrorBlock title="Submission failed" detail={error} />}
      {successHash && (
        <div className="notice info" style={{ marginTop: "16px" }}>
          <strong>Transaction submitted — {starLink(successHash)}</strong>
        </div>
      )}
    </div>
  );
}
