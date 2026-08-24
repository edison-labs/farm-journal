import { ANIMAL_SPECIES, CROPS, FINANCIAL_ASSISTANCE, ITEMS, RESIDENTS, byId } from "../content/definitions.js";
import { synchronizeToNow, migrateTimezone } from "./clock.js";
import { canonicalStringify, clamp, deepClone, halfUp, makeId, sha256 } from "./utils.js";
import { canonicalStateDigest, validateState } from "./state.js";
import { auditedRoll } from "./rng.js";
import { plantCrop, harvestCrop, markIrrigation, weedPlot } from "../rules/crops.js";
import { addSkillXp, relationshipChange } from "../rules/dsl.js";
import { chooseEvent, previewEventChoice } from "../rules/events.js";
import { exploreRegion } from "../rules/exploration.js";
import { addItem, queueForSale, retractSaleLot, takeItems } from "../rules/inventory.js";
import { abandonOrder, acceptOrder, deliverOrder, reserveOrder } from "../rules/orders.js";
import { cancelProcessing, queueProcessing } from "../rules/processing.js";
import { cancelConstruction, investConstruction, startConstruction } from "../rules/construction.js";
import { spendWork, WORK_PRIORITIES } from "../rules/work.js";
import { treatAnimal } from "../rules/animals.js";

function stateDigest(state) {
  return canonicalStateDigest(state);
}

export function inventoryBalances(state) {
  const balances = {};
  const add = (location, itemId, quantity) => { balances[`${location}:${itemId}`] = (balances[`${location}:${itemId}`] ?? 0) + quantity; };
  for (const [location, store] of [["warehouse", state.inventory.warehouse], ["sale_box", state.inventory.sale_box], ["temporary", state.inventory.temporary]]) {
    for (const lot of store.lots) add(location, lot.item_id, lot.quantity);
  }
  for (const [itemId, quantity] of Object.entries(state.inventory.seed_cabinet.quantities)) add("seed_cabinet", itemId, quantity);
  for (const [itemId, quantity] of Object.entries(state.inventory.silo.quantities)) add("silo", itemId, quantity);
  return balances;
}

export function balanceDelta(before, after) {
  const delta = {};
  for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
    const value = (after[key] ?? 0) - (before[key] ?? 0);
    if (value) delta[key] = value;
  }
  return delta;
}

function buySeeds(state, cropId, quantity) {
  const crop = byId(CROPS, cropId);
  if (!Number.isInteger(quantity) || quantity <= 0) throw new RangeError("购买数量必须为正整数");
  const cost = crop.seed_price * quantity;
  if (state.economy.cash < cost) throw new Error("资金不足");
  const current = state.inventory.seed_cabinet.quantities[crop.seed_item_id] ?? 0;
  if (current + quantity > state.inventory.seed_cabinet.capacity) throw new Error("种子柜容量不足");
  state.economy.cash -= cost;
  state.inventory.seed_cabinet.quantities[crop.seed_item_id] = current + quantity;
  return { crop_id: cropId, quantity, cost };
}

function buyFeed(state, quantity) {
  if (!Number.isInteger(quantity) || quantity <= 0) throw new RangeError("购买数量必须为正整数");
  const cost = quantity * 10;
  if (state.economy.cash < cost) throw new Error("资金不足");
  const current = state.inventory.silo.quantities.item_feed ?? 0;
  if (current + quantity > state.inventory.silo.capacity) throw new Error("料仓容量不足");
  state.economy.cash -= cost;
  state.inventory.silo.quantities.item_feed = current + quantity;
  return { quantity, cost };
}

function fertilizePlot(state, plotId, useCompost) {
  const plot = state.plots.find((entry) => entry.plot_id === plotId && entry.unlocked);
  if (!plot) throw new Error("田区不存在或未解锁");
  if (plot.fertility >= 100) return { plot_id: plotId, fertility: plot.fertility, already_full: true, duplicate_business_action: true, wp: 0, cost: 0 };
  if (useCompost) takeItems(state, "item_compost", 1);
  else {
    if (state.economy.cash < 60) throw new Error("资金不足");
    state.economy.cash -= 60;
  }
  spendWork(state, 1, 0, { id: `fertilize_${plotId}`, priority: WORK_PRIORITIES.irrigation, label: `为${plot.name}施肥` });
  plot.fertility = clamp(plot.fertility + 20);
  return { plot_id: plotId, fertility: plot.fertility, source: useCompost ? "compost" : "purchased" };
}

