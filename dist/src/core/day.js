import { ANIMAL_SPECIES, CROPS, ITEMS } from "../content/definitions.js";
import { auditedRoll } from "./rng.js";
import { advanceCalendar, canonicalStringify, compressText, decompressText, deepClone, gregorianDayNumber, halfUp, sha256 } from "./utils.js";
import { canonicalStateDigest, makeRecoveryPoint, validateState } from "./state.js";
import { treatAnimal, updateAnimals } from "../rules/animals.js";
import { harvestCrop, markIrrigation, updatePlots } from "../rules/crops.js";
import { expireEvents, generateDailyEvents, processScheduledEffects } from "../rules/events.js";
import { ageInventory, itemDefinition, queueForSale, storageUsed } from "../rules/inventory.js";
import { priceLots } from "../rules/economy.js";
import { expireOrders, generateWeeklyOrders } from "../rules/orders.js";
import { advanceProcessing } from "../rules/processing.js";
import { activateReadyConstruction } from "../rules/construction.js";
import { generateForecast, generateWeather, weatherDefinition } from "../rules/weather.js";
import { forecastWork, housingCareCost, resetDailyWork, routineCropCost, spendWork, WORK_PRIORITIES } from "../rules/work.js";

export const DAY_PHASES = Object.freeze([
  "time_lock", "trustee", "weather", "plots", "animals", "processing_building", "inventory_fees", "sales_orders", "effects_events", "journal_commit",
]);

function checkFailpoint(options, phase, index) {
  if (options.failpoint === phase || options.failpoint === index || options.failpoint === `after:${phase}`) throw new Error(`模拟日结故障点: ${phase}`);
}

export function addDateKey(dateKey, days) {
  return new Date((gregorianDayNumber(dateKey) + days) * 86400000).toISOString().slice(0, 10);
}

function workAvailable(state, wp, focus = 0) {
  return state.work_plan.used_wp + wp <= state.work_plan.capacity && state.work_plan.used_focus + focus <= state.work_plan.focus_capacity;
}

