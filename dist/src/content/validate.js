import { CONTENT } from "./definitions.js";

function check(condition, message, errors) { if (!condition) errors.push(message); }
function uniqueIds(collection, name, errors, requireNamespace = true) {
  const seen = new Set();
  for (const entry of collection) {
    check((requireNamespace ? /^([a-z][a-z0-9]*)(_[a-z0-9]+)+$/ : /^[a-z][a-z0-9_]*$/).test(entry.id), `${name} ID格式无效: ${entry.id}`, errors);
    check(!seen.has(entry.id), `${name} ID重复: ${entry.id}`, errors);
    seen.add(entry.id);
  }
  return seen;
}

const conditionOps = new Set(["eq", "gte", "lte", "contains", "date", "season", "weather_tag", "funds", "item_quantity", "building_level", "skill_level", "relationship", "flag", "not_flag", "cooldown_ready", "owns_animal", "animal_health_gte", "entity_state"]);
const effectTypes = new Set(["funds", "item_add", "item_remove", "work", "state", "flag", "relationship", "skill_xp", "animal_state", "animal_modifier", "schedule", "schedule_random", "random_branch", "create_order", "start_building", "log"]);
const compareOps = new Set(["eq", "gte", "lte", "contains"]);
const seasons = new Set(["spring", "summer", "autumn", "winter"]);
const directPaths = new Set(["calendar.absolute_day", "calendar.year", "economy.cash", "inventory.warehouse.capacity", "inventory.seed_cabinet.quantities.seed_turnip", "orders.length", "skills.husbandry.level"]);
const entityPaths = { plots: new Set(["moisture", "fertility", "weeds", "crop.status", "unlocked"]) };

function conditionHas(condition, predicate) {
  if (!condition) return false;
  if (Array.isArray(condition)) return condition.some((entry) => conditionHas(entry, predicate));
  if (condition.all) return condition.all.some((entry) => conditionHas(entry, predicate));
  if (condition.any) return condition.any.some((entry) => conditionHas(entry, predicate));
  if (condition.not) return conditionHas(condition.not, predicate);
  return predicate(condition);
}

function effectsHave(effects, predicate) {
  return (effects ?? []).some((effect) => predicate(effect)
    || effectsHave(effect.effects, predicate)
    || effectsHave(effect.success, predicate)
    || effectsHave(effect.failure, predicate));
}

function mechanicalSignature(effects) {
  const mechanical = (effects ?? []).filter((effect) => !["flag", "log"].includes(effect.type));
  return JSON.stringify(mechanical);
}

function addVectorValue(vector, key, amount) {
  if (Number.isFinite(amount) && amount !== 0) vector[key] = (vector[key] ?? 0) + amount;
}

function mechanicalValueVector(effects, probability = 1, vector = {}) {
  for (const effect of effects ?? []) {
    if (effect.type === "funds") addVectorValue(vector, "funds", effect.amount * probability);
    if (effect.type === "item_add") addVectorValue(vector, `item:${effect.item_id}`, effect.quantity * probability);
    if (effect.type === "item_remove") addVectorValue(vector, `item:${effect.item_id}`, -effect.quantity * probability);
    if (effect.type === "skill_xp") addVectorValue(vector, `skill:${effect.skill_id}`, effect.amount * probability);
    if (effect.type === "relationship") {
      addVectorValue(vector, `relationship:${effect.resident_id}:familiarity`, (effect.familiarity ?? 0) * probability);
      addVectorValue(vector, `relationship:${effect.resident_id}:trust`, (effect.trust ?? 0) * probability);
    }
    if (effect.type === "animal_state") addVectorValue(vector, `animal:${effect.species_id}:${effect.field}`, effect.amount * probability);
    if (effect.type === "work") addVectorValue(vector, "work", -effect.amount * probability);
    if (effect.type === "schedule") mechanicalValueVector(effect.effects, probability, vector);
    if (["schedule_random", "random_branch"].includes(effect.type)) {
      mechanicalValueVector(effect.success, probability * effect.success_probability, vector);
      mechanicalValueVector(effect.failure, probability * (1 - effect.success_probability), vector);
    }
  }
  return vector;
}

