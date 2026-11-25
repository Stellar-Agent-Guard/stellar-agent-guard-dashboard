# Artifact Pin Change Checklist

> **WARNING:** Changing the pinned WASM identity affects deployment trust and requires coordinated, evidence-backed review. This checklist must be completed fully before any PR that modifies the pinned artifact is merged.

## 1. Source Revision

- [ ] Identify the exact source revision (commit SHA) of the `stellar-agent-guard-sdk` that produces the new WASM artifact.
- [ ] Record the SDK commit hash and tag/version in the PR description.
- [ ] Verify the SDK commit has not been altered since the original pin was established (compare against the Phase 1 proof record).

## 2. Hash and Byte Length Verification

- [ ] Fetch the new artifact's bytes from the declared artifact source contract ID.
- [ ] Compute the SHA-256 hash of the fetched bytes.
- [ ] Confirm the hash matches the expected `wasmHash` constant (or document the new hash value if this is a deliberate pin change).
- [ ] Confirm the byte length (`wasmBytes`) matches the expected value.
- [ ] Run `verifyGuardWasm()` from the SDK to double-check the hash/bytecode integrity.

## 3. Test Evidence

- [ ] Run the existing artifact pin E2E test suite (`tests/e2e/artifactPin.spec.ts`) and confirm all tests pass with the new artifact.
- [ ] Add a unit test that verifies `checkArtifact` rejects a mismatched hash and a mismatched byte length.
- [ ] Add a test case for the "re-check" flow: verify that after a valid artifact is served, the deploy is re-enabled without a page reload.
- [ ] Document the test results, including any fixture changes or mock adjustments.

## 4. Documentation Updates

- [ ] Update `lib/guard/network.ts` `PHASE1_ARTIFACT` constant if the hash/byte length changed (bump SDK dependency otherwise).
- [ ] Update `docs/readme-claims.md` row 15 (Pinned bytecode hash) if the hash changed.
- [ ] Update `SPEC.md` if the enforcement boundary statement changes.
- [ ] Update any screenshots or inline examples in `docs/guides/` that reference the artifact hash or byte length.
- [ ] Run the scope statement test (`tests/unit/scopeStatement.test.ts`) to confirm no drift.

## 5. Independent Approval

- [ ] Tag at least one maintainer (e.g., `@aigbagbobila`) for review in the PR.
- [ ] Ensure the PR description includes all checklist items filled out with evidence (hashes, test output, links).
- [ ] No secrets (wallet keys, secrets) may be committed or exposed in the PR — the dashboard is client-side and non-custodial.

## 6. Secrets & Deployment Safety

- [ ] Confirm no secret material (private keys, secrets) is included in the change.
- [ ] Verify that `NEXT_PUBLIC_*` environment variables are not exposed or altered in a way that changes the deployed artifact.
- [ ] The deploy flow must still refuse any bytecode that does not match the pinned hash and byte length (enforced in `scripts/deploy-local.ts` and the UI).

---

### How to Use This Checklist

1. Copy this file into your PR branch.
2. Fill out every item — partial checklists will be returned for completion.
3. Reference this checklist in your PR description with a link to the checked file.
4. A maintainer will review the completed checklist before merging.

### Rationale

- The pinned artifact is the **single source of trust** for what bytecode gets deployed. Changing it without rigorous verification undermines the entire security model.
- The dashboard is **client-side only** and **non-custodial** — it holds no keys and never signs on behalf of the operator. All writes are signed by the operator's own wallet.
- Live chain reads are **authoritative**: the deploy flow fetches bytes from the network and refuses to proceed if the hash/length do not match. Failures are surfaced explicitly, never silently fallback.
