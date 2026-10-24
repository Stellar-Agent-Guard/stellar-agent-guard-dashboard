# Overview Screen (`/`)

The primary console screen provides full visibility into the active guard account:

- **Wallet Header**: Displays connected Freighter address, testnet connection status, and quick-disconnect. **Wallet diagnostics** opens a prompt-free view of the selected provider, the connected address, both networks and the capabilities this browser reports ([wallet diagnostics](wallet-diagnostics.md)).
- **Account Summary**: Shows guard custom account address, SAC token balance, and policy summary string.
- **Dead-Man Switch Status**: Displays countdown timer until the agent's heartbeat grace period expires.
- **Panic Button**: Immediate access to the emergency freeze modal, which shows the [pre-signature authorization summary](authorization-summary.md) before it asks the wallet to sign.
- **Telemetry Feed**: Live scrolling feed of recent `event_auth_checked` authorization events.