function cleanHousing(state, housingId) {
  const housing = state.housing.find((entry) => entry.id === housingId);
  if (!housing) throw new Error("圈舍不存在");
  if (housing.clean_today) return { housing_id: housingId, scheduled_cleaning: true, duplicate_business_action: true };
  spendWork(state, 1, 0, { id: `clean_${housingId}`, priority: 60, label: `清洁${housing.name}` });
  housing.clean_today = true;
  return { housing_id: housingId, scheduled_cleaning: true };
}

function irrigatePlots(state, plotIds) {
  if (!Array.isArray(plotIds) || !plotIds.length) throw new Error("至少选择一个田区");
  const coverage = state.buildings.find((building) => building.id === "well_1")?.coverage ?? 0;
  const unique = [...new Set(plotIds)];
  const already = state.plots.filter((plot) => plot.irrigation_planned).map((plot) => plot.plot_id);
  const newIds = unique.filter((id) => !already.includes(id));
  if (already.length + newIds.length > coverage) throw new Error(`当前水井每日最多覆盖${coverage}个田区`);
  const targets = unique.filter((plotId) => {
    const plot = state.plots.find((entry) => entry.plot_id === plotId && entry.unlocked);
    if (!plot) throw new Error("田区不存在或未解锁");
    return !plot.irrigation_planned;
  });
  if (!targets.length) return { plot_ids: unique, coverage, wp: 0, duplicate_business_action: true, results: [] };
  const results = [];
  for (const plotId of targets) results.push(markIrrigation(state, plotId, "well_batch"));
  spendWork(state, 1, 0, { id: `irrigate_batch_${state.calendar.absolute_day}`, priority: WORK_PRIORITIES.irrigation, label: `批量灌溉${unique.length}个田区` });
  return { plot_ids: unique, coverage, wp: 1, results };
}

function grazeHousing(state, housingId) {
  const housing = state.housing.find((entry) => entry.id === housingId);
  if (!housing || !housing.grazing_allowed) throw new Error("该圈舍当前不能放牧");
  if (housing.grazing_today) throw new Error("该圈舍今日已安排放牧");
  spendWork(state, 1, 0, { id: `graze_${housingId}`, priority: 55, label: `安排${housing.name}放牧` });
  housing.grazing_today = true;
  return { housing_id: housingId, grazing: true };
}

function interactAnimal(state, animalId) {
  const animal = state.animals.find((entry) => entry.id === animalId);
  if (!animal) throw new Error("动物不存在");
  if (animal.last_interaction_day === state.calendar.absolute_day) throw new Error("同一动物每日最多深度互动一次");
  if (animal.affinity_week_block !== state.calendar.week_block) {
    animal.affinity_week_block = state.calendar.week_block;
    animal.weekly_affinity_gain = 0;
  }
  spendWork(state, 1, 1, { id: `interact_${animalId}`, priority: WORK_PRIORITIES.social, label: `与${animal.name}互动` });
  const rolled = 2 + Math.floor(auditedRoll(state, "animal_interaction", animalId, 0) * 3);
  const affinity = Math.min(rolled, 10 - animal.weekly_affinity_gain);
  animal.affinity = clamp(animal.affinity + affinity);
  animal.mood = clamp(animal.mood + 2);
  animal.weekly_affinity_gain += affinity;
  animal.last_interaction_day = state.calendar.absolute_day;
  return { animal_id: animalId, affinity, mood: 2 };
}