function applyTrustee(state) {
  const report = { tasks: [], rejected: [], feed_expected: true, feeding_executed: false, expected_cash_cost: 0 };
  const priority = (category) => state.work_plan.priority_overrides?.[category] ?? WORK_PRIORITIES[category];
  const candidates = [];
  const addTask = (category, label, wp, action) => candidates.push({ category, label, wp, priority: priority(category), action, order: candidates.length });
  for (const animal of state.animals.filter((entry) => entry.illness && entry.illness.treatment?.status !== "recovering")) {
    addTask("medical", `处理${animal.name}的异常`, 1, () => {
      const beforeWp = state.work_plan.used_wp;
      const result = treatAnimal(state, animal.id, "treatment_basic_care", { source: "trustee" });
      state.work_plan.used_wp = beforeWp;
      state.work_plan.tasks = state.work_plan.tasks.filter((task) => task.id !== `treat_${animal.id}`);
      return result;
    });
  }
  const careCost = housingCareCost(state);
  if (careCost) addTask("feeding", "圈舍喂养与收集", careCost, () => { report.feeding_executed = true; });
  for (const plot of state.plots.filter((entry) => entry.crop && ["mature", "grace", "overripe"].includes(entry.crop.status))) {
    addTask("harvest", `收获${plot.name}`, 1, () => harvestCrop(state, plot.plot_id, "trustee"));
  }
  const forecastWeatherId = state.weather?.forecast?.[0]?.weather_id ?? state.weather?.today_id;
  const forecastWeather = forecastWeatherId ? weatherDefinition(forecastWeatherId) : { precipitation: 0, evaporation: 10 };
  const irrigationTargets = state.plots.filter((plot) => {
    if (!plot.crop) return false;
    const crop = CROPS.find((entry) => entry.id === plot.crop.crop_id);
    return plot.moisture + forecastWeather.precipitation - forecastWeather.evaporation - crop.water_use < 35;
  });
  const routineCost = routineCropCost(state, CROPS);
  if (routineCost > 0) addTask("irrigation", irrigationTargets.length ? "田区巡查与必要灌溉" : "田区例行巡查", routineCost, () => irrigationTargets.forEach((plot) => markIrrigation(state, plot.plot_id, "trustee")));
  for (const housing of state.housing.filter((entry) => state.animals.some((animal) => animal.housing_id === entry.id) && entry.cleanliness < 50)) {
    addTask("medical", `清洁${housing.name}`, 1, () => { housing.clean_today = true; });
  }
  const perishables = state.inventory.warehouse.lots
    .filter((lot) => !lot.reserved_for && lot.age >= Math.ceil(itemDefinition(lot.item_id).shelf_life * 0.5) && !itemDefinition(lot.item_id).tags.includes("reserved"))
    .sort((a, b) => b.age - a.age);
  for (const lot of perishables) addTask("processing", `托管出售${itemDefinition(lot.item_id).name}`, 0, () => {
    if (storageUsed(state.inventory.sale_box) >= state.inventory.sale_box.capacity) throw new Error("出售箱容量不足");
    queueForSale(state, lot.item_id, lot.quantity);
  });
  candidates.sort((a, b) => b.priority - a.priority || a.order - b.order);
  for (const candidate of candidates) {
    if (!workAvailable(state, candidate.wp)) {
      report.rejected.push({ label: candidate.label, category: candidate.category, reason: "工时不足", priority: candidate.priority });
      continue;
    }
    try {
      const cashBefore = state.economy.cash;
      candidate.action();
      spendWork(state, candidate.wp, 0, { id: `trustee_${state.calendar.absolute_day}_${report.tasks.length + 1}`, priority: candidate.priority, label: candidate.label, source: "trustee" });
      const cashDelta = state.economy.cash - cashBefore;
      if (cashDelta) state.daily_ledgers.push({ type: "expense", layer: "account", category: "trustee_medical", day: state.calendar.absolute_day, amount: -cashDelta, cash_delta: cashDelta, message: candidate.label });
      report.tasks.push({ label: candidate.label, category: candidate.category, wp: candidate.wp, priority: candidate.priority });
    } catch (error) {
      report.rejected.push({ label: candidate.label, category: candidate.category, reason: error.message, priority: candidate.priority });
    }
  }
  return report;
}

function replenishFeed(state) {
  const dailyNeed = state.animals.reduce((sum, animal) => {
    const definition = ANIMAL_SPECIES.find((entry) => entry.id === animal.species_id);
    if (!definition) throw new Error(`未知动物物种: ${animal.species_id}`);
    return sum + definition.feed_units;
  }, 0);
  const current = state.inventory.silo.quantities.item_feed ?? 0;
  if (!dailyNeed || current >= dailyNeed * 3) return { purchased: 0, cost: 0 };
  const desired = Math.max(0, Math.min(state.inventory.silo.capacity - current, dailyNeed * 7 - current));
  const maxCost = Math.floor(state.economy.cash * 0.30);
  const purchased = Math.min(desired, Math.floor(maxCost / 10));
  const cost = purchased * 10;
  state.economy.cash -= cost;
  state.inventory.silo.quantities.item_feed = current + purchased;
  return { purchased, cost };
}

function settleSales(state) {
  const lots = state.inventory.sale_box.lots.filter((lot) => lot.born_day < state.calendar.absolute_day);
  if (!lots.length) return { total: 0, lines: [] };
  const result = priceLots(state, lots, 1);
  state.economy.cash += result.total;
  for (const line of result.lines) {
    const key = `${result.week_key}:${line.item_id}`;
    state.economy.weekly_sales[key] = (state.economy.weekly_sales[key] ?? 0) + line.quantity;
  }
  const settledIds = new Set(lots.map((lot) => lot.lot_id));
  state.inventory.sale_box.lots = state.inventory.sale_box.lots.filter((lot) => !settledIds.has(lot.lot_id));
  state.daily_ledgers.push({ type: "sale_settlement", layer: "account", day: state.calendar.absolute_day, total: result.total, cash_delta: result.total, price_snapshot: result });
  return result;
}

