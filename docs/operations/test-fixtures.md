# Updating shared test fixtures

The unit, E2E and perf suites share RPC captures, event descriptors, pinned bytecode and proof
records. They only help if their **provenance** stays clear (where each byte came from), their
**content** is safe to publish (nothing secret in them), and their **shape** keeps up with the SDK
vocabulary the console decodes. This page is the workflow for changing any of them.

Two rules from the rest of the project apply here too:

- **Live chain reads are authoritative.** A fixture is a recorded or derived answer, never a claim
  about the chain as it is now. A fixture that says something the chain would not say is a bug in
  the fixture, not a fact.
- **Failures are explicit.** If a refresh can't reproduce a field, record the gap (in the fixture's
  `note`/`_comment` or in [`tests/fixtures/README.md`](../../tests/fixtures/README.md)). Don't copy
  the old value forward.

## Kinds of fixture

| Kind        | Meaning                                                                                       | Who may change it                                                |
| ----------- | --------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| `captured`  | Bytes copied once from the public testnet RPC and frozen.                                     | A re-capture against testnet, with a new `capturedAt`.           |
| `generated` | Written by a repository script from a live run.                                               | Only the script. Hand edits are not allowed.                     |
| `pinned`    | Exact bytes whose hash is pinned in code (`PHASE1_ARTIFACT.wasmHash`).                        | Only together with the pin, in the same PR.                      |
| `mirrored`  | A hand-maintained copy of vocabulary the SDK owns.                                            | Whenever the SDK vocabulary changes, in the same PR as the bump. |
| `synthetic` | Built in code from the SDK's own types and encoders, deterministic, with no network or clock. | Freely, as long as the SDK still parses what they build.         |

## Inventory

`tests/unit/fixtureProvenance.test.ts` parses this table. Every file in `tests/fixtures/` must
have a row, every row's path and consumers must exist, and every consumer must actually reference
the fixture. Add or update the row in the same PR that adds, moves or re-sources a fixture.

<!-- fixture-inventory:start -->

| Fixture                                       | Kind      | Source                                                                                                                                                                                 | Consumers                                                                                                       | Focused check                                                                                  |
| --------------------------------------------- | --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `tests/fixtures/rpc-capture.json`             | captured  | One-time capture of `getLatestLedger` and the mock admin's account entry from `https://soroban-testnet.stellar.org`; `capturedAt`, `network` and `passphrase` are recorded in the file | `tests/e2e/sorobanRpcMock.ts`, `tests/e2e/walletMock.ts`                                                        | `npx playwright test tests/e2e/guardLifecycle.spec.ts`                                         |
| `tests/fixtures/phase1-artifact.wasm`         | pinned    | The Phase 1 guard bytecode, byte-identical to the on-chain artifact (SHA-256 `PHASE1_ARTIFACT.wasmHash` in `lib/guard/network.ts`)                                                     | `tests/e2e/sorobanRpcMock.ts`                                                                                   | `node --import tsx --test tests/unit/fixtureProvenance.test.ts`                                |
| `tests/fixtures/pinnedGuard.wasm`             | pinned    | Same bytes as `phase1-artifact.wasm`, served by the network-mismatch fixture router                                                                                                    | `tests/e2e/rpcFixtures.ts`                                                                                      | `node --import tsx --test tests/unit/rpcFixtures.test.ts`                                      |
| `tests/fixtures/phase3-proof.json`            | generated | `npm run prove:phase3` against testnet (`scripts/prove-phase3.ts`); `network`, `rpcUrl` and `ranAt` are recorded in the file                                                           | `scripts/prove-phase3.ts`, `lib/guard/proofRun.ts`, `tests/unit/proofRun.test.ts`, `tests/unit/timeago.test.ts` | `node --import tsx --test tests/unit/proofRun.test.ts`                                         |
| `tests/fixtures/phase3-proof.run.json`        | generated | `npm run prove:phase3:emit`, or the `buildRunRecord` projection of `phase3-proof.json` (see its `note`)                                                                                | `scripts/prove-phase3.ts`, `scripts/compare-proof-run.ts`, `tests/unit/proofRun.test.ts`                        | `npm run prove:phase3:diff`                                                                    |
| `tests/fixtures/auth-checked-vocabulary.json` | mirrored  | The `event_auth_checked` topic layout and the SDK's reason list (`GUARD_REASON_CODES` in `stellar-agent-guard-sdk`)                                                                    | `tests/unit/eventExport.test.ts`                                                                                | `node --import tsx --test tests/unit/fixtureProvenance.test.ts tests/unit/eventExport.test.ts` |
| `tests/mocks/sorobanFixtures.ts`              | synthetic | XDR builders over `@stellar/stellar-sdk` for the in-memory mock RPC                                                                                                                    | `tests/mocks/mockRpcServer.ts`, `tests/unit/mockRpcServer.test.ts`                                              | `node --import tsx --test tests/unit/mockRpcServer.test.ts`                                    |
| `tests/mocks/eventFixtures.ts`                | synthetic | Event descriptors keyed to `GUARD_EVENT_TOPICS`, with identities from the SDK's `guardEventId`                                                                                         | `tests/e2e/sorobanRpcMock.ts`, `tests/unit/telemetryFeed.test.ts`                                               | `node --import tsx --test tests/unit/telemetryFeed.test.ts`                                    |
| `tests/e2e/rpcFixtures.ts`                    | synthetic | JSON-RPC router for the network-mismatch E2E suite                                                                                                                                     | `tests/e2e/networkMismatch.spec.ts`, `tests/unit/rpcFixtures.test.ts`                                           | `node --import tsx --test tests/unit/rpcFixtures.test.ts`                                      |
| `lib/guard/demoFixtures.ts`                   | synthetic | Demo-mode data shaped against the SDK's `GuardStatus`, `PolicyConfig` and event types; reached only when demo mode is on                                                               | `lib/guard/useDemoMode.ts`, `tests/unit/demoFixtures.test.ts`                                                   | `node --import tsx --test tests/unit/demoFixtures.test.ts`                                     |

