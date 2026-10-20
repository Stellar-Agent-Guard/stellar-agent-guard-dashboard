"use client";

/**
 * The dashboard's widget grid (#149, #378, #379).
 *
 * Wraps the console's panels in a layout the operator controls: drag a panel
 * by its handle to reorder it, use the Move up/Move down buttons for the same
 * thing by keyboard, collapse a panel to a title bar when it is not wanted on
 * screen, and reset to the default arrangement. Preferences persist in
 * `localStorage` across sessions via `layoutStore.ts`.
 *
 * Drag-and-drop is native HTML5 drag events over the same `reorderPanel`
 * helper the buttons use, so the two input paths share one state transition —
 * the drag handle is a real button carrying `aria-grabbed` semantics, and no
 * reordering is reachable *only* by pointer.
 *
 * Named layouts (#378): operators can save a small number of named panel
 * arrangements and switch between them. Layouts are local presentation
 * preferences only; they never affect guard or chain state.
 *
 * Reset preview (#379): shows which panels will move or be restored before
 * resetting a customized dashboard layout, with a cancel path that leaves the
 * current arrangement intact.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import {
  loadLayout,
  movePanel,
  reorderPanel,
  resetLayout,
  saveLayout,
  setCollapsed,
  type DashboardLayout,
  type PanelId,
  // Named layouts (#378)
  loadNamedLayouts,
  saveNamedLayout,
  renameNamedLayout,
  deleteNamedLayout,
  getNamedLayout,
  MAX_NAMED_LAYOUTS,
  MAX_LAYOUT_NAME_LENGTH,
  type NamedLayout,
} from "../lib/guard/layoutStore.ts";
import { useAnnounce } from "../lib/guard/useAnnounce.ts";
import { createPortal } from "react-dom";

export interface GridPanel {
  id: PanelId;
  title: string;
  /** The panel's own content. Rendered inside its card. */
  content: ReactNode;
}

const PANEL_TITLE_ID = (id: PanelId): string => `panel-title-${id}`;

