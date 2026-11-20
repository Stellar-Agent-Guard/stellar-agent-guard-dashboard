# Pull Request: chore(release): add maintainer checklist for changing pinned artifacts

## Issue
Closes #561

## Summary
This PR adds a maintainer checklist for changing pinned WASM artifacts, which affects deployment trust and requires coordinated, evidence-backed review.

## Changes

### 1. `docs/operations/artifact-pin-checklist.md` [NEW]
Comprehensive checklist defining the requirements for changing the pinned artifact:
- **Source Revision**: SDK commit SHA, tag/version, verification against Phase 1 proof record
- **Hash and Byte Length Verification**: Fetch bytes, compute SHA-256, confirm match with `wasmHash` and `wasmBytes`, run `verifyGuardWasm()`
- **Test Evidence**: Run E2E test suite, add unit tests for `checkArtifact` hash/length mismatch, test "re-check" flow
- **Documentation Updates**: `lib/guard/network.ts`, `docs/readme-claims.md`, `SPEC.md`, guide screenshots
- **Independent Approval**: Tag at least one maintainer, include checklist in PR description
- **Secrets & Deployment Safety**: No secret material, `NEXT_PUBLIC_*` not exposing artifact, deploy flow still enforces pin

### 2. `CONTRIBRIBUTING.md` [MODIFIED]
Added "Artifact Pin Changes" section requiring all PRs modifying the pinned artifact to complete the checklist. PRs not satisfying the checklist will be returned for completion.

### 3. `docs/architecture.md` [MODIFIED]
Added pinned artifact enforcement section documenting that the dashboard fetches WASM bytes from a pinned contract source and verifies hash/byte length before any deploy.

### 4. `tests/unit/artifactPin.test.ts` [NEW]
7 focused unit tests verifying:
- `verifyGuardWasm` rejects bytes with mismatched hash
- `PHASE1_ARTIFACT` structure validation (wasmHash/wasmBytes exist, correct types)
- Hash is valid SHA-256 (64 characters)
- Byte length is 39673 bytes (known pinned artifact size)
- ArtifactCheck type signature correctness
- Checklist completion requirement documentation
- CONTRIBUTING.md checklist reference

## How to Use This Checklist
1. Copy the checklist into your PR branch
2. Fill out every item with evidence (hashes, test output, links)
3. Reference the checklist in your PR description
4. A maintainer will review completed checklist before merging

## Rationale
- The pinned artifact is the single source of trust for deployed bytecode
- The dashboard is client-side only and non-custodial (holds no keys)
- Live chain reads are authoritative; deploy flow refuses mismatched bytecode
- Failures are surfaced explicitly, never silently fallback

## Checklist (fill these in PR description)
- [ ] Source revision documented (SDK commit SHA)
- [ ] Hash and byte length verified against fetched artifact
- [ ] E2E tests pass with new artifact
- [ ] Unit tests added for hash/length mismatch and re-check flow
- [ ] Documentation updated (network.ts, readme-claims.md, SPEC.md)
- [ ] Maintainer tagged for review
- [ ] No secrets exposed in change

## Type Check
Run `npm run typecheck` to verify no TypeScript errors.

## Local Gates
Run `npm ci && npm run test` to verify all unit tests pass before pushing.