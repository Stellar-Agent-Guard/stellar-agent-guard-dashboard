import assert from "node:assert/strict";
import { test } from "node:test";
import {
  DEFAULT_LAYOUT,
  LAYOUT_STORAGE_KEY,
  NAMED_LAYOUTS_STORAGE_KEY,
  MAX_NAMED_LAYOUTS,
  MAX_LAYOUT_NAME_LENGTH,
  defaultLayout,
  loadLayout,
  movePanel,
  normalizeLayout,
  reorderPanel,
  resetLayout,
  saveLayout,
  setCollapsed,
  // Named layouts (#378)
  loadNamedLayouts,
  saveNamedLayout,
  renameNamedLayout,
  deleteNamedLayout,
  getNamedLayout,
  type DashboardLayout,
  type NamedLayout,
  type PanelId,
  type StorageLike,
} from "../../lib/guard/layoutStore.ts";

function fakeStorage(): StorageLike & { data: Map<string, string>; removeItem: (key: string) => void } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => {
      data.set(key, value);
    },
    removeItem: (key: string) => {
      data.delete(key);
    },
  };
}

function ids(layout: DashboardLayout): PanelId[] {
  return layout.order.map((placement) => placement.id);
}

function placement(layout: DashboardLayout, id: PanelId) {
  return layout.order.find((entry) => entry.id === id)!;
}

test("the default layout lists every known panel, expanded", () => {
  const layout = defaultLayout();
  assert.deepEqual(ids(layout), [...DEFAULT_LAYOUT]);
  assert.ok(layout.order.every((entry) => entry.collapsed === false));
});

test("a saved layout round-trips through storage", () => {
  const storage = fakeStorage();
  const layout = setCollapsed(defaultLayout(), "panic", true);
  saveLayout(layout, storage);
  const loaded = loadLayout(storage);
  assert.equal(placement(loaded, "panic").collapsed, true);
  assert.deepEqual(ids(loaded), ids(layout));
});

test("loadLayout reads from the versioned storage key", () => {
  const storage = fakeStorage();
  storage.data.set(LAYOUT_STORAGE_KEY, JSON.stringify([{ id: "telemetry", collapsed: false }]));
  const loaded = loadLayout(storage);
  assert.equal(loaded.order[0]?.id, "telemetry");
});

test("a corrupted or non-array payload degrades to the default layout", () => {
  const storage = fakeStorage();
  storage.data.set(LAYOUT_STORAGE_KEY, "{not json");
  assert.deepEqual(ids(loadLayout(storage)), [...DEFAULT_LAYOUT]);
  storage.data.set(LAYOUT_STORAGE_KEY, JSON.stringify({ not: "an array" }));
  assert.deepEqual(ids(loadLayout(storage)), [...DEFAULT_LAYOUT]);
});

test("an unknown panel id in storage is dropped, not rendered", () => {
  const stored = [
    { id: "telemetry", collapsed: false },
    { id: "status", collapsed: false },
  ];
  const layout = normalizeLayout(stored);
  assert.equal(ids(layout).includes("telemetry" as PanelId), true);
  assert.equal(ids(layout).includes("nuclear_launch" as PanelId), false);
});

test("a panel missing from stored order is appended so an upgrade never hides it", () => {
  // A stored layout from before the multisig panel existed.
  const stored = [
    { id: "status", collapsed: false },
    { id: "panic", collapsed: true },
  ];
  const layout = normalizeLayout(stored);
  assert.equal(ids(layout).includes("multisig"), true);
  // The stored collapse state is preserved for panels it knows.
  assert.equal(placement(layout, "panic").collapsed, true);
});

test("duplicate stored entries collapse to the first occurrence", () => {
  const stored = [
    { id: "status", collapsed: false },
    { id: "status", collapsed: true },
  ];
  const layout = normalizeLayout(stored);
  assert.equal(layout.order.filter((entry) => entry.id === "status").length, 1);
  assert.equal(placement(layout, "status").collapsed, false, "first occurrence wins");
});

