# Frequently Asked Questions (FAQ)

### Can the dashboard execute transfers on behalf of the agent?

No. The dashboard is strictly an operator console for installing security policies, monitoring events, and triggering freezes. The agent's transactions are generated and signed by the autonomous agent runtime using the SDK.

### What happens if I close the browser during a freeze?

The freeze transaction is signed and broadcast on-chain. Once included in a ledger by the Stellar testnet validators, the smart account remains frozen regardless of whether the dashboard is open.

### How do I switch networks?

The current deployment targets Stellar Testnet. Network settings can be inspected in `lib/guard/network.ts`.

### How should I handle a wallet, RPC, or verification error?

Follow the read-only checks in the [RPC and wallet troubleshooting runbook](runbooks/rpc-wallet-errors.md). A failed read does not mean the guard has no policy, and an uncertain submit must be checked by transaction hash before considering another write.
