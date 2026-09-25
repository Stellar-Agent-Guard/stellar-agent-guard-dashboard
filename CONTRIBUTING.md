# Contributing

`stellar-agent-guard-dashboard` is the operator console: a pure client-side Next.js app
that holds no keys and runs no server code, so most changes are UI, client-side Soroban
RPC, or tests.

## Shared conventions

Commit style, the one-commit-per-logical-unit **per file** rule, the branch lifecycle
(feature branch → PR → delete after merge, `main` only), and the issue label taxonomy are
defined once for this org in the
[`stellar-agent-guard-sdk` CONTRIBUTING.md](https://github.com/aigbagbobila/stellar-agent-guard-sdk/blob/main/CONTRIBUTING.md).
Read that first; this page only adds what is specific to the dashboard.

## Local gates before pushing

```bash
npm ci
npm run typecheck   # tsc --noEmit
npm run lint        # eslint
npm test            # node --test (unit suite)
npm run build       # Next.js production build
```

Two extra scripts are not part of the CI gate:

- `npm run prove:phase3` — re-runs the live testnet proof against the real deployed
  contract; needs funded testnet keypairs.
- `npm run inspect` — read-only dump of a deployed instance's on-chain state.

## Branch protection and CI

`main` is protected by the `main-protection` ruleset, and the required status check is
named exactly **`ci`**. The `ci` workflow runs typecheck, lint, the unit tests, the
production build, and a dedicated step that re-checks the enforcement-scope statement in
`README.md` and `SPEC.md` against the canonical constant in `lib/guard/network.ts`
(`tests/unit/scopeStatement.test.ts`). Rewording the boundary fails CI, which is the
point — see [Enforcement scope](README.md#enforcement-scope--read-this-before-relying-on-the-caps).

## Issues

- Backlog: <https://github.com/aigbagbobila/stellar-agent-guard-dashboard/issues>
- The org-wide `tier:` / `scope:` label taxonomy is described in the shared
  CONTRIBUTING.md linked above; this repo's scope label is `scope:dashboard`.

## CI: e2e and visual jobs

- This repository now runs Playwright-based end-to-end (`e2e`) and visual test
  jobs in CI. They are configured to run on `ubuntu-latest` using `chromium` and
  to upload traces, screenshots and test results when failures occur. The CI
  jobs run on every push and PR, but they are intentionally not a required
  branch-protection check by default: maintainers should enable the required
  status after the suite demonstrates stability (recommended: three
  consecutive green CI runs) as described in issue #43.

- To update visual baselines locally run:

```bash
npm run test:visual:update
```

- CI uses `npx playwright install --with-deps chromium` to install browser
  dependencies (Playwright CI guidance). Artifacts retained on failure are
  uploaded and kept for 7 days for triage.

If you're claiming issue #43, open a PR from a branch named
`feat(tests)/ci-e2e-visual-jobs-in-github-actions-post-harness-stabilization`,
reference the issue in the PR body (`Closes #43`), and ask a maintainer to
flip the required status after three consecutive green runs.