function buyAnimal(state, speciesId, name, actionId) {
  const species = byId(ANIMAL_SPECIES, speciesId);
  const housing = state.housing.find((entry) => species.housing_tags.some((tag) => entry.tags.includes(tag)) && entry.level > 0);
  if (!housing) throw new Error("没有适用圈舍");
  const occupancy = state.animals.filter((animal) => animal.housing_id === housing.id).length;
  if (occupancy + species.capacity_cost > housing.capacity) throw new Error("圈舍容量不足");
  if (state.economy.cash < species.purchase_price) throw new Error("资金不足");
  state.economy.cash -= species.purchase_price;
  const animal = {
    id: makeId("animal", speciesId, actionId), species_id: speciesId, name: String(name || species.name), sex: "female", life_stage: "adult", age_days: 0,
    health: 90, mood: 70, affinity: 20, satiety: 100, illness: null, production_cooldown: 0, housing_id: housing.id,
    source: "market", experience_tags: [], genome_ref: null, parent_ids: [], traits: [], weekly_affinity_gain: 0,
    affinity_week_block: state.calendar.week_block, last_interaction_day: null,
  };
  state.animals.push(animal);
  return { animal_id: animal.id, cost: species.purchase_price };
}

function sellAnimal(state, animalId, confirmed) {
  if (!confirmed) throw new Error("出售动物需要二次确认");
  const index = state.animals.findIndex((entry) => entry.id === animalId);
  if (index < 0) throw new Error("动物不存在");
  const animal = state.animals[index];
  const payout = halfUp(byId(ANIMAL_SPECIES, animal.species_id).purchase_price * 0.5);
  state.animals.splice(index, 1);
  state.economy.cash += payout;
  state.daily_ledgers.push({ type: "animal_transfer", day: state.calendar.absolute_day, animal_id: animalId, name: animal.name, payout, confirmed: true });
  return { animal_id: animalId, payout };
}

function talkResident(state, residentId) {
  const resident = byId(RESIDENTS, residentId);
  if (state.calendar.absolute_day < resident.unlock_day) throw new Error("居民尚未解锁");
  spendWork(state, 1, 1, { id: `talk_${residentId}`, priority: WORK_PRIORITIES.social, label: `拜访${resident.name}` });
  relationshipChange(state, residentId, 2, 0);
  addSkillXp(state, "social", 2);
  return { resident_id: residentId, familiarity: state.residents[residentId].familiarity };
}

function giftResident(state, residentId, itemId) {
  const resident = byId(RESIDENTS, residentId);
  const relation = state.residents[residentId];
  if (state.calendar.absolute_day < resident.unlock_day) throw new Error("居民尚未解锁");
  if (relation.week_block !== state.calendar.week_block) relationshipChange(state, residentId, 0, 0);
  if (relation.gifts_this_week >= 2) throw new Error("本周普通礼物已计入2次");
  if (byId(ITEMS, itemId).tags.includes("unique")) throw new Error("唯一物品不能作为普通礼物");
  takeItems(state, itemId, 1);
  relation.gifts_this_week += 1;
  relationshipChange(state, residentId, 2, 1);
  return { resident_id: residentId, item_id: itemId, gifts_this_week: relation.gifts_this_week };
}

function updateSettings(state, changes) {
  const allowed = ["grayscale", "font_scale", "line_height", "contrast", "reduced_motion", "compact", "tab_title"];
  for (const [key, value] of Object.entries(changes)) {
    if (!allowed.includes(key)) throw new Error(`不可修改的设置: ${key}`);
    state.settings[key] = value;
  }
  state.settings.font_scale = clamp(Number(state.settings.font_scale), 0.8, 1.5);
  state.settings.line_height = clamp(Number(state.settings.line_height), 1.2, 2.2);
  return deepClone(state.settings);
}

function acceptFinancialAssistance(state) {
  if (!state.flags.financial_relief_due) throw new Error("当前没有资金周转事件");
  if (state.flags.finance_bridge_used || state.economy.assistance) throw new Error("七日周转每个存档仅可使用一次");
  const definition = FINANCIAL_ASSISTANCE;
  state.economy.cash += definition.principal;
  state.economy.assistance = { id: definition.id, principal: definition.principal, fee: definition.fee, amount_due: definition.principal + definition.fee, accepted_day: state.calendar.absolute_day, due_day: state.calendar.absolute_day + definition.duration_days, status: "active", compound_interest: false };
  state.flags.finance_bridge_used = true;
  delete state.flags.financial_relief_due;
  delete state.flags.nonessential_paused;
  state.daily_ledgers.push({ type: "assistance_receipt", layer: "account", day: state.calendar.absolute_day, assistance_id: definition.id, amount_received: definition.principal, amount_due: state.economy.assistance.amount_due, compound_interest: false, recorded_by_command_ledger: true });
  return { assistance_id: definition.id, received: definition.principal, due_day: state.economy.assistance.due_day, amount_due: state.economy.assistance.amount_due };
}

