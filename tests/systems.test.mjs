import test from "node:test";
import assert from "node:assert/strict";
import { ANIMAL_SPECIES, BUILDINGS, CROPS, EVENTS, RECIPES, WEATHER } from "../src/content/definitions.js";
import { advanceCalendar, halfUp } from "../src/core/utils.js";
import { createNewSave } from "../src/core/state.js";
import { recomputeCashFromLedger, settleOneDay } from "../src/core/day.js";
import { deterministicRound } from "../src/core/rng.js";
import { executeCommand } from "../src/core/engine.js";
import { animalDefinition, animalProductQuality, diseaseProbability, eggProbability, productionProbability, updateAnimals } from "../src/rules/animals.js";
import { applyEffects, relationshipChange } from "../src/rules/dsl.js";
import { generateDailyEvents } from "../src/rules/events.js";
import { addItem, ageInventory, availableQuantity, queueForSale, retractSaleLot, storageUsed } from "../src/rules/inventory.js";
import { priceLots } from "../src/rules/economy.js";
import { generateWeeklyOrders } from "../src/rules/orders.js";
import { cancelProcessing, queueProcessing } from "../src/rules/processing.js";
import { activateReadyConstruction, cancelConstruction, investConstruction, startConstruction } from "../src/rules/construction.js";
import { forecastWork, housingCareCost, prioritizeTasks } from "../src/rules/work.js";
import { cropQuality, harvestCrop, updatePlots } from "../src/rules/crops.js";
import { qualityTier } from "../src/rules/economy.js";
import { makeForecast } from "../src/rules/weather.js";
import { rollExplorationQuantity } from "../src/rules/exploration.js";

const NOW = Date.parse("2026-03-02T05:00:00Z");
const make = (seed = "systems") => createNewSave({ now: NOW, timezone: "UTC", save_seed: seed, save_id: `save_${seed}` });

function growingTurnip(overrides = {}) {
  return {
    crop_id: "crop_turnip", planted_day: 1, health: 90, growth_points: 0,
    status: "growing", mature_day: null, delayed_days: 0, health_sum: 0,
    health_days: 0, care: { timely_irrigation: false, weeded: false, timely_harvest: true },
    severe_days: 0, harvest_index: 0, opening_day_credit: false, ...overrides,
  };
}

test("TC-014 WP超载按医疗>喂养>收获>灌溉>建设>探索，不静默吞任务", () => {
  const result = prioritizeTasks([
    { id: "explore", wp: 2, priority: 10 }, { id: "feed", wp: 2, priority: 90 },
    { id: "medical", wp: 4, priority: 100 }, { id: "harvest", wp: 4, priority: 80 },
    { id: "build", wp: 4, priority: 50 },
  ], 12);
  assert.deepEqual(result.accepted.map((task) => task.id), ["medical", "feed", "harvest", "explore"]);
  assert.deepEqual(result.rejected.map((task) => task.id), ["build"]);
});

test("TC-021 季末不足首次成熟拒绝播种且不扣种子/工时", () => {
  const state = make();
  state.calendar = { absolute_day: 21, year: 1, season: "spring", season_day: 21, week_block: 2 };
  const beforeSeeds = state.inventory.seed_cabinet.quantities.seed_turnip;
  assert.throws(() => executeCommand(state, { action_id: "late-plant", type: "crop.plant", payload: { plot_id: "plot_a", crop_id: "crop_turnip" } }), /不足首次成熟/);
  assert.equal(state.inventory.seed_cabinet.quantities.seed_turnip, beforeSeeds);
  assert.equal(state.work_plan.used_wp, 0);
});

test("TC-030 保质期在ceil(50%/80%)各扣一次，age>life过期，新产出当日不老化", () => {
  const state = make("aging");
  addItem(state, "item_cabbage", 1, 80, { source: "test" });
  const lot = state.inventory.warehouse.lots[0];
  ageInventory(state);
  assert.equal(lot.age, 0);
  state.calendar = advanceCalendar(state.calendar, 1); ageInventory(state);
  assert.equal(lot.quality, 80);
  state.calendar = advanceCalendar(state.calendar, 1); ageInventory(state);
  assert.equal(lot.quality, 75);
  state.calendar = advanceCalendar(state.calendar, 1); ageInventory(state);
  assert.equal(lot.quality, 75);
  state.calendar = advanceCalendar(state.calendar, 1); ageInventory(state);
  assert.equal(lot.quality, 65);
  state.calendar = advanceCalendar(state.calendar, 1); ageInventory(state);
  assert.equal(state.inventory.warehouse.lots.some((entry) => entry.item_id === "item_cabbage"), false);
  assert.equal(availableQuantity(state, "item_compost") >= 1, true);
});

test("TC-031 满仓依次出售箱/临时区/异常，产出数量不静默丢失", () => {
  const state = make("overflow");
  state.inventory.warehouse.capacity = 1;
  state.inventory.sale_box.capacity = 1;
  state.inventory.temporary.capacity = 1;
  const result = addItem(state, "item_egg", 5, 60);
  assert.deepEqual(result, { warehouse: 1, sale_box: 1, temporary: 1, overflow: 2 });
  const accounted = state.inventory.warehouse.lots[0].quantity + state.inventory.sale_box.lots[0].quantity + state.inventory.temporary.lots[0].quantity + state.inventory.anomalies[0].quantity;
  assert.equal(accounted, 5);
});

test("TC-031 满仓时动物与加工同日完成仍逐项记入异常且总量守恒", () => {
  let state = make("concurrent-overflow");
  state.processing.queue_capacity = 1;
  addItem(state, "item_egg", 2, 60, { source: "processing-input" });
  state = executeCommand(state, { action_id: "overflow-mayo", type: "processing.queue", payload: { recipe_id: "recipe_mayo" } }).state;
  const batch = state.processing.batches[0];
  const sheep = {
    ...state.animals[0], id: "animal_sheep_overflow", species_id: "animal_sheep", name: "满仓羊",
    life_stage: "adult", age_days: 30, health: 100, mood: 100, affinity: 100,
    production_cooldown: 0, housing_id: "housing_barn_1", illness: null,
  };
  state.animals = [sheep];
  const barn = state.housing.find((housing) => housing.id === "housing_barn_1");
  barn.level = 1; barn.capacity = 1; barn.cleanliness = 100;
  state.inventory.silo.quantities.item_feed = 10;
  state.inventory.warehouse.capacity = 0;
  state.inventory.sale_box.capacity = 0;
  state.inventory.temporary.capacity = 0;

  const settled = settleOneDay(state, { weather_id: "weather_cloudy" });
  assert.equal(settled.journal.animals[0].produced, 5);
  assert.deepEqual(settled.journal.completed_processing, [batch.id]);
  const overflow = Object.fromEntries(settled.state.inventory.anomalies.map((entry) => [entry.item_id, entry.quantity]));
  assert.deepEqual(overflow, { item_wool: 5, item_mayo: 1 });
  assert.equal(Object.values(overflow).reduce((sum, quantity) => sum + quantity, 0), 6);
});

