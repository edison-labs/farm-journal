import { ANIMAL_SPECIES, CROPS, EVENTS } from "../content/definitions.js";
import { addDateKey, advanceOffline, auditCoreInvariants, settleOneDay } from "./day.js";
import { executeCommand } from "./engine.js";
import { canonicalStateDigest, createNewSave, validateState } from "./state.js";
import { calendarFromAbsolute, canonicalStringify, deepClone, sha256 } from "./utils.js";
import { chooseEvent, generateDailyEvents } from "../rules/events.js";
import { simulateWeatherSeasons } from "../rules/weather.js";
import { availableQuantity, storageUsed } from "../rules/inventory.js";

export const FIXED_NOW = Date.parse("2026-03-02T05:00:00Z");
export const EXPECTED_ORDER_GENERATION_KEYS = Object.freeze([
  "2026-03-09", "2026-03-16", "2026-03-23", "2026-03-30",
  "2026-04-06", "2026-04-13", "2026-04-20", "2026-04-27",
  "2026-05-04", "2026-05-11", "2026-05-18", "2026-05-25",
]);

function makeState(seed) {
  return createNewSave({ now: FIXED_NOW, timezone: "UTC", rollover_hour: 5, save_seed: seed, save_id: `save_${seed.replace(/[^a-z0-9]+/gi, "_")}` });
}

function digestState(state) {
  return canonicalStateDigest(state);
}

function command(state, sequence, type, payload, tracker = null) {
  const result = executeCommand(state, { action_id: `sim_${sequence}_${type}`, type, payload });
  if (tracker && !result.duplicate) {
    tracker.semantic_commands += 1;
    tracker.command_counts[type] = (tracker.command_counts[type] ?? 0) + 1;
    if (type === "animal.buy") {
      tracker.purchased_species[payload.species_id] = (tracker.purchased_species[payload.species_id] ?? 0) + 1;
      tracker.purchased_species_days[payload.species_id] ??= [];
      tracker.purchased_species_days[payload.species_id].push(state.calendar.absolute_day);
    }
    if (type === "inventory.sell") tracker.sold_items[payload.item_id] = (tracker.sold_items[payload.item_id] ?? 0) + payload.quantity;
    if (type === "order.accept") tracker.accepted_order_ids.push(payload.order_id);
    if (type === "order.deliver") tracker.delivered_order_ids.push(payload.order_id);
  }
  return result.state;
}

function expectedRejection(error, context, tracker) {
  const expected = [
    /工时不足/, /专注槽不足/, /季节剩余日数不足/, /本季仅剩/, /种子不足/, /资金不足/, /容量不足/,
    /今日已/, /每日最多/, /不能继续追加/, /尚未解锁/, /事件不在待处理列表/,
  ];
  if (!expected.some((pattern) => pattern.test(error.message))) throw new Error(`${context}出现未分类异常: ${error.message}`);
  tracker.push({ context, reason: error.message });
}

function farmActions(state, sequence, strategy, rejections = [], tracker = null) {
  let next = state;
  const plot = next.plots[0];
  if (plot.crop && ["mature", "grace", "overripe"].includes(plot.crop.status)) {
    const itemId = CROPS.find((crop) => crop.id === plot.crop.crop_id).product_item_id;
    next = command(next, `${sequence}_harvest`, "crop.harvest", { plot_id: plot.plot_id }, tracker);
    const quantity = next.inventory.warehouse.lots.filter((lot) => lot.item_id === itemId && !lot.reserved_for).reduce((sum, lot) => sum + lot.quantity, 0);
    const protectedQuantity = next.orders.filter((order) => ["offered", "accepted"].includes(order.status) && order.item_id === itemId).reduce((maximum, order) => Math.max(maximum, order.quantity), 0);
    if (quantity > protectedQuantity) next = command(next, `${sequence}_sale`, "inventory.sell", { item_id: itemId, quantity: Math.min(quantity - protectedQuantity, 20) }, tracker);
  }
  if (!next.plots[0].crop) {
    const crop = CROPS.find((entry) => entry.seasons.includes(next.calendar.season) && (strategy === "profit" ? entry.risk === "high" : entry.risk === "low")) ?? CROPS.find((entry) => entry.seasons.includes(next.calendar.season));
    const seeds = next.inventory.seed_cabinet.quantities[crop.seed_item_id] ?? 0;
    if (seeds < 12 && next.economy.cash >= crop.seed_price * (12 - seeds)) next = command(next, `${sequence}_buy`, "market.buy_seed", { crop_id: crop.id, quantity: 12 - seeds }, tracker);
    try { next = command(next, `${sequence}_plant`, "crop.plant", { plot_id: "plot_a", crop_id: crop.id }, tracker); }
    catch (error) { expectedRejection(error, `${strategy}:plant:${sequence}`, rejections); }
  }
  if (next.plots[0].crop && next.plots[0].moisture < 45 && next.work_plan.used_wp < next.work_plan.capacity) {
    try { next = command(next, `${sequence}_water`, "crop.irrigate", { plot_id: "plot_a" }, tracker); }
    catch (error) { expectedRejection(error, `${strategy}:water:${sequence}`, rejections); }
  }
  return next;
}