function makeWeeklyReport(state) {
  const recent = state.daily_ledgers.filter((entry) => Number.isInteger(entry.day) && entry.day > state.calendar.absolute_day - 7);
  const cashEntries = recent.filter((entry) => Number.isInteger(entry.cash_delta) && entry.cash_delta !== 0);
  const income = cashEntries.reduce((sum, entry) => sum + Math.max(0, entry.cash_delta), 0);
  const expenses = cashEntries.reduce((sum, entry) => sum + Math.max(0, -entry.cash_delta), 0);
  const dailyReports = recent.filter((entry) => entry.type === "daily_report");
  return {
    week_block: state.calendar.week_block,
    ending_day: state.calendar.absolute_day,
    income,
    expenses,
    net_cash_flow: income - expenses,
    cash: state.economy.cash,
    work_utilization: dailyReports.length ? dailyReports.reduce((sum, entry) => sum + (entry.work_used ?? 0) / (entry.work_capacity ?? 12), 0) / dailyReports.length : state.work_plan.used_wp / state.work_plan.capacity,
    inventory_used: storageUsed(state.inventory.warehouse),
    slow_moving_items: state.inventory.warehouse.lots.filter((lot) => lot.age >= Math.ceil(itemDefinition(lot.item_id).shelf_life * 0.5)).map((lot) => lot.item_id),
    upcoming_harvests: state.plots.filter((plot) => plot.crop && ["mature", "grace"].includes(plot.crop.status)).map((plot) => plot.plot_id),
    crop_risks: state.plots.filter((plot) => plot.crop && plot.crop.health < 40).map((plot) => plot.plot_id),
    animal_risks: state.animals.filter((animal) => animal.health < 60 || animal.illness).map((animal) => animal.id),
    relationship_changes: Object.fromEntries(Object.entries(state.residents).map(([id, relation]) => [id, { familiarity_gain: relation.weekly_familiarity_gain, trust_gain: relation.weekly_trust_gain }])),
    weather_trend: state.weather.forecast.map((entry) => entry.weather_id),
  };
}

function makeAnnualReport(state) {
  const year = state.calendar.year - 1;
  const archived = state.history_index.cash_archive_by_year?.[year] ?? { income: 0, expenses: 0, net: 0 };
  const current = state.daily_ledgers.filter((entry) => Number.isInteger(entry.day) && Math.floor((entry.day - 1) / 84) + 1 === year && Number.isInteger(entry.cash_delta));
  const income = archived.income + current.reduce((sum, entry) => sum + Math.max(0, entry.cash_delta), 0);
  const expenses = archived.expenses + current.reduce((sum, entry) => sum + Math.max(0, -entry.cash_delta), 0);
  return {
    year,
    ending_day: state.calendar.absolute_day,
    cash: state.economy.cash,
    total_income: income,
    total_expenses: expenses,
    net_cash_flow: income - expenses,
    total_sales: (state.history_index.sales_archive_by_year?.[year] ?? 0) + current.filter((entry) => entry.type === "sale_settlement").reduce((sum, entry) => sum + entry.total, 0),
    net_profit: income - expenses,
    ledger_reconciled_cash: recomputeCashFromLedger(state),
    major_products: Object.entries(state.economy.weekly_sales).sort((a, b) => b[1] - a[1]).slice(0, 5),
    land_use: state.plots.map((plot) => ({ plot_id: plot.plot_id, history_tags: [...plot.history_tags] })),
    animal_welfare: state.animals.map((animal) => ({ id: animal.id, health: animal.health, mood: animal.mood })),
    relationships: Object.fromEntries(Object.entries(state.residents).map(([id, relation]) => [id, { familiarity: relation.familiarity, trust: relation.trust }])),
    key_choices: state.events.history.slice(-20),
    unfinished_goals: [
      ...state.construction.filter((project) => !["complete", "cancelled"].includes(project.status)).map((project) => project.building_id),
      ...state.orders.filter((order) => ["offered", "accepted"].includes(order.status)).map((order) => order.id),
    ],
    next_year_advice: "保留恢复点，依据周报错峰播种，并为动物准备至少7日饲料。",
  };
}

