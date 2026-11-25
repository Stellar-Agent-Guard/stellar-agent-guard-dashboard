# Overview Screen (`/`)

The primary console screen provides full visibility into the active guard account:

- **Wallet Header**: Displays the connected wallet address, the target network, and quick-disconnect. **Wallet diagnostics** opens a prompt-free view of the selected provider, the connected address, both networks and the capabilities this browser reports ([wallet diagnostics](wallet-diagnostics.md)).
- **Account Summary**: Shows the guard custom account address, its rolling spend window, and the installed policy.
- **Dead-Man Switch Status**: Displays the heartbeat grace remaining, derived from the ledger clock.
- **Panic Button**: Immediate access to the emergency freeze modal, which shows the [pre-signature authorization summary](authorization-summary.md) before it asks the wallet to sign.
- **Telemetry Feed**: Live scrolling feed of recent `event_auth_checked` authorization events.
- **Incident Actions**: The admin writes worth doing to this account in the state the chain reports,
  each with what it does and the confirmation the existing control asks for; anything not offered is
  listed with its reason rather than left out. Rows hand off to the control that performs the write —
  they focus it, never click it — and a separate block re-reads `status()` once, on demand, to answer
  whether the write landed. See
  [the incident action list](../../SPEC.md#the-incident-action-list-on-the-overview).
- **Refresh Strip**: One row, on the single line the site header sets aside for it, per panel that
  polls, stating its cadence, when its last round landed, and whether it is `polling`, `connecting`,
  `poll failing`, `no response` or `stopped`. The strip reads nothing itself — panels report their own
  liveness and withdraw it when they unmount — and a frozen display is shown as `display paused` beside
  the phase rather than in place of it. The line is reserved whether or not anything has published yet,
  so the panels below it never move when the first round lands; a strip with more rows than width
  scrolls sideways. Each row links to that panel's diagnostics. See
  [the read path](../../SPEC.md#where-the-console-says-when-it-last-read).

**Related:** [Enforcement scope](../enforcement-scope.md) ·
[Emergency freeze & incident response](../runbooks/emergency-freeze.md) ·
[Dual-freeze semantics](../concepts/dual-freeze-semantics.md) ·
[Telemetry feed](./telemetry-feed.md) ·
[Keyboard & screen-reader guide](../guides/keyboard-and-screen-reader.md)

---

## Reading the on-chain state panel

The **On-chain state** panel is a _reading_, not a guarantee. Each value on it
comes from a specific source, was read at a specific moment, and can fail
independently of the others. The panel links back to this section ("How to read
this panel"), to the [enforcement boundary](../enforcement-scope.md) ("What the
guard enforces"), and to the [incident runbook](../runbooks/emergency-freeze.md)
("Incident runbook").

Three rules apply to every signal below:

1. **Chain reads are authoritative; the console is not.** Every value is read
   from Soroban RPC. The console never stores, caches across sessions, or
   invents a value — a failed read is shown as a failure, never as an empty or
   zero value (see [No mock state](../concepts/no-mock-state.md)).
2. **A failed read is not a safe state.** "Read failed" means _unknown_. It does
   not mean "no policy", "not frozen", or "nothing happening".
3. **Fresh is not the same as enforced.** A green "clear" or "match" describes
   the contract's state. What that state actually enforces is bounded by the
   [enforcement scope](../enforcement-scope.md) — full amount/recipient limits
   apply to SAC token transfers; other contract calls are limited by window and
   pause state only.

### Where each signal comes from

| Signal                                 | Source                                                  | Written by                                     |
| -------------------------------------- | ------------------------------------------------------- | ---------------------------------------------- |
| Admin wallet (`connected`, address)    | The wallet extension in this browser                    | You, by connecting a wallet                    |
| Network (header pill, mismatch notice) | This console's configured target vs. the wallet's own   | Console build config; your wallet's settings   |
| Admin freeze                           | `status().admin_frozen` on the guard contract           | The panic button (`freeze()`) / `unfreeze()`   |
| Dead-man switch, Last heartbeat        | `status()` (`heartbeat_expired`, `last_heartbeat`)      | The agent's own `heartbeat()` — not the console |
| Policy installed / Policy in force     | `status().has_policy` and `policy()`                    | Admin-signed `set_policy()` / `revoke_policy()` |
| Rolling window, velocity               | The guard's on-chain rolling spend window               | The contract, on each settled spend            |
| Artifact identity                      | The ledger's reported Wasm hash and the fetched bytecode | The deployer; compared against the pinned artifact |
| Telemetry feed health                  | The console's event poll against Soroban RPC            | The console's poller in this tab               |

### Panel-level states

| What you see                                | What it means                                                                                                       | Safe next step                                                                                                                                         |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `read <time> ago` next to the heading       | The values shown came from the read at that time. Background refreshes keep the previous values until a new read lands. | None. Use **Refresh** if you need a reading from right now, e.g. before a write.                                                                        |
| Grey placeholder bars, panel busy           | The first read is in flight. No values exist yet — the placeholders are layout only, never zeros.                   | Wait for the read. If it does not resolve, check the **RPC endpoint health** notice under the wallet bar.                                                             |
| `stale since <time>`                        | No current snapshot is on screen; the time is the last refresh attempt.                                              | Press **Refresh**. Do not act on remembered values.                                                                                                     |
| `error state <time>` + "could not be read"  | The whole snapshot failed. **No values are shown on purpose**, because a failed read is not an empty policy.         | Press **Refresh**; check **Read diagnostics** and the RPC endpoint health. If you suspect an incident, follow the [incident runbook](../runbooks/emergency-freeze.md); if the console cannot reach RPC, its freeze button is disabled too, so use the runbook's CLI fallback. |
| `<label>: read failed` on one field + Retry | Only that read failed; other fields are still valid readings.                                                        | Use that field's **Retry** button. Treat the failed field as unknown, not as its "safe" value.                                                          |
| **Read diagnostics** section                | Copyable failure context (operation, endpoint, network). It never contains chain values.                            | Copy it into an issue or incident log.                                                                                                                  |
| Striped tint + `TRAINING / SIMULATION MODE` | A rehearsal is running. The simulated freeze/DMS values are **not** chain state.                                     | Stop the rehearsal before making any decision from the panel.                                                                                           |

### Wallet and network

| State                                       | Meaning                                                                                                   | Safe next step                                                                                         |
| ------------------------------------------- | --------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `connected` + address                       | A wallet in this browser shared its public address. The console holds no keys.                            | Confirm the address is the guard's admin before signing anything.                                      |
| **Connect admin wallet** / `Observer mode`  | No wallet connected. Reading works; every write is disabled.                                              | Connect only when you need to write. Observing is safe.                                                |
| "Wallet on X, dashboard on Y" (mismatch)    | The wallet and the console target different networks. Nothing has been sent; no write can be signed.     | Switch the wallet's network (or the console's target) so they agree. Do not try to sign around it.     |
| **Wallet connection** error                 | The wallet refused or failed the request.                                                                 | Unlock or reconnect the wallet. Reads continue unaffected.                                             |
| RPC endpoint health: failing / not checked  | The configured Soroban RPC is unreachable or untested, so every chain read on the panel may fail.         | Press **Check again**, then **Refresh**. The endpoint is fixed at build time; it cannot be changed here. |

### Freeze and dead-man switch

The guard has two independent freeze mechanisms; see
[dual-freeze semantics](../concepts/dual-freeze-semantics.md).

| Field / value                             | Meaning                                                                                       | Safe next step                                                                                                                          |
| ----------------------------------------- | --------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| Admin freeze: `clear`                     | `admin_frozen` is false at read time.                                                         | None.                                                                                                                                   |
| Admin freeze: `FROZEN`                    | Someone with the admin key called `freeze()`. The account refuses agent calls.                | If you did not freeze it, treat it as an incident ([runbook](../runbooks/emergency-freeze.md)). Unfreeze only via the runbook checklist. |
| Dead-man switch: `within grace`           | The agent's last heartbeat is inside the grace window.                                        | None.                                                                                                                                   |
| Dead-man switch: `expired` / `FIRED`      | The agent missed its heartbeat; the account refuses agent calls until a heartbeat or `unfreeze()`. | Check the agent runtime first — a DMS trip is usually a stopped agent or lost key, not an intrusion.                                     |
| `switch disabled (grace 0)`               | The policy's `dms_grace_secs` is 0, so the switch never fires.                                | Intentional for some setups; otherwise set a grace in the policy.                                                                       |
| Last heartbeat: `never`                   | The agent has never called `heartbeat()`.                                                     | Expected right after deployment; otherwise check the agent integration.                                                                 |
| DMS banner: warning / critical / expired  | Remaining grace is low, imminent, or gone, measured on the **ledger** clock.                  | Restore the agent's heartbeat, or freeze deliberately if the agent is compromised.                                                     |
| DMS banner note: `stale read`             | The last ledger reading is older than the freshness bound, so the countdown is frozen at that reading instead of claiming an exact deadline. | Press **Refresh** before relying on the countdown.                                                                                      |

### Policy

| Field / value                                     | Meaning                                                                                                                       | Safe next step                                                                                             |
| ------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Policy installed: `yes`                           | `status().has_policy` is true; **Policy in force** shows the caps and allowlists from `policy()`.                              | Compare against your intended policy. Remember the [enforcement scope](../enforcement-scope.md).           |
| Policy installed: `no — default deny` + banner    | No policy is stored. The contract refuses **every** call (`no_policy`).                                                        | This is safe but blocks the agent. Use **Configure a policy for this account** when you are ready.         |
| `policy(): read failed`                           | The policy could not be read. **This is not the same as no policy.**                                                          | Retry the read. Do not install or revoke a policy based on this state.                                     |
| Assets / Recipients / Protocols: `Unavailable`    | (Printed report) The policy read failed, so the allowlist is unknown — never an empty list.                                    | Retry the read before printing a compliance report.                                                        |

### Rolling window and artifact identity

| Field / value                                | Meaning                                                                                       | Safe next step                                                                                   |
| -------------------------------------------- | --------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Spent in window / velocity                   | Spend inside the policy's rolling window, as the contract tracks it.                          | Compare with the rolling cap in **Policy in force**.                                             |
| Pinned Phase 1 artifact: `match`             | The ledger reports the exact Wasm hash this console pins.                                     | None.                                                                                            |
| Pinned Phase 1 artifact: `different artifact` | The instance runs different bytecode than the pinned, proven artifact.                       | Verify the deployment before trusting enforcement ([bytecode pinning](../concepts/bytecode-verification-pinning.md)). |
| `wasm identity: read failed`                 | The bytecode could not be fetched or hashed.                                                  | Retry. An unverified artifact is unknown, not "matching".                                        |

### Telemetry feed health

The feed reports its **own liveness** separately from its traffic, because "no
events" and "no connection" look identical in an empty table.

| Feed header says                                        | Meaning                                                                     | Safe next step                                                                                  |
| ------------------------------------------------------- | --------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| "Not watching this feed…"                               | Polling is off. An empty table means nothing, not "quiet".                 | Start watching if you need live events.                                                         |
| "Waiting for the first poll…" / "no poll has completed" | Watching, but no round has returned yet.                                    | Wait one poll interval.                                                                         |
| "Last successful poll … returned no events"             | Healthy and quiet. An empty table is genuinely empty.                       | None.                                                                                           |
| "No poll has landed for …"                              | Overdue: the feed may be behind or not updating.                            | Press **Check again** on RPC health. Do not read an empty table as "no activity".                                  |
| "The last poll failed …"                                | Failing: events stopped arriving at that time.                              | Fix connectivity. Use a chain explorer or the CLI in the [runbook](../runbooks/emergency-freeze.md#6-quick-reference-cli-fallback-web-ui-unavailable) if you need certainty now. |

Blocked decisions appear in the feed only when this console produced them: a
refusal never reaches the ledger, so another client's refused call is invisible
here. Absence of blocked events is not proof that nothing was attempted.

### When in doubt

- **Unsure whether the account is safe?** Follow the
  [incident runbook](../runbooks/emergency-freeze.md). The console's freeze
  button needs a connected admin wallet and a reachable RPC endpoint (it is
  disabled, with the reason shown, when the live read it depends on fails); when
  it is unavailable, freeze from the CLI using the runbook's
  [quick-reference fallback](../runbooks/emergency-freeze.md#6-quick-reference-cli-fallback-web-ui-unavailable).
- **Unsure what a "clear" state protects against?** Read the
  [enforcement scope](../enforcement-scope.md) before relying on it.
- **Need certainty the browser cannot give?** Read the contract directly with
  the CLI commands in the runbook's
  [quick-reference fallback](../runbooks/emergency-freeze.md#6-quick-reference-cli-fallback-web-ui-unavailable).
