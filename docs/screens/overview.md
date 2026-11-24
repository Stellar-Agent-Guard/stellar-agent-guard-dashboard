# Overview Screen (`/`)

The primary console screen provides full visibility into the active guard account:

- **Wallet Header**: Displays connected Freighter address, testnet connection status, and quick-disconnect.
- **Account Summary**: Shows guard custom account address, SAC token balance, and policy summary string.
- **Dead-Man Switch Status**: Displays countdown timer until the agent's heartbeat grace period expires.
- **Panic Button**: Immediate access to the emergency freeze modal.
- **Telemetry Feed**: Live scrolling feed of recent `event_auth_checked` authorization events.

## Page structure (all routes)

Every route (`/`, `/configure`, `/deploy`, `/fleet`, `/panic`) shares one structure from the
root layout: a skip link as the first focusable element, one banner holding the only `h1`,
a navigation labelled "Primary", and one `main` landmark around the route. Routes start
their headings at `h2` and never skip a level. `tests/e2e/routeLandmarks.spec.ts` asserts this
in a browser for all five routes.
