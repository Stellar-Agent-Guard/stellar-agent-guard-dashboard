# Runbook — Migrating to a Different Soroban RPC Endpoint

**Audience:** the operator or maintainer moving the console's **reads and broadcasts** to another
Soroban RPC provider — a new vendor, a dedicated node, a proxy, or a local sandbox.
**Applies to:** a build of this dashboard that talks to a Stellar network through
`NEXT_PUBLIC_RPC_URL`.
**Related:** [Architecture](../architecture.md) · [Client-side Freighter architecture](../concepts/client-side-freighter-architecture.md) ·
[No mock state](../concepts/no-mock-state.md) · [Emergency freeze runbook](./emergency-freeze.md) ·
[Lost browser profile recovery](./lost-browser-profile.md)

> **Read section 1 before changing anything.** The endpoint is not the network. Moving to another
> provider on the same chain changes _where the console asks_; moving to another chain changes
> _which contracts exist_, and no address, key or policy carries over.

---

## 1. Endpoint vs network — two different migrations

|                                  | **Endpoint migration** (the usual case)                       | **Network migration** (testnet → another chain)                                             |
| -------------------------------- | ------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| What changes                     | `NEXT_PUBLIC_RPC_URL` (host, provider, proxy)                 | `NEXT_PUBLIC_RPC_URL` **and** `NEXT_PUBLIC_NETWORK_PASSPHRASE` / `NEXT_PUBLIC_NETWORK_NAME` |
| Guard addresses                  | Unchanged — the same contracts on the same ledger             | **Different.** A `C…` address from testnet is not a guard on the new chain.                 |
| Policies, freeze state, balances | Unchanged — the same on-chain state                           | **Do not exist** for those addresses on the new chain.                                      |
| Wallet                           | Unchanged; the wallet's network passphrase must already match | Must be switched in the wallet; the console refuses the mismatch at connect time.           |
| Artifact pin                     | Unchanged; the source instance is still on this chain         | Must be re-established: the pinned bytes have to be readable on the new chain.              |
| Rollback                         | Point the env var back and rebuild; reads are unaffected      | Pointing back returns to the old chain, but writes made on the new chain stay there.        |
| Risk                             | Availability, latency, event retention, provider behaviour    | Addresses, keys, policies and evidence are **not portable**.                                |

The dashboard's identity for a chain is the **passphrase**, not the URL. Two providers on the same
network return the same ledger; two providers on different networks can both answer `getHealth`
successfully while holding completely different state. That is why the console checks the wallet's
passphrase against `NEXT_PUBLIC_NETWORK_PASSPHRASE` and refuses to proceed on a mismatch.

---

## 2. How this console is configured (there is no in-app endpoint switcher)

The endpoint is compiled in:

| Variable                                  | Purpose                                                 | Default                               |
| ----------------------------------------- | ------------------------------------------------------- | ------------------------------------- |
| `NEXT_PUBLIC_RPC_URL`                     | the endpoint every read and broadcast goes to           | `https://soroban-testnet.stellar.org` |
| `NEXT_PUBLIC_NETWORK_PASSPHRASE`          | the chain transactions and auth entries are signed for  | `Test SDF Network ; September 2015`   |
| `NEXT_PUBLIC_NETWORK_NAME`                | the human name shown in the UI and the mismatch message | `testnet`                             |
| `NEXT_PUBLIC_ARTIFACT_SOURCE_CONTRACT_ID` | the instance the pinned bytecode is read from           | Phase 1's testnet instance            |
| `NEXT_PUBLIC_GUARD_CONTRACT_ID`           | the guard a local sandbox build opens on                | unset                                 |

All are `NEXT_PUBLIC_*` values, inlined at **build time**. Consequences:

- Editing `.env.local` on a running server does **not** move the endpoint; rebuild and restart.
- A deployment must rebuild with the new values — restarting the same image is not enough.
- There is no runtime "custom RPC" field, and no in-app multi-endpoint failover. (`lib/guard/rpcPool.ts`
  is a tested helper, but the console does not wire it to the request path.) If you need a stable
  URL across providers, put a proxy in front and keep the console's URL unchanged.
- The endpoint is a public value. **Never** put an API token or other secret in the URL: it would be
  embedded in the client bundle.

---

## 3. Pre-checks — before you change a single variable

### 3a. Capture the baseline (rollback and comparison evidence)

Do this against the current endpoint while it is still live:

```bash
export GUARD=C…YOUR_GUARD
npm run inspect -- --guard "$GUARD" --json > baseline-inspect.json
stellar contract invoke --id "$GUARD" --source "$ADMIN_IDENTITY" --network testnet -- status
stellar contract invoke --id "$GUARD" --source "$ADMIN_IDENTITY" --network testnet -- policy
stellar contract invoke --id "$GUARD" --source "$ADMIN_IDENTITY" --network testnet -- window
```

