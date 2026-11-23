# Overview Screen (`/`)

The primary console screen provides full visibility into the active guard account:

- **Wallet Header**: Displays connected Freighter address, testnet connection status, and quick-disconnect.
- **Account Summary**: Shows guard custom account address, SAC token balance, and policy summary string.
- **Dead-Man Switch Status**: Displays countdown timer until the agent's heartbeat grace period expires.
- **Panic Button**: Immediate access to the emergency freeze modal.
- **Telemetry Feed**: Live scrolling feed of recent `event_auth_checked` authorization events.
- **Refresh Strip**: One line in the site header per panel that polls, stating its cadence, when its
  last round landed, and whether it is `polling`, `connecting`, `poll failing`, `no response` or
  `stopped`. The strip reads nothing itself — panels report their own liveness and withdraw it when
  they unmount — and a frozen display is shown as `display paused` beside the phase rather than in
  place of it. Each line links to that panel's diagnostics. See
  [the read path](../../SPEC.md#where-the-console-says-when-it-last-read).
