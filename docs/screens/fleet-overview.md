# Fleet Overview

The Fleet Overview provides operators with real-time multi-guard visibility, status tracking, and registry management across deployed contracts.

## Partial Chain Failure Resilience & Row-Scoped Errors

- **Row-scoped Isolation**: Chain read failures (such as RPC timeouts, network dropped connections, or missing contracts) on individual guards do not bring down the fleet table or affect peer rows.
- **Error Indication & Retry**: When a single guard's snapshot read fails, only that specific row displays an `Unknown` status with an error indicator and an interactive `Retry` button that re-polls just that contract.
- **Local Registry Preservation**: Partial chain errors never corrupt, alter, or wipe stored instances, operator tags, or custom display names.
- **Network Switching**: Switching network environments retains all saved guard identities and local metadata even if contracts fail to resolve on the new network.