function strictlyDominates(leftEffects, rightEffects) {
  const left = mechanicalValueVector(leftEffects);
  const right = mechanicalValueVector(rightEffects);
  const keys = new Set([...Object.keys(left), ...Object.keys(right)]);
  if (!keys.size) return false;
  let strictlyBetter = false;
  for (const key of keys) {
    const difference = (left[key] ?? 0) - (right[key] ?? 0);
    if (difference < -1e-9) return false;
    if (difference > 1e-9) strictlyBetter = true;
  }
  return strictlyBetter;
}

function validateCondition(condition, path, ids, weatherTags, errors) {
  if (!condition) return;
  if (Array.isArray(condition)) { condition.forEach((entry, index) => validateCondition(entry, `${path}[${index}]`, ids, weatherTags, errors)); return; }
  if (condition.all) { check(condition.all.length > 0, `${path}.all不能为空`, errors); condition.all.forEach((entry, index) => validateCondition(entry, `${path}.all[${index}]`, ids, weatherTags, errors)); return; }
  if (condition.any) { check(condition.any.length > 0, `${path}.any不能为空`, errors); condition.any.forEach((entry, index) => validateCondition(entry, `${path}.any[${index}]`, ids, weatherTags, errors)); return; }
  if (condition.not) { validateCondition(condition.not, `${path}.not`, ids, weatherTags, errors); return; }
  check(conditionOps.has(condition.op), `${path} 使用未知条件词汇: ${condition.op}`, errors);
  if (["eq", "gte", "lte", "contains"].includes(condition.op)) {
    check(directPaths.has(condition.path), `${path} 引用未批准状态路径: ${condition.path}`, errors);
    check(condition.op === "contains" || Number.isFinite(condition.value), `${path} 比较值无效`, errors);
  }
  if (condition.op === "date") check(Number.isInteger(condition.value) && condition.value >= 1 && compareOps.has(condition.compare ?? "eq"), `${path} 日期条件无效`, errors);
  if (condition.op === "season") check(seasons.has(condition.value), `${path} 季节条件无效`, errors);
  if (condition.op === "weather_tag") check(weatherTags.has(condition.value), `${path} 引用未知天气标签${condition.value}`, errors);
  if (condition.op === "funds") check(Number.isFinite(condition.value) && condition.value >= 0 && compareOps.has(condition.compare ?? "gte"), `${path} 资金条件无效`, errors);
  if (condition.op === "item_quantity") { check(ids.items.has(condition.item_id), `${path} 引用未知物品${condition.item_id}`, errors); check(Number.isFinite(condition.value) && condition.value >= 0, `${path} 物品数量无效`, errors); }
  if (condition.op === "building_level") { check(ids.buildings.has(condition.building_id), `${path} 引用未知建筑${condition.building_id}`, errors); check(Number.isInteger(condition.value) && condition.value >= 0, `${path} 建筑等级无效`, errors); }
  if (condition.op === "skill_level") { check(ids.skills.has(condition.skill_id), `${path} 引用未知技能${condition.skill_id}`, errors); check(Number.isInteger(condition.value) && condition.value >= 0 && condition.value <= 5, `${path} 技能等级无效`, errors); }
  if (condition.op === "relationship") {
    check(ids.residents.has(condition.resident_id), `${path} 引用未知居民${condition.resident_id}`, errors);
    check(["familiarity", "trust"].includes(condition.field), `${path} 关系字段无效`, errors);
    const bounds = condition.field === "trust" ? [-50, 100] : [0, 100];
    check(Number.isFinite(condition.value) && condition.value >= bounds[0] && condition.value <= bounds[1], `${path} 关系阈值越界`, errors);
  }
  if (["flag", "not_flag"].includes(condition.op)) check(typeof condition.flag === "string" && condition.flag.length > 0, `${path} 标记条件无效`, errors);
  if (condition.op === "cooldown_ready") check(ids.events.has(condition.event_id), `${path} 引用未知冷却事件${condition.event_id}`, errors);
  if (["owns_animal", "animal_health_gte"].includes(condition.op)) check(ids.animals.has(condition.species_id), `${path} 引用未知动物${condition.species_id}`, errors);
  if (condition.op === "animal_health_gte") check(Number.isFinite(condition.value) && condition.value >= 0 && condition.value <= 100, `${path} 动物健康阈值越界`, errors);
  if (condition.op === "entity_state") {
    check(Boolean(entityPaths[condition.collection]?.has(condition.path)), `${path} 实体路径无效: ${condition.collection}.${condition.path}`, errors);
    check(condition.collection !== "plots" || ["plot_a", "plot_b", "plot_greenhouse_1", "plot_greenhouse_2"].includes(condition.id), `${path} 引用未知田区${condition.id}`, errors);
    check(compareOps.has(condition.compare ?? "eq"), `${path} 实体比较符无效`, errors);
  }
}

