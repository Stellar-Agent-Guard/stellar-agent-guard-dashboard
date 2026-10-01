"use client";

import { useEffect, useRef, type ReactNode } from "react";

/**
 * The shared destructive-action confirmation dialog (issue #34).
 *
 * Extracted from the freeze confirmation in `PanicPanel`, which was the project's
 * only destructive-confirm at the time. The shape follows that implementation,
 * not a fresh design: a stateful dialog whose parent owns the open/close state,
 * rendered as a modal with an Escape-to-cancel, a focus trap, and focus
 * restoration to the trigger.
 *
 * The dialogue's copy rule: every confirm states its CONSEQUENCE, not a generic
 * "Are you sure?" — `consequence` is a required prop, so TypeScript rejects a
 * dialog that cannot say what it is about to destroy. The freeze dialog keeps
 * its acknowledgement checkbox via `children`; flows that do not need one pass
 * nothing.
 *
 * Focus discipline is delegated to `useModalFocus`, which owns the trap
 * mechanics (move focus in on open, cycle Tab, close on Escape, restore focus
 * to the trigger on close). This component renders the dialog semantics —
 * `role="dialog"`, `aria-modal`, `aria-labelledby` — and hands the hook the
 * element to trap; the hook's own tests own the trap behaviour, so this file's
 * tests assert wiring, not duplication.
 *
 * Readback is deliberately out of scope: the shared dialog is a confirm-gate
 * only. Post-action verification (like the panic path's mandatory `status()`
 * re-read) belongs to the caller, because it is a property of the action, not
 * of asking permission for it.
 */
export function ConfirmDialog({
  title,
  consequence,
  confirmLabel,
  cancelLabel = "Cancel",
  labelledById,
  onClose,
  onConfirm,
  busy = false,
  confirmDisabled = false,
  children,
  triggerRef,
}: {
  /** The decision being asked for, stated plainly. */
  title: string;
  /** What confirming will do — the consequence-first copy rule. Required. */
  consequence: ReactNode;
  /** The confirm button's verb, e.g. "Sign freeze" or "Delete contact". */
  confirmLabel: string;
  cancelLabel?: string;
  /** The id the title is given, for `aria-labelledby`. */
  labelledById: string;
  /** Called for dismissal (Cancel button, Escape). Never called for confirm. */
  onClose: () => void;
  /** Called when the operator confirms. */
  onConfirm: () => void;
  /** Disables both action buttons while the confirm's work runs in flight. */
  busy?: boolean;
  /**
   * Disables only the confirm button until the dialog's precondition is met
   * (e.g. the freeze flow's acknowledgement checkbox). Cancel stays live —
   * backing out must never require buying in first.
   */
  confirmDisabled?: boolean;
  /** Extra body content — e.g. the freeze flow's acknowledgement checkbox. */
  children?: ReactNode;
  /**
   * The control that opened the dialog, so focus returns to it on dismissal.
   * The trigger row is re-created when the dialog closes and React re-attaches
   * refs during the commit — before the hook's cleanup runs — so the ref points
   * at the live button at cleanup time; a snapshot of the element would be
   * detached (the row is unmounted while the dialog is open).
   */
  triggerRef?: React.RefObject<HTMLElement | null>;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);

  useModalFocus({ open: true, dialogRef, onClose, restoreFocus: triggerRef === undefined, triggerRef });

  return (
    <div className="modal-backdrop">
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledById}
        ref={dialogRef}
        tabIndex={-1}
      >
        <strong id={labelledById}>{title}</strong>
        <p className="tiny">{consequence}</p>
        {children}
        <div className="row">
          <button className="danger" disabled={busy || confirmDisabled} onClick={onConfirm}>
            {confirmLabel}
          </button>
          <button className="secondary" disabled={busy} onClick={onClose}>
            {cancelLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Shared modal focus mechanics: move focus into the dialog on open, keep Tab
 * cycling inside it, dismiss on Escape, and restore focus to the trigger when
 * the dialog unmounts.
 *
 * One implementation exists for every dialog in the app (the freeze confirm,
 * the address book, this component) — a second trap would be a second place to
 * get the keyboard rules wrong.
 */
export function useModalFocus({
  open,
  dialogRef,
  onClose,
  restoreFocus = true,
  triggerRef,
}: {
  open: boolean;
  dialogRef: React.RefObject<HTMLElement | null>;
  onClose: () => void;
  /** Restore focus to the previously-active element on close (default true). */
  restoreFocus?: boolean;
  /** Explicit element to restore focus to, instead of the saved prior element. */
  triggerRef?: React.RefObject<HTMLElement | null> | undefined;
}): void {
  useEffect(() => {
    if (!open) return;
    const dialog = dialogRef.current;
    if (!dialog) return;

    const focusables = () =>
      Array.from(
        dialog.querySelectorAll<HTMLElement>(
          'button:not([disabled]), input:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])',
        ),
      );

    // Remember where focus came from only when nothing else will provide it.
    const prior = restoreFocus && !triggerRef ? document.activeElement as HTMLElement | null : null;

    // Focus the dialog itself first, so a screen reader announces the title
    // before the operator tabs into its controls.
    dialog.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
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
      // Dismissal in any form (Escape, Cancel, or proceeding) returns focus to
      // the trigger. The cleanup runs after the dialog unmounts but while the
      // trigger row has been re-created and its ref re-attached, so reading
      // `.current` here is the whole point (see PanicPanel's original note).
      if (triggerRef) {
        // eslint-disable-next-line react-hooks/exhaustive-deps -- deliberate late ref read, see above
        triggerRef.current?.focus();
      } else if (restoreFocus) {
        prior?.focus();
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the trap is installed once per open; onClose/prior are stable within a dialog's lifetime
  }, [open]);
}
