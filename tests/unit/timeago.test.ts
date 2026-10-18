import assert from "node:assert/strict";
import { describe, it, before, test } from "node:test";
import { formatTimeAgo, formatRemaining } from "../../lib/guard/time.ts";
import { installDom, loadReact, type Act } from "./domHarness.ts";
import { TimeAgo } from "../../components/bits.tsx";
import fs from "node:fs/promises";

installDom();

let react: typeof import("react");
let createRoot: typeof import("react-dom/client").createRoot;
let act: Act;

before(async () => {
  const loaded = await loadReact();
  react = loaded.react;
  createRoot = loaded.createRoot;
  act = loaded.act;
});

describe("formatTimeAgo", () => {
  const fixedNow = 1700000000n; // arbitrary deterministic "now"

  it("returns 'just now' for diff < 10s (boundary at 9s)", () => {
    assert.equal(formatTimeAgo(fixedNow - 0n, fixedNow), "just now");
    assert.equal(formatTimeAgo(fixedNow - 9n, fixedNow), "just now");
  });

  it("returns seconds for diff < 60s (boundary at 10s and 59s)", () => {
    assert.equal(formatTimeAgo(fixedNow - 10n, fixedNow), "10s");
    assert.equal(formatTimeAgo(fixedNow - 59n, fixedNow), "59s");
  });

  it("returns minutes for diff < 60m (boundary at 60s and 3599s)", () => {
    assert.equal(formatTimeAgo(fixedNow - 60n, fixedNow), "1m");
    assert.equal(formatTimeAgo(fixedNow - 119n, fixedNow), "1m");
    assert.equal(formatTimeAgo(fixedNow - 3599n, fixedNow), "59m");
  });

  it("returns hours for diff < 24h (boundary at 3600s and 86399s)", () => {
    assert.equal(formatTimeAgo(fixedNow - 3600n, fixedNow), "1h");
    assert.equal(formatTimeAgo(fixedNow - 7199n, fixedNow), "1h");
    assert.equal(formatTimeAgo(fixedNow - 86399n, fixedNow), "23h");
  });

  it("returns days for diff >= 24h (boundary at 86400s)", () => {
    assert.equal(formatTimeAgo(fixedNow - 86400n, fixedNow), "1d");
    assert.equal(formatTimeAgo(fixedNow - 172800n, fixedNow), "2d");
  });

  it("handles clock skew gracefully by capping at 0s (future timestamps)", () => {
    assert.equal(formatTimeAgo(fixedNow + 10n, fixedNow), "just now");
    assert.equal(formatTimeAgo(fixedNow + 3600n, fixedNow), "just now");
  });

  it("supports number input deterministically", () => {
    const fixedNowNum = 1700000000;
    assert.equal(formatTimeAgo(fixedNowNum - 45, fixedNowNum), "45s");
    assert.equal(formatTimeAgo(fixedNowNum - 4000, fixedNowNum), "1h");
  });
});

describe("formatRemaining", () => {
  it("returns 'now' for sub-minute remaining (0s and 59s)", () => {
    assert.deepEqual(formatRemaining(0n), { text: "now", expired: false });
    assert.deepEqual(formatRemaining(59n), { text: "now", expired: false });
  });

  it("returns exact minutes at 60s boundary", () => {
    assert.deepEqual(formatRemaining(60n), { text: "1m", expired: false });
    assert.deepEqual(formatRemaining(119n), { text: "1m", expired: false });
    assert.deepEqual(formatRemaining(3599n), { text: "59m", expired: false });
  });

  it("returns hours at 3600s boundary", () => {
    assert.deepEqual(formatRemaining(3600n), { text: "1h", expired: false });
    assert.deepEqual(formatRemaining(7199n), { text: "1h", expired: false });
    assert.deepEqual(formatRemaining(86399n), { text: "23h", expired: false });
  });

  it("returns days at 86400s boundary", () => {
    assert.deepEqual(formatRemaining(86400n), { text: "1d", expired: false });
    assert.deepEqual(formatRemaining(172800n), { text: "2d", expired: false });
  });

  it("signals expired via separate return for negative values", () => {
    assert.deepEqual(formatRemaining(-1n), { text: "expired", expired: true });
    assert.deepEqual(formatRemaining(-180n), { text: "expired", expired: true });
  });

  it("caps large values at 999d+", () => {
    assert.deepEqual(formatRemaining(999n * 86400n), { text: "999d+", expired: false });
    assert.deepEqual(formatRemaining(10475n * 86400n), { text: "999d+", expired: false });
  });

  it("accepts bigint u64 seconds without float precision loss", () => {
    // 2^53 + 1 seconds would lose precision as a JS number; bigint must be exact.
    const big = 9007199254740993n * 86400n;
    assert.deepEqual(formatRemaining(big), { text: "999d+", expired: false });
  });

  it("supports number input deterministically", () => {
    assert.deepEqual(formatRemaining(45), { text: "now", expired: false });
    assert.deepEqual(formatRemaining(4000), { text: "1h", expired: false });
    assert.deepEqual(formatRemaining(-5), { text: "expired", expired: true });
  });
});

test("<TimeAgo /> renders relative text and absolute ISO timestamp attributes", async () => {
  const fixtureUrl = new URL("../fixtures/phase3-proof.json", import.meta.url);
  const data = JSON.parse(await fs.readFile(fixtureUrl, "utf8"));
  const iso = data.ranAt;

  assert.equal(typeof iso, "string");

  const container = document.createElement("div");
  document.body.appendChild(container);

  let root: ReturnType<typeof createRoot> | undefined;
  await act(async () => {
    root = createRoot(container);
    root.render(react.createElement(TimeAgo, { iso }));
  });

  const timeEl = container.querySelector("time.timeago") as HTMLTimeElement;
  assert.ok(timeEl, "a <time> element should be rendered");

  assert.equal(timeEl.getAttribute("datetime"), iso);
  assert.equal(timeEl.getAttribute("title"), iso);

  const relText = timeEl.textContent;
  assert.ok(
    relText && /^(just now|\d+[smhd])$/.test(relText),
    `Rendered text "${relText}" should match relative time format`,
  );

  await act(async () => {
    root?.unmount();
  });
  container.remove();
});