export function DashboardGrid({ panels }: { panels: GridPanel[] }) {
  const [layout, setLayout] = useState<DashboardLayout | null>(null);
  const [dragging, setDragging] = useState<PanelId | null>(null);
  // Named layouts state (#378)
  const [namedLayouts, setNamedLayouts] = useState<NamedLayout[]>(() => loadNamedLayouts());
  const [activeLayoutName, setActiveLayoutName] = useState<string | null>(null);
  const [showSaveLayoutDialog, setShowSaveLayoutDialog] = useState(false);
  const [newLayoutName, setNewLayoutName] = useState("");
  const [renameLayoutName, setRenameLayoutName] = useState("");
  const [layoutToRename, setLayoutToRename] = useState<NamedLayout | null>(null);
  // Reset preview state (#379)
  const [showResetPreview, setShowResetPreview] = useState(false);
  const [resetPreviewLayout, setResetPreviewLayout] = useState<DashboardLayout | null>(null);
  const announce = useAnnounce();

  // Load the persisted layout after mount (never during render), so server and
  // client markup agree on the first paint — the console's hydration rule.
  // The setState is deferred to a macrotask-flavoured callback via a queued
  // microtask-free approach: the lint rule forbids synchronous setState in an
  // effect body, and the subscription seam below is the idiomatic "react to an
  // external system" shape. `loadLayout` reads localStorage, an external
  // system, and this effect is its subscription point.
  useEffect(() => {
    let cancelled = false;
    const read = () => {
      if (cancelled) return;
      setLayout(loadLayout());
    };
    // `requestAnimationFrame` defers past the effect body; jsdom's
    // `pretendToBeVisual` provides it in tests too.
    const frame = requestAnimationFrame(read);
    return () => {
      cancelled = true;
      cancelAnimationFrame(frame);
    };
  }, []);

  // Load named layouts on mount
  useEffect(() => {
    let cancelled = false;
    const read = () => {
      if (cancelled) return;
      setNamedLayouts(loadNamedLayouts());
    };
    const frame = requestAnimationFrame(read);
    return () => {
      cancelled = true;
      cancelAnimationFrame(frame);
    };
  }, []);

  const persist = (next: DashboardLayout) => {
    setLayout(next);
    saveLayout(next);
  };

  const byId = useMemo(() => new Map(panels.map((panel) => [panel.id, panel])), [panels]);

  if (layout === null) {
    // First paint: the default order, no interaction, so hydration matches.
    return (
      <div>
        {panels.map((panel) => (
          <section key={panel.id} className="panel" aria-labelledby={PANEL_TITLE_ID(panel.id)}>
            <h2 style={{ margin: 0 }} id={PANEL_TITLE_ID(panel.id)}>
              {panel.title}
            </h2>
            {panel.content}
          </section>
        ))}
      </div>
    );
  }

  const move = (id: PanelId, direction: "up" | "down") => {
    const index = layout.order.findIndex((placement) => placement.id === id);
    const target = direction === "up" ? index - 1 : index + 1;
    if (target < 0 || target >= layout.order.length) return;
    persist(movePanel(layout, id, direction));
    const neighbour = layout.order[target];
    announce(`${neighbour?.id ?? "panel"} and ${id} swapped position`);
  };

  const dropOn = (targetId: PanelId) => {
    if (dragging === null || dragging === targetId) return;
    const toIndex = layout.order.findIndex((placement) => placement.id === targetId);
    persist(reorderPanel(layout, dragging, toIndex));
    announce(`${dragging} moved to position ${toIndex + 1}`);
    setDragging(null);
  };

  // Named layout actions (#378)
  const handleSaveLayout = () => {
    const name = newLayoutName.trim();
    if (!name) return;
    const result = saveNamedLayout(name, layout);
    if (result.ok) {
      setNamedLayouts(loadNamedLayouts());
      setActiveLayoutName(result.layout.name);
      setShowSaveLayoutDialog(false);
      setNewLayoutName("");
      announce(`Layout "${result.layout.name}" saved`);
    } else {
      announce(`Failed to save layout: ${result.error}`);
    }
  };

  const handleLoadNamedLayout = (namedLayout: NamedLayout) => {
    persist(namedLayout.layout);
    setActiveLayoutName(namedLayout.name);
    announce(`Layout "${namedLayout.name}" loaded`);
  };

  const handleRenameLayout = () => {
    if (!layoutToRename || !renameLayoutName.trim()) return;
    const result = renameNamedLayout(layoutToRename.name, renameLayoutName.trim());
    if (result.ok) {
      setNamedLayouts(loadNamedLayouts());
      if (activeLayoutName === layoutToRename.name) {
        setActiveLayoutName(result.layout.name);
      }
      setLayoutToRename(null);
      setRenameLayoutName("");
      announce(`Layout renamed to "${result.layout.name}"`);
    } else {
      announce(`Failed to rename layout: ${result.error}`);
    }
  };

  const handleDeleteLayout = (name: string) => {
    if (deleteNamedLayout(name)) {
      setNamedLayouts(loadNamedLayouts());
      if (activeLayoutName === name) {
        setActiveLayoutName(null);
      }
      announce(`Layout "${name}" deleted`);
    }
  };

  // Reset preview (#379)
  const handleResetPreview = () => {
    const defaultLayoutResult = resetLayout();
    setResetPreviewLayout(defaultLayoutResult);
    setShowResetPreview(true);
  };

  const handleConfirmReset = () => {
    if (resetPreviewLayout) {
      persist(resetPreviewLayout);
      setActiveLayoutName(null);
      announce("Layout reset to default");
    }
    setShowResetPreview(false);
    setResetPreviewLayout(null);
  };

  const handleCancelReset = () => {
    setShowResetPreview(false);
    setResetPreviewLayout(null);
  };

  const getResetPreviewChanges = () => {
    if (!resetPreviewLayout) return { moved: [] as string[], restored: [] as string[], hidden: [] as string[] };
    const currentOrder = layout.order.map((p) => p.id);
    const defaultOrder = resetPreviewLayout.order.map((p) => p.id);
    const currentCollapsed = new Set(layout.order.filter((p) => p.collapsed).map((p) => p.id));
    const defaultCollapsed = new Set(resetPreviewLayout.order.filter((p) => p.collapsed).map((p) => p.id));

    const moved: string[] = [];
    const restored: string[] = [];
    const hidden: string[] = [];

    defaultOrder.forEach((id, index) => {
      const currentIndex = currentOrder.indexOf(id);
      if (currentIndex === -1) {
        restored.push(id);
      } else if (currentIndex !== index) {
        moved.push(id);
      }
    });

    currentOrder.forEach((id) => {
      if (!defaultOrder.includes(id)) {
        hidden.push(id);
      }
    });

    // Check collapsed state changes
    currentOrder.forEach((id) => {
      if (defaultOrder.includes(id)) {
        const wasCollapsed = currentCollapsed.has(id);
        const willBeCollapsed = defaultCollapsed.has(id);
        if (wasCollapsed !== willBeCollapsed) {
          if (willBeCollapsed) {
            moved.push(`${id} (will collapse)`);
          } else {
            moved.push(`${id} (will expand)`);
          }
        }
      }
    });

    return { moved, restored, hidden };
  };

  return (
    <div>
      {layout.order.map((placement, index) => {
        const panel = byId.get(placement.id);
        // A placement without a matching panel (a stale storage entry for a
        // panel this build does not render) is skipped rather than rendered
        // as an empty card.
        if (!panel) return null;
        return (
          <section
            key={placement.id}
            className="panel"
            aria-labelledby={PANEL_TITLE_ID(placement.id)}
            onDragOver={(event) => event.preventDefault()}
            onDrop={() => dropOn(placement.id)}
          >
            <div
              className="row"
              style={{ justifyContent: "space-between", marginBottom: placement.collapsed ? 0 : 8 }}
            >
              <div className="row" style={{ gap: 6 }}>
                <button
                  type="button"
                  className="secondary"
                  style={{ cursor: "grab", padding: "4px 8px" }}
                  draggable
                  onDragStart={() => setDragging(placement.id)}
                  onDragEnd={() => setDragging(null)}
                  aria-label={`Drag handle: ${panel.title}. Position ${index + 1} of ${layout.order.length}`}
                  aria-grabbed={dragging === placement.id}
                  title="Drag to reorder"
                >
                  ⠿
                </button>
                <h2 style={{ margin: 0 }} id={PANEL_TITLE_ID(placement.id)}>
                  {panel.title}
                </h2>
              </div>
              <div className="row" style={{ gap: 6 }}>
                <button
                  type="button"
                  className="secondary"
                  onClick={() => move(placement.id, "up")}
                  disabled={index === 0}
                  aria-label={`Move ${panel.title} earlier`}
                >
                  ↑
                </button>
                <button
                  type="button"
                  className="secondary"
                  onClick={() => move(placement.id, "down")}
                  disabled={index === layout.order.length - 1}
                  aria-label={`Move ${panel.title} later`}
                >
                  ↓
                </button>
                <button
                  type="button"
                  className="secondary"
                  onClick={() => {
                    const collapsed = !placement.collapsed;
                    persist(setCollapsed(layout, placement.id, collapsed));
                    announce(`${panel.title} ${collapsed ? "collapsed" : "expanded"}`);
                  }}
                  aria-expanded={!placement.collapsed}
                  aria-controls={`panel-body-${placement.id}`}
                >
                  {placement.collapsed ? "Expand" : "Collapse"}
                </button>
              </div>
            </div>
            {placement.collapsed ? null : (
              <div id={`panel-body-${placement.id}`}>{panel.content}</div>
            )}
          </section>
        );
      })}
      <LayoutToolbar
        onResetPreview={handleResetPreview}
        namedLayouts={namedLayouts}
        activeLayoutName={activeLayoutName}
        onLoadNamedLayout={handleLoadNamedLayout}
        onSaveLayout={() => setShowSaveLayoutDialog(true)}
        onRenameLayout={(l) => {
          setLayoutToRename(l);
          setRenameLayoutName(l.name);
        }}
        onDeleteLayout={handleDeleteLayout}
        showSaveLayoutDialog={showSaveLayoutDialog}
        setShowSaveLayoutDialog={setShowSaveLayoutDialog}
        newLayoutName={newLayoutName}
        setNewLayoutName={setNewLayoutName}
        onConfirmSaveLayout={handleSaveLayout}
        showResetPreview={showResetPreview}
        resetPreviewChanges={getResetPreviewChanges()}
        onConfirmReset={handleConfirmReset}
        onCancelReset={handleCancelReset}
        layoutToRename={layoutToRename}
        renameLayoutName={renameLayoutName}
        setRenameLayoutName={setRenameLayoutName}
        onConfirmRename={handleRenameLayout}
        MAX_NAMED_LAYOUTS={MAX_NAMED_LAYOUTS}
        MAX_LAYOUT_NAME_LENGTH={MAX_LAYOUT_NAME_LENGTH}
      />
      {showSaveLayoutDialog && createPortal(
        <SaveLayoutDialog
          isOpen={showSaveLayoutDialog}
          onClose={() => { setShowSaveLayoutDialog(false); setNewLayoutName(""); }}
          newLayoutName={newLayoutName}
          setNewLayoutName={setNewLayoutName}
          onSave={handleSaveLayout}
          MAX_LAYOUT_NAME_LENGTH={MAX_LAYOUT_NAME_LENGTH}
        />,
        document.body
      )}
      {layoutToRename && createPortal(
        <RenameLayoutDialog
          isOpen={!!layoutToRename}
          onClose={() => { setLayoutToRename(null); setRenameLayoutName(""); }}
          layoutName={layoutToRename.name}
          renameLayoutName={renameLayoutName}
          setRenameLayoutName={setRenameLayoutName}
          onRename={handleRenameLayout}
          MAX_LAYOUT_NAME_LENGTH={MAX_LAYOUT_NAME_LENGTH}
        />,
        document.body
      )}
      {showResetPreview && resetPreviewLayout && createPortal(
        <ResetPreviewDialog
          isOpen={showResetPreview}
          onClose={handleCancelReset}
          changes={getResetPreviewChanges()}
          onConfirm={handleConfirmReset}
        />,
        document.body
      )}
    </div>
  );
}