test("TC-026/TC-027 初始鸡产出公式0.835，疾病概率与技能修正均clamp", () => {
  const state = make();
  const animal = state.animals[0];
  const housing = state.housing[0]; housing.occupancy = 3;
  const species = animalDefinition("animal_chicken");
  assert.equal(eggProbability(animal, housing, species), 0.835);
  assert.equal(diseaseProbability(animal, housing, species, { animal_risk: 0 }, 0), 0.002);
  animal.health = 0; housing.cleanliness = 0; housing.occupancy = 9;
  assert.equal(diseaseProbability(animal, housing, species, { animal_risk: 1 }, 0), 0.2);
  assert.equal(ANIMAL_SPECIES.length, 5);
});

test("TC-025/TC-027 动物子顺序喂食后生产，固定种子结果可复现", () => {
  const a = settleOneDay(make("animal-order"), { weather_id: "weather_cloudy" });
  const b = settleOneDay(make("animal-order"), { weather_id: "weather_cloudy" });
  assert.deepEqual(a.journal.animals, b.journal.animals);
  assert.equal(a.journal.animals.every((entry) => entry.feed_ratio === 1), true);
});

test("TC-025 圈舍清洁命令与喂养在动物结算前生效", () => {
  let state = make("housing-care");
  state.housing[0].cleanliness = 20;
  const feedBefore = state.inventory.silo.quantities.item_feed;
  state = executeCommand(state, { action_id: "clean-care", type: "housing.clean", payload: { housing_id: "housing_coop_1" } }).state;
  assert.equal(state.housing[0].clean_today, true);
  const results = updateAnimals(state, "weather_cloudy");
  assert.equal(results.every((entry) => entry.feed_ratio === 1), true);
  assert.equal(state.inventory.silo.quantities.item_feed, feedBefore - 3);
  assert.equal(state.housing[0].cleanliness > 20, true);
  assert.equal("clean_today" in state.housing[0], false);
});

test("TC-027 疾病只令生产概率-30个百分点、产品品质-20且不强制停产", () => {
  const state = make("ill-production-1");
  const animal = state.animals[0];
  animal.species_id = "animal_duck";
  animal.illness = { id: "illness_general", started_day: 1, days: 0, status: "abnormal" };
  const housing = state.housing[0];
  housing.occupancy = 1;
  const definition = animalDefinition("animal_duck");
  const healthy = { ...animal, illness: null };
  assert.equal(productionProbability(healthy, housing, definition), 0.72);
  assert.equal(productionProbability(animal, housing, definition), 0.42);

  const healthyState = structuredClone(state);
  healthyState.animals[0].illness = null;
  const healthyQuality = animalProductQuality(healthyState, healthyState.animals[0], healthyState.housing[0], definition);
  const illQuality = animalProductQuality(state, animal, housing, definition);
  assert.equal(healthyQuality - illQuality, 20);
  const result = updateAnimals(state, "weather_cloudy")[0];
  assert.equal(result.production_probability, 0.42);
  assert.equal(result.produced, 1);
});

test("TC-027 绵羊首日产出后恰隔7日再次产毛，无冷却off-by-one", () => {
  const state = make("sheep-seven-day");
  const sheep = state.animals[0];
  sheep.species_id = "animal_sheep";
  sheep.housing_id = "housing_barn_1";
  sheep.health = 100;
  sheep.mood = 100;
  sheep.affinity = 100;
  state.animals = [sheep];
  const barn = state.housing.find((housing) => housing.id === "housing_barn_1");
  barn.level = 1;
  barn.capacity = 1;
  state.inventory.silo.quantities.item_feed = 100;
  const outputs = Array.from({ length: 8 }, () => updateAnimals(state, "weather_cloudy")[0].produced);
  assert.deepEqual(outputs, [5, 0, 0, 0, 0, 0, 0, 5]);
});

test("TC-032 未开始加工全返，已开始只返输入基础价值80%且操作费不退", () => {
  let state = make("processing-cancel");
  state.processing.queue_capacity = 2;
  addItem(state, "item_egg", 4, 60);
  const pending = queueProcessing(state, "recipe_mayo");
  const cashAfterFee = state.economy.cash;
  const pendingResult = cancelProcessing(state, pending.id);
  assert.equal(pendingResult.inputs_returned, true);
  assert.equal(state.economy.cash, cashAfterFee);
  const started = queueProcessing(state, "recipe_mayo");
  started.status = "started";
  const beforeRefund = state.economy.cash;
  const startedResult = cancelProcessing(state, started.id);
  assert.equal(startedResult.refund, halfUp(64 * 0.8));
  assert.equal(state.economy.cash, beforeRefund + 51);
  assert.equal(availableQuantity(state, "item_egg"), 2);
});

test("TC-012/TC-032/TC-033 加工锁定原料阻止出售/订单双花，8配方均为数据配置", () => {
  let state = make("double-spend");
  state.processing.queue_capacity = 2;
  addItem(state, "item_egg", 2, 60);
  state = executeCommand(state, { action_id: "queue-mayo", type: "processing.queue", payload: { recipe_id: "recipe_mayo" } }).state;
  assert.equal(availableQuantity(state, "item_egg"), 0);
  assert.throws(() => executeCommand(state, { action_id: "sell-eggs", type: "inventory.sell", payload: { item_id: "item_egg", quantity: 1 } }), /物品不足/);
  assert.equal(RECIPES.length, 8);
});

test("TC-032/TC-033 加工品质按输入加权，单件高品质不能无成本抬整批", () => {
  let state = make("quality-weight");
  state.processing.queue_capacity = 2;
  addItem(state, "item_egg", 1, 100);
  addItem(state, "item_egg", 1, 20);
  state = executeCommand(state, { action_id: "quality-batch", type: "processing.queue", payload: { recipe_id: "recipe_mayo" } }).state;
  assert.equal(state.processing.batches[0].input_quality, 60);
  state = settleOneDay(state, { weather_id: "weather_cloudy" }).state;
  const mayo = state.inventory.warehouse.lots.find((lot) => lot.item_id === "item_mayo");
  assert.equal(mayo.quality <= 70, true);
});

