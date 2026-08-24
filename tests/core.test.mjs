import test from "node:test";
import assert from "node:assert/strict";
import { createNewSave } from "../src/core/state.js";
import { advanceOffline, DAY_PHASES, settleOneDay } from "../src/core/day.js";
import { executeCommand } from "../src/core/engine.js";
import { deterministicRoll } from "../src/core/rng.js";
import { halfUp, sha256 } from "../src/core/utils.js";
import { validateNewSaveOptions } from "../src/core/new-save.js";

const NOW = Date.parse("2026-03-02T05:00:00Z");
const fresh = (seed = "test-seed") => createNewSave({ now: NOW, timezone: "UTC", save_seed: seed, save_id: `save_${seed}` });

test("TC-004/TC-056 half-up与SHA-256规范值", () => {
  assert.equal(halfUp(2.5), 3);
  assert.equal(halfUp(-2.5), -3);
  assert.equal(sha256("abc"), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
});

test("TC-004 RNG同键稳定且系统流隔离", () => {
  const a = deterministicRoll("seed", "weather", 8, "farm", 0);
  const b = deterministicRoll("seed", "weather", 8, "farm", 0);
  const c = deterministicRoll("seed", "animal", 8, "farm", 0);
  assert.deepEqual(a, b);
  assert.notEqual(a.digest, c.digest);
});

test("TC-009 action_id同载荷幂等、异载荷拒绝", () => {
  const state = fresh();
  const command = { action_id: "buy-1", type: "market.buy_seed", payload: { crop_id: "crop_turnip", quantity: 1 } };
  const first = executeCommand(state, command);
  const second = executeCommand(first.state, command);
  assert.equal(first.state.economy.cash, 2375);
  assert.equal(second.state.economy.cash, 2375);
  assert.equal(second.duplicate, true);
  assert.throws(() => executeCommand(first.state, { ...command, payload: { crop_id: "crop_turnip", quantity: 2 } }), /不同payload/);
});

test("TC-009/TC-014 不同action_id重复一次性日安排不重复扣WP，确认后不可追加", () => {
  let state = fresh("business-idempotency");
  const first = executeCommand(state, { action_id: "water-a", type: "crop.irrigate", payload: { plot_id: "plot_a" } });
  const second = executeCommand(first.state, { action_id: "water-b", type: "crop.irrigate", payload: { plot_id: "plot_a" } });
  assert.equal(second.state.work_plan.used_wp, 1);
  assert.equal(second.receipt.result.duplicate_business_action, true);
  state = executeCommand(second.state, { action_id: "clean-a", type: "housing.clean", payload: { housing_id: "housing_coop_1" } }).state;
  const cleanAgain = executeCommand(state, { action_id: "clean-b", type: "housing.clean", payload: { housing_id: "housing_coop_1" } });
  assert.equal(cleanAgain.state.work_plan.used_wp, 2);
  state = executeCommand(cleanAgain.state, { action_id: "confirm", type: "work.confirm", payload: {} }).state;
  assert.throws(() => executeCommand(state, { action_id: "late-task", type: "work.assign", payload: { wp: 1, focus: 0 } }), /已确认/);
});

test("肥力满时施肥不扣资金和WP，也不改变肥力", () => {
  const state = fresh("fertility-full-no-cost");
  state.plots[0].fertility = 100;
  const result = executeCommand(state, { action_id: "fertility-full", type: "crop.fertilize", payload: { plot_id: "plot_a", use_compost: false } });
  assert.equal(result.state.plots[0].fertility, 100);
  assert.equal(result.state.economy.cash, 2400);
  assert.equal(result.state.work_plan.used_wp, 0);
  assert.equal(result.receipt.result.already_full, true);
  assert.equal(result.receipt.result.duplicate_business_action, true);
});

test("TC-021 春1播种在春4成熟，后续节点可落在8/12/16/20", () => {
  let state = fresh("crop-nodes");
  state = executeCommand(state, { action_id: "plant-1", type: "crop.plant", payload: { plot_id: "plot_a", crop_id: "crop_turnip" } }).state;
  state = settleOneDay(state, { weather_id: "weather_cloudy" }).state;
  assert.equal(state.calendar.season_day, 2);
  assert.equal(state.plots[0].crop.growth_points, 1);
  state = settleOneDay(state, { weather_id: "weather_cloudy" }).state;
  state = settleOneDay(state, { weather_id: "weather_cloudy" }).state;
  assert.equal(state.calendar.season_day, 4);
  assert.equal(state.plots[0].crop.status, "mature");
  state = executeCommand(state, { action_id: "harvest-4", type: "crop.harvest", payload: { plot_id: "plot_a" } }).state;
  state.inventory.seed_cabinet.quantities.seed_turnip += 12;
  state = executeCommand(state, { action_id: "plant-4", type: "crop.plant", payload: { plot_id: "plot_a", crop_id: "crop_turnip" } }).state;
  for (let index = 0; index < 4; index += 1) state = settleOneDay(state, { weather_id: "weather_cloudy" }).state;
  assert.equal(state.calendar.season_day, 8);
  assert.equal(state.plots[0].crop.status, "mature");
});

test("TC-010/TC-011 十阶段顺序及每个failpoint保持输入前态", () => {
  const state = fresh("failpoints");
  const success = settleOneDay(state);
  assert.deepEqual(success.journal.phases, DAY_PHASES);
  for (const phase of DAY_PHASES) {
    assert.throws(() => settleOneDay(state, { failpoint: phase }), /模拟日结故障点/);
    assert.equal(state.calendar.absolute_day, 1);
    assert.equal(state.economy.cash, 2400);
    assert.equal(state.inventory.silo.quantities.item_feed, 42);
  }
});

test("TC-036 托管阶段2先补料：资金1000补7日，资金100仅补当日", () => {
  const rich = fresh("feed-rich");
  rich.inventory.silo.quantities.item_feed = 0;
  rich.economy.cash = 1000;
  rich.economy.ledger_opening_cash = 1000;
  const richResult = settleOneDay(rich).state;
  assert.equal(richResult.inventory.silo.quantities.item_feed, 18);
  assert.equal(richResult.animals.every((animal) => animal.satiety === 100), true);
  const poor = fresh("feed-poor");
  poor.inventory.silo.quantities.item_feed = 0;
  poor.economy.cash = 100;
  poor.economy.ledger_opening_cash = 100;
  const poorResult = settleOneDay(poor).state;
  assert.equal(poorResult.inventory.silo.quantities.item_feed, 0);
  assert.equal(poorResult.animals.every((animal) => animal.satiety === 100), true);
});

test("TC-045 离线1—3日全部逐日活跃结算且结果可复现", () => {
  for (const days of [1, 2, 3]) {
    const first = advanceOffline(fresh(`offline-short-${days}`), days);
    const second = advanceOffline(fresh(`offline-short-${days}`), days);
    assert.equal(first.active_days, days);
    assert.equal(first.rest_days, 0);
    assert.equal(first.state.calendar.absolute_day, days + 1);
    assert.equal(first.state.daily_ledgers.filter((entry) => entry.type === "daily_report").length, days);
    assert.equal(first.state.daily_ledgers.some((entry) => entry.type === "rest_freeze"), false);
    assert.deepEqual(first.state, second.state);
  }
});

test("TC-046 离线4—7日安全托管但不进入冻结", () => {
  for (const days of [4, 5, 6, 7]) {
    const result = advanceOffline(fresh(`offline-week-${days}`), days);
    assert.equal(result.active_days, days);
    assert.equal(result.rest_days, 0);
    assert.equal(result.state.calendar.absolute_day, days + 1);
    assert.equal(result.state.daily_ledgers.filter((entry) => entry.type === "daily_report").length, days);
    assert.equal(result.state.daily_ledgers.some((entry) => entry.type === "rest_freeze"), false);
    assert.equal(result.state.economy.cash >= 0, true);
    assert.equal(result.state.animals.every((animal) => animal.health > 0), true);
  }
});

test("TC-047 离线超过7日只模拟7日，其余日期休整推进", () => {
  const state = fresh("offline");
  const result = advanceOffline(state, 12);
  assert.equal(result.active_days, 7);
  assert.equal(result.rest_days, 5);
  assert.equal(result.state.calendar.absolute_day, 13);
  assert.equal(result.state.daily_ledgers.filter((entry) => entry.type === "daily_report").length, 7);
  assert.equal(result.state.daily_ledgers.filter((entry) => entry.type === "rest_freeze").length, 1);
});

test("TC-047 冻结期顺延订单/事件/延迟效果且跨年不伪造活跃报告", () => {
  const state = fresh("freeze-deadlines");
  state.calendar = { absolute_day: 78, year: 1, season: "winter", season_day: 15, week_block: 11 };
  state.orders.push({ id: "order_freeze", item_id: "item_egg", quantity: 2, minimum_quality: 0, deadline_day: 88, reward_multiplier: 1.2, publisher_id: "resident_shopkeeper", status: "accepted", reserved_quantity: 0 });
  state.events.active.push({ event_id: "event_farm_01_01", created_day: 78, deadline_day: 88, urgent: false, attention_cost: 1, exclusive_group: null, status: "pending" });
  state.events.scheduled_effects.push({ due_day: 88, source_event: "event_farm_01_01", source_choice: "choice_observe", effects: [{ type: "log", message: "冻结后处理" }], random: null });
  const result = advanceOffline(state, 14);
  assert.equal(result.active_days, 7); assert.equal(result.rest_days, 7);
  assert.equal(result.state.orders[0].status, "accepted");
  assert.equal(result.state.orders[0].deadline_day, 95);
  const pending = result.state.events.active.find((entry) => entry.event_id === "event_farm_01_01");
  assert.equal(pending.deadline_day, 95);
  assert.equal(result.state.events.scheduled_effects.find((entry) => entry.source_event === "event_farm_01_01").due_day, 95);
  assert.equal(result.state.annual_reports.length, 1, "仅7个活跃日内跨年时生成真实年度报告");
  assert.equal(result.state.recovery_archive.year_start[0].day, 85);
});

test("TC-047 冻结后作物宽限、周转期限及新日工时均暂停并重置", () => {
  let state = fresh("freeze-active-timers");
  state.work_plan.capacity = 1;
  state.work_plan.priority_overrides.feeding = 100;
  state.work_plan.priority_overrides.harvest = 0;
  state.plots[0].crop = { crop_id: "crop_turnip", planted_day: 1, health: 90, growth_points: 4, status: "mature", mature_day: 1, delayed_days: 0, health_sum: 90, health_days: 1, care: { timely_irrigation: true, weeded: true, timely_harvest: true }, severe_days: 0, harvest_index: 0, opening_day_credit: false };
  state.work_plan.used_wp = 1; state.work_plan.tasks = [{ id: "full", wp: 1, focus: 0 }];
  state.economy.assistance = { id: "finance_bridge_7d_v1", principal: 500, fee: 10, amount_due: 510, accepted_day: 1, due_day: 20, status: "active", compound_interest: false };
  const result = advanceOffline(state, 9).state;
  assert.equal(result.calendar.absolute_day, 10);
  assert.equal(result.work_plan.farm_day, 10); assert.equal(result.work_plan.used_wp, 0); assert.deepEqual(result.work_plan.tasks, []);
  assert.equal(result.economy.assistance.due_day, 22);
  assert.ok(result.plots[0].crop, "降低收获优先级后成熟作物应保留以验证冻结时钟");
  assert.equal(result.plots[0].crop.mature_day >= 3, true);
  assert.equal(result.plots[0].crop.delayed_days <= 6, true, "仅7个活跃日可累计成熟延迟");
});
test("TC-001 建档前验证IANA时区、0—8整点刷新并生成关键初始状态", () => {
  assert.deepEqual(validateNewSaveOptions("Asia/Shanghai", "5"), { timezone: "Asia/Shanghai", rollover_hour: 5 });
  assert.throws(() => validateNewSaveOptions("Not/A_Timezone", 5), /IANA/);
  assert.throws(() => validateNewSaveOptions("UTC", 9), /0—8/);
  assert.throws(() => validateNewSaveOptions("UTC", 1.5), /整点/);
  const state = fresh("initial-state");
  assert.equal(state.save_version, 1);
  assert.equal(state.calendar.absolute_day, 1);
  assert.equal(state.economy.cash, 2400);
  assert.equal(state.inventory.seed_cabinet.quantities.seed_turnip, 12);
  assert.equal(state.inventory.silo.quantities.item_feed, 42);
  assert.equal(state.animals.length, 3);
  assert.equal(state.work_plan.capacity, 12);
  assert.equal(state.work_plan.focus_capacity, 3);
});