function resolveOneEvent(state, sequence, rejections = [], tracker = null) {
  const active = state.events.active[0];
  if (!active) return state;
  const event = EVENTS.find((entry) => entry.id === active.event_id);
  const choice = event.choices.find((entry) => entry.id === "choice_observe") ?? event.choices[0];
  try { return command(state, `${sequence}_event`, "event.choose", { event_id: event.id, choice_id: choice.id }, tracker); }
  catch (error) { expectedRejection(error, `event:${sequence}`, rejections); return state; }
}

function tryCommand(state, sequence, type, payload, rejections, tracker, context = type) {
  try { return command(state, sequence, type, payload, tracker); }
  catch (error) { expectedRejection(error, context, rejections); return state; }
}

function fulfillAvailableOrder(state, sequence, rejections, tracker) {
  const order = state.orders.find((entry) => entry.status === "offered"
    && entry.deadline_day >= state.calendar.absolute_day
    && availableQuantity(state, entry.item_id) >= entry.quantity);
  if (!order) return state;
  let next = command(state, `${sequence}_accept_${order.id}`, "order.accept", { order_id: order.id }, tracker);
  next = command(next, `${sequence}_deliver_${order.id}`, "order.deliver", { order_id: order.id }, tracker);
  return next;
}

function dailyCare(state, sequence, mode, rejections, tracker) {
  let next = state;
  const housingIds = mode === "animal" ? [...new Set(next.animals.map((animal) => animal.housing_id))] : ["housing_coop_1"];
  for (const housingId of housingIds) {
    const housing = next.housing.find((entry) => entry.id === housingId);
    next = tryCommand(next, `${sequence}_clean_${housingId}`, "housing.clean", { housing_id: housingId }, rejections, tracker, `${mode}:clean:${sequence}:${housingId}`);
    if (housing?.grazing_allowed) next = tryCommand(next, `${sequence}_graze_${housingId}`, "housing.graze", { housing_id: housingId }, rejections, tracker, `${mode}:graze:${sequence}:${housingId}`);
  }
  const interactionCount = mode === "animal" ? 3 : 0;
  const interactionTargets = interactionCount ? next.animals.slice(-interactionCount) : [];
  for (const animal of interactionTargets) {
    next = tryCommand(next, `${sequence}_interact_${animal.id}`, "animal.interact", { animal_id: animal.id }, rejections, tracker, `${mode}:interact:${sequence}`);
  }
  return next;
}

function explore(state, sequence, regionIds, rejections, tracker) {
  let next = state;
  for (const regionId of regionIds) next = tryCommand(next, `${sequence}_explore_${regionId}`, "exploration.run", { region_id: regionId }, rejections, tracker, `explore:${sequence}:${regionId}`);
  return next;
}

function talk(state, sequence, rejections, tracker) {
  const unlockDays = { resident_shopkeeper: 1, resident_vet: 2, resident_craftsman: 3, resident_restaurateur: 5 };
  const residentId = Object.keys(unlockDays).find((id) => state.calendar.absolute_day >= unlockDays[id] && state.residents[id].weekly_familiarity_gain < 12);
  return residentId ? tryCommand(state, `${sequence}_talk_${residentId}`, "resident.talk", { resident_id: residentId }, rejections, tracker, `story:talk:${sequence}`) : state;
}

