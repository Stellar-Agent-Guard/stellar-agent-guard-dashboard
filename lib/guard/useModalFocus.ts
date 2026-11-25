/**
 * Focus management for a modal dialog, in one place.
 *
 * A modal has to do four things or it is broken in one of two directions: move
 * focus into itself on open, keep Tab cycling inside it, close on Escape, and
 * give focus back to the control that opened it. Skip the first and focus stays
 * behind the dialog on a page the operator cannot see; skip the last and focus
 * lands nowhere on dismissal. Both fail WCAG 2.1 AA keyboard requirements, and
 * both are invisible to a mouse-driven test.
 *
 * It lives here, rather than inline in the panel that uses it, for two reasons
 * the freeze dialog is the proof of: the trap and the announcement of a result
 * have to coexist, and "the result is announced before the dialog is torn down"
 * is only assertable if the teardown is a unit something else can observe.
 *
 * The focus restore happens in the effect's cleanup rather than in the close
 * handler, so *every* way out of the dialog — Escape, Cancel, or proceeding to
 * sign — returns focus exactly once, and the restore is ordered after whatever
 * the close itself announced.
 *
 * ## Nested dialogs (issue #540)
 *
 * Dialogs can stack: the secret-key alert is portaled to `<body>` and can open
 * over the freeze dialog; a confirmation can open from inside another modal.
 * Every trap listens on `document` in the capture phase, so without
 * coordination one Escape would dismiss *every* open dialog at once, and the
 * lower dialog's Tab trap — seeing focus "outside" itself, because the upper
 * dialog lives in a different portal subtree — would drag focus back behind
 * the overlay the operator is looking at.
 *
 * The module-level {@link dialogStack} fixes both: only the topmost open dialog
 * reacts to Escape and Tab, and when a dialog closes, focus goes to (in order)
 * its trigger, its fallback, or the dialog now on top of the stack — never to
 * `<body>` behind a still-open overlay.
 */

import { useEffect, useRef, type RefObject } from "react";

export interface ModalFocusOptions {
  /** True while the dialog is mounted. */
  open: boolean;
  /** The dialog node itself. */
  containerRef: RefObject<HTMLElement | null>;
  /**
   * The control that opened the dialog; it receives focus back on close. Read
   * at close time, so a trigger re-created while the dialog was open is still
   * found. When omitted (or empty at close time), the element that held focus
   * when the dialog opened is used instead.
   */
  returnFocusRef?: RefObject<HTMLElement | null>;
  /** An available control to focus if the original trigger cannot receive focus. */
  fallbackFocusRef?: RefObject<HTMLElement | null>;
  /** Called on Escape. */
  onDismiss: () => void;
}

const FOCUSABLE =
  'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])';

/**
 * Open dialogs, bottom to top. Each entry is an opaque token rather than the
 * DOM node, so a dialog whose node is replaced while it is open keeps its
 * place in the stack.
 */
interface StackEntry {
  container: () => HTMLElement | null;
}

const stack: StackEntry[] = [];

/** Read-only view of the open-dialog stack, for tests and diagnostics. */
export const dialogStack = {
  /** Number of dialogs currently registered as open. */
  get depth(): number {
    return stack.length;
  },
  /** The topmost open dialog's node that is still in the document, if any. */
  top(): HTMLElement | null {
    for (let i = stack.length - 1; i >= 0; i--) {
      const node = stack[i]!.container();
      if (node?.isConnected) return node;
    }
    return null;
  },
};

function isTop(entry: StackEntry): boolean {
  return stack[stack.length - 1] === entry;
}

function removeEntry(entry: StackEntry): void {
  const index = stack.lastIndexOf(entry);
  if (index >= 0) stack.splice(index, 1);
}

/** Focus `target` if it is a live element; report whether focus landed there. */
function tryFocus(target: HTMLElement | null | undefined): boolean {
  if (!target || !target.isConnected) return false;
  target.focus();
  return document.activeElement === target;
}

export function useModalFocus({
  open,
  containerRef,
  returnFocusRef,
  fallbackFocusRef,
  onDismiss,
}: ModalFocusOptions): void {
  // The dismiss callback is almost always a fresh closure, so it is read through
  // a ref: subscribing the keydown listener to its identity would re-run the
  // whole effect (and re-arm the focus restore) on every render of the owner.
  const dismissRef = useRef(onDismiss);
  useEffect(() => {
    dismissRef.current = onDismiss;
  });

  useEffect(() => {
    if (!open) return;
    const dialog = containerRef.current;
    if (!dialog) return;

    // Whatever held focus when the dialog opened is the implicit trigger. An
    // element already inside the dialog (an `autoFocus` field) is not one.
    const activeAtOpen = document.activeElement as HTMLElement | null;
    const opener =
      activeAtOpen && activeAtOpen !== document.body && !dialog.contains(activeAtOpen)
        ? activeAtOpen
        : null;

    const entry: StackEntry = { container: () => containerRef.current ?? dialog };
    stack.push(entry);

    const focusables = () => Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE));

    // Focus the dialog itself first, so a screen reader announces the title
    // before the operator tabs into its controls. A field the dialog
    // auto-focused keeps focus.
    if (!dialog.contains(document.activeElement)) dialog.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      // Only the topmost dialog owns the keyboard. A lower dialog reacting here
      // would close underneath the one in view, or pull focus behind it.
      if (!isTop(entry)) return;
      if (event.key === "Escape") {
        event.preventDefault();
        dismissRef.current();
        return;
      }
      if (event.key !== "Tab") return;
      const items = focusables();
      if (items.length === 0) {
        event.preventDefault();
        dialog.focus();
        return;
      }
      const first = items[0]!;
      const last = items[items.length - 1]!;
      const active = document.activeElement as HTMLElement | null;
      const inside = active !== null && dialog.contains(active);
      if (event.shiftKey && (active === first || !inside)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (active === last || !inside)) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("keydown", onKeyDown, true);
      removeEntry(entry);
      // Dismissal in any form (Escape, Cancel, or proceeding to sign) returns
      // focus to the trigger. The trigger row is re-created when the dialog
      // closes, and React re-attaches refs during the commit — before this
      // cleanup runs — so the ref already points at the live button. Reading
      // `.current` at cleanup time is the whole point; a snapshot taken when the
      // effect started would be null (the row is unmounted while the dialog is
      // open) or a detached node.
      // eslint-disable-next-line react-hooks/exhaustive-deps -- deliberate late ref read, see above
      const explicitTarget = returnFocusRef?.current ?? null;
      // eslint-disable-next-line react-hooks/exhaustive-deps -- fallback is attached in the closing commit.
      const fallbackTarget = fallbackFocusRef?.current ?? null;
      // A caller that names its trigger keeps its own precedence (trigger, then
      // fallback); the element focused at open time is the last resort. A
      // caller that names none gets the opener first.
      const candidates = returnFocusRef
        ? [explicitTarget, fallbackTarget, opener]
        : [opener, fallbackTarget];
      for (const candidate of candidates) {
        if (tryFocus(candidate)) return;
      }

      // No usable trigger. If another dialog already put focus somewhere live
      // outside this one (an outer dialog closing in the same commit restores
      // its own trigger first), leave it; otherwise hand focus to the dialog
      // now on top, so it never falls to <body> behind an open overlay.
      const active = document.activeElement as HTMLElement | null;
      if (active && active !== document.body && active.isConnected && !dialog.contains(active)) {
        return;
      }
      dialogStack.top()?.focus();
    };
  }, [open, containerRef, returnFocusRef, fallbackFocusRef]);
}
