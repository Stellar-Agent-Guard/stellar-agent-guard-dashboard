import assert from "node:assert/strict";
import { describe, it, beforeEach, mock } from "node:test";
import { ToastStore } from "../../lib/guard/useToast.ts";

describe("ToastStore (issue #105)", () => {
  let store: ToastStore;

  beforeEach(() => {
    store = new ToastStore();
  });

  it("dispatches toasts with incrementing ids", () => {
    const a = store.dispatch({ kind: "success", title: "Sent" });
    const b = store.dispatch({ kind: "info", title: "Polled" });
    assert.notEqual(a, b);
    assert.equal(store.getSnapshot().length, 2);
    assert.equal(store.getSnapshot()[0]?.title, "Sent");
  });

  it("notifies subscribers on dispatch and dismiss", () => {
    let calls = 0;
    const unsubscribe = store.subscribe(() => {
      calls += 1;
    });
    const id = store.dispatch({ kind: "warning", title: "Slow" });
    store.dismiss(id);
    assert.equal(calls, 2);
    unsubscribe();
    store.dispatch({ kind: "info", title: "Quiet" });
    assert.equal(calls, 2);
  });

  it("auto-dismisses success toasts after their duration", () => {
    mock.timers.enable({ apis: ["setTimeout"] });
    try {
      const id = store.dispatch({
        kind: "success",
        title: "Sent",
        durationMs: 1000,
      });
      assert.equal(store.getSnapshot().length, 1);
      mock.timers.tick(1000);
      assert.equal(store.getSnapshot().length, 0);
      assert.ok(!store.getSnapshot().some((t) => t.id === id));
    } finally {
      mock.timers.reset();
    }
  });

  it("keeps error toasts until explicitly dismissed", () => {
    mock.timers.enable({ apis: ["setTimeout"] });
    try {
      const id = store.dispatch({
        kind: "error",
        title: "RPC failed",
        error: { message: "boom", status: 500, stack: "trace" },
      });
      mock.timers.tick(60_000);
      assert.equal(store.getSnapshot().length, 1);
      store.dismiss(id);
      assert.equal(store.getSnapshot().length, 0);
    } finally {
      mock.timers.reset();
    }
  });

  it("preserves error details payloads for the inspector", () => {
    store.dispatch({
      kind: "error",
      title: "RPC failed",
      error: { message: "horizon 503", status: 503, stack: "at x" },
    });
    const toast = store.getSnapshot()[0];
    assert.equal(toast?.error?.message, "horizon 503");
    assert.equal(toast?.error?.status, 503);
    assert.equal(toast?.error?.stack, "at x");
  });

  it("dismissing an unknown id is a no-op", () => {
    store.dispatch({ kind: "info", title: "Hi" });
    store.dismiss(9999);
    assert.equal(store.getSnapshot().length, 1);
  });

  it("caps visible toasts, protecting persistent errors", () => {
    for (let i = 0; i < 5; i += 1) {
      store.dispatch({ kind: "info", title: `n${i}`, durationMs: null });
    }
    const errId = store.dispatch({
      kind: "error",
      title: "RPC failed",
      error: { message: "boom" },
    });
    store.dispatch({ kind: "info", title: "overflow", durationMs: null });
    const titles = store.getSnapshot().map((t) => t.title);
    assert.equal(store.getSnapshot().length, 5);
    assert.ok(!titles.includes("n0"));
    assert.ok(store.getSnapshot().some((t) => t.id === errId));
  });

  it("clear empties the queue and cancels pending timers", () => {
    mock.timers.enable({ apis: ["setTimeout"] });
    try {
      store.dispatch({ kind: "success", title: "a", durationMs: 1000 });
      store.dispatch({ kind: "success", title: "b", durationMs: 1000 });
      store.clear();
      assert.equal(store.getSnapshot().length, 0);
      mock.timers.tick(5000);
      assert.equal(store.getSnapshot().length, 0);
    } finally {
      mock.timers.reset();
    }
  });
});