function LayoutToolbar({
  onResetPreview,
  namedLayouts,
  activeLayoutName,
  onLoadNamedLayout,
  onSaveLayout,
  onRenameLayout,
  onDeleteLayout,
  showSaveLayoutDialog,
  setShowSaveLayoutDialog,
  newLayoutName,
  setNewLayoutName,
  onConfirmSaveLayout,
  showResetPreview,
  resetPreviewChanges,
  onConfirmReset,
  onCancelReset,
  layoutToRename,
  renameLayoutName,
  setRenameLayoutName,
  onConfirmRename,
  MAX_NAMED_LAYOUTS,
  MAX_LAYOUT_NAME_LENGTH,
}: {
  onResetPreview: () => void;
  namedLayouts: NamedLayout[];
  activeLayoutName: string | null;
  onLoadNamedLayout: (layout: NamedLayout) => void;
  onSaveLayout: () => void;
  onRenameLayout: (layout: NamedLayout) => void;
  onDeleteLayout: (name: string) => void;
  showSaveLayoutDialog: boolean;
  setShowSaveLayoutDialog: (show: boolean) => void;
  newLayoutName: string;
  setNewLayoutName: (name: string) => void;
  onConfirmSaveLayout: () => void;
  showResetPreview: boolean;
  resetPreviewChanges: { moved: string[]; restored: string[]; hidden: string[] };
  onConfirmReset: () => void;
  onCancelReset: () => void;
  layoutToRename: NamedLayout | null;
  renameLayoutName: string;
  setRenameLayoutName: (name: string) => void;
  onConfirmRename: () => void;
  MAX_NAMED_LAYOUTS: number;
  MAX_LAYOUT_NAME_LENGTH: number;
}) {
  const canSave = namedLayouts.length < MAX_NAMED_LAYOUTS || activeLayoutName !== null;

  return (
    <div className="row" style={{ justifyContent: "flex-end", gap: 8, flexWrap: "wrap", marginTop: 16 }}>
      {/* Named layouts dropdown */}
      {namedLayouts.length > 0 && (
        <div className="row" style={{ gap: 6, alignItems: "center" }}>
          <label style={{ fontSize: 12, color: "var(--muted)" }}>Layout:</label>
          <select
            value={activeLayoutName ?? ""}
            onChange={(e) => {
              const name = e.target.value;
              if (name) {
                const layout = namedLayouts.find((l) => l.name === name);
                if (layout) onLoadNamedLayout(layout);
              } else {
                onResetPreview(); // Treat empty selection as reset preview
              }
            }}
            style={{ minWidth: 180, padding: "4px 8px" }}
          >
            <option value="">— Default —</option>
            {namedLayouts.map((l) => (
              <option key={l.name} value={l.name}>
                {l.name} {l.name === activeLayoutName ? "(active)" : ""}
              </option>
            ))}
          </select>
        </div>
      )}

      {/* Save layout button */}
      {canSave && (
        <button type="button" className="secondary" onClick={onSaveLayout} disabled={!canSave}>
          {activeLayoutName ? "Update Layout" : "Save Layout"}
        </button>
      )}

      {/* Reset layout button (shows preview) */}
      <button type="button" className="secondary" onClick={onResetPreview}>
        Reset Layout
      </button>
    </div>
  );
}

