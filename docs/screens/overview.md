# Overview Screen (`/`)

The primary console screen provides full visibility into the active guard account:

- **Wallet Header**: Displays connected Freighter address, testnet connection status, and quick-disconnect.
- **Account Summary**: Shows guard custom account address, SAC token balance, and policy summary string.
- **Dead-Man Switch Status**: Displays countdown timer until the agent's heartbeat grace period expires.
- **Panic Button**: Immediate access to the emergency freeze modal.
- **Telemetry Feed**: Live scrolling feed of recent `event_auth_checked` authorization events.

## 200% browser zoom

Browser zoom shrinks the layout viewport, so a 1280px monitor at 200% is a 640 CSS px
window and falls below the console's 720px breakpoint. The shell re-evaluates its
single-column layout on `resize` (which zoom fires), and the critical controls stack:

- The panic freeze/unfreeze actions, the network-switch action and the policy submit bar
  go full width at a 44px minimum height rather than clipping their last button.
- Dialogs stay inside the viewport, scroll internally, and their actions remain tappable.
- Focus stays visible: the shared `:focus-visible` outline is never replaced or removed,
  and every stacked control keeps its label or `aria-label`.

Verification is a manual check at 200% on `/`, `/fleet`, `/configure` and `/panic`:
reach freeze, network switch and submit by keyboard, confirm the focus ring is visible and
nothing is clipped. The stylesheet contract behind it is asserted in
`tests/unit/zoomContract.test.ts`.
