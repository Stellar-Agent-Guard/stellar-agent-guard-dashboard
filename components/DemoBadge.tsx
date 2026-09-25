"use client";

import { DEMO_BADGE_TEXT } from "../lib/guard/demoFixtures.ts";
import { useDemoMode } from "../lib/guard/useDemoMode.ts";

/**
 * The top-level badge that names demo data for what it is.
 *
 * It renders above the console on every screen while demo mode is active, and
 * nothing at all otherwise. Demo mode is read as external browser state (see
 * `useDemoMode`), so the server and the hydrating client agree on "off" and only
 * the browser can adopt `?demo=true` — which keeps the normal, non-demo page
 * byte-identical to before.
 */
export function DemoBadge() {
  const demo = useDemoMode();

  if (!demo) return null;

  return (
    <div className="demo-badge" role="status">
      <span className="pill warn">demo</span>
      <span>{DEMO_BADGE_TEXT}</span>
    </div>
  );
}
