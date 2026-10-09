/**
 * The one wording of the unaudited-tooling disclosure (issue: cross-network
 * address confusion).
 *
 * The deploy surface puts real bytecode in front of real funds, and the README
 * already says so in one sentence. Re-typing that sentence into a component
 * would give the interface a second, drifting copy of a security disclosure —
 * the exact failure `ENFORCEMENT_SCOPE_STATEMENT` and its drift guard exist to
 * prevent, so this wording lives in one place and
 * `tests/unit/auditDisclosure.test.ts` checks the README still carries it
 * verbatim.
 *
 * It is a *disclosure*, not a control. Nothing here blocks a deploy: whether a
 * write may be signed is decided by the wallet/network guard and by the
 * artifact-identity check, and a display-side warning that quietly stopped a
 * write would be a flow-blocking change wearing a label it does not earn. What
 * this does is make the risk legible at the moment an operator is about to
 * deploy, which is the only place a disclosure is still able to inform a
 * decision.
 */

export const UNAUDITED_DISCLOSURE =
  "This is unaudited security tooling that gates real fund access. Do not deploy to mainnet without an independent audit.";

/** Where the full security policy and disclosure channel live. */
export const SECURITY_POLICY_URL =
  "https://github.com/aigbagbobila/stellar-agent-guard-contracts/blob/main/SECURITY.md";