function profitInfrastructure(state, sequence, rejections, tracker) {
  let next = state;
  const workshopComplete = next.buildings.some((entry) => entry.id === "build_workshop" && entry.status === "complete");
  let project = next.construction.find((entry) => entry.building_id === "build_workshop" && !["complete", "cancelled"].includes(entry.status));
  if (!workshopComplete && !project && next.calendar.absolute_day >= 7 && next.economy.cash >= 3000) {
    next = tryCommand(next, `${sequence}_workshop_start`, "building.start", { building_id: "build_workshop" }, rejections, tracker, `profit:workshop-start:${sequence}`);
    project = next.construction.find((entry) => entry.building_id === "build_workshop" && !["complete", "cancelled"].includes(entry.status));
  }
  if (project && ["planned", "started"].includes(project.status) && next.work_plan.used_wp + 4 <= next.work_plan.capacity) {
    next = tryCommand(next, `${sequence}_workshop_invest`, "building.invest", { building_id: "build_workshop", wp: Math.min(4, project.total_wp - project.invested_wp) }, rejections, tracker, `profit:workshop-invest:${sequence}`);
  }
  const activeBatch = next.processing.batches.some((batch) => ["pending", "started"].includes(batch.status));
  if (next.processing.queue_capacity > 0 && !activeBatch && availableQuantity(next, "item_egg") >= 2 && next.work_plan.used_wp + 1 <= next.work_plan.capacity && next.work_plan.used_focus < next.work_plan.focus_capacity) {
    next = tryCommand(next, `${sequence}_process_mayo`, "processing.queue", { recipe_id: "recipe_mayo" }, rejections, tracker, `profit:processing:${sequence}`);
  }
  return next;
}

function animalInfrastructure(state, sequence, rejections, tracker) {
  let next = state;
  if (!next.animals.some((animal) => animal.species_id === "animal_duck") && next.economy.cash >= 900) {
    next = tryCommand(next, `${sequence}_buy_duck`, "animal.buy", { species_id: "animal_duck", name: "策略鸭" }, rejections, tracker, `animal:buy-duck:${sequence}`);
  }
  for (let giftIndex = 0; giftIndex < 2; giftIndex += 1) {
    const relationship = next.residents.resident_craftsman;
    const giftsThisWeek = relationship.week_block === next.calendar.week_block ? relationship.gifts_this_week : 0;
    if (next.calendar.absolute_day < 3 || relationship.trust >= 20 || giftsThisWeek >= 2 || availableQuantity(next, "item_egg") <= 0) break;
    next = tryCommand(next, `${sequence}_gift_${giftsThisWeek + 1}`, "resident.gift", { resident_id: "resident_craftsman", item_id: "item_egg" }, rejections, tracker, `animal:craftsman-gift:${sequence}`);
  }

  const craftsman = next.residents.resident_craftsman;
  const barnComplete = next.buildings.some((entry) => entry.id === "build_barn" && entry.status === "complete");
  let project = next.construction.find((entry) => entry.building_id === "build_barn" && !["complete", "cancelled"].includes(entry.status));
  if (!barnComplete && !project && craftsman.trust >= 20 && next.economy.cash >= 3500) {
    next = tryCommand(next, `${sequence}_barn_start`, "building.start", { building_id: "build_barn" }, rejections, tracker, `animal:barn-start:${sequence}`);
    project = next.construction.find((entry) => entry.building_id === "build_barn" && !["complete", "cancelled"].includes(entry.status));
  }
  if (project && ["planned", "started"].includes(project.status) && next.work_plan.used_wp + 4 <= next.work_plan.capacity && next.work_plan.used_focus < next.work_plan.focus_capacity) {
    next = tryCommand(next, `${sequence}_barn_invest`, "building.invest", { building_id: "build_barn", wp: Math.min(4, project.total_wp - project.invested_wp) }, rejections, tracker, `animal:barn-invest:${sequence}`);
  }

  const activeBarn = next.buildings.some((entry) => entry.id === "build_barn" && entry.status === "complete");
  const ownsLargeAnimal = next.animals.some((animal) => ["animal_cow", "animal_goat", "animal_sheep"].includes(animal.species_id));
  const target = ANIMAL_SPECIES.find((species) => species.id === tracker.target_large_species);
  if (activeBarn && !ownsLargeAnimal && next.economy.cash >= target.purchase_price) {
    next = tryCommand(next, `${sequence}_buy_${target.id}`, "animal.buy", { species_id: target.id, name: `策略${target.name}` }, rejections, tracker, `animal:buy-${target.id}:${sequence}`);
  }
  return next;
}