test("TC-012/TC-013/TC-032 当日全部加工队列合计1WP/1专注，失败事务完整回滚", () => {
  const state = make("processing-day-plan");
  state.processing.queue_capacity = 2;
  addItem(state, "item_egg", 4, 70, { source: "test" });
  queueProcessing(state, "recipe_mayo");
  queueProcessing(state, "recipe_mayo");
  assert.equal(state.processing.batches.length, 2);
  assert.equal(state.work_plan.used_wp, 1);
  assert.equal(state.work_plan.used_focus, 1);

  const insufficient = make("processing-rollback");
  insufficient.processing.queue_capacity = 2;
  addItem(insufficient, "item_egg", 2, 70, { source: "test" });
  queueProcessing(insufficient, "recipe_mayo");
  const before = structuredClone(insufficient);
  assert.throws(() => queueProcessing(insufficient, "recipe_mayo"), /物品不足/);
  assert.deepEqual(insufficient, before);

  const noFocus = make("processing-focus-rollback");
  noFocus.processing.queue_capacity = 2;
  noFocus.work_plan.used_focus = noFocus.work_plan.focus_capacity;
  addItem(noFocus, "item_egg", 2, 70, { source: "test" });
  const focusBefore = structuredClone(noFocus);
  assert.throws(() => queueProcessing(noFocus, "recipe_mayo"), /专注槽不足/);
  assert.deepEqual(noFocus, focusBefore);
});

test("TC-037 建设未开工全退；开工退款按剩余WP×80%", () => {
  const unstartedState = make("build-unstarted");
  const unstarted = startConstruction(unstartedState, "build_plot_b");
  assert.equal(cancelConstruction(unstartedState, unstarted.building_id).refund, 1200);
  const startedState = make("build-started");
  const project = startConstruction(startedState, "build_plot_b");
  project.status = "started"; project.invested_wp = 2;
  assert.equal(cancelConstruction(startedState, project.building_id).refund, 640);
  assert.equal(BUILDINGS.length, 8);
});

test("TC-038/TC-039 技能等级与关系周上限生效", () => {
  const state = make("caps");
  relationshipChange(state, "resident_shopkeeper", 20, 20);
  assert.equal(state.residents.resident_shopkeeper.familiarity, 12);
  assert.equal(state.residents.resident_shopkeeper.trust, 8);
  applyEffects(state, [{ type: "skill_xp", skill_id: "farming", amount: 500 }]);
  assert.equal(state.skills.farming.level, 5);
});

test("TC-035 订单生成不超过3个，交付产生快照且不使用唯一物品", () => {
  let state = make("orders");
  generateWeeklyOrders(state);
  assert.equal(state.orders.length, 3);
  const order = state.orders[0];
  addItem(state, order.item_id, order.quantity, 80);
  state = executeCommand(state, { action_id: "accept-order", type: "order.accept", payload: { order_id: order.id } }).state;
  state = executeCommand(state, { action_id: "deliver-order", type: "order.deliver", payload: { order_id: order.id } }).state;
  const delivered = state.orders.find((entry) => entry.id === order.id);
  assert.equal(delivered.status, "complete");
  assert.equal(delivered.price_snapshot.total > 0, true);
});

test("TC-043 探索2WP/1专注、每日每区域一次并产生2—4件", () => {
  let state = make("explore");
  const result = executeCommand(state, { action_id: "explore-1", type: "exploration.run", payload: { region_id: "region_forest" } });
  state = result.state;
  assert.equal(result.receipt.result.items.length >= 2 && result.receipt.result.items.length <= 4, true);
  assert.equal(state.work_plan.used_wp, 2);
  assert.equal(state.work_plan.used_focus, 1);
  assert.throws(() => executeCommand(state, { action_id: "explore-2", type: "exploration.run", payload: { region_id: "region_forest" } }), /每日最多/);
});

test("TC-042 event_cow_bloat_01兽医分支320G、健康+15、延迟因果可追溯", () => {
  let state = make("cow-event");
  state.animals.push({ id: "animal_cow_test", species_id: "animal_cow", name: "晚霞", sex: "female", life_stage: "adult", age_days: 1, health: 50, mood: 60, affinity: 20, satiety: 100, illness: null, production_cooldown: 0, housing_id: "housing_barn_1", source: "test", experience_tags: [], genome_ref: null, parent_ids: [], traits: [], weekly_affinity_gain: 0, affinity_week_block: 0, last_interaction_day: null });
  state.events.active.push({ event_id: "event_cow_bloat_01", created_day: 1, deadline_day: 1, urgent: true, attention_cost: 3, exclusive_group: null, status: "pending" });
  const before = state.economy.cash;
  state = executeCommand(state, { action_id: "cow-vet", type: "event.choose", payload: { event_id: "event_cow_bloat_01", choice_id: "choice_call_vet" } }).state;
  assert.equal(state.economy.cash, before - 320);
  assert.equal(state.animals.find((animal) => animal.id === "animal_cow_test").health, 65);
  assert.equal(state.events.scheduled_effects[0].source_choice, "choice_call_vet");
});

test("TC-041 事件导演每日预算≤6、选择≤3、紧急≤1", () => {
  const state = make("director");
  const selected = generateDailyEvents(state);
  const definitions = selected.map((id) => EVENTS.find((event) => event.id === id));
  assert.equal(selected.length <= 3, true);
  assert.equal(definitions.reduce((sum, event) => sum + event.attention_cost, 0) <= 6, true);
  assert.equal(definitions.filter((event) => event.urgent).length <= 1, true);
});

test("TC-018/TC-020 干旱停长时开局信用不会绕过growth_points强制成熟", () => {
  let state = make("dry-growth");
  state = executeCommand(state, { action_id: "dry-plant", type: "crop.plant", payload: { plot_id: "plot_a", crop_id: "crop_turnip" } }).state;
  state.plots[0].moisture = 0;
  state.plots[0].crop.health = 10;
  for (let day = 0; day < 3; day += 1) state = settleOneDay(state, { weather_id: "weather_heatwave", trustee: false }).state;
  assert.equal(state.calendar.season_day, 4);
  assert.equal(state.plots[0].crop.growth_points, 0);
  assert.equal(state.plots[0].crop.status, "growing");
});

test("TC-018 湿度公式在预测34.999时灌至65、恰35时不灌溉", () => {
  const below = make("moisture-below");
  below.plots[0].crop = growingTurnip();
  below.plots[0].moisture = 49.999;
  below.plots[0].irrigation_planned = true;
  const belowUpdate = updatePlots(below, "weather_cloudy")[0];
  assert.ok(Math.abs(belowUpdate.irrigation - 30.001) < 1e-9);
  assert.ok(Math.abs(below.plots[0].moisture - 65) < 1e-9);
  assert.equal(below.plots[0].crop.care.timely_irrigation, true);

  const boundary = make("moisture-boundary");
  boundary.plots[0].crop = growingTurnip();
  boundary.plots[0].moisture = 50;
  boundary.plots[0].irrigation_planned = true;
  const boundaryUpdate = updatePlots(boundary, "weather_cloudy")[0];
  assert.equal(boundaryUpdate.irrigation, 0);
  assert.equal(boundary.plots[0].moisture, 35);
  assert.equal(boundary.plots[0].crop.care.timely_irrigation, false);
});