function declineFinancialAssistance(state) {
  if (!state.flags.financial_relief_due) throw new Error("当前没有资金周转事件");
  delete state.flags.financial_relief_due;
  state.flags.finance_bridge_declined_day = state.calendar.absolute_day;
  state.daily_ledgers.push({ type: "assistance_declined", layer: "decision", day: state.calendar.absolute_day, assistance_id: FINANCIAL_ASSISTANCE.id, message: "玩家暂不使用七日周转。" });
  return { declined: true };
}

function dispatch(state, type, payload, actionId) {
  switch (type) {
    case "crop.plant": return plantCrop(state, payload.plot_id, payload.crop_id);
    case "crop.harvest": return harvestCrop(state, payload.plot_id);
    case "crop.irrigate": return irrigatePlots(state, [payload.plot_id]);
    case "crop.irrigate_batch": return irrigatePlots(state, payload.plot_ids);
    case "crop.weed": return weedPlot(state, payload.plot_id);
    case "crop.fertilize": return fertilizePlot(state, payload.plot_id, Boolean(payload.use_compost));
    case "market.buy_seed": return buySeeds(state, payload.crop_id, payload.quantity);
    case "market.buy_feed": return buyFeed(state, payload.quantity);
    case "inventory.sell": return { lots: queueForSale(state, payload.item_id, payload.quantity) };
    case "inventory.retract_sale": return retractSaleLot(state, payload.lot_id);
    case "housing.clean": return cleanHousing(state, payload.housing_id);
    case "housing.graze": return grazeHousing(state, payload.housing_id);
    case "animal.interact": return interactAnimal(state, payload.animal_id);
    case "animal.treat": return treatAnimal(state, payload.animal_id, payload.treatment_id);
    case "animal.buy": return buyAnimal(state, payload.species_id, payload.name, actionId);
    case "animal.sell": return sellAnimal(state, payload.animal_id, payload.confirmed);
    case "processing.queue": return queueProcessing(state, payload.recipe_id);
    case "processing.cancel": return cancelProcessing(state, payload.batch_id);
    case "building.start": return startConstruction(state, payload.building_id);
    case "building.invest": return investConstruction(state, payload.building_id, payload.wp);
    case "building.cancel": {
      if (!payload.confirmed) throw new Error("取消工程需要二次确认");
      return cancelConstruction(state, payload.building_id);
    }
    case "order.accept": return acceptOrder(state, payload.order_id);
    case "order.reserve": return reserveOrder(state, payload.order_id);
    case "order.deliver": return deliverOrder(state, payload.order_id);
    case "order.abandon": return abandonOrder(state, payload.order_id);
    case "exploration.run": return exploreRegion(state, payload.region_id);
    case "resident.talk": return talkResident(state, payload.resident_id);
    case "resident.gift": return giftResident(state, payload.resident_id, payload.item_id);
    case "event.choose": return chooseEvent(state, payload.event_id, payload.choice_id);
    case "finance.accept_bridge": return acceptFinancialAssistance(state);
    case "finance.decline_bridge": return declineFinancialAssistance(state);
    case "work.assign": {
      if (state.work_plan.confirmed) throw new Error("今日基础日程已确认，不能继续追加");
      spendWork(state, payload.wp, payload.focus ?? 0, { id: payload.task_id ?? `task_${actionId}`, priority: payload.priority ?? 0, label: payload.label ?? "自定义工作", source: "manual_plan" });
      return { used_wp: state.work_plan.used_wp, used_focus: state.work_plan.used_focus };
    }
    case "work.remove": {
      if (state.work_plan.confirmed) throw new Error("已确认的基础日程不能直接移除；请在确认前修改");
      const index = state.work_plan.tasks.findIndex((task) => task.id === payload.task_id);
      if (index < 0) throw new Error("工作任务不存在");
      if (state.work_plan.tasks[index].source !== "manual_plan") throw new Error("已执行的经营行动不能作为日程移除；其资源与效果已经提交");
      const [removed] = state.work_plan.tasks.splice(index, 1);
      state.work_plan.used_wp -= removed.wp;
      state.work_plan.used_focus -= removed.focus;
      return { removed: removed.id, used_wp: state.work_plan.used_wp, used_focus: state.work_plan.used_focus };
    }
    case "work.confirm": {
      state.work_plan.confirmed = true;
      return { confirmed: true, tasks: state.work_plan.tasks.length, used_wp: state.work_plan.used_wp, used_focus: state.work_plan.used_focus };
    }
    case "work.set_priority": {
      const categories = ["medical", "feeding", "harvest", "irrigation", "processing", "construction", "social", "exploration"];
      if (!categories.includes(payload.category) || !Number.isInteger(payload.priority) || payload.priority < 0 || payload.priority > 120) throw new Error("托管优先级类别或数值无效");
      state.work_plan.priority_overrides[payload.category] = payload.priority;
      return { category: payload.category, priority: payload.priority };
    }
    case "settings.update": return updateSettings(state, payload);
    case "timezone.migrate": return { replacement_state: migrateTimezone(state, payload.timezone, payload.now) };
    default: throw new Error(`未知语义命令: ${type}`);
  }
}