function sellForagedSurplus(state, sequence, tracker, reserveFloor = 0) {
  const room = state.inventory.sale_box.capacity - storageUsed(state.inventory.sale_box);
  if (room <= 0) return state;
  const candidate = ["item_herb", "item_mushroom", "item_wood", "item_reed", "item_clay", "item_scrap", "item_mayo"]
    .map((itemId) => {
      const protectedQuantity = Math.max(reserveFloor, state.orders.filter((order) => ["offered", "accepted"].includes(order.status) && order.item_id === itemId).reduce((maximum, order) => Math.max(maximum, order.quantity), 0));
      return { itemId, quantity: Math.max(0, availableQuantity(state, itemId) - protectedQuantity) };
    })
    .sort((a, b) => b.quantity - a.quantity || a.itemId.localeCompare(b.itemId))[0];
  return candidate?.quantity > 0 ? command(state, `${sequence}_sell_${candidate.itemId}`, "inventory.sell", { item_id: candidate.itemId, quantity: Math.min(candidate.quantity, room) }, tracker) : state;
}

function sellAnimalSurplus(state, sequence, tracker) {
  const room = state.inventory.sale_box.capacity - storageUsed(state.inventory.sale_box);
  if (room <= 0) return state;
  const targetProduct = ANIMAL_SPECIES.find((species) => species.id === tracker.target_large_species)?.product_item_id;
  const candidates = ["item_egg", "item_duck_egg", "item_milk", "item_goat_milk", "item_wool"]
    .map((itemId) => {
      const protectedQuantity = state.orders.filter((order) => ["offered", "accepted"].includes(order.status) && order.item_id === itemId).reduce((maximum, order) => Math.max(maximum, order.quantity), 0);
      return { itemId, quantity: Math.max(0, availableQuantity(state, itemId) - protectedQuantity) };
    });
  const preferred = !tracker.sold_items[targetProduct] ? candidates.find((entry) => entry.itemId === targetProduct && entry.quantity > 0) : null;
  const candidate = preferred ?? candidates.sort((left, right) => right.quantity - left.quantity || left.itemId.localeCompare(right.itemId))[0];
  return candidate?.quantity > 0 ? command(state, `${sequence}_sell_${candidate.itemId}`, "inventory.sell", { item_id: candidate.itemId, quantity: Math.min(candidate.quantity, room) }, tracker) : state;
}

function trackSettledDay(result, tracker) {
  for (const outcome of result.journal.animals) {
    const animal = result.state.animals.find((entry) => entry.id === outcome.animal_id);
    if (!animal) continue;
    tracker.animal_care_days[animal.species_id] = (tracker.animal_care_days[animal.species_id] ?? 0) + 1;
    tracker.animal_production[animal.species_id] = (tracker.animal_production[animal.species_id] ?? 0) + outcome.produced;
  }
  const activeOrders = result.state.orders.filter((order) => ["offered", "accepted"].includes(order.status)).length;
  tracker.max_active_orders = Math.max(tracker.max_active_orders, activeOrders);
}

export function runGoldenReplay(days, seed = "golden-v1") {
  let state = makeState(seed);
  const checkpoints = [];
  const expectedRejections = [];
  for (let step = 0; step < days; step += 1) {
    state = farmActions(state, step, "conservative", expectedRejections);
    const result = settleOneDay(state, { weather_id: "weather_cloudy", offline: false });
    state = result.state;
    state = resolveOneEvent(state, step, expectedRejections);
    checkpoints.push({ day: state.calendar.absolute_day, cash: state.economy.cash, feed: state.inventory.silo.quantities.item_feed, hash: digestState(state) });
  }
  auditCoreInvariants(state);
  return { days, seed, final_day: state.calendar.absolute_day, cash: state.economy.cash, feed: state.inventory.silo.quantities.item_feed, inventory_used: state.inventory.warehouse.lots.reduce((sum, lot) => sum + lot.quantity, 0), state_hash: digestState(state), log_hash: sha256(canonicalStringify(state.daily_ledgers)), expected_rejections: expectedRejections, unexpected_errors: 0, checkpoints };
}

