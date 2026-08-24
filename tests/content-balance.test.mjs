import test from "node:test";
import assert from "node:assert/strict";
import { ANIMAL_SPECIES, CONTENT, CROPS, EVENTS, RECIPES, WEATHER_WEIGHTS } from "../src/content/definitions.js";
import { validateContent } from "../src/content/validate.js";
import { runBalanceChecks } from "../src/rules/balance.js";
import { marketDistributionExpectation, segmentedSalePrice } from "../src/rules/economy.js";
import { createNewSave } from "../src/core/state.js";
import { chooseEvent, previewEventChoice } from "../src/rules/events.js";
import { applyEffects, evaluateCondition } from "../src/rules/dsl.js";

test("TC-002/TC-054 内容数量、引用、DSL、文本键与正式正文范围", () => {
  const result = validateContent();
  assert.deepEqual(result.counts, { crops: 19, weather: 10, animals: 5, recipes: 8, buildings: 8, residents: 8, regions: 3, events: 183 });
  assert.deepEqual(result.event_categories, { farm: 40, animal: 35, weather: 32, resident: 48, main: 16, festival: 12 });
  assert.equal(EVENTS.some((event) => event.id === "event_cow_bloat_01"), true);
});

test("TC-003 稳定ID内容定义由通用校验与事件执行器驱动", () => {
  assert.equal(CONTENT.crops, CROPS);
  assert.equal(CONTENT.animal_species, ANIMAL_SPECIES);
  assert.equal(CONTENT.recipes, RECIPES);
  assert.equal(CONTENT.events, EVENTS);
  for (const [name, definitions] of Object.entries({ crops: CROPS, animals: ANIMAL_SPECIES, recipes: RECIPES, events: EVENTS })) {
    assert.equal(new Set(definitions.map((definition) => definition.id)).size, definitions.length, name);
  }
  const choiceIds = EVENTS.flatMap((event) => event.choices.map((choice) => choice.id));
  assert.equal(new Set(choiceIds).size, choiceIds.length);
  assert.doesNotThrow(() => validateContent(structuredClone(CONTENT)));

  const extended = structuredClone(CONTENT);
  const replacedIndex = extended.events.findIndex((entry) => entry.id === "event_farm_01_01");
  extended.events[replacedIndex].id = "event_farm_extension_01";
  assert.doesNotThrow(() => validateContent(extended), "替换为新稳定ID的数据定义不应要求修改校验代码");

  const event = EVENTS.find((entry) => entry.id === "event_farm_01_01");
  const state = createNewSave({ now: Date.parse("2026-03-02T05:00:00Z"), timezone: "UTC", save_seed: "data-driven", save_id: "save_data_driven" });
  const extensionChoice = {
    id: "choice_extension_test",
    conditions: { op: "funds", compare: "gte", value: 10 },
    effects: [{ type: "funds", amount: -10 }, { type: "flag", flag: "extension_executed", value: true }, { type: "log", message: "扩展配置已执行" }],
  };
  assert.equal(evaluateCondition(state, extensionChoice.conditions), true);
  applyEffects(state, extensionChoice.effects, { source: "event", event_id: "event_extension_test", choice_id: extensionChoice.id });
  assert.equal(state.economy.cash, 2390);
  assert.equal(state.flags.extension_executed, true);

  state.events.active.push({ event_id: event.id, status: "pending" });
  chooseEvent(state, event.id, event.choices[0].id);
  assert.deepEqual(state.events.history.at(-1), {
    event_id: event.id,
    choice_id: event.choices[0].id,
    day: 1,
    subject_ids: [],
    theme_tags: [...event.tags],
    summary: event.summary_template,
  });
});

function effectsHave(effects, predicate) {
  return (effects ?? []).some((effect) => predicate(effect)
    || effectsHave(effect.effects, predicate)
    || effectsHave(effect.success, predicate)
    || effectsHave(effect.failure, predicate));
}

function mechanicalSignature(effects) {
  return JSON.stringify((effects ?? []).filter((effect) => !["flag", "log"].includes(effect.type)));
}

