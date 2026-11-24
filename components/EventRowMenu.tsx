"use client";

/**
 * The keyboard-operable action menu on a telemetry row (#533).
 *
 * Copy and details used to be reachable only through pointer-sized controls
 * inside the cells. This is one menu button per row that follows the WAI-ARIA
 * menu-button pattern:
 *
 *   - Enter / Space / ArrowDown open it (ArrowUp opens on the last item); focus
 *     moves to the first item.
 *   - ArrowUp / ArrowDown / Home / End move between items, wrapping at the ends.
 *   - Escape closes it and returns focus to the button; so does choosing an item
 *     or clicking elsewhere. Tab closes it and carries on to the next control,
 *     so the feed's normal tab order is never trapped.
 *
 * The button's name carries the row context ("Actions for Authorization decision,
 * blocked, ledger 100"), so a screen reader hears which row a menu belongs to
 * rather than a column of identical "Actions" buttons. The menu is rendered
 * inline (not a floating popup) so a scrolling table can never clip it.
 *
 * A failed copy is reported in a visible status line and announced, never
 * swallowed: the clipboard API is absent in insecure contexts.
 */

import { useEffect, useId, useRef, useState } from "react";
import { copyToClipboard } from "../lib/guard/clipboard.ts";
import { announce } from "../lib/guard/useAnnounce.ts";

/**
 * Where focus goes for a navigation key, or `null` when the key is not one the
 * menu handles. Wraps at both ends, like a native menu.
 */
export function nextMenuIndex(key: string, current: number, count: number): number | null {
  if (count <= 0) return null;
  switch (key) {
    case "ArrowDown":
      return (current + 1) % count;
    case "ArrowUp":
      return (current - 1 + count) % count;
    case "Home":
      return 0;
    case "End":
      return count - 1;
    default:
      return null;
  }
}

export interface EventDetail {
  label: string;
  value: string;
}

export function EventRowMenu({
  rowLabel,
  contractId,
  transactionHash,
  details,
}: {
  /** Plain-text row context, spoken as part of the button's name. */
  rowLabel: string;
  contractId: string | null;
  transactionHash: string | null;
  details: EventDetail[];
}) {
  const [open, setOpen] = useState(false);
  const [showDetails, setShowDetails] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  // Which item to focus once the menu has rendered: first on open, last for ArrowUp.
  const pendingFocus = useRef<"first" | "last">("first");
  const menuId = useId();
  const detailsId = useId();

  const items: Array<{ id: string; label: string; run: () => void }> = [];
  if (contractId) {
    items.push({
      id: "copy-contract",
      label: "Copy contract address",
      run: () => void copy(contractId, "contract address"),
    });
  }
  if (transactionHash) {
    items.push({
      id: "copy-tx",
      label: "Copy transaction hash",
      run: () => void copy(transactionHash, "transaction hash"),
    });
  }
  items.push({
    id: "details",
    label: showDetails ? "Hide details" : "Show details",
    run: () => {
      const next = !showDetails;
      setShowDetails(next);
      announce(next ? "Event details shown" : "Event details hidden");
    },
  });

  function itemButtons(): HTMLButtonElement[] {
    return Array.from(
      menuRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? [],
    );
  }

  async function copy(text: string, noun: string): Promise<void> {
    const result = await copyToClipboard(text);
    if (result.ok) {
      setStatus(`Copied ${noun}`);
      announce(`Copied ${noun}`);
    } else {
      const message = `Could not copy the ${noun}: ${result.error}`;
      setStatus(message);
      announce(message, "assertive");
    }
  }

  function closeAndRestore() {
    setOpen(false);
    buttonRef.current?.focus();
  }

  useEffect(() => {
    if (!open) return;
    const buttons = itemButtons();
    (pendingFocus.current === "last" ? buttons[buttons.length - 1] : buttons[0])?.focus();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent): void => {
      const target = event.target as Node;
      if (menuRef.current?.contains(target) || buttonRef.current?.contains(target)) return;
      // A pointer dismissal must not steal focus from what was clicked.
      setOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [open]);

  function onButtonKeyDown(event: React.KeyboardEvent<HTMLButtonElement>) {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      pendingFocus.current = event.key === "ArrowUp" ? "last" : "first";
      setOpen(true);
    }
  }

  function onMenuKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      closeAndRestore();
      return;
    }
    if (event.key === "Tab") {
      // Hand focus back to the button first; the browser then moves on from there,
      // so Tab continues through the feed instead of dropping focus to the page.
      setOpen(false);
      buttonRef.current?.focus();
      return;
    }
    const buttons = itemButtons();
    const current = buttons.indexOf(document.activeElement as HTMLButtonElement);
    const next = nextMenuIndex(event.key, current, buttons.length);
    if (next !== null) {
      event.preventDefault();
      buttons[next]?.focus();
    }
  }

  return (
    <div className="row-menu">
      <button
        ref={buttonRef}
        type="button"
        className="secondary"
        style={{ padding: "4px 8px", fontSize: "0.8em" }}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label={`Actions for ${rowLabel}`}
        onClick={() => {
          pendingFocus.current = "first";
          if (open) closeAndRestore();
          else setOpen(true);
        }}
        onKeyDown={onButtonKeyDown}
      >
        Actions
      </button>
      {open && (
        <div
          id={menuId}
          ref={menuRef}
          role="menu"
          aria-label={`Actions for ${rowLabel}`}
          className="row-menu-list"
          onKeyDown={onMenuKeyDown}
        >
          {items.map((item) => (
            <button
              key={item.id}
              type="button"
              role="menuitem"
              tabIndex={-1}
              className="secondary"
              onClick={() => {
                item.run();
                closeAndRestore();
              }}
            >
              {item.label}
            </button>
          ))}
        </div>
      )}
      {status && (
        <div className="tiny muted" role="status">
          {status}
        </div>
      )}
      {showDetails && (
        <dl id={detailsId} className="tiny row-menu-details" aria-label={`Details for ${rowLabel}`}>
          {details.map((detail) => (
            <div key={detail.label}>
              <dt className="muted">{detail.label}</dt>
              <dd className="mono">{detail.value}</dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  );
}