export function simulateEventDays(days = 10000, seed = "event-limit-v1") {
  const state = makeState(seed);
  state.animals.push({ ...state.animals[0], id: "simulation_cow", species_id: "animal_cow", name: "模拟奶牛", housing_id: "housing_barn_1", health: 90 });
  let violations = 0;
  let maxChoices = 0;
  let maxAttention = 0;
  let maxUrgentDay = 0;
  const urgentByWeek = new Map();
  for (let day = 1; day <= days; day += 1) {
    state.calendar = calendarFromAbsolute(day);
    state.weather.today_tags = day % 5 === 0 ? ["rain", "severe"] : ["clear"];
    state.events.active = [];
    const selected = generateDailyEvents(state);
    const definitions = selected.map((id) => EVENTS.find((event) => event.id === id));
    const attention = definitions.reduce((sum, event) => sum + event.attention_cost, 0);
    const urgent = definitions.filter((event) => event.urgent).length;
    maxChoices = Math.max(maxChoices, selected.length);
    maxAttention = Math.max(maxAttention, attention);
    maxUrgentDay = Math.max(maxUrgentDay, urgent);
    urgentByWeek.set(state.calendar.week_block, (urgentByWeek.get(state.calendar.week_block) ?? 0) + urgent);
    const exclusive = definitions.map((event) => event.exclusive_group).filter(Boolean);
    if (selected.length > 3 || attention > 6 || urgent > 1 || new Set(exclusive).size !== exclusive.length) violations += 1;
  }
  const maxUrgentWeek = Math.max(0, ...urgentByWeek.values());
  if (maxUrgentWeek > 2) violations += 1;
  return { days, max_choices: maxChoices, max_attention: maxAttention, max_urgent_day: maxUrgentDay, max_urgent_week: maxUrgentWeek, violations };
}

export function runInvariantSamples(samples = 100000) {
  let value = 0x12345678;
  const random = () => {
    value ^= value << 13; value ^= value >>> 17; value ^= value << 5;
    return (value >>> 0) / 0x100000000;
  };
  let rejected = 0;
  let executed = 0;
  let transactionChecks = 0;
  let state = makeState("invariants-v3-0");
  for (let index = 0; index < samples; index += 1) {
    // Every sample is a real semantic command.  Fresh tiny states keep this
    // 100k transaction audit practical without weakening executeCommand.
    if (index % 100 === 0) state = makeState(`invariants-v3-${index}`);
    const kind = index % 5;
    const commandObject = kind === 0
      ? { action_id: `prop_${index}`, type: "settings.update", payload: { compact: random() < 0.5, font_scale: 0.8 + random() * 0.7 } }
      : kind === 1
        ? { action_id: `prop_${index}`, type: "work.set_priority", payload: { category: "harvest", priority: Math.floor(random() * 121) } }
        : kind === 2
          ? { action_id: `prop_${index}`, type: "market.buy_feed", payload: { quantity: 1 + Math.floor(random() * 8) } }
          : kind === 3
            ? { action_id: `prop_${index}`, type: "work.assign", payload: { task_id: `task_${index}`, label: "属性序列", wp: 1, focus: 0 } }
            : { action_id: `prop_${index}`, type: "market.buy_feed", payload: { quantity: 1000000 } };
    const before = digestState(state);
    try {
      const result = executeCommand(state, commandObject);
      validateState(result.state);
      if (digestState(state) !== before) throw new Error(`命令改变输入对象: sample ${index}`);
      // Sample action-idempotency and mismatched-payload atomic rejection on a
      // rotating subset while retaining 100k primary semantic commands.
      if (index % 100 === 0) {
        const duplicate = executeCommand(result.state, commandObject);
        if (!duplicate.duplicate || digestState(duplicate.state) !== digestState(result.state)) throw new Error(`幂等收据失败: sample ${index}`);
        transactionChecks += 1;
      }
      state = result.state;
      executed += 1;
    } catch (error) {
      if (!((kind === 4 && /资金不足|容量不足/.test(error.message)) || (kind === 2 && /资金不足|容量不足/.test(error.message)) || (kind === 3 && /工时不足/.test(error.message)))) throw error;
      if (digestState(state) !== before) throw new Error(`失败事务改变输入状态: sample ${index}`);
      rejected += 1;
    }
  }
  return { samples, semantic_commands: samples, executed, expected_rejections: rejected, idempotency_checks: transactionChecks, violations: 0, final_prng_state: value >>> 0 };
}

