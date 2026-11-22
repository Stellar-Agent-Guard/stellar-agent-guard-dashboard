# Deploy Panel & Setup Wizard

Provides guided deployment and lifecycle setup of guard accounts:

1. Operator enters target agent public key and admin public key.
2. Dashboard fetches and validates pinned WASM bytecode from testnet.
3. Address is pre-calculated and displayed.
4. Freighter prompts approval for deployment and initialization.
5. New custom account address is automatically set as the active guard.

## Post-Deploy Checklist & Next Recommended Actions

The Setup Wizard derives four linear verification stages directly from live on-chain reads:
- **Deployed**: Confirms contract deployment on Soroban.
- **Initialized**: Verifies admin and agent key registration in contract storage.
- **Policy Installed**: Warns if the account is in default-deny, confirming when an active allowlist policy is installed.
- **Verified**: Confirms status and policy via explicit live on-chain re-read.

### Next Action Guidance
For returning operators with an already deployed guard, the wizard evaluates fresh reads to surface an explicit **Recommended Next Action** callout (e.g. initialize keys, install policy, or re-verify on-chain). Write operations are never automatically replayed.

## Guided Rehearsal (Demo Fixtures)

Operators can rehearse setup verification, policy allowlist review, and emergency freeze drills without a wallet, RPC credentials, or live contract deployments.
- **Strictly Disabled Writes**: All transaction submission and signing buttons remain disabled with explicit tooltips.
- **Isolated Fixtures**: Rehearsal executes against static demo fixtures, completely isolated from active browser state and live chains.

## Provenance Visibility

The interface displays a consistent mode indicator:
- **Live Chain**: Indicates authoritative on-chain reads (`LIVE CHAIN: Soroban testnet`).
- **Demo Mode**: Explicitly banners static fixture data (`DEMO MODE — Static Fixture Data`), persisting prominently across print stylesheets (`@media print`) and export files.