export function recomputeCashFromLedger(state) {
  const opening = state.economy.ledger_opening_cash ?? 2400;
  return opening + (state.history_index.archived_cash_delta ?? 0) + state.daily_ledgers.reduce((sum, entry) => sum + (Number.isInteger(entry.cash_delta) ? entry.cash_delta : 0), 0);
}

function retainRemovedLedgerForRecovery(state, removed) {
  if (!removed.length) return;
  state.recovery_ledger_chunks ??= [];
  state.recovery_ledger_chunks.push({
    start_index: state.history_index.archived_ledger_count ?? 0,
    count: removed.length,
    entries_compressed: compressText(JSON.stringify(removed)),
  });
  // Only the internal prerelease point format needs an external history
  // prefix. Current points are self-contained and immutable after creation.
  const points = [...state.recovery_points, ...state.recovery_archive.weekly, ...state.recovery_archive.year_start]
    .filter((point) => !["self_contained_v2", "shared_history_v2"].includes(point.snapshot_format));
  const visited = new Set();
  for (const point of points) {
    if (!point.history_prefix_compressed) continue;
    if (visited.has(point)) continue;
    visited.add(point);
    const relevant = removed.filter((entry) => !Number.isInteger(entry.day) || entry.day <= point.day);
    if (!relevant.length) continue;
    const prefix = JSON.parse(decompressText(point.history_prefix_compressed));
    prefix.push(...deepClone(relevant));
    point.history_prefix_compressed = compressText(JSON.stringify(prefix));
  }
}

function pruneRecoveryLedgerChunks(state) {
  const points = [...state.recovery_points, ...state.recovery_archive.weekly, ...state.recovery_archive.year_start];
  const starts = points
    .filter((point) => point.snapshot_format === "shared_history_v2" && point.history_cursors.daily_ledgers > 0)
    .map((point) => point.history_cursors.daily_ledger_total - point.history_cursors.daily_ledgers);
  const minimum = starts.length ? Math.min(...starts) : (state.history_index.archived_ledger_count ?? 0);
  state.recovery_ledger_chunks = (state.recovery_ledger_chunks ?? []).filter((chunk) => chunk.start_index + chunk.count > minimum);
}

function settleFinancialAssistance(state) {
  const assistance = state.economy.assistance;
  if (!assistance || assistance.status !== "active" || assistance.due_day > state.calendar.absolute_day) return null;
  const paid = Math.min(state.economy.cash, assistance.amount_due);
  state.economy.cash -= paid;
  assistance.paid = (assistance.paid ?? 0) + paid;
  assistance.amount_due -= paid;
  assistance.status = assistance.amount_due === 0 ? "repaid" : "hardship_outstanding";
  assistance.last_payment_day = state.calendar.absolute_day;
  state.daily_ledgers.push({ type: "assistance_repayment", layer: "account", day: state.calendar.absolute_day, assistance_id: assistance.id, amount: paid, cash_delta: -paid, remaining: assistance.amount_due, compound_interest: false });
  return { paid, remaining: assistance.amount_due, status: assistance.status };
}