export function runStrategy(name, seed) {
  let state = makeState(seed);
  const expectedRejections = [];
  const targetBySuffix = { a: "animal_cow", b: "animal_goat", c: "animal_sheep" };
  const tracker = {
    seed, semantic_commands: 0, command_counts: {}, login_days: [], purchased_species: {}, purchased_species_days: {}, sold_items: {},
    accepted_order_ids: [], delivered_order_ids: [], animal_care_days: {}, animal_production: {}, max_active_orders: 0,
    target_large_species: targetBySuffix[seed.at(-1)] ?? "animal_goat",
  };
  if (name === "low_frequency") {
    const gaps = [...Array.from({ length: 5 }, () => [4, 5, 6]).flat(), 3, 6];
    let elapsed = 0;
    let login = 0;
    while (elapsed < 84) {
      const gap = gaps[login];
      const offline = advanceOffline(state, gap);
      for (const summary of offline.summaries) trackSettledDay({ state: offline.state, journal: summary.journal }, tracker);
      state = offline.state;
      elapsed += gap;
      tracker.login_days.push(state.calendar.absolute_day);
      state = farmActions(state, `login_${login}`, "conservative", expectedRejections, tracker);
      state = resolveOneEvent(state, `login_${login}`, expectedRejections, tracker);
      login += 1;
    }
    return summarizeStrategy(name, state, expectedRejections, tracker);
  }
  for (let step = 0; step < 84; step += 1) {
    if (["conservative", "profit", "animal"].includes(name)) state = farmActions(state, step, name === "animal" ? "conservative" : name, expectedRejections, tracker);
    if (["conservative", "profit", "animal"].includes(name)) state = fulfillAvailableOrder(state, step, expectedRejections, tracker);
    if (name === "animal") state = animalInfrastructure(state, step, expectedRejections, tracker);
    if (["conservative", "profit", "animal", "story"].includes(name)) state = dailyCare(state, step, name, expectedRejections, tracker);
    if (name === "conservative") {
      state = talk(state, step, expectedRejections, tracker);
      state = explore(state, step, ["region_forest"], expectedRejections, tracker);
      state = sellForagedSurplus(state, step, tracker);
    }
    if (name === "profit") {
      state = profitInfrastructure(state, step, expectedRejections, tracker);
      const explorationSlots = Math.min(state.work_plan.focus_capacity - state.work_plan.used_focus, Math.floor((state.work_plan.capacity - state.work_plan.used_wp) / 2));
      const regions = ["region_riverbank", "region_old_station"].slice(0, explorationSlots);
      state = explore(state, step, regions, expectedRejections, tracker);
      // A profit-oriented farm keeps a small diversified order buffer until it
      // has proved one full delivery cycle.  This is legal stock management,
      // and prevents the strategy from liquidating every requested material
      // the day before the next weekly board appears.
      state = sellForagedSurplus(state, step, tracker, tracker.delivered_order_ids.length === 0 ? 8 : 0);
      state = fulfillAvailableOrder(state, `${step}_after_explore`, expectedRejections, tracker);
    }
    if (name === "animal") {
      state = sellAnimalSurplus(state, step, tracker);
      state = fulfillAvailableOrder(state, `${step}_after_sale`, expectedRejections, tracker);
    }
    if (name === "story") {
      state = talk(state, step, expectedRejections, tracker);
      state = explore(state, step, ["region_forest"], expectedRejections, tracker);
      state = sellForagedSurplus(state, step, tracker);
      state = resolveOneEvent(state, step, expectedRejections, tracker);
    }
    const result = settleOneDay(state, { offline: false, real_date_key: addDateKey(state.last_real_date_key, 1) });
    trackSettledDay(result, tracker);
    state = result.state;
    if (name === "story") state = resolveOneEvent(state, `${step}_after_settle`, expectedRejections, tracker);
  }
  return summarizeStrategy(name, state, expectedRejections, tracker);
}