function validateEffects(effects, path, ids, errors, ownerChoiceId = null) {
  check(Array.isArray(effects), `${path} 必须是效果数组`, errors);
  if (!Array.isArray(effects)) return;
  effects.forEach((effect, index) => {
    const effectPath = `${path}[${index}]`;
    check(effectTypes.has(effect.type), `${effectPath} 使用未知效果词汇: ${effect.type}`, errors);
    if (["item_add", "item_remove"].includes(effect.type)) check(ids.items.has(effect.item_id), `${effectPath} 引用未知物品: ${effect.item_id}`, errors);
    if (effect.type === "relationship") check(ids.residents.has(effect.resident_id), `${effectPath} 引用未知居民: ${effect.resident_id}`, errors);
    if (["animal_state", "animal_modifier"].includes(effect.type)) check(ids.animals.has(effect.species_id), `${effectPath} 引用未知动物: ${effect.species_id}`, errors);
    if (effect.type === "start_building") check(ids.buildings.has(effect.building_id), `${effectPath} 引用未知建筑: ${effect.building_id}`, errors);
    if (effect.type === "skill_xp") { check(ids.skills.has(effect.skill_id), `${effectPath} 引用未知技能: ${effect.skill_id}`, errors); check(Number.isFinite(effect.amount) && effect.amount > 0, `${effectPath} 技能经验无效`, errors); }
    if (effect.type === "funds") check(Number.isFinite(effect.amount), `${effectPath} 资金效果无效`, errors);
    if (["item_add", "item_remove"].includes(effect.type)) check(Number.isFinite(effect.quantity) && effect.quantity > 0, `${effectPath} 物品数量无效`, errors);
    if (effect.type === "relationship") check(Number.isFinite(effect.familiarity ?? 0) && Number.isFinite(effect.trust ?? 0) && Math.abs(effect.familiarity ?? 0) <= 100 && Math.abs(effect.trust ?? 0) <= 100, `${effectPath} 关系变化越界`, errors);
    if (effect.type === "animal_state") check(["health", "mood", "affinity", "satiety"].includes(effect.field) && Number.isFinite(effect.amount) && Math.abs(effect.amount) <= 100, `${effectPath} 动物状态效果无效`, errors);
    if (effect.type === "animal_modifier") check(Number.isFinite(effect.production_multiplier) && effect.production_multiplier >= 0 && effect.production_multiplier <= 2 && Number.isInteger(effect.duration_days) && effect.duration_days >= 1, `${effectPath} 动物修正无效`, errors);
    if (effect.type === "flag") check(typeof effect.flag === "string" && effect.flag.length > 0, `${effectPath} 标记效果无效`, errors);
    if (effect.type === "log") check(typeof effect.message === "string" && effect.message.length >= 4, `${effectPath} 日志反馈无效`, errors);
    if (["schedule", "schedule_random"].includes(effect.type)) check(typeof effect.source_choice === "string" && effect.source_choice === ownerChoiceId, `${effectPath} 延迟来源选项必须匹配${ownerChoiceId}`, errors);
    if (effect.type === "schedule") validateEffects(effect.effects, `${effectPath}.effects`, ids, errors, ownerChoiceId);
    if (effect.type === "schedule") check(Number.isInteger(effect.delay_days) && effect.delay_days >= 1, `${effectPath} 延迟日数无效`, errors);
    if (["schedule_random", "random_branch"].includes(effect.type)) {
      check(Number.isFinite(effect.success_probability) && effect.success_probability >= 0 && effect.success_probability <= 1, `${effectPath} 概率越界`, errors);
      validateEffects(effect.success, `${effectPath}.success`, ids, errors, ownerChoiceId);
      validateEffects(effect.failure, `${effectPath}.failure`, ids, errors, ownerChoiceId);
    }
  });
}

function normalizedTokens(text) { return new Set(text.replace(/[\s，。；：“”！？、（）·\d]/g, "").split("")); }
function jaccard(a, b) {
  const one = normalizedTokens(a); const two = normalizedTokens(b);
  const intersection = [...one].filter((token) => two.has(token)).length;
  return intersection / new Set([...one, ...two]).size;
}

