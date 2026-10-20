# RPC and wallet troubleshooting

Use these checks before taking another action. A read failure says that the dashboard could not obtain an answer; it does not say that policy, freeze, or transaction state is zero or unchanged. The network ledger is authoritative.

| Dashboard error or outcome | What is known | What remains uncertain | Read-only next check |
| --- | --- | --- | --- |
| Wallet unavailable, disconnected, or wrong network | No wallet signature was obtained for this attempt. | Whether another tab or operator submitted a related transaction. | Check the wallet’s selected network and account address; then refresh the guard status from RPC. |
| Simulation rejected / `refused` | The enforced pre-submit simulation refused the call; this attempt was not broadcast. Diagnostics may include the host’s reason. | Whether the requested change is valid under current live policy. | Re-read `status()` and `policy()` for the selected guard, then inspect the displayed diagnostic events. |
| RPC rate limit (`429`, `TRY_AGAIN_LATER`) or timeout during a read/simulation | This request did not return a usable answer. Read/simulation backoff may retry those safe operations. | Current chain state; a failed read must not be interpreted as empty policy or an unfrozen guard. | Use the field’s **Retry** action or refresh once the endpoint is available; inspect the resulting per-field read outcome. |
| Timeout or disconnect after wallet approval / submit | The browser did not receive a conclusive submit response. | The transaction may already have been broadcast or included. | Check the wallet transaction activity and search the network for the transaction hash if available; re-read the guard from RPC before deciding what to do. Do not blindly submit again. |
| Submitted transaction is pending / not found yet | A transaction hash was returned, but inclusion is not yet confirmed. | Whether it will be included, expire, or fail. | Look up that exact hash with the network’s transaction status endpoint or wallet activity. |
| Transaction failed after submission | The network included and rejected the transaction; the dashboard has a hash and failure diagnostics. | Whether a later transaction changed the same state. | Inspect the exact transaction by hash, then re-read current guard status and policy. |
| Post-submit verification unavailable or stale | The transaction result and the later read are separate outcomes; the report marks the read unavailable/error. | Whether the intended state is now present. | Refresh the same network and guard and confirm each field reports a successful live read. Never treat unavailable as verified or zero. |

The **Retry** action on a failed status, policy, window, or identity read repeats only that read. It does not resubmit a write. Writes require a fresh operator action after checking transaction activity and current on-chain state.