test("TC-019 肥力低于20与结算后杂草高于60的健康惩罚叠加", () => {
  const stressed = make("soil-stack");
  stressed.plots[0].crop = growingTurnip({ health: 90 });
  stressed.plots[0].moisture = 65;
  stressed.plots[0].fertility = 19.999;
  stressed.plots[0].weeds = 59;
  updatePlots(stressed, "weather_cloudy");
  assert.equal(stressed.plots[0].weeds, 61);
  assert.equal(stressed.plots[0].crop.health, 85);

  const boundary = make("soil-boundary");
  boundary.plots[0].crop = growingTurnip({ health: 90 });
  boundary.plots[0].moisture = 65;
  boundary.plots[0].fertility = 20;
  boundary.plots[0].weeds = 58;
  updatePlots(boundary, "weather_cloudy");
  assert.equal(boundary.plots[0].crop.health, 91);
});

test("TC-020 健康20与39日增0.5、健康40日增1，湿度越界停长", () => {
  const cases = [
    { initialHealth: 19, effectiveHealth: 20, expectedGrowth: 0.5 },
    { initialHealth: 38, effectiveHealth: 39, expectedGrowth: 0.5 },
    { initialHealth: 39, effectiveHealth: 40, expectedGrowth: 1 },
  ];
  for (const entry of cases) {
    const state = make(`growth-health-${entry.effectiveHealth}`);
    state.plots[0].crop = growingTurnip({ health: entry.initialHealth });
    state.plots[0].moisture = 65;
    updatePlots(state, "weather_cloudy");
    assert.equal(state.plots[0].crop.health, entry.effectiveHealth);
    assert.equal(state.plots[0].crop.growth_points, entry.expectedGrowth);
  }
  for (const [label, moisture, expected] of [["below", 34, 19], ["above", 106, 91]]) {
    const state = make(`growth-moisture-${label}`);
    state.plots[0].crop = growingTurnip({ health: 90 });
    state.plots[0].moisture = moisture;
    updatePlots(state, "weather_cloudy");
    assert.equal(state.plots[0].moisture, expected);
    assert.equal(state.plots[0].crop.growth_points, 0);
  }
});

test("TC-015 成熟后1日无损宽限，之后每活跃日健康-5并累计延误", () => {
  let state = make("crop-grace");
  state.plots[0].crop = growingTurnip({ status: "mature", mature_day: 1, growth_points: 4, health: 90 });
  state = settleOneDay(state, { weather_id: "weather_cloudy", trustee: false }).state;
  assert.equal(state.plots[0].crop.status, "grace");
  assert.equal(state.plots[0].crop.health, 90);
  assert.equal(state.plots[0].crop.delayed_days, 0);
  state = settleOneDay(state, { weather_id: "weather_cloudy", trustee: false }).state;
  assert.equal(state.plots[0].crop.status, "overripe");
  assert.equal(state.plots[0].crop.health, 85);
  assert.equal(state.plots[0].crop.delayed_days, 1);
  assert.equal(state.plots[0].crop.care.timely_harvest, false);
  state = settleOneDay(state, { weather_id: "weather_cloudy", trustee: false }).state;
  assert.equal(state.plots[0].crop.health, 80);
  assert.equal(state.plots[0].crop.delayed_days, 2);
});

test("TC-022 YieldFactor公式与确定性小数舍入逐项一致", () => {
  for (const [averageHealth, expectedFactor] of [[0, 0.70], [60, 0.90], [90, 1], [100, 0.70 + 100 / 300]]) {
    const state = make(`yield-${averageHealth}`);
    state.plots[0].crop = growingTurnip({ status: "mature", mature_day: 1, growth_points: 4, health: averageHealth, health_sum: averageHealth, health_days: 1 });
    const receipt = harvestCrop(state, "plot_a", "trustee");
    const expectedQuantity = 12 * expectedFactor;
    const yieldRoll = state.rng_audit.find((entry) => entry.system_id === "crop_yield").value;
    assert.ok(Math.abs(receipt.yield_factor - expectedFactor) < 1e-12);
    assert.equal(receipt.quantity, deterministicRound(expectedQuantity, yieldRoll));
  }
  assert.equal(deterministicRound(10.8, 0.79), 11);
  assert.equal(deterministicRound(10.8, 0.81), 10);
});

test("TC-023 品质公式各项、倍率边界及每延误日-3精确一致", () => {
  const state = make("quality-formula");
  state.skills.farming.level = 3;
  state.plots[0].fertility = 80;
  state.plots[0].protection_tags.push("greenhouse");
  const batch = growingTurnip({
    health: 80, health_sum: 160, health_days: 2, severe_days: 2, delayed_days: 1,
    care: { timely_irrigation: true, weeded: true, timely_harvest: true },
  });
  const score = cropQuality(state, state.plots[0], batch);
  const roll = state.rng_audit.find((entry) => entry.system_id === "crop_quality").value;
  const random = Math.floor(roll * 9) - 4;
  const expected = 45 + 0.5 * (80 - 70) + 0.2 * (80 - 50) + 8 + 2 * 3 + 8 - 2 * 2 - 3 + random;
  assert.equal(score, expected);

  const delayedScores = [0, 1, 2].map((delayedDays) => {
    const sample = make("quality-delay-fixed-seed");
    sample.plots[0].fertility = 60;
    return cropQuality(sample, sample.plots[0], growingTurnip({ health_sum: 90, health_days: 1, delayed_days: delayedDays, care: { timely_irrigation: false, weeded: false, timely_harvest: false } }));
  });
  assert.deepEqual(delayedScores, [delayedScores[0], delayedScores[0] - 3, delayedScores[0] - 6]);
  for (const [quality, tier, multiplier] of [
    [0, "quality_normal", 1], [59, "quality_normal", 1],
    [60, "quality_fine", 1.15], [74, "quality_fine", 1.15],
    [75, "quality_premium", 1.4], [89, "quality_premium", 1.4],
    [90, "quality_exceptional", 1.8], [97, "quality_exceptional", 1.8],
    [98, "quality_heirloom", 2.5], [100, "quality_heirloom", 2.5],
  ]) assert.deepEqual([qualityTier(quality).id, qualityTier(quality).multiplier], [tier, multiplier]);
});