In the console, also record:

- the endpoint origin shown in the WalletBar's **RPC endpoint health** panel;
- the guard address and its label, the network pill, and the artifact-identity result;
- the telemetry feed's last successful poll, latest ledger and current cursor position (if shown);
- the **Policy in force** line and the current `admin_frozen` / `heartbeat_expired` state.

A migration without a baseline is not verifiable — the new endpoint can only be checked against
something you wrote down.

### 3b. Probe the new endpoint from the same browser context

```bash
NEW_RPC=https://your-new-endpoint.example

curl -sS -X POST "$NEW_RPC" \
  -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"getHealth"}'

curl -sS -X POST "$NEW_RPC" \
  -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"getNetwork"}'
```

Requirements:

- [ ] `getHealth` reports `"status": "healthy"` (or the provider's documented equivalent).
- [ ] `getNetwork` returns the **exact** passphrase you intend to configure, character for
      character. Compare it to the baseline, not to a vendor's marketing name.
- [ ] `getLatestLedger` returns a ledger number within a normal drift of the current one. A node
      that is hours behind will answer every read, just with stale state.
- [ ] The endpoint sends permissive **CORS** headers for the console's origin. A browser-only app
      cannot proxy around a missing `Access-Control-Allow-Origin`; the request fails before RPC.
- [ ] TLS is valid for the hostname. Do not disable verification to make a migration work.
- [ ] `getEvents`, `getLedgerEntries`, `simulateTransaction` and (for writes) `sendTransaction` are
      all served. A read-only provider that passes `getHealth` still breaks the telemetry feed,
      deploy verification and the write pipeline.
- [ ] The provider's **event retention window** covers the incident/history you need. Events are not
      archived by this console, and a fresh provider cannot return events outside its window.
- [ ] Rate limits and timeouts are acceptable for the console's polling cadence. `429` responses are
      surfaced as read failures, not silently retried forever.

### 3c. Confirm you are not touching a guard's authority

The endpoint is where requests are sent; it never gains the ability to sign. The admin key stays in
the wallet and the agent key stays in the agent runtime. Do not add a server proxy that terminates
or holds secrets: the console has no API route, no server signing, and no secret-key persistence,
and this migration must not become the first one.

---

## 4. Identity confirmation — the check that catches a wrong chain

Before trusting reads from the new endpoint, confirm **all** of these:

1. **Guard address** — character-for-character against the baseline. There is no fuzzy matching,
   and a valid-looking `C…` can be a different contract.
2. **Network** — the pill and the wallet-bar network check. The wallet passphrase must equal
   `NEXT_PUBLIC_NETWORK_PASSPHRASE`. A mismatch is refused at connect time; do not work around it
   by switching the env var to match a wallet you did not mean to use.
3. **Artifact identity** — `is Phase 1 artifact` must be `true` for a guard this console is expected
   to manage. If it reads `false`, the instance runs different bytecode: you are either on the wrong
   chain or looking at a different deployment.
4. **State equality** — `status()`, `policy()` and `window()` must match the baseline apart from
   legitimate time-based changes (`now`, heartbeat countdown, rolling-window decay). A policy that
   suddenly reads absent, or a guard that suddenly reads unfrozen, is an identity failure first,
   not good news.
5. **Endpoint reachability is not guard health** — the health panel's own caveat applies: a reachable
   provider says nothing about a guard's on-chain state.

---

## 5. Migration sequence

Do this in a maintenance window, with the agent either paused or in a state where a short read
interruption is acceptable. No write is required for an endpoint migration.

1. **Stage the config.** Set the new `NEXT_PUBLIC_RPC_URL`, and the matching passphrase/name, in a
   staging or preview build — not on the production host yet.
2. **Rebuild.** Run the normal gates (`npm run typecheck`, `npm test`, `npm run build`) so the
   change is a reviewed configuration diff, not an ad-hoc server edit.
3. **Verify the staging build** with section 6's checks. Only then cut over.
4. **Deploy/cut over** and open the console. Hard-reload if it is a PWA: the service worker may serve
   a cached shell, and the app's update notice is the signal that a new build is ready.
5. **Re-confirm identity** (section 4) and the artifact check.
6. **Re-run the read checks** (section 6): `status`, `policy`, `window`, deploy artifact fetch,
   telemetry poll health.
7. **Watch the telemetry feed** for one or more poll intervals. A brand-new provider plus a fresh
   page load starts a new cursor from the current ledger; an empty feed immediately after the switch
   is expected and is not evidence that no events ever occurred.
8. **Only then allow writes.** The first write after the cut-over should be benign and verified:
   submit it, record the hash, and re-read the state. If the write is ambiguous (timeout after
   `sendTransaction`), do not resend blindly — check the hash against the chain.
9. **Record the change**: old and new endpoint origins, passphrase, baseline and post-change reads,
   timestamps, and who approved it.

---

## 6. Post-change verification checklist

- [ ] The WalletBar health panel probes the **new** origin and reports it reachable.
- [ ] The network pill shows the intended network, and the wallet connects without a mismatch
      banner.
- [ ] `npm run inspect -- --guard C…YOUR_GUARD --json` matches the baseline for every time-independent
      field.
- [ ] `status()` reports the same freeze state and a live `last_heartbeat` as expected.
- [ ] `policy()` matches the baseline (or is knowingly absent / default-deny).
- [ ] `window()` shows the same accumulated spend, allowing for time-based decay.
- [ ] The artifact check reads `true` for a managed guard.
- [ ] The telemetry feed reaches `healthy` poll health, even if it delivers zero events.
- [ ] A read-only deploy verification (fetching and hashing the pinned bytes) succeeds.
- [ ] No read diagnostics were produced, or each one is understood and recorded.
- [ ] If a write was performed: its hash is included, its result was re-read from the chain, and it
      appears in the transaction history with the expected fee.
- [ ] Rollback is still available: the old endpoint and env values are recorded and were not deleted.

---

## 7. Cursors, gaps and event retention

The telemetry feed is cursor-based polling of `getEvents`. The cursor is held **in memory by the
open feed**, not persisted. After a migration:

- a fresh page starts from the new provider's current ledger, so events that occurred while the
  console was closed are not magically backfilled;
- a provider with a shorter retention window may not have older events at all;
- the feed's gap detection can report `cursor_regressed` or a ledger gap if a response moves
  backwards or skips retained history. Treat a gap as a stated limitation of the switch and record
  it — never as "there were no events".

If you need continuous history across the migration, export the event window **before** the switch
(see [Telemetry feed](../screens/telemetry-feed.md)) and keep it with the change record.

---

## 8. Rollback

An endpoint change is reversible for reads; a write is not undone by pointing back.

1. Restore the previous `NEXT_PUBLIC_RPC_URL`, passphrase and name.
2. Rebuild and redeploy. (Again: a restart alone does not change an inlined `NEXT_PUBLIC_*` value.)
3. Hard-reload the console and re-confirm identity against the baseline (section 4).
4. Re-check `status()`, `policy()` and `window()`. Rollback does not alter the chain, so a write
   confirmed before the rollback remains confirmed.
5. If any write was sent during the migrated window, verify its hash on the appropriate chain by
   block explorer or `stellar contract invoke`; the console's local transaction history is not a
   substitute for a chain read.

If the migration was actually a **network** change and you wrote anything there, rollback returns
you to the old chain but does not move those writes. Record the new chain's transactions separately;
they are a different ledger, not a rollback candidate.

---

## 9. Failure modes

| Symptom                                                        | Meaning                                                                                           | Safe next step                                                                                         |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| Wallet mismatch banner after the switch                        | Wallet passphrase differs from `NEXT_PUBLIC_NETWORK_PASSPHRASE`; often a different chain entirely | Do not change the env var to match the wallet. Decide which chain you intend, then fix both sides.     |
| Every read fails, health panel unreachable                     | DNS, TLS, CORS, or the endpoint is down                                                           | Probe with `curl` from the same machine; a browser-only CORS failure needs a provider/proxy change.    |
| Reads succeed but `policy()` is absent on a guard that had one | Wrong chain, wrong guard address, or a provider serving a stale/different ledger                  | Stop. Compare the guard address and passphrase to the baseline; do not reinstall the policy.           |
| Ledger numbers far behind the baseline                         | Node lag or a load balancer pinned to a stale backend                                             | Do not trust time-sensitive reads (DMS countdown, rolling window); roll back or wait for the provider. |
| Feed is empty right after the switch                           | New cursor starts at the current ledger; expected                                                 | Watch poll health; do not claim "no events". Export before the switch if history matters.              |
| Feed reports a cursor gap                                      | Provider retention or a response moving backwards                                                 | Record the gap, keep the pre-switch export, and verify critical events from the ledger directly.       |
| `429` / timeouts increase                                      | Provider rate limit or insufficient capacity for the console's polling cadence                    | Roll back to the previous endpoint; tune only with the provider's documented limits.                   |
| A write times out after `sendTransaction`                      | It may have reached the network; this is ambiguous, not failed                                    | Do not resend. Look up the hash / re-read the account state before retrying.                           |
| One tab still shows the old endpoint's data                    | Tabs are separate clients; only state broadcasts are synchronised, not configuration              | Reload every open tab after a cut-over; treat an old tab as stale evidence, never as the new endpoint. |

> ⚠️ This is unaudited security tooling that gates real fund access. Do not deploy to mainnet
> without an independent audit, and do not treat a provider migration as a security control
> change — the guard's enforcement lives on chain, not in the RPC provider.
