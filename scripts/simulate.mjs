import { WEATHER_WEIGHTS } from "../src/content/definitions.js";
import { runAllSimulations } from "../src/core/simulation.js";
import { readFile } from "node:fs/promises";

const result = runAllSimulations();
const frequencyFailures = [];
for (const [season, expected] of Object.entries(WEATHER_WEIGHTS)) {
  const observed = result.weather.season_counts[season];
  const total = Object.values(observed).reduce((sum, count) => sum + count, 0);
  for (const [weatherId, weight] of Object.entries(expected)) {
    const frequency = ((observed[weatherId] ?? 0) / total) * 100;
    if (Math.abs(frequency - weight) > 1.5) frequencyFailures.push(`${season}:${weatherId} ${frequency.toFixed(3)} vs ${weight}`);
  }
}
if (result.weather.constraint_violations) throw new Error(`天气连续性约束失败${result.weather.constraint_violations}次`);
if (frequencyFailures.length) throw new Error(`天气频率超出±1.5百分点\n${frequencyFailures.join("\n")}`);
if (result.events.violations) throw new Error(`事件导演约束失败${result.events.violations}次`);
if (result.invariants.violations) throw new Error(`属性不变量失败${result.invariants.violations}次`);
if (result.strategies.violations) throw new Error(`84日策略模拟失败${result.strategies.violations}个策略`);
const historicalGolden = JSON.parse(await readFile(new URL("../fixtures/golden-replays-v1.json", import.meta.url), "utf8"));
if (historicalGolden.format !== "farm-journal-golden-replays-v1") throw new Error("TC-058 历史v1黄金基线缺失或被覆盖");
const goldenBaseline = JSON.parse(await readFile(new URL("../fixtures/golden-replays-v2.json", import.meta.url), "utf8"));
if (goldenBaseline.format !== "farm-journal-golden-replays-v2-current-content-mechanics") throw new Error("TC-058 当前v2黄金基线格式无效");
for (const replay of result.golden) {
  const expected = goldenBaseline.checkpoints[String(replay.days)];
  for (const field of ["final_day", "cash", "state_hash", "log_hash"]) if (replay[field] !== expected[field]) throw new Error(`TC-058 ${replay.days}日黄金回放${field}漂移: ${replay[field]} != ${expected[field]}`);
  if (replay.unexpected_errors) throw new Error(`TC-058 ${replay.days}日黄金回放出现未分类异常`);
}
if (result.strategies.strategies.some((entry) => entry.unexpected_errors)) throw new Error("TC-059 策略模拟出现未分类异常");
if (result.strategies.semantic_activity.profit_processing_completions < 3) throw new Error("TC-059 利润策略未真实完成加工");
if (result.strategies.semantic_activity.animal_purchases !== 6
  || result.strategies.semantic_activity.duck_purchases !== 3
  || result.strategies.semantic_activity.large_animal_purchases !== 3
  || result.strategies.semantic_activity.completed_barns !== 3
  || result.strategies.semantic_activity.animal_species_exercised.length !== 5) throw new Error("TC-059 动物策略未覆盖鸭、畜棚与三种大动物闭环");
if (result.strategies.semantic_activity.generated_order_weeks !== 18 * 12
  || result.strategies.semantic_activity.delivered_order_source_weeks.length < 2
  || result.strategies.semantic_activity.late_order_deliveries < 1) throw new Error("TC-059 未覆盖完整84日周订单节奏");
if (result.strategies.semantic_activity.accepted_orders < 1 || result.strategies.semantic_activity.delivered_orders !== result.strategies.semantic_activity.accepted_orders) throw new Error("TC-059 可履约订单未形成接受/交付闭环");
console.log(JSON.stringify({
  status: "passed",
  weather: { seasons: result.weather.seasons, constraint_violations: result.weather.constraint_violations },
  events: result.events,
  invariants: result.invariants,
  golden: result.golden.map(({ days, final_day, cash, state_hash, log_hash }) => ({ days, final_day, cash, state_hash, log_hash })),
  strategies: result.strategies,
}, null, 2));