test("TC-028 幼体7/14日成长接口与老年仅-15%产出概率", () => {
  const chickenState = make("juvenile");
  const chicken = chickenState.animals[0];
  chicken.life_stage = "juvenile"; chicken.age_days = 6;
  updateAnimals(chickenState, "weather_cloudy");
  assert.equal(chicken.life_stage, "growing");
  chicken.age_days = 13;
  updateAnimals(chickenState, "weather_cloudy");
  assert.equal(chicken.life_stage, "adult");
  const cowState = make("cow-young");
  cowState.housing[1].level = 1; cowState.housing[1].capacity = 2;
  cowState.animals = [{ ...cowState.animals[0], id: "young-cow", species_id: "animal_cow", housing_id: "housing_barn_1", life_stage: "juvenile", age_days: 13 }];
  updateAnimals(cowState, "weather_cloudy");
  assert.equal(cowState.animals[0].life_stage, "growing");
  const elderState = make("elder");
  elderState.animals[0].life_stage = "elderly";
  const adultState = make("adult-compare");
  const result = updateAnimals(elderState, "weather_cloudy")[0];
  const adultResult = updateAnimals(adultState, "weather_cloudy")[0];
  assert.equal(result.production_probability, adultResult.production_probability * 0.85);
});

test("TC-029 出售箱日结前可撤回且容量不足拒绝", () => {
  const state = make("retract");
  addItem(state, "item_egg", 2, 60);
  const lots = queueForSale(state, "item_egg", 2);
  const saleLot = state.inventory.sale_box.lots.find((lot) => lot.item_id === "item_egg");
  assert.equal(lots.reduce((sum, lot) => sum + lot.quantity, 0), 2);
  retractSaleLot(state, saleLot.lot_id);
  assert.equal(availableQuantity(state, "item_egg"), 2);
  assert.equal(state.inventory.sale_box.lots.length, 0);
});

test("TC-013/TC-014 玩家可分配3专注、修改并确认基础日程及覆盖托管优先级", () => {
  let state = make("work-plan");
  for (let index = 0; index < 3; index += 1) state = executeCommand(state, { action_id: `focus-${index}`, type: "work.assign", payload: { wp: 1, focus: 1, label: `专注${index}` } }).state;
  assert.throws(() => executeCommand(state, { action_id: "focus-over", type: "work.assign", payload: { wp: 1, focus: 1 } }), /专注槽不足/);
  const removeId = state.work_plan.tasks[0].id;
  state = executeCommand(state, { action_id: "remove-focus", type: "work.remove", payload: { task_id: removeId } }).state;
  state = executeCommand(state, { action_id: "priority", type: "work.set_priority", payload: { category: "exploration", priority: 110 } }).state;
  state = executeCommand(state, { action_id: "confirm-plan", type: "work.confirm", payload: {} }).state;
  assert.equal(state.work_plan.used_focus, 2);
  assert.equal(state.work_plan.priority_overrides.exploration, 110);
  assert.equal(state.work_plan.confirmed, true);
  assert.throws(() => executeCommand(state, { action_id: "remove-after", type: "work.remove", payload: { task_id: state.work_plan.tasks[0].id } }), /确认/);
});

test("TC-012/TC-013 已执行经营行动不可用work.remove退款并保留结果", () => {
  let state = make("work-remove-semantic-action");
  state = executeCommand(state, { action_id: "plant-before-remove", type: "crop.plant", payload: { plot_id: "plot_a", crop_id: "crop_turnip" } }).state;
  const planted = structuredClone(state);
  assert.equal(planted.work_plan.used_wp, 1);
  assert.equal(planted.plots[0].crop.crop_id, "crop_turnip");
  assert.throws(
    () => executeCommand(planted, { action_id: "remove-planted-action", type: "work.remove", payload: { task_id: "plant_plot_a" } }),
    /已执行的经营行动不能作为日程移除/,
  );
  assert.equal(planted.work_plan.used_wp, 1);
  assert.equal(planted.inventory.seed_cabinet.quantities.seed_turnip, 0);
  assert.equal(planted.plots[0].crop.crop_id, "crop_turnip");

  state = make("work-remove-social-action");
  state = executeCommand(state, { action_id: "talk-before-remove", type: "resident.talk", payload: { resident_id: "resident_shopkeeper" } }).state;
  assert.throws(
    () => executeCommand(state, { action_id: "remove-talk-action", type: "work.remove", payload: { task_id: "talk_resident_shopkeeper" } }),
    /已执行的经营行动不能作为日程移除/,
  );
  assert.equal(state.work_plan.used_wp, 1);
  assert.equal(state.work_plan.used_focus, 1);
  assert.equal(state.skills.social.xp, 2);
});

test("TC-017 气象站使实际预报从3日扩展到7日", () => {
  const normal = settleOneDay(make("forecast-normal"), { weather_id: "weather_cloudy" }).state;
  assert.equal(normal.weather.forecast.length, 3);
  const upgraded = make("forecast-seven"); upgraded.flags.forecast_days = 7;
  assert.equal(settleOneDay(upgraded, { weather_id: "weather_cloudy" }).state.weather.forecast.length, 7);
});

test("TC-017 固定种子10k反证第2/3日预报准确率且失败绝不返回实况", () => {
  const samples = 10000;
  for (const [distance, expected] of [[2, 0.80], [3, 0.65]]) {
    let matches = 0;
    for (let index = 0; index < samples; index += 1) {
      const actual = WEATHER[index % WEATHER.length].id;
      const forecast = makeForecast("forecast-accuracy-fixed-v1", index + 2, actual, distance);
      if (forecast === actual) matches += 1;
      else assert.equal(WEATHER.find((entry) => entry.id === actual).forecast_neighbors.includes(forecast), true);
    }
    const measured = matches / samples;
    assert.equal(Math.abs(measured - expected) <= 0.02, true, `distance=${distance} measured=${measured}`);
  }
});

test("TC-025/TC-028/TC-037 放牧正常天气心情+3，保温/防风抵消对应恶劣天气圈舍惩罚", () => {
  let grazing = make("graze");
  const before = grazing.animals[0].mood;
  grazing = executeCommand(grazing, { action_id: "graze", type: "housing.graze", payload: { housing_id: "housing_coop_1" } }).state;
  const after = updateAnimals(grazing, "weather_cloudy")[0];
  assert.equal(after.mood >= before + 5, true);
  const protectedState = make("protected"); protectedState.housing[0].insulation = true;
  const unprotectedState = make("unprotected");
  const protectedMood = updateAnimals(protectedState, "weather_cold_snap")[0].mood;
  const unprotectedMood = updateAnimals(unprotectedState, "weather_cold_snap")[0].mood;
  assert.equal(protectedMood - unprotectedMood, 6);
});

test("TC-038 技能收益：加工费-2%/级、经营订单+1%/级、采集+2%/级概率参数", () => {
  const processing = make("skill-processing"); processing.processing.queue_capacity = 2; processing.skills.processing.level = 5;
  addItem(processing, "item_egg", 2, 60);
  assert.equal(queueProcessing(processing, "recipe_mayo").operation_cost, 5);
  let business = make("skill-business"); business.skills.business.level = 5; generateWeeklyOrders(business);
  const order = business.orders[0]; addItem(business, order.item_id, order.quantity, 80);
  business = executeCommand(business, { action_id: "deliver-skill", type: "order.deliver", payload: { order_id: order.id } }).state;
  assert.equal(business.orders[0].price_snapshot.business_skill_multiplier, 1.05);
  let forage = make("skill-forage"); forage.skills.foraging.level = 5;
  const exploration = executeCommand(forage, { action_id: "forage-skill", type: "exploration.run", payload: { region_id: "region_forest" } });
  assert.equal(exploration.receipt.result.items.length >= 2, true);
});