export function settleOneDay(inputState, options = {}) {
  validateState(inputState);
  const state = deepClone(inputState);
  const journal = { from_day: inputState.calendar.absolute_day, phases: [], trustee: null, weather: null, plots: [], animals: [], completed_processing: [], activated_buildings: [], feed_purchase: null, sales: null, events: [], scheduled_effects: 0 };

  state.weather ??= { history: [], today_id: null, today_tags: [], forecast: [] };
  const pendingWeatherId = options.weather_id ?? generateWeather(state.save_seed, state.calendar.absolute_day + 1, state.weather.history);
  const pendingWeather = weatherDefinition(pendingWeatherId);
  state.weather.forecast = [{ distance: 1, weather_id: pendingWeatherId }];
  state.calendar = advanceCalendar(state.calendar, 1);
  if (options.real_date_key) state.last_real_date_key = options.real_date_key;
  journal.phases.push("time_lock");
  checkFailpoint(options, "time_lock", 1);

  journal.trustee = options.trustee === false ? { tasks: [], rejected: [], feed_expected: false, feeding_executed: false } : applyTrustee(state);
  journal.feed_purchase = options.trustee === false || !journal.trustee.feeding_executed ? { purchased: 0, cost: 0 } : replenishFeed(state);
  if (journal.feed_purchase.cost) state.daily_ledgers.push({ type: "expense", layer: "account", category: "feed_purchase", day: state.calendar.absolute_day, amount: journal.feed_purchase.cost, cash_delta: -journal.feed_purchase.cost });
  journal.phases.push("trustee");
  checkFailpoint(options, "trustee", 2);

  const weatherId = pendingWeatherId;
  const weather = weatherDefinition(weatherId);
  state.weather.today_id = weatherId;
  state.weather.today_tags = [...weather.tags];
  state.weather.history.push({ day: state.calendar.absolute_day, weather_id: weatherId, week_block: state.calendar.week_block });
  state.weather.history = state.weather.history.slice(-84);
  const forecastDays = state.flags.forecast_days ?? 3;
  state.weather.forecast = generateForecast(state.save_seed, state.calendar.absolute_day, state.weather.history, forecastDays).map(({ actual_weather_id, ...entry }) => entry);
  state.work_plan.forecast = forecastWork(state, CROPS, 3);
  journal.weather = weatherId;
  journal.phases.push("weather");
  checkFailpoint(options, "weather", 3);

  journal.plots = updatePlots(state, weatherId, { offline: options.offline !== false });
  journal.phases.push("plots");
  checkFailpoint(options, "plots", 4);

  journal.animals = updateAnimals(state, weatherId, { offline: options.offline !== false, feeding_enabled: journal.trustee.feeding_executed });
  journal.phases.push("animals");
  checkFailpoint(options, "animals", 5);

  journal.completed_processing = advanceProcessing(state);
  journal.activated_buildings = activateReadyConstruction(state);
  journal.phases.push("processing_building");
  checkFailpoint(options, "processing_building", 6);

  ageInventory(state);
  const assistancePayment = settleFinancialAssistance(state);
  const charged = Math.min(state.economy.cash, state.economy.upkeep_per_day);
  state.economy.cash -= charged;
  state.daily_ledgers.push({ type: "expense", layer: "account", category: "upkeep", day: state.calendar.absolute_day, amount: charged, cash_delta: -charged });
  if (charged < state.economy.upkeep_per_day) {
    state.flags.financial_relief_due = !state.flags.finance_bridge_used;
    state.flags.nonessential_paused = true;
  } else if (!state.flags.financial_relief_due && state.economy.cash >= state.economy.upkeep_per_day * 7) delete state.flags.nonessential_paused;
  journal.feed_purchase.recorded_in_phase = "trustee";
  journal.phases.push("inventory_fees");
  checkFailpoint(options, "inventory_fees", 7);

  journal.sales = settleSales(state);
  expireOrders(state);
  const monday = new Date(gregorianDayNumber(state.last_real_date_key) * 86400000).getUTCDay() === 1;
  const orderWeekKey = `orders_generated_${state.last_real_date_key}`;
  if (monday && !state.flags[orderWeekKey]) {
    generateWeeklyOrders(state);
    state.flags[orderWeekKey] = true;
  }
  journal.phases.push("sales_orders");
  checkFailpoint(options, "sales_orders", 8);

  journal.scheduled_effects = processScheduledEffects(state);
  expireEvents(state);
  journal.events = generateDailyEvents(state);
  journal.phases.push("effects_events");
  checkFailpoint(options, "effects_events", 9);

  journal.phases.push("journal_commit");
  const hashBeforeJournal = canonicalStateDigest(state);
  state.daily_ledgers.push({ type: "daily_report", layer: "operation", day: state.calendar.absolute_day, journal, work_used: state.work_plan.used_wp, work_capacity: state.work_plan.capacity, state_hash: hashBeforeJournal });
  if (state.calendar.absolute_day % 7 === 0) state.weekly_reports.push(makeWeeklyReport(state));
  if ((state.calendar.absolute_day - 1) % 84 === 0 && state.calendar.absolute_day > 1) state.annual_reports.push(makeAnnualReport(state));
  // Player commands and trustee work share one daily budget.  Only after the
  // report is captured do we open a blank plan for the newly displayed day.
  resetDailyWork(state);
  if (state.daily_ledgers.length > 256) {
    const removed = state.daily_ledgers.splice(0, state.daily_ledgers.length - 256);
    retainRemovedLedgerForRecovery(state, removed);
    state.history_index.archived_ledger_count = (state.history_index.archived_ledger_count ?? 0) + removed.length;
    state.history_index.archived_ledger_hash = sha256(`${state.history_index.archived_ledger_hash ?? "ledger:v1"}:${canonicalStringify(removed)}`);
    state.history_index.archived_cash_delta = (state.history_index.archived_cash_delta ?? 0) + removed.reduce((sum, entry) => sum + (entry.cash_delta ?? 0), 0);
    state.history_index.cash_archive_by_year ??= {};
    state.history_index.sales_archive_by_year ??= {};
    for (const entry of removed.filter((item) => Number.isInteger(item.day))) {
      const year = Math.floor((entry.day - 1) / 84) + 1;
      const bucket = state.history_index.cash_archive_by_year[year] ?? { income: 0, expenses: 0, net: 0 };
      const delta = Number.isInteger(entry.cash_delta) ? entry.cash_delta : 0;
      bucket.income += Math.max(0, delta); bucket.expenses += Math.max(0, -delta); bucket.net += delta;
      state.history_index.cash_archive_by_year[year] = bucket;
      if (entry.type === "sale_settlement") state.history_index.sales_archive_by_year[year] = (state.history_index.sales_archive_by_year[year] ?? 0) + entry.total;
    }
  }
  if (state.events.history.length > 128) {
    const removed = state.events.history.splice(0, state.events.history.length - 128);
    state.history_index.archived_event_count = (state.history_index.archived_event_count ?? 0) + removed.length;
    state.history_index.archived_event_hash = sha256(`${state.history_index.archived_event_hash ?? "events:v1"}:${canonicalStringify(removed)}`);
  }
  if (state.orders.length > 96) {
    const terminal = new Set(["complete", "abandoned", "expired"]);
    const removable = state.orders.filter((order) => terminal.has(order.status)).slice(0, state.orders.length - 96);
    const removedIds = new Set(removable.map((order) => order.id));
    if (removedIds.size) {
      state.orders = state.orders.filter((order) => !removedIds.has(order.id));
      state.history_index.archived_order_count = (state.history_index.archived_order_count ?? 0) + removable.length;
      state.history_index.archived_order_hash = sha256(`${state.history_index.archived_order_hash ?? "orders:v1"}:${canonicalStringify(removable)}`);
    }
  }
  const point = makeRecoveryPoint(state, "daily");
  state.recovery_points.push(point);
  state.recovery_points = state.recovery_points.slice(-7);
  state.recovery_archive ??= { weekly: [], year_start: [] };
  if (state.calendar.absolute_day % 7 === 0) {
    state.recovery_archive.weekly.push({ ...point, reason: "weekly" });
    state.recovery_archive.weekly = state.recovery_archive.weekly.slice(-4);
  }
  if ((state.calendar.absolute_day - 1) % 84 === 0) {
    state.recovery_archive.year_start = [{ ...point, reason: "year_start" }];
  }
  pruneRecoveryLedgerChunks(state);
  checkFailpoint(options, "journal_commit", 10);
  validateState(state);
  if (recomputeCashFromLedger(state) !== state.economy.cash) throw new Error("结构化账本无法重算当前资金");
  return { state, journal, state_hash: canonicalStateDigest(state) };
}