function SaveLayoutDialog({
  isOpen,
  onClose,
  newLayoutName,
  setNewLayoutName,
  onSave,
  MAX_LAYOUT_NAME_LENGTH,
}: {
  isOpen: boolean;
  onClose: () => void;
  newLayoutName: string;
  setNewLayoutName: (name: string) => void;
  onSave: () => void;
  MAX_LAYOUT_NAME_LENGTH: number;
}) {
  if (!isOpen) return null;

  const handleKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === "Escape") {
      onClose();
    } else if (event.key === "Enter" && newLayoutName.trim()) {
      onSave();
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="save-layout-title"
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={handleKeyDown}
      >
        <strong id="save-layout-title">Save Layout</strong>
        <p className="tiny muted">
          Enter a name for this panel arrangement. Maximum {MAX_LAYOUT_NAME_LENGTH} characters.
        </p>
        <label className="field" style={{ marginTop: 12 }}>
          <input
            value={newLayoutName}
            onChange={(e) => setNewLayoutName(e.target.value)}
            placeholder="My Layout"
            maxLength={MAX_LAYOUT_NAME_LENGTH}
            aria-label="Layout name"
            autoFocus
          />
        </label>
        <div className="row" style={{ justifyContent: "flex-end", marginTop: 12 }}>
          <button className="secondary" onClick={onClose}>
            Cancel
          </button>
          <button onClick={onSave} disabled={!newLayoutName.trim()}>
            Save
          </button>
        </div>
      </div>
    </div>
  );
}