test("farm 40/40事件两分支具有不同且可执行的真实机械效果", () => {
  const farmEvents = EVENTS.filter((event) => event.category === "farm");
  assert.equal(farmEvents.length, 40);
  for (const event of farmEvents) {
    assert.equal(event.choices.length, 2, event.id);
    assert.equal(new Set(event.choices.map((choice) => mechanicalSignature(choice.effects))).size, 2, event.id);
    for (const choice of event.choices) {
      assert.equal(effectsHave(choice.effects, (effect) => ["item_add", "funds", "schedule"].includes(effect.type)), true, `${event.id}.${choice.id}`);
    }
  }

  const cases = [
    ["event_farm_01_01", "choice_handle_01"],
    ["event_farm_07_01", "choice_followup_25"],
  ];
  for (const [eventId, choiceId] of cases) {
    const state = createNewSave({ now: Date.parse("2026-03-02T05:00:00Z"), timezone: "UTC", save_seed: eventId, save_id: `save_${eventId}` });
    state.events.active.push({ event_id: eventId, status: "pending" });
    const preview = previewEventChoice(state, eventId, choiceId);
    assert.notDeepEqual(preview, state);
    assert.doesNotThrow(() => chooseEvent(state, eventId, choiceId));
    assert.equal(state.events.history.at(-1).choice_id, choiceId);
  }
});

test("animal 35/35事件分支具有物种相关且不同的真实机械效果", () => {
  const animalEvents = EVENTS.filter((event) => event.category === "animal");
  assert.equal(animalEvents.length, 35);
  for (const event of animalEvents) {
    assert.equal(event.choices.length >= 2, true, event.id);
    assert.equal(new Set(event.choices.map((choice) => mechanicalSignature(choice.effects))).size, event.choices.length, event.id);
    for (const choice of event.choices) {
      assert.equal(effectsHave(choice.effects, (effect) => ["animal_state", "schedule"].includes(effect.type)), true, `${event.id}.${choice.id}`);
    }
  }

  const cases = [
    ["event_animal_01_01", "choice_care_01", null],
    ["event_animal_02_01", "choice_recheck_06", "animal_duck"],
    ["event_cow_bloat_01", "choice_call_vet", "animal_cow"],
  ];
  for (const [eventId, choiceId, speciesId] of cases) {
    const state = createNewSave({ now: Date.parse("2026-03-02T05:00:00Z"), timezone: "UTC", save_seed: eventId, save_id: `save_${eventId}` });
    if (speciesId) state.animals.push({ ...state.animals[0], id: `${speciesId}_test`, species_id: speciesId, health: 80, mood: 80 });
    state.events.active.push({ event_id: eventId, status: "pending" });
    const preview = previewEventChoice(state, eventId, choiceId);
    assert.notDeepEqual(preview, state);
    assert.doesNotThrow(() => chooseEvent(state, eventId, choiceId));
    assert.equal(state.events.history.at(-1).choice_id, choiceId);
  }
});

test("weather 32/32事件分支具有主题相关且不同的真实机械效果", () => {
  const weatherEvents = EVENTS.filter((event) => event.category === "weather");
  assert.equal(weatherEvents.length, 32);
  for (const event of weatherEvents) {
    assert.equal(event.choices.length, 2, event.id);
    assert.equal(new Set(event.choices.map((choice) => mechanicalSignature(choice.effects))).size, 2, event.id);
    for (const choice of event.choices) {
      assert.equal(effectsHave(choice.effects, (effect) => ["item_add", "schedule"].includes(effect.type)), true, `${event.id}.${choice.id}`);
    }
  }

  const cases = [
    ["event_weather_01_01", "choice_gather_01"],
    ["event_weather_03_01", "choice_revisit_09"],
    ["event_weather_07_01", "choice_gather_25"],
  ];
  for (const [eventId, choiceId] of cases) {
    const state = createNewSave({ now: Date.parse("2026-03-02T05:00:00Z"), timezone: "UTC", save_seed: eventId, save_id: `save_${eventId}` });
    state.events.active.push({ event_id: eventId, status: "pending" });
    const preview = previewEventChoice(state, eventId, choiceId);
    assert.notDeepEqual(preview, state);
    assert.doesNotThrow(() => chooseEvent(state, eventId, choiceId));
    assert.equal(state.events.history.at(-1).choice_id, choiceId);
  }
});

