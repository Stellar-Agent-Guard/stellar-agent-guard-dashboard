"use client";

import { DEMO_BADGE_TEXT } from "../lib/guard/demoFixtures.ts";
import { useDemoMode } from "../lib/guard/useDemoMode.ts";
import { NETWORK } from "../lib/guard/network.ts";

/**
 * The top-level provenance badge that keeps live versus demo status visible in all views.
 *
 * Renders prominently across routes and print views, ensuring operators always
 * know whether data is an authoritative live chain read or offline demo fixtures.
 */
export function DemoBadge() {
  const demo = useDemoMode();

  if (demo) {
    return (
      <div
        className="demo-badge mode-indicator demo"
        role="status"
        data-testid="mode-indicator"
        data-mode="demo"
      >
        <span className="pill warn">demo</span>
        <span>{DEMO_BADGE_TEXT} — Writes Disabled</span>
      </div>
    );
  }

  return (
    <div
      className="mode-indicator live"
      role="status"
      data-testid="mode-indicator"
      data-mode="live"
      style={{
        display: "flex",
        alignItems: "center",
        gap: "8px",
        padding: "4px 10px",
        marginBottom: "12px",
        borderRadius: "6px",
        background: "var(--surface-subtle, rgba(255,255,255,0.03))",
        border: "1px solid var(--border-subtle, rgba(255,255,255,0.1))",
        fontSize: "12px",
      }}
    >
      <span className="pill info tiny">LIVE CHAIN</span>
      <span className="tiny muted">
        {NETWORK.name} — Authoritative on-chain reads
      </span>
    </div>
  );
}