function RenameLayoutDialog({
  isOpen,
  onClose,
  layoutName,
  renameLayoutName,
  setRenameLayoutName,
  onRename,
  MAX_LAYOUT_NAME_LENGTH,
}: {
  isOpen: boolean;
  onClose: () => void;
  layoutName: string;
  renameLayoutName: string;
  setRenameLayoutName: (name: string) => void;
  onRename: () => void;
  MAX_LAYOUT_NAME_LENGTH: number;
}) {
  if (!isOpen) return null;

  const handleKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === "Escape") {
      onClose();
    } else if (event.key === "Enter" && renameLayoutName.trim()) {
      onRename();
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="rename-layout-title"
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={handleKeyDown}
      >
        <strong id="rename-layout-title">Rename Layout</strong>
        <p className="tiny muted">
          Enter a new name for &ldquo;{layoutName}&rdquo;. Maximum {MAX_LAYOUT_NAME_LENGTH} characters.
        </p>
        <label className="field" style={{ marginTop: 12 }}>
          <input
            value={renameLayoutName}
            onChange={(e) => setRenameLayoutName(e.target.value)}
            placeholder="New name"
            maxLength={MAX_LAYOUT_NAME_LENGTH}
            aria-label="New layout name"
            autoFocus
          />
        </label>
        <div className="row" style={{ justifyContent: "flex-end", marginTop: 12 }}>
          <button className="secondary" onClick={onClose}>
            Cancel
          </button>
          <button onClick={onRename} disabled={!renameLayoutName.trim()}>
            Rename
          </button>
        </div>
      </div>
    </div>
  );
}

function ResetPreviewDialog({
  isOpen,
  onClose,
  changes,
  onConfirm,
}: {
  isOpen: boolean;
  onClose: () => void;
  changes: { moved: string[]; restored: string[]; hidden: string[] };
  onConfirm: () => void;
}) {
  if (!isOpen) return null;

  const hasChanges = changes.moved.length > 0 || changes.restored.length > 0 || changes.hidden.length > 0;

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="reset-preview-title"
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
      >
        <strong id="reset-preview-title">Reset Layout Preview</strong>
        <p className="tiny muted">
          This will restore the default panel arrangement. The following changes will occur:
        </p>
        {hasChanges ? (
          <>
            {changes.restored.length > 0 && (
              <div style={{ marginTop: 8 }}>
                <strong className="tiny">Panels restored:</strong>
                <ul className="tiny" style={{ margin: "4px 0 0 18px" }}>
                  {changes.restored.map((id) => (
                    <li key={id}>{id}</li>
                  ))}
                </ul>
              </div>
            )}
            {changes.moved.length > 0 && (
              <div style={{ marginTop: 8 }}>
                <strong className="tiny">Panels moved:</strong>
                <ul className="tiny" style={{ margin: "4px 0 0 18px" }}>
                  {changes.moved.map((id, index) => (
                    <li key={index}>{id}</li>
                  ))}
                </ul>
              </div>
            )}
            {changes.hidden.length > 0 && (
              <div style={{ marginTop: 8 }}>
                <strong className="tiny">Panels hidden (not in default layout):</strong>
                <ul className="tiny" style={{ margin: "4px 0 0 18px" }}>
                  {changes.hidden.map((id) => (
                    <li key={id}>{id}</li>
                  ))}
                </ul>
              </div>
            )}
          </>
        ) : (
          <p className="tiny muted" style={{ marginTop: 8 }}>
            The layout is already at the default arrangement.
          </p>
        )}
        <div className="row" style={{ justifyContent: "flex-end", marginTop: 16 }}>
          <button className="secondary" onClick={onClose}>
            Cancel
          </button>
          <button className="danger" onClick={onConfirm} disabled={!hasChanges}>
            Confirm Reset
          </button>
        </div>
      </div>
    </div>
  );
}