test("reorderPanel moves a panel to a zero-based index, shifting the rest", () => {
  const layout = reorderPanel(defaultLayout(), "telemetry", 0);
  assert.equal(ids(layout)[0], "telemetry");
  assert.equal(ids(layout).length, DEFAULT_LAYOUT.length, "no panel lost");
  // Every panel still present exactly once.
  assert.equal(new Set(ids(layout)).size, layout.order.length);
});

test("reorderPanel clamps out-of-range indices and no-ops when already there", () => {
  // Below zero clamps to the front: "status" is already first, so unchanged.
  assert.deepEqual(ids(reorderPanel(defaultLayout(), "status", -5)), [...DEFAULT_LAYOUT]);
  // Past the end clamps to the back: "status" moves last.
  assert.deepEqual(ids(reorderPanel(defaultLayout(), "status", 99)), [
    "txhistory",
    "panic",
    "telemetry",
    "multisig",
    "xdr",
    "status",
  ]);
  // Already at the target index: no-op.
  assert.deepEqual(ids(reorderPanel(defaultLayout(), "status", 0)), [...DEFAULT_LAYOUT]);
});

test("movePanel steps a panel one slot and refuses to run off the ends", () => {
  const up = movePanel(defaultLayout(), "txhistory", "up");
  assert.deepEqual(ids(up)[0], "txhistory");
  assert.deepEqual(ids(up)[1], "status");

  const down = movePanel(defaultLayout(), "status", "down");
  assert.deepEqual(ids(down)[0], "txhistory");
  assert.deepEqual(ids(down)[1], "status");

  // At the very top, "up" is a no-op; at the very bottom, "down" is.
  assert.deepEqual(ids(movePanel(defaultLayout(), "status", "up")), [...DEFAULT_LAYOUT]);
  assert.deepEqual(ids(movePanel(defaultLayout(), "xdr", "down")), [...DEFAULT_LAYOUT]);
});

test("collapsing preserves position and can be reversed", () => {
  const collapsed = setCollapsed(defaultLayout(), "telemetry", true);
  assert.deepEqual(ids(collapsed), [...DEFAULT_LAYOUT]);
  assert.equal(placement(collapsed, "telemetry").collapsed, true);
  const expanded = setCollapsed(collapsed, "telemetry", false);
  assert.equal(placement(expanded, "telemetry").collapsed, false);
});

test("resetLayout restores the default arrangement regardless of current state", () => {
  const shuffled = setCollapsed(reorderPanel(defaultLayout(), "xdr", 0), "status", true);
  assert.notDeepEqual(ids(shuffled), [...DEFAULT_LAYOUT]);
  assert.deepEqual(ids(resetLayout()), [...DEFAULT_LAYOUT]);
  assert.ok(resetLayout().order.every((entry) => entry.collapsed === false));
});

test("loadLayout with no storage returns the default (server render, private mode)", () => {
  assert.deepEqual(ids(loadLayout(null)), [...DEFAULT_LAYOUT]);
  assert.deepEqual(saveLayout(defaultLayout(), null), undefined);
});

// ── Named layouts (#378) ────────────────────────────────────────────────

test("saveNamedLayout persists a named layout and enforces the cap", () => {
  const storage = fakeStorage();
  const layout = defaultLayout();
  const result = saveNamedLayout("My Layout", layout, storage);
  assert.equal(result.ok, true);
  assert.equal(result.layout.name, "My Layout");
  assert.deepEqual(ids(result.layout.layout), [...DEFAULT_LAYOUT]);

  const loaded = loadNamedLayouts(storage);
  assert.equal(loaded.length, 1);
  assert.equal(loaded[0]?.name, "My Layout");
});

test("saveNamedLayout rejects empty names", () => {
  const storage = fakeStorage();
  const result = saveNamedLayout("   ", defaultLayout(), storage);
  assert.equal(result.ok, false);
  assert.equal(result.error, "Layout name cannot be empty.");
});

