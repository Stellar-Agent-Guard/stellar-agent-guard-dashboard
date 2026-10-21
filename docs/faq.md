# Frequently Asked Questions (FAQ)

### Can the dashboard execute transfers on behalf of the agent?

No. The dashboard is strictly an operator console for installing security policies, monitoring events, and triggering freezes. The agent's transactions are generated and signed by the autonomous agent runtime using the SDK.

### What happens if I close the browser during a freeze?

The freeze transaction is signed and broadcast on-chain. Once included in a ledger by the Stellar testnet validators, the smart account remains frozen regardless of whether the dashboard is open.

### How do I switch networks?

The current deployment targets Stellar Testnet. Network settings can be inspected in `lib/guard/network.ts`.

### An error appeared — should I retry?

Not before a read. Every dashboard error is mapped to what is known, what stays uncertain, and a read-only next step in the [error runbook](runbooks/errors.md) — in short: reads may be retried freely; a refused or failed _write_ must be checked against the ledger (by transaction hash or a direct contract read) before anything is sent again, and a failed read never stands in for chain state.