export function advanceOffline(inputState, days, options = {}) {
  if (!Number.isInteger(days) || days < 0) throw new RangeError("离线日数必须为非负整数");
  let state = deepClone(inputState);
  const activeDays = Math.min(7, days);
  const summaries = [];
  for (let index = 1; index <= activeDays; index += 1) {
    const realDateKey = addDateKey(inputState.last_real_date_key, index);
    const result = settleOneDay(state, { ...options, real_date_key: realDateKey, offline: true });
    state = result.state;
    summaries.push({ day: state.calendar.absolute_day, hash: result.state_hash, journal: result.journal });
  }
  const restDays = days - activeDays;
  if (restDays > 0) {
    for (const order of state.orders.filter((entry) => ["offered", "accepted"].includes(entry.status))) order.deadline_day += restDays;
    for (const event of state.events.active.filter((entry) => entry.status === "pending" && entry.deadline_day !== null)) event.deadline_day += restDays;
    for (const scheduled of state.events.scheduled_effects) scheduled.due_day += restDays;
    for (const modifier of state.animals.flatMap((animal) => animal.production_modifiers ?? [])) modifier.through_day += restDays;
    for (const plot of state.plots.filter((entry) => entry.crop)) {
      plot.crop.planted_day += restDays;
      if (plot.crop.mature_day !== null) plot.crop.mature_day += restDays;
    }
    for (const batch of state.processing.batches.filter((entry) => ["pending", "started"].includes(entry.status))) {
      if (batch.queued_day) batch.queued_day += restDays;
      if (batch.started_day) batch.started_day += restDays;
    }
    for (const project of state.construction.filter((entry) => !["complete", "cancelled"].includes(entry.status))) {
      if (project.started_day) project.started_day += restDays;
      if (project.ready_day) project.ready_day += restDays;
      if (project.last_invest_day) project.last_invest_day += restDays;
    }
    if (state.economy.assistance?.status === "active") state.economy.assistance.due_day += restDays;
    state.calendar = advanceCalendar(state.calendar, restDays);
    state.clock.rest_days += restDays;
    state.flags.trustee_frozen = true;
    state.daily_ledgers.push({ type: "rest_freeze", layer: "operation", from_day: state.calendar.absolute_day - restDays + 1, to_day: state.calendar.absolute_day, days: restDays, deadlines_shifted: true, reports_paused: true, message: "超过7日的时间进入休整；未消耗、生产、老化或逾期，期限按休整日数顺延。" });
  } else delete state.flags.trustee_frozen;
  if (restDays > 0) resetDailyWork(state);
  state.last_real_date_key = addDateKey(inputState.last_real_date_key, days);
  validateState(state);
  return { state, active_days: activeDays, rest_days: restDays, summaries };
}

export function auditCoreInvariants(state) {
  validateState(state);
  if (state.daily_ledgers.some((entry) => entry.type === "daily_report" && entry.journal.phases.join("|") !== DAY_PHASES.join("|"))) throw new Error("日结阶段顺序不一致");
  return true;
}
