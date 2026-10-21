# Deploy Panel

Provides guided deployment of new guard accounts:

1. Operator enters target agent public key and admin public key.
2. Dashboard fetches and validates pinned WASM bytecode from testnet.
3. Address is pre-calculated and displayed.
4. Freighter prompts approval for deployment and initialization. The initialization step first shows
   the [pre-signature authorization summary](authorization-summary.md) — operation, guard, network and
   signing account — and stays disabled until this console can name all four.
5. New custom account address is automatically set as the active guard.