test("resident 48/48事件分支绑定居民且具有不同的真实机械效果", () => {
  const residentEvents = EVENTS.filter((event) => event.category === "resident");
  assert.equal(residentEvents.length, 48);
  for (const event of residentEvents) {
    const residentId = event.tags.find((tag) => tag.startsWith("resident_") && tag !== "resident");
    assert.equal(event.choices.length, 2, event.id);
    assert.equal(new Set(event.choices.map((choice) => mechanicalSignature(choice.effects))).size, 2, event.id);
    for (const choice of event.choices) {
      assert.equal(effectsHave(choice.effects, (effect) => ["relationship", "schedule"].includes(effect.type)), true, `${event.id}.${choice.id}`);
      assert.equal(effectsHave(choice.effects, (effect) => effect.type === "relationship" && effect.resident_id !== residentId), false, `${event.id}.${choice.id}`);
    }
  }

  const cases = [
    ["event_resident_01_01", "choice_connect_01", "resident_shopkeeper"],
    ["event_resident_08_06", "choice_resident_followup_48", "resident_archivist"],
  ];
  for (const [eventId, choiceId, residentId] of cases) {
    const state = createNewSave({ now: Date.parse("2026-03-02T05:00:00Z"), timezone: "UTC", save_seed: eventId, save_id: `save_${eventId}` });
    state.calendar.absolute_day = 100;
    state.residents[residentId].familiarity = 100;
    state.events.active.push({ event_id: eventId, status: "pending" });
    const preview = previewEventChoice(state, eventId, choiceId);
    assert.notDeepEqual(preview, state);
    assert.doesNotThrow(() => chooseEvent(state, eventId, choiceId));
    assert.equal(state.events.history.at(-1).choice_id, choiceId);
  }
});

test("main 16/16事件保留前序链并具有不同的真实机械效果", () => {
  const mainEvents = EVENTS.filter((event) => event.category === "main");
  assert.equal(mainEvents.length, 16);
  for (const event of mainEvents) {
    assert.equal(event.choices.length, 2, event.id);
    assert.equal(new Set(event.choices.map((choice) => mechanicalSignature(choice.effects))).size, 2, event.id);
    for (const choice of event.choices) {
      assert.equal(effectsHave(choice.effects, (effect) => ["item_add", "schedule"].includes(effect.type)), true, `${event.id}.${choice.id}`);
    }
  }

  const chainState = createNewSave({ now: Date.parse("2026-03-02T05:00:00Z"), timezone: "UTC", save_seed: "main-chain", save_id: "save_main_chain" });
  chainState.calendar.absolute_day = 1000;
  for (let index = 0; index < mainEvents.length; index += 1) {
    const event = mainEvents[index];
    if (index > 0) {
      const missing = structuredClone(chainState);
      delete missing.flags[`main_step_${String(index).padStart(2, "0")}`];
      assert.equal(evaluateCondition(missing, event.conditions), false, `${event.id}缺前序仍可用`);
    }
    assert.equal(evaluateCondition(chainState, event.conditions), true, `${event.id}前序完成后不可用`);
    chainState.events.active.push({ event_id: event.id, status: "pending" });
    chooseEvent(chainState, event.id, `choice_advance_${String(index + 1).padStart(2, "0")}`);
  }

  for (const [eventId, choiceId] of [["event_main_01_01", "choice_advance_01"], ["event_main_08_02", "choice_archive_16"]]) {
    const state = createNewSave({ now: Date.parse("2026-03-02T05:00:00Z"), timezone: "UTC", save_seed: eventId, save_id: `save_${eventId}` });
    state.events.active.push({ event_id: eventId, status: "pending" });
    const preview = previewEventChoice(state, eventId, choiceId);
    assert.notDeepEqual(preview, state);
    assert.doesNotThrow(() => chooseEvent(state, eventId, choiceId));
    assert.equal(state.events.history.at(-1).choice_id, choiceId);
  }
});

test("festival 12/12事件保持季节条件并具有不同的真实机械效果", () => {
  const festivalEvents = EVENTS.filter((event) => event.category === "festival");
  assert.equal(festivalEvents.length, 12);
  for (const event of festivalEvents) {
    assert.equal(event.choices.length, 2, event.id);
    assert.equal(new Set(event.choices.map((choice) => mechanicalSignature(choice.effects))).size, 2, event.id);
    for (const choice of event.choices) {
      assert.equal(effectsHave(choice.effects, (effect) => ["item_add", "schedule"].includes(effect.type)), true, `${event.id}.${choice.id}`);
    }
    const wrongSeason = createNewSave({ now: Date.parse("2026-03-02T05:00:00Z"), timezone: "UTC", save_seed: event.id, save_id: `wrong_${event.id}` });
    wrongSeason.calendar.absolute_day = 1000;
    wrongSeason.calendar.season = ["spring", "summer", "autumn", "winter"].find((season) => season !== event.festival_season);
    assert.equal(evaluateCondition(wrongSeason, event.conditions), false, `${event.id}错季仍可用`);
  }

  const cases = [
    ["event_festival_01_01", "choice_join_01"],
    ["event_festival_04_01", "choice_review_07"],
    ["event_festival_05_01", "choice_join_09"],
  ];
  for (const [eventId, choiceId] of cases) {
    const state = createNewSave({ now: Date.parse("2026-03-02T05:00:00Z"), timezone: "UTC", save_seed: eventId, save_id: `save_${eventId}` });
    state.events.active.push({ event_id: eventId, status: "pending" });
    const preview = previewEventChoice(state, eventId, choiceId);
    assert.notDeepEqual(preview, state);
    assert.doesNotThrow(() => chooseEvent(state, eventId, choiceId));
    assert.equal(state.events.history.at(-1).choice_id, choiceId);
  }
});