test("TC-043 探索连续同区3次稀有概率衰减，雾天概率+20%", () => {
  let state = make("explore-decay");
  state.weather.today_id = "weather_fog";
  state.exploration.history = [1, 2, 3].map((day) => ({ day, region_id: "region_forest", items: [], event_triggered: false }));
  const result = executeCommand(state, { action_id: "decay", type: "exploration.run", payload: { region_id: "region_forest" } }).receipt.result;
  assert.equal(result.rarity_decay, 0.5);
  assert.equal(result.fog_bonus, 1.2);
  assert.equal(result.event_probability, 0.18);
});

test("TC-038 固定大样本采集数量期望每技能等级精确增加2%", () => {
  const samples = 20000;
  const averages = [];
  for (let level = 0; level <= 5; level += 1) {
    let baseTotal = 0;
    let expectedTotal = 0;
    let actualTotal = 0;
    for (let day = 1; day <= samples; day += 1) {
      const result = rollExplorationQuantity("foraging-expectation-v1", day, "region_forest", level);
      baseTotal += result.base_quantity;
      expectedTotal += result.skill_expected_quantity;
      actualTotal += result.quantity;
    }
    assert.ok(Math.abs(expectedTotal / baseTotal - (1 + level * 0.02)) < 1e-12);
    averages.push(actualTotal / samples);
  }
  for (let level = 1; level <= 5; level += 1) assert.ok(Math.abs(averages[level] / averages[0] - (1 + level * 0.02)) < 0.01);
});

test("TC-043 固定种子探索命中区域事件后返回可读正文、选项并可执行", () => {
  let state = make("regional-event-2");
  const result = executeCommand(state, { action_id: "regional-explore", type: "exploration.run", payload: { region_id: "region_forest" } });
  state = result.state;
  const encounter = result.receipt.result.event;
  assert.equal(result.receipt.result.event_probability, 0.30);
  assert.equal(result.receipt.result.event_triggered, true);
  assert.equal(encounter.body.length >= 100, true);
  assert.equal(encounter.choices.length >= 2, true);
  assert.equal(state.events.active.some((active) => active.event_id === encounter.event_id && active.source === "exploration"), true);
  state = executeCommand(state, { action_id: "regional-choice", type: "event.choose", payload: { event_id: encounter.event_id, choice_id: encounter.choices[0].id } }).state;
  assert.equal(state.events.history.some((entry) => entry.event_id === encounter.event_id && entry.choice_id === encounter.choices[0].id), true);
});

test("TC-041/TC-044 事件无候选时生成无选择生活日志", () => {
  const state = make("life-log");
  for (const event of EVENTS) state.events.cooldowns[event.id] = 99999;
  assert.deepEqual(generateDailyEvents(state), []);
  assert.equal(state.daily_ledgers.some((entry) => entry.type === "life_log" && entry.layer === "life"), true);
});

test("TC-044 四层日志由真实命令与日结写入", () => {
  let state = make("four-logs");
  state = executeCommand(state, { action_id: "account-log", type: "market.buy_feed", payload: { quantity: 1 } }).state;
  state = executeCommand(state, { action_id: "operation-log", type: "work.assign", payload: { wp: 0, focus: 0, label: "检查" } }).state;
  state = executeCommand(state, { action_id: "life-log", type: "resident.talk", payload: { resident_id: "resident_shopkeeper" } }).state;
  const event = EVENTS.find((entry) => entry.id === "event_farm_01_01");
  const choice = event.choices[0];
  state.events.active.push({ event_id: event.id, created_day: 1, deadline_day: 5, urgent: false, attention_cost: 1, exclusive_group: null, status: "pending" });
  state = executeCommand(state, { action_id: "decision-log", type: "event.choose", payload: { event_id: event.id, choice_id: choice.id } }).state;
  const layers = new Set(state.daily_ledgers.map((entry) => entry.layer));
  assert.deepEqual([...layers].sort(), ["account", "decision", "life", "operation"]);
});

test("TC-012/TC-037/TC-040 DSL启动建设复用锁款、前置与并发规则", () => {
  const state = make("dsl-build");
  const before = state.economy.cash;
  applyEffects(state, [{ type: "start_building", building_id: "build_plot_b" }]);
  assert.equal(state.economy.cash, before - 1200);
  assert.equal(state.construction[0].locked_cash, 1200);
  assert.throws(() => applyEffects(state, [{ type: "start_building", building_id: "build_plot_b" }]), /已经存在/);
});

test("TC-034 同物品多品质与订单/普通渠道共享唯一周销量阶梯", () => {
  const state = make("tier-shared");
  state.last_real_date_key = "2026-03-02";
  const lots = [
    { item_id: "item_turnip", quantity: 20, quality: 50 },
    { item_id: "item_turnip", quantity: 35, quality: 80 },
  ];
  const priced = priceLots(state, lots, 1);
  assert.equal(priced.lines[0].previous_week_quantity, 0);
  assert.equal(priced.lines[1].previous_week_quantity, 20);
  const weekKey = priced.week_key;
  state.economy.weekly_sales[`${weekKey}:item_turnip`] = 20;
  state.orders.push({ id: "order_manual", item_id: "item_turnip", item_tags: ["crop"], quantity: 5, minimum_quality: 0, deadline_day: 5, reward_multiplier: 1.2, publisher_id: "resident_shopkeeper", status: "offered", followup_flag: "order_manual_done" });
  addItem(state, "item_turnip", 5, 80);
  const accepted = executeCommand(state, { action_id: "reserve-tier", type: "order.accept", payload: { order_id: "order_manual" } }).state;
  const delivered = executeCommand(accepted, { action_id: "deliver-tier", type: "order.deliver", payload: { order_id: "order_manual" } }).state;
  assert.equal(delivered.orders[0].price_snapshot.lines[0].previous_week_quantity, 20);
  assert.equal(delivered.economy.weekly_sales[`${weekKey}:item_turnip`], 25);
});

