# Fleet Overview Screen

The Fleet Overview (`/fleet`) provides an aggregated, client-only view across all registered smart guards.

## Features

### Read-Only Fleet Risk Summary
- Aggregates verified live on-chain status across healthy, frozen, missing-policy, and DMS expired guards.
- Guards that fail to respond or encounter RPC errors are explicitly listed as excluded from the healthy/risk metrics rather than treated as healthy.
- Quick navigation links allow operators to jump straight to inspecting the affected guard.

### Operator Tags
- Group guards into logical categories (e.g. `treasury`, `arbitrage`, `prod`, `staging`).
- Operator tags are network-scoped and stored strictly in browser-local storage (`localStorage`).
- Tags never touch the ledger, alter smart account contracts, or transmit off-client.
- Operators can filter the fleet view by any assigned tag.

### Preferred Display Names
- Allows assigning user-friendly nicknames to guards without losing the authoritative Stellar contract address.
- Full contract addresses remain accessible and copyable on demand.
- Duplicate names are safely permitted; identity is strictly resolved by contract address.

### Policy Installation Age
- Displays elapsed time since policy installation when and only when derivable from on-chain data (`active_from` in policy and chain timestamp).
- Displays `unavailable` if on-chain timestamps are absent or invalid.
- Never infers installation age from local client edits or browser clocks.