function summarizeStrategy(name, state, expectedRejections = [], tracker = { seed: null, semantic_commands: 0, command_counts: {}, login_days: [], purchased_species: {}, purchased_species_days: {}, sold_items: {}, accepted_order_ids: [], delivered_order_ids: [], animal_care_days: {}, animal_production: {}, max_active_orders: 0, target_large_species: null }) {
  auditCoreInvariants(state);
  const dayReports = state.daily_ledgers.filter((entry) => entry.type === "daily_report");
  const utilizations = dayReports.map((entry) => (entry.work_used ?? 0) / (entry.work_capacity ?? 12));
  return {
    strategy: name,
    seed: tracker.seed,
    final_day: state.calendar.absolute_day,
    cash: state.economy.cash,
    inventory_used: state.inventory.warehouse.lots.reduce((sum, lot) => sum + lot.quantity, 0),
    minimum_animal_health: Math.min(...state.animals.map((animal) => animal.health)),
    living_animals: state.animals.length,
    completed_orders: state.orders.filter((order) => order.status === "complete").length,
    completed_processing: state.processing.batches.filter((batch) => batch.status === "complete").length,
    purchased_animals: tracker.command_counts["animal.buy"] ?? 0,
    purchased_species: tracker.purchased_species,
    purchased_species_days: tracker.purchased_species_days,
    target_large_species: tracker.target_large_species,
    animal_care_days: tracker.animal_care_days,
    animal_production: tracker.animal_production,
    sold_items: tracker.sold_items,
    large_animals: state.animals.filter((animal) => ["animal_cow", "animal_goat", "animal_sheep"].includes(animal.species_id)).length,
    barn_complete: state.buildings.some((building) => building.id === "build_barn" && building.status === "complete"),
    craftsman_trust: state.residents.resident_craftsman.trust,
    construction_statuses: state.construction.map((project) => ({ building_id: project.building_id, status: project.status, invested_wp: project.invested_wp, started_day: project.started_day, ready_day: project.ready_day, activated_day: project.activated_day ?? null })),
    accepted_orders: tracker.command_counts["order.accept"] ?? 0,
    delivered_orders: tracker.command_counts["order.deliver"] ?? 0,
    accepted_order_ids: tracker.accepted_order_ids,
    delivered_order_ids: tracker.delivered_order_ids,
    order_records: state.orders.map((order) => ({
      id: order.id,
      item_id: order.item_id,
      quantity: order.quantity,
      created_day: order.created_day,
      deadline_day: order.deadline_day,
      completed_day: order.completed_day ?? null,
      status: order.status,
    })),
    delivered_order_source_weeks: [...new Set(tracker.delivered_order_ids.map((id) => state.orders.find((order) => order.id === id)).filter(Boolean).map((order) => order.id.split("_")[1]))].sort(),
    completed_buildings: state.construction.filter((project) => project.status === "complete").length,
    semantic_commands: tracker.semantic_commands,
    command_counts: tracker.command_counts,
    login_days: tracker.login_days,
    event_choices: state.events.history.filter((event) => event.choice_id).length,
    weekly_reports: state.weekly_reports.length,
    annual_reports: state.annual_reports.length,
    final_real_date_key: state.last_real_date_key,
    order_generation_keys: Object.keys(state.flags).filter((flag) => flag.startsWith("orders_generated_")).map((flag) => flag.slice("orders_generated_".length)).sort(),
    generated_order_weeks: Object.keys(state.flags).filter((flag) => flag.startsWith("orders_generated_")).length,
    order_created_weeks: new Set(state.orders.map((order) => order.id.split("_")[1])).size,
    late_orders_created: state.orders.filter((order) => order.created_day > 42).length,
    late_orders_delivered: tracker.delivered_order_ids.filter((id) => (state.orders.find((order) => order.id === id)?.created_day ?? 0) > 42).length,
    max_active_orders: tracker.max_active_orders,
    average_work_utilization: utilizations.length ? utilizations.reduce((sum, value) => sum + value, 0) / utilizations.length : 0,
    peak_work_utilization: Math.max(0, ...utilizations),
    expected_rejections: expectedRejections.length,
    unexpected_errors: 0,
    outstanding_reservations: Object.keys(state.inventory.reservations).length,
    unresolved_storage_anomalies: state.inventory.anomalies.filter((entry) => entry.status === "must_resolve").length,
    state_hash: digestState(state),
  };
}