<!-- fixture-inventory:end -->

## Source: refreshing a fixture

1. **Find the row above.** Its kind tells you what's allowed:
   - **captured**: re-capture from the public testnet RPC with plain JSON-RPC calls (`getLatestLedger`,
     `getLedgerEntries`). Replace the whole file and update `capturedAt`. Never mix fields from two
     captures.
   - **generated**: run the script named in the Source column. For the Phase 3 proof, read
     [Re-running, and diffing a re-run against this record](../../tests/fixtures/README.md#re-running-and-diffing-a-re-run-against-this-record)
     first. That run spends testnet funds and is deliberately not part of the CI gate.
   - **pinned**: change the bytes only together with `PHASE1_ARTIFACT` in `lib/guard/network.ts`.
     If the hash test fails, the bytes are wrong, so don't "fix" it by re-pinning.
   - **mirrored**: copy the vocabulary from the installed SDK (see [Schema updates](#schema-updates-when-the-sdk-vocabulary-moves)).
   - **synthetic**: edit the builder. Keep it deterministic (no `Date.now()`, no `Math.random()`, no
     network access).
2. **Record provenance in the fixture itself** where the format allows it. Use `capturedAt` / `ranAt`,
   `network`, `passphrase` / `rpcUrl`, and a `_comment` or `note` that says what the file is.
3. **Don't run Prettier on `tests/fixtures/`.** It is listed in `.prettierignore` because the
   bytes are compared against hashes and recorded runs.

## Redaction

Fixtures are committed and public, so they may only contain **public testnet data**:

- **Never commit a secret seed** (`S…`). The provenance test scans `tests/fixtures/`, `tests/mocks/`,
  `tests/e2e/` and `lib/guard/demoFixtures.ts` for checksummed Stellar secret seeds and fails if it
  finds one. Public keys (`G…`), contract ids (`C…`), hashes and XDR are fine.
- **Never commit `.env.phase3`** or any other file that the proof script writes keys into. It is
  gitignored. Keep it that way.
- **Testnet only.** A captured or generated fixture must record the testnet passphrase
  (`Test SDF Network ; September 2015`). Never capture from mainnet, a private RPC, or an endpoint
  that needs an API key in its URL.
- **No personal or operator data.** Strip local paths, usernames, email addresses and anything copied
  from a wallet UI. Prefer fixed throwaway addresses that are already in the repository.
- **Keep what a test needs, and nothing more.** If a field is only there because the capture
  returned it, drop it, unless the SDK needs it to parse the response.

## Schema updates when the SDK vocabulary moves

`stellar-agent-guard-sdk` owns the event topics (`GUARD_EVENT_TOPICS`) and the reason symbols
(`GUARD_REASON_CODES`). Contract and SDK behavior changes belong in those repositories. This
dashboard only follows them. When an SDK bump adds, renames or removes vocabulary:

1. Bump the SDK and commit the lockfile diff in the same PR (see the
   [lockfile ride-along rule](../../CONTRIBUTING.md#lockfile-ride-along-rule)).
2. Run the provenance test. It compares `auth-checked-vocabulary.json`'s `known_reasons` with the
   SDK's `GUARD_REASON_CODES` in both directions, and lists exactly which reasons are missing or
   unknown.
3. Update `known_reasons` and `reason_explanations` together. Every known reason needs an
   explanation.
4. Update the synthetic builders that enumerate the vocabulary (`tests/mocks/eventFixtures.ts`,
   `lib/guard/demoFixtures.ts`) and run their focused checks from the inventory.
5. If a **captured** or **generated** fixture no longer parses under the new SDK, re-capture or
   re-run it. Don't hand-edit XDR or proof JSON to match the new shape.

## Focused commands

```bash
# Inventory, redaction scan, provenance fields, pinned hash, vocabulary drift
node --import tsx --test tests/unit/fixtureProvenance.test.ts

# A single fixture's consumer (use the inventory's "Focused check" column)
node --import tsx --test tests/unit/rpcFixtures.test.ts
node --import tsx --test tests/unit/proofRun.test.ts tests/unit/eventExport.test.ts

# Phase 3 proof: re-run live and diff (spends testnet funds; not in the CI gate)
npm run prove:phase3:emit
npm run prove:phase3:diff

# Browser suites that serve the captured and pinned fixtures
npm run test:e2e

# The whole unit suite, and the doc link check for this page
npm test
npm run test:docs
```
