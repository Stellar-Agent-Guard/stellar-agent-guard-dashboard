# Evaluating Third-Party RPC Endpoints

This guide provides a provider-neutral safety checklist for operators considering third-party Soroban RPC endpoints, along with an explicit breakdown of what browser request data leaves the console and what never leaves the client.

---

## 1. Provider-Neutral Evaluation Checklist

When evaluating an endpoint provider for production or testnet guard monitoring, assess the endpoint against these four essential dimensions:

### A. Trust & Cryptographic Integrity

- **Bytecode Verification**: Does the endpoint serve unmodified contract WASM code via `getLedgerEntries` matching the pinned SHA-256 hash (`GUARD_WASM_HASH`)?
- **Authoritative Ledger Timestamps**: Does the endpoint report true close times from consensus rather than local clock approximations?
- **Standard Protocol Conformance**: Does the provider adhere to standard Soroban JSON-RPC method signatures (`simulateTransaction`, `getEvents`, `getLedgerEntries`, `getNetwork`, `sendTransaction`) without non-standard parameter rewriting?

### B. Availability & Reliability

- **Documented Uptime & SLAs**: What are the provider's documented availability targets and maintenance windows?
- **Explicit Rate Limiting**: Does the endpoint return standard HTTP 429 status codes with `Retry-After` headers when throttling, rather than dropping TCP connections or hanging indefinitely?
- **Latency & Geodistribution**: Does round-trip time meet operator response expectations during incident management (such as emergency freezes)?
- **Failover Capabilities**: Does your operational setup have a configured fallback endpoint list for high-availability continuity?

### C. Privacy, Logging & Retention

- **Transport Security**: Is HTTPS enforced with TLS 1.3/1.2 and modern cipher suites?
- **Query Logging Policies**: Does the provider log or retain full JSON-RPC request bodies, target contract addresses, or client IP addresses?
- **IP Retention Period**: What is the data retention schedule for server access logs?
- **No Third-Party Telemetry**: Does the RPC host refrain from proxying requests through untrusted advertising or analytics intermediaries?

### D. Network Identity & Passphrase Isolation

- **Network Identity Verification**: Does the provider's `getNetwork` response return the exact passphrase matching your intended network (`Test SDF Network ; September 2015` for Testnet vs `Public Global Stellar Network ; September 2015` for Mainnet)?
- **Cross-Network Isolation**: Ensure the endpoint never proxies queries intended for testnet to public networks or vice versa.

---

## 2. Browser Request Data: What Leaves vs What Stays

The Stellar Agent Guard Dashboard is an entirely non-custodial, client-side application. It operates without a backend server, database, or API routes.

### What Data Leaves the Browser to the RPC Endpoint

When the dashboard interacts with an RPC endpoint, the following items are transmitted over HTTPS:

1. **HTTP Connection Metadata**:
   - The operator's client IP address (inherent to TCP/IP communication).
   - Standard HTTP headers: `User-Agent`, `Origin` header, `Content-Type: application/json`.
2. **JSON-RPC Queries**:
   - Contract IDs (e.g., `C...`) and ledger storage keys queried to fetch guard status, installed policy, and event logs.
   - Read-only simulation payloads used by `simulateTransaction` to preview authorization outcomes and calculate execution resource fees.
3. **Signed Transaction Envelopes (Only Upon Operator Confirmation)**:
   - When an operator explicitly signs an action (such as `freeze`, `unfreeze`, `set_policy`, or `deploy`) in their connected wallet extension and confirms submission, the signed XDR envelope is posted via `sendTransaction`.

### What Data NEVER Leaves the Browser

Under no circumstances does the dashboard transmit the following:

1. **Private Keys or Seed Phrases**:
   - Keys reside exclusively inside the operator's browser extension (Freighter, Albedo, xBull) or hardware device.
   - The dashboard contains zero code capable of viewing, storing, or exporting private keys.
2. **Unsigned Sensitive Drafts**:
   - Policy configurations in the form editor remain strictly in browser state until the operator initiates a wallet signing review.
3. **Local Storage & Address Book Data**:
   - Custom nicknames, address book contacts, theme preferences, and audit history logs are stored purely in browser `localStorage` and `sessionStorage`. They are never sent to RPC providers.

---

## 3. Endpoint Health History, Minimum Evidence & Failover Rehearsal

- **Endpoint Identity & Network Scoping**: Health history records only the sanitized endpoint origin (`scheme://host[:port]`) and active network name (`testnet`, `mainnet`, etc.). Embedded credentials (`user:pass@`) and query-string API tokens are stripped before recording.
- **Minimum Evidence Thresholds**: Endpoint quality is only reported as `Healthy` after collecting at least **5 samples** spanning at least **60 seconds** of observation. Fewer samples or shorter observation windows are explicitly flagged as `Unknown` (0 samples) or `Insufficient evidence` so short bursts are never mistaken for proven reliability.
- **Read-Only Failover Rehearsal**: Before switching to an alternate RPC endpoint, operators can run a read-only rehearsal (`getNetwork`, `getHealth`, and `getLatestLedger`) to inspect per-check latency and network identity. Rehearsal never promotes the candidate endpoint automatically and never signs or broadcasts transactions.