test("TC-012/TC-029/TC-035 订单预留阻止出售加工双花，放弃时解除", () => {
  let state = make("order-reservation");
  state.orders.push({ id: "order_lock", item_id: "item_egg", item_tags: ["animal_product"], quantity: 2, minimum_quality: 0, deadline_day: 5, reward_multiplier: 1.2, publisher_id: "resident_shopkeeper", status: "offered", followup_flag: "order_lock_done" });
  addItem(state, "item_egg", 2, 70);
  state = executeCommand(state, { action_id: "accept-lock", type: "order.accept", payload: { order_id: "order_lock" } }).state;
  assert.equal(state.orders[0].reserved_quantity, 2);
  assert.throws(() => queueForSale(state, "item_egg", 1), /物品不足/);
  state.processing.queue_capacity = 2;
  assert.throws(() => queueProcessing(state, "recipe_mayo"), /物品不足/);
  state = executeCommand(state, { action_id: "abandon-lock", type: "order.abandon", payload: { order_id: "order_lock" } }).state;
  assert.equal(availableQuantity(state, "item_egg"), 2);
  assert.deepEqual(state.inventory.reservations, {});
});

test("TC-030/TC-035 临期订单保留品过期后日结成功并转为可补货", () => {
  let state = make("order-expiry");
  state.orders.push({ id: "order_expiry", item_id: "item_mushroom", item_tags: ["forage"], quantity: 1, minimum_quality: 0, deadline_day: 10, reward_multiplier: 1.2, publisher_id: "resident_shopkeeper", status: "offered", followup_flag: "order_expiry_done" });
  addItem(state, "item_mushroom", 1, 70, { born_day: 0, age: 4 });
  state = executeCommand(state, { action_id: "accept-expiry", type: "order.accept", payload: { order_id: "order_expiry" } }).state;
  const settled = settleOneDay(state, { weather_id: "weather_cloudy" }).state;
  const order = settled.orders.find((entry) => entry.id === "order_expiry");
  assert.equal(order.status, "accepted");
  assert.equal(order.reserved_quantity, 0);
  assert.equal(order.reservation_status, "needs_restock");
  assert.deepEqual(settled.inventory.reservations, {});
  assert.throws(() => executeCommand(settled, { action_id: "deliver-expired", type: "order.deliver", payload: { order_id: order.id } }), /可保留物品不足/);
  assert.equal(settled.economy.cash >= 0, true);
});

test("TC-044 结构化账本可从初始资金重算现金", () => {
  let state = make("ledger-reconcile");
  state = executeCommand(state, { action_id: "ledger-feed", type: "market.buy_feed", payload: { quantity: 2 } }).state;
  state = executeCommand(state, { action_id: "ledger-seed", type: "market.buy_seed", payload: { crop_id: "crop_turnip", quantity: 1 } }).state;
  state = settleOneDay(state, { weather_id: "weather_cloudy" }).state;
  const recomputed = 2400 + state.daily_ledgers.reduce((sum, entry) => sum + (entry.cash_delta ?? 0), 0);
  assert.equal(recomputed, state.economy.cash);
  assert.equal(state.daily_ledgers.filter((entry) => entry.type === "command").every((entry) => Number.isFinite(entry.cash_delta) && entry.inventory_delta), true);
});

test("TC-044 周报含当日工时且长期归档后年度账本仍可重算", () => {
  let state = make("ledger-reports");
  for (let day = 0; day < 168; day += 1) {
    state = executeCommand(state, { action_id: `report-work-${day}`, type: "work.assign", payload: { task_id: `report-task-${day}`, label: "周报工时", wp: 6, focus: 0 } }).state;
    state = settleOneDay(state, { weather_id: "weather_cloudy", trustee: false }).state;
  }
  assert.equal(recomputeCashFromLedger(state), state.economy.cash);
  assert.equal(state.weekly_reports.at(-1).work_utilization, 0.5);
  assert.equal(state.annual_reports.length, 2);
  for (const report of state.annual_reports) {
    assert.equal(report.total_income - report.total_expenses, report.net_cash_flow);
    assert.equal(Number.isInteger(report.ledger_reconciled_cash), true);
  }
});

test("TC-037 温室启用后创建两块全年且防护恶劣天气的田区", () => {
  const state = make("greenhouse");
  state.calendar = { absolute_day: 85, year: 2, season: "spring", season_day: 1, week_block: 12 };
  state.economy.cash = 20000;
  const project = startConstruction(state, "build_greenhouse");
  project.status = "ready"; project.ready_day = 84; project.invested_wp = project.total_wp;
  activateReadyConstruction(state);
  const greenhouse = state.plots.filter((plot) => plot.protection_tags.includes("greenhouse"));
  assert.deepEqual(greenhouse.map((plot) => plot.plot_id), ["plot_greenhouse_1", "plot_greenhouse_2"]);
  assert.equal(greenhouse.every((plot) => plot.unlocked && plot.cells === 12), true);
});

test("TC-026/TC-028 基础诊疗一次收费80G并锁定两日恢复，玩家命令幂等", () => {
  let state = make("animal-treatment");
  state.animals[0].illness = { id: "illness_general", started_day: 1, days: 0, status: "abnormal" };
  const first = executeCommand(state, { action_id: "treat-one", type: "animal.treat", payload: { animal_id: state.animals[0].id, treatment_id: "treatment_basic_care" } });
  assert.equal(first.state.economy.cash, 2320);
  assert.equal(first.state.animals[0].health, 95);
  const differentAction = executeCommand(first.state, { action_id: "treat-two", type: "animal.treat", payload: { animal_id: state.animals[0].id, treatment_id: "treatment_basic_care" } });
  assert.equal(differentAction.state.economy.cash, 2320);
  assert.equal(differentAction.receipt.result.duplicate_business_action, true);
  state = settleOneDay(differentAction.state, { weather_id: "weather_cloudy" }).state;
  state = settleOneDay(state, { weather_id: "weather_cloudy" }).state;
  assert.equal(state.animals[0].illness, null);
});

test("TC-026/TC-028/TC-036 托管基础诊疗与玩家复用同一定义且总计只扣80G", () => {
  const state = make("trustee-treatment");
  state.animals[0].illness = { id: "illness_general", started_day: 1, days: 0, status: "abnormal" };
  const cash = state.economy.cash;
  const first = settleOneDay(state, { weather_id: "weather_cloudy" }).state;
  assert.equal(first.economy.cash, cash - 80 - 20);
  const second = settleOneDay(first, { weather_id: "weather_cloudy" }).state;
  assert.equal(second.economy.cash, cash - 80 - 40);
  const third = settleOneDay(second, { weather_id: "weather_cloudy" }).state;
  assert.equal(third.economy.cash, cash - 80 - 60);
  assert.equal(third.animals[0].illness, null);
});

