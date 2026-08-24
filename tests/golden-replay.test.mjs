import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { runGoldenReplay } from "../src/core/simulation.js";
import { sha256 } from "../src/core/utils.js";

const v1Text = await readFile(new URL("../fixtures/golden-replays-v1.json", import.meta.url), "utf8");
const v2Text = await readFile(new URL("../fixtures/golden-replays-v2.json", import.meta.url), "utf8");
const v1 = JSON.parse(v1Text);
const v2 = JSON.parse(v2Text);

test("TC-058 历史v1与当前内容机械v2黄金基线共存且因果明确", () => {
  assert.equal(sha256(v1Text), "3751ab36124b1b47270d86b405442fcbeba350a7466e24d7f056d2caeba6c8bd");
  assert.equal(v1.format, "farm-journal-golden-replays-v1");
  assert.equal(v2.format, "farm-journal-golden-replays-v2-current-content-mechanics");
  assert.equal(v1.seed, v2.seed);
  assert.match(v2.supersedes_reason, /mechanical choices/);
  assert.deepEqual({ day: v2.first_divergence.display_day, event: v2.first_divergence.event_id, before: v2.first_divergence.legacy_choice_id, after: v2.first_divergence.current_choice_id }, {
    day: 2, event: "event_resident_01_01", before: "choice_observe", after: "choice_connect_01",
  });
  assert.match(v2.first_divergence.cause, /mechanical effects/);
});

test("TC-058 当前7/21/84日黄金回放逐字段命中v2且不同于历史v1", () => {
  for (const days of [7, 21, 84]) {
    const replay = runGoldenReplay(days, v2.seed);
    const expected = v2.checkpoints[String(days)];
    for (const field of ["final_day", "cash", "state_hash", "log_hash"]) assert.equal(replay[field], expected[field], `${days}日${field}`);
    assert.notEqual(replay.state_hash, v1.checkpoints[String(days)].state_hash, `${days}日应与v1历史状态区分`);
    assert.equal(replay.unexpected_errors, 0);
  }
});