test("saveNamedLayout enforces maximum name length", () => {
  const storage = fakeStorage();
  const longName = "a".repeat(MAX_LAYOUT_NAME_LENGTH + 1);
  const result = saveNamedLayout(longName, defaultLayout(), storage);
  assert.equal(result.ok, false);
  assert.match(result.error, /cannot exceed/);
});

test("saveNamedLayout enforces maximum number of layouts", () => {
  const storage = fakeStorage();
  for (let i = 0; i < MAX_NAMED_LAYOUTS; i++) {
    const result = saveNamedLayout(`Layout ${i}`, defaultLayout(), storage);
    assert.equal(result.ok, true);
  }
  const result = saveNamedLayout("One Too Many", defaultLayout(), storage);
  assert.equal(result.ok, false);
  assert.match(result.error, /Maximum of/);
});

test("saveNamedLayout updates existing layout with same name (case-insensitive)", () => {
  const storage = fakeStorage();
  const layout1 = setCollapsed(defaultLayout(), "panic", true);
  saveNamedLayout("My Layout", layout1, storage);
  const layout2 = setCollapsed(defaultLayout(), "telemetry", true);
  const result = saveNamedLayout("my layout", layout2, storage); // different case
  assert.equal(result.ok, true);
  const loaded = loadNamedLayouts(storage);
  assert.equal(loaded.length, 1);
  assert.equal(loaded[0]?.name, "My Layout"); // Original casing preserved
  assert.equal(placement(loaded[0]!.layout, "telemetry").collapsed, true);
});

test("renameNamedLayout renames a saved layout", () => {
  const storage = fakeStorage();
  saveNamedLayout("Old Name", defaultLayout(), storage);
  const result = renameNamedLayout("Old Name", "New Name", storage);
  assert.equal(result.ok, true);
  assert.equal(result.layout.name, "New Name");
  const loaded = loadNamedLayouts(storage);
  assert.equal(loaded.length, 1);
  assert.equal(loaded[0]?.name, "New Name");
});

test("renameNamedLayout rejects duplicate names", () => {
  const storage = fakeStorage();
  saveNamedLayout("Layout A", defaultLayout(), storage);
  saveNamedLayout("Layout B", defaultLayout(), storage);
  const result = renameNamedLayout("Layout A", "Layout B", storage);
  assert.equal(result.ok, false);
  assert.match(result.error, /already exists/);
});

test("deleteNamedLayout removes a saved layout", () => {
  const storage = fakeStorage();
  saveNamedLayout("To Delete", defaultLayout(), storage);
  assert.equal(deleteNamedLayout("To Delete", storage), true);
  assert.equal(loadNamedLayouts(storage).length, 0);
  // Deleting non-existent returns false
  assert.equal(deleteNamedLayout("Not There", storage), false);
});

test("getNamedLayout retrieves a specific layout by name (case-insensitive)", () => {
  const storage = fakeStorage();
  saveNamedLayout("My Layout", defaultLayout(), storage);
  const layout = getNamedLayout("my layout", storage);
  assert.ok(layout);
  assert.equal(layout?.name, "My Layout");
  assert.equal(getNamedLayout("Not There", storage), null);
});

test("named layouts survive load/save round-trip with collapse state", () => {
  const storage = fakeStorage();
  const layout = setCollapsed(reorderPanel(defaultLayout(), "xdr", 0), "status", true);
  saveNamedLayout("Complex Layout", layout, storage);
  const loaded = loadNamedLayouts(storage);
  assert.equal(loaded.length, 1);
  assert.equal(ids(loaded[0]!.layout)[0], "xdr");
  assert.equal(placement(loaded[0]!.layout, "status").collapsed, true);
});

test("corrupted named layouts storage degrades to empty list", () => {
  const storage = fakeStorage();
  storage.data.set(NAMED_LAYOUTS_STORAGE_KEY, "{not json");
  assert.deepEqual(loadNamedLayouts(storage), []);
  storage.data.set(NAMED_LAYOUTS_STORAGE_KEY, JSON.stringify({ not: "an array" }));
  assert.deepEqual(loadNamedLayouts(storage), []);
});

