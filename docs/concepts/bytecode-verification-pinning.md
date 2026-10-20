# Bytecode Verification & Pinning

To guarantee that deployed custom accounts execute the exact audited Phase 1 security logic:

1. When deploying a fresh guard account, the dashboard retrieves the WASM bytecode directly from the Stellar testnet ledger.
2. The SHA-256 hash is computed in the browser and verified against the canonical Phase 1 hash (`f47919f92e78fdd034836aa61955fc338dd56a218c448c37df1867a8c3da0f63`).
3. If the hash does not match, deployment is refused.
4. The custom account address is predicted mathematically before the operator signs the transaction.
5. After deployment, `status()` is queried from Soroban RPC to confirm initialization.
# Browser resource limit

The dashboard refuses to parse or hash WASM artifacts larger than 2 MiB. The
limit is checked before section parsing and digest work; an oversized response is
reported as **UNRECOGNIZED BYTECODE** and cannot receive a verified result.
