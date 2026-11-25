# Keyboard & Screen-Reader Guide

**Audience:** operators who drive the console from the keyboard, with a screen
reader, or both.
**Linked from:** the console header ("keyboard help"), on every screen.
**Related:** [Overview screen](../screens/overview.md) ·
[Telemetry feed](../screens/telemetry-feed.md) ·
[Policy configurator](../screens/policy-configurator.md)

This page lists only behaviour that exists in the code today and is covered by
the unit tests named in [How this guide is kept honest](#how-this-guide-is-kept-honest).
If something is not listed here, assume it is **not** supported — please open an
issue rather than relying on it.

On macOS, read <kbd>Ctrl</kbd> as <kbd>⌘</kbd> wherever both are accepted (the
table says so explicitly).

---

## Global behaviour

- **No single-letter shortcuts.** The console binds no letter key without a modifier, so a
  screen reader's browse-mode navigation keys are never intercepted.
- **Tab order follows reading order.** Navigation tabs (Console, Fleet,
  Configure) are ordinary links; the current page is exposed with
  `aria-current="page"`.
- **Announcements.** Results of writes and shared-panel restores are spoken
  through one polite live region, so they do not interrupt what the screen
  reader is already reading.
- **Shared links.** Opening a link that names a console panel (`?tab=telemetry`)
  moves focus to that panel's heading and announces "Shared view restored".

## Command palette

**Not currently available.** A command palette component exists in the
codebase (`components/CommandPalette.tsx`), but no screen in the shipped
console mounts it, so <kbd>Ctrl</kbd> + <kbd>K</kbd> / <kbd>⌘</kbd> +
<kbd>K</kbd> does nothing today. Its keyboard behaviour will be documented here
once a screen mounts it; until then, use the navigation tabs and
<kbd>Tab</kbd> order described above.

> **Before it is mounted:** the component's "Trigger Emergency Freeze" entry
> shows a browser alert only — it does **not** sign or submit `freeze()`. Use
> the **Emergency** panel on the Console screen to freeze an account.

## Dialogs

These dialogs share one focus contract (`lib/guard/useModalFocus.ts`):

- freeze confirmation (Emergency panel),
- policy change review ("Policy changes", before the wallet signs),
- preset confirmation ("Replace current draft?"),
- dashboard layout dialogs (name layout, reset layout preview),
- the secret-key alert ("Secret key detected").

| Keys                                               | Action                                                              |
| -------------------------------------------------- | ------------------------------------------------------------------- |
| (on open)                                          | Focus moves into the dialog, so its title is read first.            |
| <kbd>Tab</kbd> / <kbd>Shift</kbd> + <kbd>Tab</kbd> | Cycle through the dialog's controls; focus never leaves the dialog. |
| <kbd>Escape</kbd>                                  | Cancel and close the dialog.                                        |
| (on close)                                         | Focus returns to the control that opened the dialog.                |

**Stacked dialogs.** When one of these dialogs opens on top of another — for
example the secret-key alert over the freeze confirmation — only the top one
responds to <kbd>Escape</kbd> and <kbd>Tab</kbd>. Closing it returns focus to
the control inside the dialog underneath that opened it (or, if that control is
gone, to the dialog underneath itself), never to the page behind an open
overlay. Press <kbd>Escape</kbd> again to close the next dialog down.

These other dialogs also close on <kbd>Escape</kbd>: the address book, the
storage explorer, webhook settings, the fleet bulk-cleanup confirmation, guard rename and
delete, and the unsaved-changes prompt.

## Policy form (/configure)

| Keys                                                                                                | Action                           |
| --------------------------------------------------------------------------------------------------- | -------------------------------- |
| <kbd>Ctrl</kbd> + <kbd>Z</kbd> or <kbd>⌘</kbd> + <kbd>Z</kbd>                                       | Undo the last edit to the draft. |
| <kbd>Ctrl</kbd> + <kbd>Shift</kbd> + <kbd>Z</kbd> or <kbd>⌘</kbd> + <kbd>Shift</kbd> + <kbd>Z</kbd> | Redo.                            |
| <kbd>Ctrl</kbd> + <kbd>Y</kbd> or <kbd>⌘</kbd> + <kbd>Y</kbd>                                       | Redo.                            |

These only act while focus is inside the policy form, and never when
<kbd>Alt</kbd> is held. Invalid fields are marked `aria-invalid` and point at
their error text with `aria-describedby`.

**Policy change review on a phone.** Below 720px wide the review linearizes:
each changed field is one card read top to bottom as _Field_ → _Before
(installed)_ → _After (this draft)_, with those labels printed in front of each
value. Confirm and Cancel follow the cards in the same order as on desktop.

### Protocol function picker

| Keys                                 | Action                               |
| ------------------------------------ | ------------------------------------ |
| <kbd>↓</kbd> or <kbd>Enter</kbd>     | Open the suggestion list.            |
| <kbd>↓</kbd> / <kbd>↑</kbd>          | Move through suggestions.            |
| <kbd>Home</kbd> / <kbd>End</kbd>     | Jump to the first / last suggestion. |
| <kbd>Enter</kbd> or <kbd>Space</kbd> | Toggle the highlighted function.     |
| <kbd>Escape</kbd>                    | Close the list.                      |

## Tables

The fleet table, telemetry feed, transaction history, and chart data table use
real `<th scope="col">` column headers, so screen-reader table navigation
announces each cell with its column name.

Below 720px wide, the fleet, telemetry and history tables stack each row into a
card. The header row is hidden visually but stays in the accessibility tree,
and every cell prints its column name in front of its value.

## Telemetry chart and its alternatives

| Keys                             | Action                                     |
| -------------------------------- | ------------------------------------------ |
| <kbd>Tab</kbd>                   | Focus the chart.                           |
| <kbd>→</kbd> / <kbd>←</kbd>      | Step to the next / previous time interval. |
| <kbd>Home</kbd> / <kbd>End</kbd> | Jump to the first / last interval.         |
| <kbd>Escape</kbd>                | Clear the highlighted interval.            |

The chart is exposed as one image whose label summarizes the whole window. The
highlighted interval's counts and spend are read out through a polite live
region as you step. For a non-visual alternative that needs no stepping at all,
expand **Data table** under the chart (<kbd>Enter</kbd> or <kbd>Space</kbd> on
the disclosure): it lists every interval with allowed, blocked and other event
counts and settled spend.

## Telemetry time range

The range presets are a radio group (`role="radio"` with `aria-checked`). Each
preset is its own <kbd>Tab</kbd> stop and applies immediately on
<kbd>Enter</kbd> or <kbd>Space</kbd>; arrow-key movement between presets is
**not** implemented. **Custom** reveals native date-time fields for the start
and end; an invalid range is reported as an alert.

## On-chain state panel

- The panel is marked busy only while its **first** read is in flight;
  background refreshes are silent.
- A field whose read failed is announced as an alert ("status(): read failed")
  and offers a **Retry** button named for that read, e.g. "Retry status() fetch".
- See [Reading the on-chain state panel](../screens/overview.md#reading-the-on-chain-state-panel)
  for what each value and state means.

---

## How this guide is kept honest

- `tests/unit/keyboardGuide.test.ts` checks that every key written in a
  `<kbd>` on this page belongs to the set of keys the code actually handles,
  that the undo/redo bindings above match `historyShortcut`, that the command
  palette is still unmounted (so this page is updated the moment it ships),
  and that the in-app link to this page resolves to a file in the repository.
- `tests/unit/nestedDialogFocus.test.ts` covers the stacked-dialog behaviour:
  <kbd>Escape</kbd> and explicit close, cancelled flows, and focus restoration.
- `tests/unit/telemetryChart.test.ts` covers the chart's arrow, <kbd>Home</kbd>,
  <kbd>End</kbd> and <kbd>Escape</kbd> keys.