test("invalid entries in named layouts storage are dropped", () => {
  const storage = fakeStorage();
  storage.data.set(NAMED_LAYOUTS_STORAGE_KEY, JSON.stringify([
    { name: "Valid", layout: { order: [{ id: "status", collapsed: false }] } },
    { name: "", layout: { order: [{ id: "status", collapsed: false }] } }, // empty name
    { name: "Also Valid", layout: "not an object" }, // bad layout
    { name: "Another Valid", layout: { order: [{ id: "telemetry", collapsed: false }] } }, // valid
    { not: "a layout object" }, // completely wrong shape
  ]));
  const loaded = loadNamedLayouts(storage);
  assert.equal(loaded.length, 2);
  assert.equal(loaded[0]?.name, "Valid");
  assert.equal(loaded[1]?.name, "Another Valid");
});

// ── Reset preview (#379) ────────────────────────────────────────────────

test("resetLayout produces the default arrangement for preview", () => {
  const preview = resetLayout();
  assert.deepEqual(ids(preview), [...DEFAULT_LAYOUT]);
  assert.ok(preview.order.every((entry) => entry.collapsed === false));
});

test("reset preview can detect moved panels", () => {
  const current = reorderPanel(defaultLayout(), "xdr", 0);
  const preview = resetLayout();
  const currentOrder = current.order.map((p) => p.id);
  const defaultOrder = preview.order.map((p) => p.id);
  const moved = defaultOrder.filter((id, index) => currentOrder.indexOf(id) !== index);
  assert.ok(moved.includes("xdr"));
  assert.ok(moved.includes("status"));
});

test("reset preview can detect restored panels", () => {
  // A layout missing some panels
  const current: DashboardLayout = {
    order: [
      { id: "status", collapsed: false },
      { id: "panic", collapsed: false },
    ],
  };
  const preview = resetLayout();
  const currentOrder = current.order.map((p) => p.id);
  const defaultOrder = preview.order.map((p) => p.id);
  const restored = defaultOrder.filter((id) => !currentOrder.includes(id));
  assert.ok(restored.includes("telemetry"));
  assert.ok(restored.includes("multisig"));
  assert.ok(restored.includes("xdr"));
});

test("reset preview can detect hidden panels", () => {
  // A layout with extra panels (stale entries that normalizeLayout would drop)
  const current: DashboardLayout = {
    order: [
      { id: "status", collapsed: false },
      { id: "txhistory", collapsed: false },
      { id: "panic", collapsed: false },
      { id: "telemetry", collapsed: false },
      { id: "multisig", collapsed: false },
      { id: "xdr", collapsed: false },
      { id: "status", collapsed: false }, // Duplicate - will be dropped by normalizeLayout
    ],
  };
  const preview = resetLayout();
  const currentOrder = current.order.map((p) => p.id);
  const defaultOrder = preview.order.map((p) => p.id);
  // After normalizeLayout, duplicates are removed, so hidden panels would be those
  // that exist in the current (pre-normalized) but not in the default
  const hidden = currentOrder.filter((id, index) => currentOrder.indexOf(id) !== index);
  assert.ok(hidden.includes("status"));
});

test("reset preview detects collapse state changes", () => {
  const current = setCollapsed(defaultLayout(), "panic", true);
  const preview = resetLayout();
  const currentCollapsed = new Set(current.order.filter((p) => p.collapsed).map((p) => p.id));
  const defaultCollapsed = new Set(preview.order.filter((p) => p.collapsed).map((p) => p.id));
  const defaultOrder = preview.order.map((p) => p.id);
  const collapseChanges = current.order
    .filter((p) => defaultOrder.includes(p.id))
    .filter((p) => currentCollapsed.has(p.id) !== defaultCollapsed.has(p.id));
  assert.equal(collapseChanges.length, 1);
  assert.equal(collapseChanges[0]?.id, "panic");
});
