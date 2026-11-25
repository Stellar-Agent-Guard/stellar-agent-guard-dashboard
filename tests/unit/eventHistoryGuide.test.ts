import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { test } from "node:test";
import { BOOKMARK_CAP } from "../../lib/guard/investigations.ts";
import { FEED_GUARD_CAP } from "../../lib/guard/feedSubscriptions.ts";
import { OVERDUE_INTERVALS } from "../../lib/guard/feedHealth.ts";
import { POLLING } from "../../lib/guard/polling.ts";
import { AVERAGE_LEDGER_CLOSE_SECS } from "../../lib/guard/ledgerTime.ts";
import {
  FEED_GAP_LIMIT,
  FEED_SWITCH_HISTORY_LEDGERS,
  STREAM_BUFFER_LIMIT,
} from "../../lib/guard/telemetry.ts";

/**
 * `docs/concepts/historical-event-availability.md` (#491) is the one place that
 * answers "how far back can this table go, and what does an empty result prove".
 * It is operational writing, so these tests are the drift guard for the numbers
 * in it: every ceiling is read from the module that sets it, so retuning a
 * constant reddens the document that quotes it. The alternative — a page of
 * round numbers nobody checks — is how documentation ends up teaching operators
 * the wrong limit.
 */
const DOC_PATH = "docs/concepts/historical-event-availability.md";

function doc(): string {
  return readFileSync(DOC_PATH, "utf8");
}

test("the document walks its sections in reading order", () => {
  const content = doc();
  const sections = [
    "The two sources, and the one that is not on chain",
    "Four ceilings",
    "How the live tail advances",
    "Retention is the endpoint's decision",
    "What a time-range query actually asks for",
    "Gap indicators, and what they can prove",
    "What no indicator can see",
    "Reading the health line",
    "Checking independently",
    "Keeping evidence past the window",
    "Boundaries",
  ];
  let cursor = -1;
  for (const section of sections) {
    const found = content.indexOf(section, cursor + 1);
    assert.notEqual(found, -1, `missing section: ${section}`);
    assert.ok(found > cursor, `section out of order: ${section}`);
    cursor = found;
  }
});

test("every ceiling quoted in the document is the value the code sets", () => {
  const content = doc();
  // Numbers first: a stale limit in a page an operator trusts is worse than no page.
  assert.match(content, new RegExp(`pollOnce\\(limit = 50\\)`), "the live page size");
  assert.match(content, /pollRange\(range, limit = 200\)/, "the range-query page size");
  assert.ok(
    content.includes(String(STREAM_BUFFER_LIMIT)),
    `buffer rows held (${STREAM_BUFFER_LIMIT})`,
  );
  assert.match(content, new RegExp(`STREAM_BUFFER_LIMIT`));
  assert.ok(content.includes(String(FEED_GUARD_CAP)), "the tailing cap");
  assert.match(content, new RegExp(`FEED_GUARD_CAP`));
  assert.ok(content.includes(String(FEED_GAP_LIMIT)), "the remembered gap ranges");
  assert.match(content, new RegExp(`FEED_GAP_LIMIT`));
  assert.ok(
    content.includes(String(FEED_SWITCH_HISTORY_LEDGERS)),
    "the ledgers a fresh feed is primed to",
  );
  assert.match(content, new RegExp(`FEED_SWITCH_HISTORY_LEDGERS`));
  assert.ok(content.includes(String(OVERDUE_INTERVALS)), "the overdue window in intervals");
  assert.match(content, new RegExp(`OVERDUE_INTERVALS`));
  assert.ok(
    content.includes(String(BOOKMARK_CAP)),
    `the bookmark cap (${BOOKMARK_CAP}) an operator falls back on`,
  );
  assert.match(content, new RegExp(`BOOKMARK_CAP`));
});

test("the cadence and the latency floor are stated as the polling module sets them", () => {
  const content = doc();
  assert.ok(
    content.includes(String(POLLING.feedMs)),
    `the feed poll interval (${POLLING.feedMs} ms) is quoted`,
  );
  assert.match(content, /POLLING\.feedMs/);
  assert.match(content, /\[4000, 5000\)/, "jitter narrows the cadence, and says by how much");
  assert.ok(
    content.includes(String(AVERAGE_LEDGER_CLOSE_SECS)),
    "the ledger close estimate is quoted",
  );
  assert.match(content, /AVERAGE_LEDGER_CLOSE_SECS/);
  assert.match(content, /no push stream/, "why polling faster cannot help");
});

test("the retention boundary is named as the RPC's own field, not a dashboard setting", () => {
  const content = doc();
  assert.match(content, /oldestLedger/, "the field that carries the boundary");
  assert.match(content, /getEvents/);
  assert.match(content, /NEXT_PUBLIC_RPC_URL/, "which endpoint decides it");
  assert.match(content, /a client\s+can negotiate/, "the window is not the dashboard's to set");
  assert.match(
    content,
    /console can fetch them back/,
    "and once gone, nothing here can re-read it",
  );
  assert.match(content, /rejected by the RPC/, "too-old queries fail loudly, not silently empty");
});

test("both gap reasons are documented with what each can and cannot say", () => {
  const content = doc();
  assert.match(content, /history_pruned/);
  assert.match(content, /cursor_regressed/);
  assert.match(content, /Events were missed and cannot be recovered/);
  assert.match(content, /The affected range is unknown|range is unknown/);
  assert.match(content, /last known-good position/, "a regressed cursor is not adopted");
  assert.match(content, /unsettled/, "one kind of finding clears on the next consistent round");
  assert.match(
    content,
    /whether the page contained any events is not an input/i,
    "an empty page is not treated as a gap",
  );
});

