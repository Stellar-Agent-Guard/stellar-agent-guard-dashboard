# Policy Configurator (`/configure`)

Interactive no-code form for configuring smart account guardrails:

- **Policy Presets**: One-click archetypes (Strict Micro-Agent, Standard DeFi Bot, High-Throughput Arbitrage), each badged Conservative, Balanced or Permissive. Selecting one asks to confirm before replacing the current draft; placeholder addresses must be replaced before installing.
- **Per-Transaction Spend Cap**: Limits maximum tokens moved in a single call.
- **Rolling Window Cap & Duration**: Enforces spending limits over a rolling time window (seconds).
- **Asset Allowlists**: Enforces accepted SAC tokens.
- **Recipient Allowlists**: Default-deny recipient address list.
- **Protocol & Function Allowlists**: Configures approved contract IDs and method names for arbitrary Soroban calls.
- **Active Execution Windows**: Restricts execution to specific ledger timestamp intervals.
- **Pause Switch**: Global pause switch for routine maintenance.
- **Dead-Man Grace Window**: Configures maximum allowable inactivity period in seconds.
- **Flagged-Address Warning**: Screens every address in the allowlists against an
  embedded, versioned warning registry of known malicious Stellar addresses
  (`lib/guard/securityChecker.ts`) and blocks the policy write behind a
  high-severity warning until the operator clears two explicit gates.

## Flagged-address screening

Every address the draft puts into an allowlist — **Assets**, **Recipients**,
**Protocols** and **Per-asset cap overrides** — is cross-referenced against a
registry compiled into the build. A hit is reported three times, in increasing
order of friction:

1. **Inline, in the form.** A red panel names each flagged address, the field it
   came from, and why it is listed. This is where a mistyped or lookalike address
   is actually caught.
2. **On submit.** The **Sign and install policy** and **Export XDR** buttons
   refuse to reach the wallet and open a modal reading
   *"CRITICAL: This address has been flagged as malicious or compromised."* with
   the report, its date, and a link to verify it. XDR export is gated by the same
   path deliberately: an exported envelope is signed later, out of reach of this
   warning.
3. **Double confirmation.** Proceeding needs a ticked acknowledgement *and* the
   typed phrase `PROCEED`. Confirmation is bound to the exact address list, so
   editing the addresses afterwards re-arms the gate.

### What this check is not

- **A miss is not a clearance.** The registry is a small, dated snapshot, not a
  live reputation feed, and it is nowhere near complete. An address missing from
  it is *unknown here*, not verified. The modal says so, and names the registry
  version and date so a reader can weigh the claim.
- **Reports, not verdicts.** Entries are public reports with sources, not this
  project's own findings. A false positive is possible, which is why the gate can
  be cleared deliberately rather than being a wall.
- **Matching is on identity, not text.** Addresses are canonicalised through the
  SDK first, so a muxed `M…` form of a flagged `G…` account is caught and named
  as an alias rather than passing as a different string.

Entries carry a category, a reason, a report date, and an `https` source. Adding
one is a data change in `MALICIOUS_ADDRESS_REGISTRY`; bumping `REGISTRY_VERSION`
is what makes a stale install visible to an operator reading the modal.
