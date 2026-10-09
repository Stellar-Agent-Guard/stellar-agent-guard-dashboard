import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { SECURITY_POLICY_URL, UNAUDITED_DISCLOSURE } from "../../lib/guard/auditDisclosure.ts";

/**
 * The unaudited-tooling disclosure, in the interface and in the README.
 *
 * Same shape as `scopeStatement.test.ts`, and for the same reason: a security
 * disclosure is worth exactly as much as its consistency. A deploy panel that
 * says "do not deploy to mainnet without an audit" while the README says
 * something softer is worse than either, because an operator who read only one
 * of them has been told something the other does not support.
 *
 * The disclosure is *displayed*, not enforced — nothing in the deploy path
 * consults it. The last test here is the one that keeps that honest.
 */
const REQUIRED =
  "This is unaudited security tooling that gates real fund access. Do not deploy to mainnet " +
  "without an independent audit.";

test("the canonical disclosure is the required wording, word for word", () => {
  assert.equal(UNAUDITED_DISCLOSURE, REQUIRED);
});

test("the disclosure names the audit requirement, not just the risk", () => {
  // "Unaudited" alone is a mood; the actionable half is what to do about it,
  // and it is the half an operator can actually follow.
  assert.match(UNAUDITED_DISCLOSURE, /unaudited/i);
  assert.match(UNAUDITED_DISCLOSURE, /mainnet/i);
  assert.match(UNAUDITED_DISCLOSURE, /independent audit/i);
});

test("README carries the same disclosure as the code", () => {
  // Normalised the same way as the scope statement: whitespace collapsed,
  // markdown emphasis stripped. Backticks are kept, because this project's
  // README formats code spans inside security wording deliberately.
  const normalise = (text: string): string => text.replace(/\*/g, "").replace(/\s+/g, " ").trim();
  const content = normalise(readFileSync("README.md", "utf8"));
  assert.ok(
    content.includes(normalise(REQUIRED)),
    "README.md must contain the unaudited-tooling disclosure the deploy panel shows",
  );
});

test("the security policy the panel links to is the contracts repo's", () => {
  // The disclosure has to point somewhere. A link to this repo's own docs would
  // be the wrong target: the contracts repo holds the audit surface and the
  // disclosure channel for a finding about the guard itself.
  assert.match(SECURITY_POLICY_URL, /^https:\/\/github\.com\//);
  assert.match(SECURITY_POLICY_URL, /stellar-agent-guard-contracts/);
  assert.match(SECURITY_POLICY_URL, /SECURITY\.md$/);
});

test("the disclosure is documentation, not a deploy gate", () => {
  // The change adds a warning to the deploy surface; it must not have quietly
  // become a control. If a future edit makes the disclosure conditional on
  // something, or a panel refuses to render without it, this fails and the
  // behaviour change gets decided rather than inherited.
  const panel = readFileSync("components/DeployPanel.tsx", "utf8");
  assert.equal(
    /if\s*\([^)]*UNAUDITED_DISCLOSURE/.test(panel),
    false,
    "the disclosure must be rendered unconditionally, never branched on",
  );
  assert.equal(
    /disabled=\{[^}]*UNAUDITED_DISCLOSURE/.test(panel),
    false,
    "the disclosure must not gate any control's disabled state",
  );
});
