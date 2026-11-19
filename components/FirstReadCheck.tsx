"use client";

/**
 * First-read verification before deployment (issue #522).
 *
 * Three read-only checks — endpoint, wallet, admin account — each with its own
 * outcome. They run only when the operator asks, gate nothing, and never ask
 * the wallet for a signature: the logic is in `lib/guard/firstRead.ts`, which
 * receives no signer at all.
 */

import { useState } from "react";
import { useGuard } from "./GuardProvider.tsx";
import { NETWORK } from "../lib/guard/network.ts";
import { isDemoMode } from "../lib/guard/demoFixtures.ts";
import {
  FIRST_READ_CHECKS,
  runFirstReadChecks,
  type FirstReadOutcome,
  type FirstReadServer,
} from "../lib/guard/firstRead.ts";

const STATE_TEXT: Record<FirstReadOutcome["state"], string> = {
  pass: "Pass",
  fail: "Failed",
  skipped: "Skipped",
};
const STATE_CLASS: Record<FirstReadOutcome["state"], string> = {
  pass: "done",
  fail: "error",
  skipped: "pending",
};

export function FirstReadCheck() {
  const { server, wallet, networkMismatch } = useGuard();
  const [result, setResult] = useState<{
    forAddress: string | null;
    outcomes: FirstReadOutcome[];
  } | null>(null);
  const [running, setRunning] = useState(false);

  // Outcomes describe the wallet they were read with; a different wallet needs a new run.
  const current = wallet?.address ?? null;
  const outcomes = result && result.forAddress === current ? result.outcomes : null;

  async function run() {
    setRunning(true);
    try {
      const next = await runFirstReadChecks({
        server: server as unknown as FirstReadServer,
        network: NETWORK,
        wallet,
        networkMismatch,
        demo: isDemoMode(),
      });
      setResult({ forAddress: current, outcomes: next });
    } finally {
      setRunning(false);
    }
  }

  return (
    <section data-testid="first-read-check" aria-label="First-read verification">
      <div className="row" style={{ justifyContent: "space-between" }}>
        <strong>Before you deploy: first-read checks</strong>
        <button className="secondary" onClick={() => void run()} disabled={running}>
          {running ? "Reading… (read-only)" : "Run read-only checks"}
        </button>
      </div>
      <p className="tiny muted" style={{ marginTop: 4 }}>
        Confirms the endpoint, wallet and admin account for {NETWORK.name}. Each check is a read
        with its own result; none asks for a signature, and none blocks observing or deploying.
      </p>
      <ul className="setup-steps" data-testid="first-read-outcomes">
        {FIRST_READ_CHECKS.map((check) => {
          const found = outcomes?.find((candidate) => candidate.id === check.id) ?? null;
          return (
            <li
              key={check.id}
              data-check={check.id}
              data-state={found?.state ?? "not-run"}
              className="setup-step"
            >
              <span className={`setup-status ${found ? STATE_CLASS[found.state] : "pending"}`}>
                {found ? STATE_TEXT[found.state] : "Not run"}
              </span>
              {" — "}
              <span className="setup-label">{check.label}</span>
              {found && <span className="setup-detail tiny muted">{found.detail}</span>}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
