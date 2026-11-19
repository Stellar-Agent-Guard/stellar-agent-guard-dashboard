# Large allowlists in the policy editor

Operators often paste or import long recipient and protocol lists. The policy
editor re-validates the whole draft on every edit, so validation latency at
realistic list sizes decides whether typing stays responsive.

## Measured sizes

`tests/unit/policyFormLargeAllowlist.test.ts` builds synthetic drafts with
checksummed `G…` recipients and `C…` protocol contracts. A tenth of the
protocols carry a per-function list. It times the two functions the form runs
on each edit, `validatePolicyDraftFields` and `buildPolicyConfig`, as the median
of five runs.

| Recipients | Protocols | Budget (CI) | Typical on a developer machine |
| ---------- | --------- | ----------- | ------------------------------ |
| 100        | 10        | 100 ms      | under 20 ms                    |
| 1,000      | 100       | 250 ms      | about 50 ms                    |
| 5,000      | 500       | 1,000 ms    | about 250 ms                   |

The budgets sit well above typical timings, so the test fails on a real
regression, such as a check that became quadratic, and not on a busy CI
runner. The suite also checks the results at scale: every entry is kept, and a
single malformed line among 5,000 is still reported.

## Guidance

- Lists of a few thousand entries edit comfortably. Beyond about 5,000, prefer
  `allow_any_recipient` with per-transaction and window caps over an
  exhaustive recipient list.
- Validation runs in the browser only and makes no RPC call. Nothing about list
  size changes what is sent to the chain until the policy is installed.

Run the benchmark with:

```bash
node --import tsx --test tests/unit/policyFormLargeAllowlist.test.ts
```