test("TC-036 七日低息周转一次触发、无复利且困难还款不为负", () => {
  let state = make("finance-bridge");
  state.economy.cash = 0;
  state.economy.ledger_opening_cash = 0;
  state = settleOneDay(state, { weather_id: "weather_cloudy", trustee: false }).state;
  assert.equal(state.flags.financial_relief_due, true);
  const accepted = executeCommand(state, { action_id: "bridge", type: "finance.accept_bridge", payload: {} });
  assert.equal(accepted.receipt.result.received, 500);
  assert.equal(accepted.receipt.result.amount_due, 510);
  assert.throws(() => executeCommand(accepted.state, { action_id: "bridge-again", type: "finance.accept_bridge", payload: {} }), /没有资金周转事件|仅可使用一次/);
  state = accepted.state;
  state.daily_ledgers.push({ type: "test_cash_adjustment", layer: "account", day: state.calendar.absolute_day, cash_delta: 100 - state.economy.cash });
  state.economy.cash = 100;
  for (let day = 0; day < 7; day += 1) state = settleOneDay(state, { weather_id: "weather_cloudy", trustee: false }).state;
  assert.equal(state.economy.cash, 0);
  assert.equal(state.economy.assistance.status, "hardship_outstanding");
  assert.equal(state.economy.assistance.amount_due > 0, true);
  assert.equal(state.economy.assistance.compound_interest, false);
});

test("TC-013/TC-025 圈舍工时按鸡鸭舍每舍1WP、大型动物每2只向上取整", () => {
  const makeBarn = (count) => {
    const state = make(`barn-work-${count}`);
    state.animals = state.animals.slice(0, 1);
    state.housing[1].level = 1; state.housing[1].capacity = 10;
    for (let index = 0; index < count; index += 1) state.animals.push({ ...state.animals[0], id: `cow_${count}_${index}`, species_id: "animal_cow", housing_id: "housing_barn_1" });
    return state;
  };
  assert.equal(housingCareCost(makeBarn(1)), 2);
  assert.equal(housingCareCost(makeBarn(2)), 2);
  assert.equal(housingCareCost(makeBarn(3)), 3);
  assert.equal(housingCareCost(makeBarn(5)), 4);
});

test("TC-013/TC-037 建设每日累计最多4WP且最后一次只扣剩余WP", () => {
  let state = make("construction-daily"); state.economy.cash = 5000;
  state = executeCommand(state, { action_id: "build-start", type: "building.start", payload: { building_id: "build_plot_b" } }).state;
  state = executeCommand(state, { action_id: "build-3", type: "building.invest", payload: { building_id: "build_plot_b", wp: 3 } }).state;
  assert.throws(() => executeCommand(state, { action_id: "build-over", type: "building.invest", payload: { building_id: "build_plot_b", wp: 2 } }), /最多还可投入1/);
  state = executeCommand(state, { action_id: "build-1", type: "building.invest", payload: { building_id: "build_plot_b", wp: 1 } }).state;
  state.calendar = advanceCalendar(state.calendar, 1); state.work_plan.used_wp = 0; state.work_plan.used_focus = 0; state.work_plan.tasks = [];
  const before = state.work_plan.used_wp;
  state = executeCommand(state, { action_id: "build-finish", type: "building.invest", payload: { building_id: "build_plot_b", wp: 4 } }).state;
  assert.equal(state.work_plan.used_wp - before, 2);
  assert.equal(state.construction[0].invested_wp, 6);
});

test("TC-013/TC-037 同工程同日1—4WP合计1专注，跨工程分别计费", () => {
  const state = make("construction-focus-batch");
  state.economy.cash = 10000;
  startConstruction(state, "build_plot_b");
  startConstruction(state, "build_storage_2");
  investConstruction(state, "build_plot_b", 1);
  investConstruction(state, "build_plot_b", 3);
  assert.equal(state.work_plan.used_wp, 4);
  assert.equal(state.work_plan.used_focus, 1);
  investConstruction(state, "build_storage_2", 2);
  assert.equal(state.work_plan.used_wp, 6);
  assert.equal(state.work_plan.used_focus, 2);
});

test("TC-018/TC-037 水井覆盖升级前2、升级后4且跨命令不能绕过", () => {
  let state = make("well-coverage");
  state.plots[1].unlocked = true;
  for (let index = 0; index < 4; index += 1) if (!state.plots[index]) state.plots.push({ plot_id: `plot_x_${index}`, name: `X${index}`, unlocked: true, land_use_type: "field", cells: 12, moisture: 60, fertility: 60, weeds: 0, crop: null, protection_tags: [], history_tags: [] });
  state = executeCommand(state, { action_id: "water-one", type: "crop.irrigate", payload: { plot_id: "plot_a" } }).state;
  state = executeCommand(state, { action_id: "water-two", type: "crop.irrigate", payload: { plot_id: "plot_b" } }).state;
  assert.throws(() => executeCommand(state, { action_id: "water-three", type: "crop.irrigate", payload: { plot_id: "plot_x_2" } }), /最多覆盖2/);
  state.buildings.find((entry) => entry.id === "well_1").coverage = 4;
  state = executeCommand(state, { action_id: "water-four-batch", type: "crop.irrigate_batch", payload: { plot_ids: ["plot_x_2", "plot_x_3"] } }).state;
  assert.equal(state.plots.filter((plot) => plot.irrigation_planned).length, 4);
});

test("TC-014 未来3日工时预测识别三田成熟峰值和宽限错峰建议", () => {
  const state = make("work-forecast");
  state.work_plan.capacity = 2;
  state.plots = ["a", "b", "c"].map((id) => ({ plot_id: `plot_${id}`, name: id, unlocked: true, land_use_type: "field", cells: 12, moisture: 60, fertility: 60, weeds: 0, protection_tags: [], history_tags: [], crop: { crop_id: "crop_turnip", planted_day: 1, health: 90, growth_points: 3, status: "growing", mature_day: null, delayed_days: 0, health_sum: 270, health_days: 3, care: { timely_irrigation: true, weeded: true, timely_harvest: true }, severe_days: 0, harvest_index: 0, opening_day_credit: false } }));
  const forecast = forecastWork(state, CROPS, 3);
  assert.equal(forecast[0].due_harvest_plots.length, 3);
  assert.equal(forecast[0].over_capacity, true);
  assert.match(forecast[0].suggestion, /宽限错峰/);
});

test("TC-021/TC-024 三叶草收获只转为饲料且不同时生成现金产品", () => {
  let state = make("clover-outcome");
  state.inventory.seed_cabinet.quantities.seed_clover = 12;
  state = executeCommand(state, { action_id: "plant-clover", type: "crop.plant", payload: { plot_id: "plot_a", crop_id: "crop_clover" } }).state;
  state.plots[0].crop.status = "mature"; state.plots[0].crop.growth_points = 6; state.plots[0].crop.mature_day = 1;
  const feedBefore = state.inventory.silo.quantities.item_feed;
  const harvested = executeCommand(state, { action_id: "harvest-clover", type: "crop.harvest", payload: { plot_id: "plot_a" } });
  assert.equal(harvested.receipt.result.harvest_outcome, "feed_conversion");
  assert.equal(harvested.state.inventory.silo.quantities.item_feed > feedBefore, true);
  assert.equal(harvested.state.inventory.warehouse.lots.some((lot) => lot.item_id === "item_clover"), false);
});