export function previewCommand(inputState, command) {
  const state = deepClone(inputState);
  const result = dispatch(state, command.type, command.payload ?? {}, command.action_id ?? "preview");
  const outputState = result?.replacement_state ?? state;
  validateState(outputState);
  return { state: outputState, result: result?.replacement_state ? { timezone: outputState.timezone } : result, state_hash: stateDigest(outputState) };
}

export function executeCommand(inputState, command) {
  if (!command?.action_id || !command?.type) throw new Error("命令必须包含action_id和type");
  if (inputState.read_only_recovery) throw new Error("存档处于只读恢复模式");
  const payloadHash = sha256(canonicalStringify({ type: command.type, payload: command.payload ?? {} }));
  const prior = inputState.action_receipts[command.action_id];
  if (prior) {
    if (prior.payload_hash !== payloadHash) throw new Error("同一action_id不能绑定不同payload");
    return { state: inputState, receipt: deepClone(prior), duplicate: true };
  }
  const state = deepClone(inputState);
  const beforeHash = stateDigest(state);
  const cashBefore = state.economy.cash;
  const inventoryBefore = inventoryBalances(state);
  const result = dispatch(state, command.type, command.payload ?? {}, command.action_id);
  const outputState = result?.replacement_state ?? state;
  const layer = command.type.startsWith("event.") ? "decision" : command.type.startsWith("resident.") || command.type.startsWith("animal.interact") || command.type.startsWith("exploration.") ? "life" : command.type.startsWith("market.") || command.type.startsWith("inventory.") || command.type.startsWith("order.") ? "account" : "operation";
  outputState.daily_ledgers.push({
    type: "command", layer, day: outputState.calendar.absolute_day, command_type: command.type, action_id: command.action_id,
    cash_before: cashBefore, cash_after: outputState.economy.cash, cash_delta: outputState.economy.cash - cashBefore,
    inventory_delta: balanceDelta(inventoryBefore, inventoryBalances(outputState)),
    message: `${command.type} 已提交`,
  });
  validateState(outputState);
  const receipt = {
    action_id: command.action_id,
    type: command.type,
    payload_hash: payloadHash,
    farm_day: outputState.calendar.absolute_day,
    result: result?.replacement_state ? { timezone: outputState.timezone } : deepClone(result),
    before_hash: beforeHash,
    after_hash: stateDigest(outputState),
  };
  outputState.action_receipts[command.action_id] = receipt;
  const ids = Object.keys(outputState.action_receipts);
  if (ids.length > 2000) for (const id of ids.slice(0, ids.length - 2000)) delete outputState.action_receipts[id];
  return { state: outputState, receipt, duplicate: false };
}

export function synchronizeCommand(inputState, now) {
  return synchronizeToNow(inputState, now);
}

export { previewEventChoice };