test("TC-002/TC-040 内容校验使用传入内容并拒绝重复ID、坏引用/文本键/DSL/概率/长度", () => {
  const cases = [
    (content) => { content.crops[1].id = content.crops[0].id; },
    (content) => { content.recipes[0].inputs[0].item_id = "item_missing"; },
    (content) => { delete content.localization[content.events[0].title_key]; },
    (content) => { content.events[0].conditions = { op: "execute_javascript" }; },
    (content) => { content.events.find((event) => event.id === "event_cow_bloat_01").choices[1].effects[0].success_probability = 2; },
    (content) => { content.events[0].body = "太短"; },
    (content) => { content.events[0].choices[0].effects[0].skill_id = "skill_missing"; },
    (content) => { content.events.find((event) => event.category === "resident").choices[0].effects.find((effect) => effect.type === "relationship").resident_id = "resident_missing"; },
    (content) => { content.events[0].deadline_days = -99; },
    (content) => { content.buildings[0].prerequisite = "unknown_release_gate"; },
    (content) => { content.events.find((event) => event.category === "main" && event.id !== "event_main_01_01").conditions.all[1].flag = "main_step_missing"; },
    (content) => { content.events[0].choices[1].id = content.events[0].choices[0].id; },
    (content) => { content.events.find((event) => event.category === "weather").conditions = { op: "season", value: "spring" }; },
    (content) => { content.events.find((event) => event.category === "festival").festival_season = "winter"; },
    (content) => { content.events.find((event) => event.category === "resident").choices[0].id = content.events.find((event) => event.category === "farm").choices[0].id; },
    (content) => { content.events.find((event) => event.category === "resident").choices[1].effects.find((effect) => effect.type === "schedule").source_choice = "choice_wrong_owner"; },
    (content) => {
      const event = content.events.find((entry) => entry.category === "farm");
      const immediate = event.choices[0].effects.find((effect) => ["funds", "item_add"].includes(effect.type));
      const delayed = event.choices[1].effects.find((effect) => effect.type === "schedule").effects.find((effect) => effect.type === immediate.type);
      if (immediate.type === "funds") delayed.amount = immediate.amount;
      else delayed.quantity = immediate.quantity;
    },
  ];
  for (const mutate of cases) {
    const copy = structuredClone(CONTENT); mutate(copy);
    assert.throws(() => validateContent(copy), /内容校验失败/);
  }
});

test("TC-024/TC-033/TC-056 数值门槛覆盖全作物、全配方、动物和压力现金流", () => {
  const result = runBalanceChecks();
  assert.equal(result.crops.length, CROPS.length);
  assert.equal(result.animals.length, ANIMAL_SPECIES.length);
  assert.equal(result.recipes.length, RECIPES.length);
  assert.equal(result.crops.every((crop) => crop.net > 0), true);
  assert.equal(result.crops.filter((crop) => crop.id !== "crop_clover").every((crop) => crop.net >= 1100 && crop.net <= 2100), true);
  assert.equal(result.recipes.every((recipe) => recipe.uplift > 0 && recipe.uplift_rate <= 0.35), true);
  assert.equal(result.cash_stress.ending_cash, 3805.2);
  assert.equal(result.cash_stress.ending_cash >= 3500, true);
  assert.equal(result.liquid_cash.feed_cash, 210);
  assert.equal(result.liquid_cash.fertility_cash, 0);
  assert.equal(result.runtime_cash.feed_cash, 300);
  assert.equal(result.runtime_cash.ending_feed, 9);
  assert.equal(result.runtime_cash.fertility_cash, 0);
  assert.equal(result.market_expectation, 1);
});

test("TC-034 市场分段按单位价half-up，55件base100为5100", () => {
  const result = segmentedSalePrice(100, 55);
  assert.equal(result.total, 5100);
  assert.deepEqual(result.breakdown.map((line) => [line.quantity, line.unit_price]), [[20, 100], [30, 90], [5, 80]]);
  assert.equal(marketDistributionExpectation(), 1);
});

test("TC-016 四季天气权重各为100", () => {
  for (const weights of Object.values(WEATHER_WEIGHTS)) assert.equal(Object.values(weights).reduce((sum, weight) => sum + weight, 0), 100);
});