test("the limits no indicator can see are listed, not smoothed over", () => {
  const content = doc();
  assert.match(content, /A short page[\s\S]*indistinguishable from a quiet chain/);
  assert.match(
    content,
    /Refusals produced elsewhere/,
    "another client's refusals have no trace here at all",
  );
  assert.match(content, /beyond the five tailed slots/);
  assert.match(content, /tab (?:is closed|was closed)/, "nothing polls with the tab shut");
});

test("the empty-result honesty rule appears in the document and in the panel copy it links", () => {
  const content = doc();
  assert.match(
    content,
    /a missing event looks exactly like an event that never\s+happened/,
    "the premise the whole page exists to state",
  );
  const feedScreen = readFileSync("docs/screens/telemetry-feed.md", "utf8");
  assert.match(
    feedScreen,
    /an\s+empty table is not evidence that nothing happened/i,
    "the screen doc states the same rule the in-app notice does",
  );
  assert.match(
    feedScreen,
    /A quiet guard, a stopped watch, a pruned\s+ledger range and an unreachable endpoint all render as no rows/,
    "and names the four absences that look identical",
  );
  const panel = readFileSync("components/TelemetryFeed.tsx", "utf8");
  assert.match(
    panel,
    /empty feed is not evidence that nothing was\s+refused/,
    "the pre-existing refusal notice is unchanged",
  );
});

test("the health phases are documented as the health module defines them", () => {
  const content = doc();
  for (const phase of ["off", "pending", "healthy", "overdue", "failing"]) {
    // `\s+` before the closing pipe: prettier pads table cells for alignment.
    assert.match(content, new RegExp(`\\| \`${phase}\`\\s+\\|`), `phase ${phase} is explained`);
  }
  assert.match(content, /emptyIsFault/, "the quiet-versus-broken distinction is named");
  // Prettier spells markdown emphasis with underscores, so that is what lands.
  assert.match(content, /last round that _returned_ and the last one that was _attempted_/);
});

test("the verification section tells an operator how to check without this console", () => {
  const content = doc();
  assert.match(content, /getLatestLedger/);
  assert.match(content, /"method": "getEvents"/);
  assert.match(content, /contractIds/);
  assert.match(content, /cursor` back|passing that/, "pagination is by cursor");
  assert.match(content, /Horizon archive|Stellar CLI/, "an outside authority for older history");
});

test("the client-only, non-custodial boundary is restated where it matters", () => {
  const content = doc();
  assert.match(content, /no API route/);
  assert.match(content, /no server-side collector/);
  assert.match(content, /stores\nkey material|no server-side collector[\s\S]*key material/);
  assert.match(content, /Live chain reads are the authority/);
});

test("the document is reachable from the summary and from the two pages it expands", () => {
  const summary = readFileSync("docs/SUMMARY.md", "utf8");
  assert.match(summary, /\(concepts\/historical-event-availability\.md\)/);
  const feedScreen = readFileSync("docs/screens/telemetry-feed.md", "utf8");
  assert.match(feedScreen, /\(\.\.\/concepts\/historical-event-availability\.md\)/);
  const exportSchema = readFileSync("docs/export-schema.md", "utf8");
  assert.match(exportSchema, /\(\.\/concepts\/historical-event-availability\.md\)/);
});

test("the in-app links point at this file, at all four absence points", () => {
  const panel = readFileSync("components/TelemetryFeed.tsx", "utf8");
  // The href the component builds must resolve to the file this test reads.
  const href = /const EVENT_HISTORY_DOC_HREF =\s*\n?\s*"([^"]+)"/.exec(panel)?.[1];
  assert.ok(href, "the panel declares one availability document");
  assert.match(href, /blob\/main\/docs\/concepts\/historical-event-availability\.md$/);
  const repoPath = href.replace(
    "https://github.com/Stellar-Agent-Guard/stellar-agent-guard-dashboard/blob/main/",
    "",
  );
  assert.equal(repoPath, DOC_PATH, "the link target is this document");
  assert.ok(existsSync(repoPath), `${repoPath} exists on disk`);

  const callSites = panel.match(/<AvailabilityDocLink /g) ?? [];
  assert.equal(
    callSites.length,
    4,
    "health line, gap notice, watched-but-empty table and filtered-empty table each link it",
  );
});

test("every repository docs link written into the UI resolves to a real file", () => {
  // The panel's links are absolute blob URLs, which the markdown link checker
  // skips by design (it makes no network request). This is the local half of
  // that check: a `docs/...` path quoted in source has to exist in this tree.
  const sources = [
    "components/TelemetryFeed.tsx",
    "components/RecoveryGuidance.tsx",
    "lib/guard/recoveryGuidance.ts",
  ];
  const found: string[] = [];
  for (const file of sources) {
    const content = readFileSync(file, "utf8");
    for (const match of content.matchAll(/\/(docs\/[A-Za-z0-9._/-]+\.md)/g)) {
      found.push(match[1]!);
    }
  }
  assert.ok(found.length >= 4, "the scan is not silently finding nothing");
  for (const path of new Set(found)) {
    assert.ok(existsSync(path), `${path} is linked from the UI but does not exist`);
  }
});