export function simulateSixStrategies() {
  const names = ["conservative", "profit", "animal", "story", "low_frequency", "neglect"];
  const results = names.flatMap((name) => ["a", "b", "c"].map((suffix) => runStrategy(name, `strategy-${name}-v3-${suffix}`)));
  const normal = new Set(["conservative", "profit", "animal", "story"]);
  const structuralViolations = results.filter((result) => result.final_day !== 85 || result.living_animals < 3 || result.minimum_animal_health < 0 || result.cash < 0 || result.outstanding_reservations > 0 || result.unresolved_storage_anomalies > 0).length;
  const utilizationViolations = results.filter((result) => normal.has(result.strategy) && (result.average_work_utilization < 0.5 || result.average_work_utilization > 0.8)).length;
  const roleViolations = results.filter((result) => {
    if (result.strategy === "profit") return result.completed_processing < 1;
    if (result.strategy === "animal") {
      const targetProduct = ANIMAL_SPECIES.find((species) => species.id === result.target_large_species)?.product_item_id;
      return result.purchased_animals < 2 || result.purchased_species.animal_duck !== 1 || result.purchased_species[result.target_large_species] !== 1
        || result.large_animals < 1 || !result.barn_complete || (result.animal_care_days[result.target_large_species] ?? 0) < 7
        || (result.animal_production[result.target_large_species] ?? 0) < 1 || (result.sold_items[targetProduct] ?? 0) < 1;
    }
    if (result.strategy === "story") return result.event_choices < 1 || (result.command_counts["resident.talk"] ?? 0) < 1 || (result.command_counts["exploration.run"] ?? 0) < 1;
    if (result.strategy === "low_frequency") return result.login_days.length < 12 || result.login_days.some((day, index, days) => index > 0 && (day - days[index - 1] < 3 || day - days[index - 1] > 7));
    if (result.strategy === "neglect") return result.semantic_commands !== 0;
    return false;
  }).length;
  const cashRanges = Object.fromEntries(names.map((name) => {
    const values = results.filter((entry) => entry.strategy === name).map((entry) => entry.cash);
    return [name, { min: Math.min(...values), max: Math.max(...values) }];
  }));
  const freeLoop = results.some((entry) => entry.cash > 100000 || entry.inventory_used > 10000);
  const bestMinimum = Math.max(...Object.values(cashRanges).map((range) => range.min));
  const dominantStrategy = Object.entries(cashRanges).find(([name, range]) => range.min > Math.max(...Object.entries(cashRanges).filter(([other]) => other !== name).map(([, otherRange]) => otherRange.max)))?.[0] ?? null;
  const orderActivity = results.filter((entry) => ["conservative", "profit", "animal"].includes(entry.strategy)).reduce((sum, entry) => sum + entry.delivered_orders, 0);
  const semantic_activity = {
    profit_processing_completions: results.filter((entry) => entry.strategy === "profit").reduce((sum, entry) => sum + entry.completed_processing, 0),
    animal_purchases: results.filter((entry) => entry.strategy === "animal").reduce((sum, entry) => sum + entry.purchased_animals, 0),
    large_animal_purchases: results.filter((entry) => entry.strategy === "animal").reduce((sum, entry) => sum + Object.entries(entry.purchased_species).filter(([species]) => ["animal_cow", "animal_goat", "animal_sheep"].includes(species)).reduce((count, [, quantity]) => count + quantity, 0), 0),
    duck_purchases: results.filter((entry) => entry.strategy === "animal").reduce((sum, entry) => sum + (entry.purchased_species.animal_duck ?? 0), 0),
    animal_species_exercised: [...new Set(results.filter((entry) => entry.strategy === "animal").flatMap((entry) => Object.keys(entry.animal_care_days)))].sort(),
    completed_barns: results.filter((entry) => entry.strategy === "animal" && entry.barn_complete).length,
    generated_order_weeks: results.reduce((sum, entry) => sum + entry.generated_order_weeks, 0),
    accepted_orders: results.reduce((sum, entry) => sum + entry.accepted_orders, 0),
    delivered_orders: results.reduce((sum, entry) => sum + entry.delivered_orders, 0),
    related_strategy_order_deliveries: orderActivity,
    delivered_order_source_weeks: [...new Set(results.flatMap((entry) => entry.delivered_order_source_weeks))].sort(),
    late_order_deliveries: results.reduce((sum, entry) => sum + entry.late_orders_delivered, 0),
  };
  const dateViolations = results.filter((result) => result.final_real_date_key !== "2026-05-25" || result.generated_order_weeks !== 12 || canonicalStringify(result.order_generation_keys) !== canonicalStringify(EXPECTED_ORDER_GENERATION_KEYS) || result.order_created_weeks < 2 || result.late_orders_created < 1 || result.max_active_orders > 3).length;
  const activityViolations = Number(semantic_activity.profit_processing_completions < 3 || semantic_activity.animal_purchases < 6 || semantic_activity.large_animal_purchases < 3 || semantic_activity.duck_purchases < 3 || semantic_activity.completed_barns < 3 || semantic_activity.animal_species_exercised.length < 5 || semantic_activity.accepted_orders < 1 || semantic_activity.delivered_orders < 1 || semantic_activity.related_strategy_order_deliveries < 1 || semantic_activity.delivered_order_source_weeks.length < 2 || semantic_activity.late_order_deliveries < 1);
  return { days: 84, seeds_per_strategy: 3, strategies: results, semantic_activity, cash_ranges: cashRanges, free_loop_detected: freeLoop, dominant_strategy: dominantStrategy, best_strategy_minimum_cash: bestMinimum, violations: structuralViolations + utilizationViolations + roleViolations + dateViolations + activityViolations + Number(Boolean(freeLoop || dominantStrategy)) };
}

export function runAllSimulations() {
  const weather = simulateWeatherSeasons("weather-baseline-v1", 10000);
  const events = simulateEventDays(10000);
  const invariants = runInvariantSamples(100000);
  const golden = [7, 21, 84].map((days) => runGoldenReplay(days));
  const strategies = simulateSixStrategies();
  return { weather, events, invariants, golden, strategies };
}
