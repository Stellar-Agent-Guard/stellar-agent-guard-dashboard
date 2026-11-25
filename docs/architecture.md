# Architecture

Stellar Agent Guard is structured across three repositories:

```
┌─────────────────────────────────────────────────────────────────────────┐
│                      Operator (Browser / Freighter)                     │
│                                     │                                   │
│                                     ▼                                   │
│              stellar-agent-guard-dashboard (Next.js / UI)               │
└─────────────────────────────────────┬───────────────────────────────────┘
                                      │
                                      ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                   AI Agent Runtime (LangChain / ElizaOS)                │
│                                     │                                   │
│                                     ▼                                   │
│                stellar-agent-guard-sdk (TypeScript / RPC)               │
│               • Pre-flight policy check  • Cost pre-checks              │
│               • Agent-auth tx signing    • Event telemetry              │
└─────────────────────────────────────┬───────────────────────────────────┘
                                      │
                                      ▼ Soroban RPC
┌─────────────────────────────────────────────────────────────────────────┐
│               stellar-agent-guard-contracts (Soroban / Rust)             │
│            • CustomAccount interface (`__check_auth`)                   │
│            • Spend caps, rolling window, allowlists, dead-man switch    │
└─────────────────────────────────────────────────────────────────────────┘
```

| Repository                                                                                                     | Role                                                                                                | Documentation                                                                                                                                                                                                                                                                                                                                                         |
| -------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [**stellar-agent-guard-contracts**](https://github.com/aigbagbobila/stellar-agent-guard-contracts)             | Soroban smart contracts implementing Custom Account Abstraction and spending policy firewall        | [GitBook Docs](https://soroban-cost-estimator.gitbook.io/stellar-agent-guard-contracts/)                                                                                                                                                                                                                                                                              |
| [**stellar-agent-guard-sdk**](https://github.com/aigbagbobila/stellar-agent-guard-sdk)                         | TypeScript SDK for pre-flight interception, simulation pricing, and AI agent framework integration  | [GitHub](https://github.com/aigbagbobila/stellar-agent-guard-sdk)                                                                                                                                                                                                                                                                                                     |
| [**stellar-agent-guard-dashboard**](https://github.com/aigbagbobila/stellar-agent-guard-dashboard) (this repo) | Client-side operator dashboard for policy deployment, inspection, and emergency panic-button freeze | [GitHub](https://github.com/aigbagbobila/stellar-agent-guard-dashboard)                                                                                                                                                                                                                                                                                               |
|                                                                                                                | **Pinned artifact enforcement**                                                                     | The dashboard fetches WASM bytes from a pinned contract source and verifies the SHA-256 hash and byte length before any deploy. The deploy flow refuses to proceed if the hash/length does not match the constant in `lib/guard/network.ts`. Changes to the pinned artifact require the Artifact Pin Change Checklist in `docs/operations/artifact-pin-checklist.md`. |     |