export function validateContent(content = CONTENT) {
  const errors = [];
  check(content.schema_version === 1, "内容schema_version必须为1", errors);
  check(typeof content.content_version === "string", "内容缺少content_version", errors);
  const crops = content.crops ?? []; const weather = content.weather ?? []; const animals = content.animal_species ?? [];
  const recipes = content.recipes ?? []; const buildings = content.buildings ?? []; const residents = content.residents ?? [];
  const regions = content.regions ?? []; const events = content.events ?? []; const items = content.items ?? []; const skills = content.skills ?? [];
  const weatherWeights = content.weather_weights ?? {}; const localization = content.localization ?? {};
  const ids = {
    crops: uniqueIds(crops, "作物", errors), weather: uniqueIds(weather, "天气", errors), animals: uniqueIds(animals, "动物", errors),
    recipes: uniqueIds(recipes, "配方", errors), buildings: uniqueIds(buildings, "建筑", errors), residents: uniqueIds(residents, "居民", errors),
    regions: uniqueIds(regions, "区域", errors), events: uniqueIds(events, "事件", errors), items: uniqueIds(items, "物品", errors), skills: uniqueIds(skills, "技能", errors, false),
  };
  const expectedSizes = [[crops, 19, "作物"], [weather, 10, "天气"], [animals, 5, "动物"], [recipes, 8, "配方"], [buildings, 8, "建筑"], [residents, 8, "居民"], [regions, 3, "探索区域"], [events, 183, "事件"]];
  expectedSizes.forEach(([values, size, name]) => check(values.length === size, `${name}数量应为${size}，实际${values.length}`, errors));
  check(ids.events.has("event_cow_bloat_01"), "缺少策划样例事件event_cow_bloat_01", errors);
  for (const crop of crops) {
    check(ids.items.has(crop.seed_item_id), `${crop.id}种子引用不存在`, errors); check(ids.items.has(crop.product_item_id), `${crop.id}产品引用不存在`, errors);
    check(Number.isFinite(crop.water_use) && crop.water_use >= 0, `${crop.id} water_use无效`, errors);
    check(crop.growth_days > 0 && crop.yield_per_cell > 0 && crop.seed_price >= 0 && crop.base_sell_price > 0, `${crop.id}数值无效`, errors);
  }
  for (const [season, weights] of Object.entries(weatherWeights)) {
    check(Object.values(weights).every((value) => Number.isFinite(value) && value >= 0), `${season}天气权重含非法值`, errors);
    check(Object.values(weights).reduce((sum, value) => sum + value, 0) === 100, `${season}天气权重不等于100`, errors);
    for (const id of Object.keys(weights)) check(ids.weather.has(id), `${season}引用未知天气${id}`, errors);
  }
  for (const definition of weather) for (const neighbor of definition.forecast_neighbors ?? []) check(ids.weather.has(neighbor), `${definition.id}预报邻接引用未知天气${neighbor}`, errors);
  for (const species of animals) check(ids.items.has(species.product_item_id), `${species.id}产品引用不存在`, errors);
  for (const recipe of recipes) {
    recipe.inputs?.forEach((input) => check(ids.items.has(input.item_id), `${recipe.id}输入引用未知物品${input.item_id}`, errors));
    recipe.outputs?.forEach((output) => check(ids.items.has(output.item_id), `${recipe.id}输出引用未知物品${output.item_id}`, errors));
  }
  const stablePrerequisites = new Set([null, "storage_1", "coop_1", "spring_week_1", "resident_craftsman_trust_20", "two_plots", "resident_weather_familiarity_20", "year_2"]);
  for (const building of buildings) check(stablePrerequisites.has(building.prerequisite ?? null), `${building.id}引用未知稳定前置${building.prerequisite}`, errors);
  for (const region of regions) {
    region.items?.forEach((item) => check(ids.items.has(item), `${region.id}引用未知采集物${item}`, errors));
    check((region.exploration_event_ids?.length ?? 0) >= 3, `${region.id}至少需要3个可轮换探索事件`, errors);
    region.exploration_event_ids?.forEach((eventId) => check(ids.events.has(eventId), `${region.id}引用未知探索事件${eventId}`, errors));
  }

  const expectedCounts = { farm: 40, animal: 35, weather: 32, resident: 48, main: 16, festival: 12 };
  const lengths = { farm: [100, 350], animal: [150, 500], weather: [100, 400], resident: [300, 900], main: [600, 1200], festival: [400, 1000] };
  for (const [category, expected] of Object.entries(expectedCounts)) check(events.filter((event) => event.category === category).length === expected, `${category}事件应为${expected}`, errors);
  const globalChoiceIds = new Map();
  for (const event of events) for (const choice of event.choices ?? []) {
    check(!globalChoiceIds.has(choice.id), `${event.id}选项ID与${globalChoiceIds.get(choice.id)}全局重复: ${choice.id}`, errors);
    globalChoiceIds.set(choice.id, event.id);
  }
  const exactBodies = new Map();
  const weatherTags = new Set(weather.flatMap((entry) => entry.tags ?? []));
  for (const event of events) {
    check(localization[event.title_key] === event.title, `${event.id}标题文本键缺失`, errors); check(localization[event.body_key] === event.body, `${event.id}正文文本键缺失`, errors);
    const [minimum, maximum] = lengths[event.category] ?? [1, 10000];
    check(event.body.length >= minimum && event.body.length <= maximum, `${event.id}正文长度${event.body.length}不在${minimum}—${maximum}`, errors);
    const paragraphs = event.body.split(/\n\s*\n/).map((value) => value.trim()).filter(Boolean);
    check(new Set(paragraphs).size === paragraphs.length, `${event.id}正文含重复段落`, errors);
    check(!exactBodies.has(event.body), `${event.id}与${exactBodies.get(event.body)}正文完全重复`, errors); exactBodies.set(event.body, event.id);
    check(jaccard(event.title, event.body) < 0.95, `${event.id}标题与正文高度重复`, errors);
    check(Number.isFinite(event.base_weight) && event.base_weight > 0, `${event.id}基础权重无效`, errors);
    check(Number.isInteger(event.cooldown_days) && event.cooldown_days >= 0, `${event.id}冷却无效`, errors);
    check(Number.isInteger(event.deadline_days) && event.deadline_days >= 0, `${event.id}期限无效`, errors);
    check(event.attention_cost >= 1 && event.attention_cost <= 3, `${event.id}注意力成本越界`, errors);
    check(event.choices?.length >= 2, `${event.id}至少需要两个选择`, errors);
    check(new Set((event.choices ?? []).map((choice) => choice.id)).size === (event.choices ?? []).length, `${event.id}选项ID重复`, errors);
    validateCondition(event.conditions, `${event.id}.conditions`, ids, weatherTags, errors);
    for (const choice of event.choices ?? []) {
      check(Boolean(choice.id && choice.label && choice.label.length >= 2), `${event.id}存在不可理解选项`, errors);
      check(choice.effects?.some((effect) => effect.type === "log" || ["schedule", "schedule_random", "random_branch"].includes(effect.type)), `${event.id}.${choice.id}缺少可理解反馈`, errors);
      validateCondition(choice.conditions, `${event.id}.${choice.id}.conditions`, ids, weatherTags, errors); validateEffects(choice.effects, `${event.id}.${choice.id}.effects`, ids, errors, choice.id);
    }
    if (event.choices?.length === 2) {
      check(!strictlyDominates(event.choices[0].effects, event.choices[1].effects), `${event.id}.${event.choices[0].id}在可量化机械维度上单边支配${event.choices[1].id}`, errors);
      check(!strictlyDominates(event.choices[1].effects, event.choices[0].effects), `${event.id}.${event.choices[1].id}在可量化机械维度上单边支配${event.choices[0].id}`, errors);
    }
    if (event.category === "farm") {
      check(conditionHas(event.conditions, (condition) => !["date"].includes(condition.op) && !(condition.op === "gte" && condition.path === "calendar.absolute_day")), `${event.id}缺少农场状态条件`, errors);
      for (const choice of event.choices ?? []) check(effectsHave(choice.effects, (effect) => ["item_add", "funds", "schedule"].includes(effect.type)), `${event.id}.${choice.id}缺少真实农场机械效果`, errors);
      check(new Set((event.choices ?? []).map((choice) => mechanicalSignature(choice.effects))).size === (event.choices ?? []).length, `${event.id}农场分支机械签名重复`, errors);
    }
    if (event.category === "animal") {
      check(conditionHas(event.conditions, (condition) => condition.op === "owns_animal"), `${event.id}缺少动物持有条件`, errors);
      for (const choice of event.choices ?? []) check(effectsHave(choice.effects, (effect) => ["animal_state", "schedule"].includes(effect.type)), `${event.id}.${choice.id}缺少真实动物机械效果`, errors);
      check(new Set((event.choices ?? []).map((choice) => mechanicalSignature(choice.effects))).size === (event.choices ?? []).length, `${event.id}动物分支机械签名重复`, errors);
    }
    if (event.category === "weather") {
      check(conditionHas(event.conditions, (condition) => condition.op === "season"), `${event.id}缺少季节条件`, errors);
      check(conditionHas(event.conditions, (condition) => condition.op === "weather_tag"), `${event.id}缺少实况天气标签条件`, errors);
      for (const choice of event.choices ?? []) check(effectsHave(choice.effects, (effect) => ["item_add", "schedule"].includes(effect.type)), `${event.id}.${choice.id}缺少真实天气机械效果`, errors);
      check(new Set((event.choices ?? []).map((choice) => mechanicalSignature(choice.effects))).size === (event.choices ?? []).length, `${event.id}天气分支机械签名重复`, errors);
    }
    if (event.category === "resident") {
      check(conditionHas(event.conditions, (condition) => condition.op === "relationship"), `${event.id}缺少关系阈值条件`, errors);
      const residentId = event.tags.find((tag) => ids.residents.has(tag));
      check(Boolean(residentId), `${event.id}缺少居民标签`, errors);
      for (const choice of event.choices ?? []) {
        check(effectsHave(choice.effects, (effect) => ["relationship", "schedule"].includes(effect.type)), `${event.id}.${choice.id}缺少真实居民机械效果`, errors);
        check(!effectsHave(choice.effects, (effect) => effect.type === "relationship" && effect.resident_id !== residentId), `${event.id}.${choice.id}关系效果居民与事件标签不一致`, errors);
      }
      check(new Set((event.choices ?? []).map((choice) => mechanicalSignature(choice.effects))).size === (event.choices ?? []).length, `${event.id}居民分支机械签名重复`, errors);
    }
    if (event.category === "festival") {
      check(seasons.has(event.festival_season), `${event.id}缺少节庆季节`, errors);
      check(conditionHas(event.conditions, (condition) => condition.op === "season" && condition.value === event.festival_season), `${event.id}节庆季节条件错配`, errors);
      check(event.tags.includes(event.festival_season), `${event.id}节庆季节标签错配`, errors);
      for (const choice of event.choices ?? []) check(effectsHave(choice.effects, (effect) => ["item_add", "schedule"].includes(effect.type)), `${event.id}.${choice.id}缺少真实节庆机械效果`, errors);
      check(new Set((event.choices ?? []).map((choice) => mechanicalSignature(choice.effects))).size === (event.choices ?? []).length, `${event.id}节庆分支机械签名重复`, errors);
    }
  }
  const mainEvents = events.filter((event) => event.category === "main");
  mainEvents.forEach((event, index) => {
    const completionFlag = `main_step_${String(index + 1).padStart(2, "0")}`;
    for (const choice of event.choices ?? []) {
      check(effectsHave(choice.effects, (effect) => effect.type === "flag" && effect.flag === completionFlag && effect.value === true), `${event.id}.${choice.id}未产生主线完成标记${completionFlag}`, errors);
      check(effectsHave(choice.effects, (effect) => ["item_add", "schedule"].includes(effect.type)), `${event.id}.${choice.id}缺少真实主线机械效果`, errors);
    }
    check(new Set((event.choices ?? []).map((choice) => mechanicalSignature(choice.effects))).size === (event.choices ?? []).length, `${event.id}主线分支机械签名重复`, errors);
    if (index > 0) {
      const prerequisite = `main_step_${String(index).padStart(2, "0")}`;
      check(conditionHas(event.conditions, (condition) => condition.op === "flag" && condition.flag === prerequisite && condition.value === true), `${event.id}缺少前序主线依赖${prerequisite}`, errors);
    }
  });
  if (errors.length) throw new Error(`内容校验失败（${errors.length}项）\n${errors.join("\n")}`);
  return { content_version: content.content_version, counts: { crops: crops.length, weather: weather.length, animals: animals.length, recipes: recipes.length, buildings: buildings.length, residents: residents.length, regions: regions.length, events: events.length }, event_categories: Object.fromEntries(Object.keys(expectedCounts).map((category) => [category, events.filter((event) => event.category === category).length])), references_valid: true, dsl_valid: true, localization_valid: true, narrative_valid: true };
}
