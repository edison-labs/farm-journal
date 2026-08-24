import { ANIMAL_SPECIES, CONTENT_VERSION, CROPS, ITEMS, RESIDENTS, SKILLS } from "../content/definitions.js";
import { calendarFromAbsolute, canonicalStringify, compressText, decompressText, deepClone, makeId, rolloverDateKey, sha256 } from "./utils.js";
import { generateForecast, generateWeather, weatherDefinition } from "../rules/weather.js";
import { storageUsed } from "../rules/inventory.js";
import { forecastWork } from "../rules/work.js";

export const SAVE_VERSION = 1;

export function createNewSave(options = {}) {
  const now = options.now ?? Date.now();
  const timezone = options.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone ?? "UTC";
  const rolloverHour = options.rollover_hour ?? 5;
  if (!Number.isInteger(rolloverHour) || rolloverHour < 0 || rolloverHour > 8) throw new RangeError("刷新小时必须为0—8的整点");
  const seed = String(options.save_seed ?? "garden-journal-default-seed");
  const saveId = options.save_id ?? makeId("save", seed, now);
  const realDateKey = rolloverDateKey(now, timezone, rolloverHour);
  const calendar = calendarFromAbsolute(1);
  const initialWeatherId = generateWeather(seed, 1, []);
  const initialWeather = weatherDefinition(initialWeatherId);
  const initialWeatherHistory = [{ day: 1, weather_id: initialWeatherId, week_block: 0 }];
  const residentState = Object.fromEntries(RESIDENTS.map((resident) => [resident.id, {
    id: resident.id,
    familiarity: 0,
    trust: 0,
    weekly_familiarity_gain: 0,
    weekly_trust_gain: 0,
    week_block: 0,
    gifts_this_week: 0,
    shared_experiences: [],
  }]));
  const skillState = Object.fromEntries(SKILLS.map((skill) => [skill.id, { level: 0, xp: 0 }]));
  const state = {
    save_version: SAVE_VERSION,
    content_version: CONTENT_VERSION,
    save_id: saveId,
    save_seed: seed,
    created_at: new Date(now).toISOString(),
    timezone,
    rollover_hour: rolloverHour,
    last_trusted_time: now,
    last_real_date_key: realDateKey,
    clock: {
      status: "normal",
      rollback_ms: 0,
      timezone_migrated_at_day: null,
      rest_days: 0,
    },
    calendar,
    weather: {
      today_id: initialWeatherId,
      today_tags: [...initialWeather.tags],
      history: initialWeatherHistory,
      forecast: generateForecast(seed, 1, initialWeatherHistory, 3).map(({ actual_weather_id, ...entry }) => entry),
    },
    economy: {
      cash: 2400,
      ledger_opening_cash: 2400,
      upkeep_per_day: 20,
      reserved_cash: 0,
      weekly_sales: {},
      weekly_market: {},
      opportunity_cost: { feed_consumed: 0, fertility_consumed: 0 },
      assistance: null,
    },
    work_plan: {
      farm_day: 1,
      capacity: 12,
      focus_capacity: 3,
      used_wp: 0,
      used_focus: 0,
      tasks: [],
      confirmed: false,
      trustee_template: "conservative_v1",
      priority_overrides: {},
      forecast: [],
    },
    plots: [
      {
        plot_id: "plot_a", name: "A田区", unlocked: true, land_use_type: "field", cells: 12,
        moisture: 60, fertility: 60, weeds: 0, crop: null, protection_tags: [], history_tags: [],
      },
      {
        plot_id: "plot_b", name: "B田区", unlocked: false, land_use_type: "field", cells: 12,
        moisture: 60, fertility: 60, weeds: 0, crop: null, protection_tags: [], history_tags: [],
      },
    ],
    animals: [
      createAnimal("animal_hen_amber", "琥珀", "animal_chicken", "female"),
      createAnimal("animal_hen_millet", "小米", "animal_chicken", "female"),
      createAnimal("animal_hen_cloud", "云朵", "animal_chicken", "female"),
    ],
    housing: [
      { id: "housing_coop_1", name: "鸡舍", tags: ["coop"], level: 1, capacity: 4, cleanliness: 100, insulation: false, windproof: false, grazing_allowed: true },
      { id: "housing_barn_1", name: "畜棚", tags: ["barn"], level: 0, capacity: 0, cleanliness: 100, insulation: false, windproof: false, grazing_allowed: false },
    ],
    buildings: [
      { id: "storage_1", status: "complete", level: 1 },
      { id: "coop_1", status: "complete", level: 1 },
      { id: "well_1", status: "complete", level: 1, coverage: 2 },
    ],
    construction: [],
    inventory: {
      warehouse: { capacity: 120, lots: [] },
      seed_cabinet: { capacity: 120, quantities: { seed_turnip: 12 } },
      silo: { capacity: 120, quantities: { item_feed: 42 } },
      sale_box: { capacity: 20, lots: [] },
      temporary: { capacity: 20, lots: [] },
      reservations: {},
      anomalies: [],
      lot_sequence: 0,
    },
    processing: { queue_capacity: 0, batches: [] },
    orders: [],
    residents: residentState,
    skills: skillState,
    events: {
      active: [],
      history: [],
      cooldowns: {},
      scheduled_effects: [],
      weekly_urgent_count: 0,
      week_block: 0,
      recent_tags: [],
    },
    exploration: { last_region_days: {}, history: [] },
    flags: {},
    history_index: {},
    recovery_ledger_chunks: [],
    daily_ledgers: [],
    weekly_reports: [],
    annual_reports: [],
    rng_audit: [],
    action_receipts: {},
    recovery_points: [],
    recovery_archive: { weekly: [], year_start: [] },
    modules: {
      feature_weather_fronts: { enabled: false, state: {} },
      feature_breeding: { enabled: false, state: {} },
      feature_orchards: { enabled: false, state: {} },
      feature_staff: { enabled: false, state: {} },
    },
    settings: {
      grayscale: false,
      font_scale: 1,
      line_height: 1.6,
      contrast: "normal",
      reduced_motion: true,
      compact: false,
      tab_title: "田园日志",
    },
    read_only_recovery: false,
  };
  state.work_plan.forecast = forecastWork(state, CROPS, 3);
  initializeRecoveryHistory(state);
  return state;
}

export function stateWithoutRecovery(state) {
  // RNG draws are an append-only audit trail.  They have their own digest in
  // evidence and must not make an otherwise identical gameplay snapshot
  // unrestorable merely because the bounded audit window moved on.
  const { recovery_ledger_chunks: _sharedRecoveryLedger, ...gameplayState } = state;
  return deepClone({ ...gameplayState, rng_audit: [], action_receipts: {}, recovery_points: [], recovery_archive: { weekly: [], year_start: [] } });
}

export function canonicalStateDigest(state) {
  return sha256(canonicalStringify(stateWithoutRecovery(state)));
}

export function makeRecoveryPoint(state, reason = "daily") {
  const history_cursors = {
    daily_ledgers: state.daily_ledgers.length,
    daily_ledger_total: (state.history_index.archived_ledger_count ?? 0) + state.daily_ledgers.length,
    weekly_reports: state.weekly_reports.length,
    annual_reports: state.annual_reports.length,
    rng_audit: state.rng_audit.length,
    event_history: state.events.history.length,
    weather_history: state.weather.history.length,
    exploration_history: state.exploration.history.length,
    action_receipt_ids: Object.keys(state.action_receipts),
    farm_day: state.calendar.absolute_day,
  };
  const snapshot = deepClone({
    ...state,
    daily_ledgers: [], weekly_reports: [], annual_reports: [], rng_audit: [],
    recovery_ledger_chunks: [],
    recovery_points: [], recovery_archive: { weekly: [], year_start: [] },
  });
  return {
    snapshot_format: "shared_history_v2",
    day: state.calendar.absolute_day,
    state_hash: canonicalStateDigest(state),
    reason,
    history_cursors,
    state_compressed: compressText(JSON.stringify(snapshot)),
  };
}

export function restoreRecoveryPoint(currentState, point) {
  if ((!point?.state && !point?.state_compressed) || !point.history_cursors) throw new Error("恢复点缺少紧凑状态或历史游标");
  const restored = point.state_compressed ? JSON.parse(decompressText(point.state_compressed)) : deepClone(point.state);
  if (point.snapshot_format === "self_contained_v2") {
    restored.recovery_points = [];
    restored.recovery_archive = { weekly: [], year_start: [] };
    const currentDigest = canonicalStateDigest(restored);
    // Internal prerelease self-contained points predate the shared history
    // field. Accept their original canonical form without weakening checksum
    // verification for any other field.
    const legacyState = deepClone({ ...restored, rng_audit: [], action_receipts: {}, recovery_points: [], recovery_archive: { weekly: [], year_start: [] } });
    delete legacyState.recovery_ledger_chunks;
    const legacyDigest = sha256(canonicalStringify(legacyState));
    if (currentDigest !== point.state_hash && legacyDigest !== point.state_hash) throw new Error("恢复点状态哈希不一致");
    return restored;
  }
  const cursor = point.history_cursors;
  const throughDay = (entries, dayField, expectedLength) => {
    const eligible = entries.filter((entry) => {
      const value = entry?.[dayField];
      return !Number.isInteger(value) || value <= point.day;
    });
    // New saves use day-based cursors.  This fallback keeps internal v1
    // prerelease points readable while avoiding the old shifting-index bug.
    return eligible.length <= expectedLength ? eligible : eligible.slice(0, expectedLength);
  };
  if (point.snapshot_format === "shared_history_v2") {
    const targetEnd = cursor.daily_ledger_total ?? cursor.daily_ledgers;
    const targetStart = targetEnd - cursor.daily_ledgers;
    const ledger = [];
    for (const chunk of currentState.recovery_ledger_chunks ?? []) {
      const chunkEnd = chunk.start_index + chunk.count;
      if (chunkEnd <= targetStart || chunk.start_index >= targetEnd) continue;
      const entries = JSON.parse(decompressText(chunk.entries_compressed));
      ledger.push(...entries.slice(Math.max(0, targetStart - chunk.start_index), Math.min(entries.length, targetEnd - chunk.start_index)));
    }
    const liveStart = currentState.history_index.archived_ledger_count ?? 0;
    if (targetEnd > liveStart) ledger.push(...currentState.daily_ledgers.slice(Math.max(0, targetStart - liveStart), targetEnd - liveStart));
    if (ledger.length !== cursor.daily_ledgers) throw new Error("恢复点共享账本窗口不完整");
    restored.daily_ledgers = deepClone(ledger);
    restored.weekly_reports = deepClone(throughDay(currentState.weekly_reports, "ending_day", cursor.weekly_reports));
    restored.annual_reports = deepClone(throughDay(currentState.annual_reports, "ending_day", cursor.annual_reports));
    restored.rng_audit = [];
    restored.recovery_ledger_chunks = [];
    restored.recovery_points = [];
    restored.recovery_archive = { weekly: [], year_start: [] };
    if (canonicalStateDigest(restored) !== point.state_hash) throw new Error("恢复点共享历史与状态哈希不一致");
    return restored;
  }
  const prefix = point.history_prefix_compressed ? JSON.parse(decompressText(point.history_prefix_compressed)) : point.history_prefix?.daily_ledgers ?? [];
  restored.daily_ledgers = deepClone([...prefix, ...throughDay(currentState.daily_ledgers, "day", cursor.daily_ledgers)]);
  if (restored.daily_ledgers.length > cursor.daily_ledgers) restored.daily_ledgers = restored.daily_ledgers.slice(-cursor.daily_ledgers);
  restored.weekly_reports = deepClone(throughDay(currentState.weekly_reports, "ending_day", cursor.weekly_reports));
  restored.annual_reports = deepClone(throughDay(currentState.annual_reports, "ending_day", cursor.annual_reports));
  restored.rng_audit = deepClone(throughDay(currentState.rng_audit, "farm_date", cursor.rng_audit));
  // New compressed points carry the exact bounded receipt window in their
  // snapshot.  The fallback below is only for internal prerelease points.
  if (!restored.action_receipts) restored.action_receipts = Object.fromEntries(cursor.action_receipt_ids.filter((id) => currentState.action_receipts[id]).map((id) => [id, deepClone(currentState.action_receipts[id])]));
  restored.recovery_points = [];
  restored.recovery_archive = { weekly: [], year_start: [] };
  if (canonicalStateDigest(restored) !== point.state_hash) throw new Error("恢复点历史与状态哈希不一致");
  return restored;
}

export function initializeRecoveryHistory(state) {
  const point = makeRecoveryPoint(state, "year_start");
  state.recovery_points = [{ ...point, reason: "initial" }];
  state.recovery_archive = { weekly: [], year_start: [point] };
  return state;
}

function createAnimal(id, name, speciesId, sex) {
  return {
    id,
    species_id: speciesId,
    name,
    sex,
    life_stage: "adult",
    age_days: 0,
    health: 90,
    mood: 70,
    affinity: 20,
    satiety: 100,
    illness: null,
    production_cooldown: 0,
    housing_id: "housing_coop_1",
    source: "initial_flock",
    experience_tags: [],
    genome_ref: null,
    parent_ids: [],
    traits: [],
    weekly_affinity_gain: 0,
    affinity_week_block: 0,
    last_interaction_day: null,
  };
}

function assertFinite(value, path) {
  if (!Number.isFinite(value)) throw new Error(`${path} 必须是有限数值`);
}

export function validateState(state) {
  if (state.save_version !== SAVE_VERSION) throw new Error(`不支持的存档版本: ${state.save_version}`);
  if (!state.save_id || !state.save_seed) throw new Error("存档缺少稳定标识或随机种子");
  if (!Number.isInteger(state.calendar.absolute_day) || state.calendar.absolute_day < 1) throw new Error("牧场日期无效");
  const expectedCalendar = calendarFromAbsolute(state.calendar.absolute_day);
  for (const field of ["year", "season", "season_day", "week_block"]) if (state.calendar[field] !== expectedCalendar[field]) throw new Error(`历法冗余字段不一致: ${field}`);
  assertFinite(state.economy.cash, "economy.cash");
  if (state.economy.cash < 0 || !Number.isInteger(state.economy.cash)) throw new Error("资金必须为非负整数");
  const unique = (values, label) => { if (new Set(values).size !== values.length) throw new Error(`${label}稳定ID重复`); };
  unique(state.plots.map((plot) => plot.plot_id), "田区"); unique(state.animals.map((animal) => animal.id), "动物");
  const contentIds = { crops: new Set(CROPS.map((entry) => entry.id)), species: new Set(ANIMAL_SPECIES.map((entry) => entry.id)), items: new Set(ITEMS.map((entry) => entry.id)), housing: new Set(state.housing.map((entry) => entry.id)) };
  for (const plot of state.plots) {
    for (const field of ["moisture", "fertility", "weeds"]) {
      assertFinite(plot[field], `${plot.plot_id}.${field}`);
      if (plot[field] < 0 || plot[field] > 100) throw new Error(`${plot.plot_id}.${field} 越界`);
    }
    if (plot.crop) {
      if (!contentIds.crops.has(plot.crop.crop_id)) throw new Error(`${plot.plot_id}引用未知作物`);
      assertFinite(plot.crop.health, `${plot.plot_id}.crop.health`);
      assertFinite(plot.crop.growth_points, `${plot.plot_id}.crop.growth_points`);
      if (plot.crop.health < 0 || plot.crop.health > 100 || plot.crop.growth_points < 0) throw new Error(`${plot.plot_id}作物状态越界`);
      if (!Number.isInteger(plot.crop.severe_days) || plot.crop.severe_days < 0) throw new Error(`${plot.plot_id}严重天气计数无效`);
    }
  }
  for (const animal of state.animals) {
    if (!contentIds.species.has(animal.species_id) || !contentIds.housing.has(animal.housing_id)) throw new Error(`${animal.id}运行时外键无效`);
    for (const field of ["health", "mood", "affinity", "satiety"]) {
      assertFinite(animal[field], `${animal.id}.${field}`);
      if (animal[field] < 0 || animal[field] > 100) throw new Error(`${animal.id}.${field} 越界`);
    }
  }
  for (const store of [state.inventory.warehouse, state.inventory.sale_box, state.inventory.temporary]) {
    if (store.capacity < 0) throw new Error("库存容量不能为负");
    for (const lot of store.lots) {
      if (!contentIds.items.has(lot.item_id)) throw new Error(`${lot.lot_id}引用未知物品`);
      assertFinite(lot.quantity, `${lot.lot_id}.quantity`);
      if (lot.quantity <= 0 || !Number.isInteger(lot.quantity)) throw new Error(`${lot.lot_id} 数量必须为正整数`);
      assertFinite(lot.quality, `${lot.lot_id}.quality`);
      if (lot.quality < 0 || lot.quality > 100 || !Number.isInteger(lot.age) || lot.age < 0) throw new Error(`${lot.lot_id}品质或年龄越界`);
    }
    if (storageUsed(store) > store.capacity) throw new Error("库存实际占用超过容量");
  }
  unique([state.inventory.warehouse, state.inventory.sale_box, state.inventory.temporary].flatMap((store) => store.lots.map((lot) => lot.lot_id)), "库存批次");
  for (const quantity of Object.values(state.inventory.seed_cabinet.quantities)) if (quantity < 0) throw new Error("种子数量不能为负");
  for (const quantity of Object.values(state.inventory.silo.quantities)) if (quantity < 0) throw new Error("饲料数量不能为负");
  if (state.work_plan.used_wp < 0 || state.work_plan.used_wp > state.work_plan.capacity || state.work_plan.used_focus < 0 || state.work_plan.used_focus > state.work_plan.focus_capacity) throw new Error("工时或专注槽越界");
  for (const skill of Object.values(state.skills)) if (!Number.isInteger(skill.level) || skill.level < 0 || skill.level > 5 || skill.xp < 0) throw new Error("技能状态越界");
  for (const relationship of Object.values(state.residents)) {
    if (relationship.familiarity < 0 || relationship.familiarity > 100 || relationship.trust < -50 || relationship.trust > 100) throw new Error("关系状态越界");
  }
  if (state.events.weekly_urgent_count < 0 || state.events.weekly_urgent_count > 2) throw new Error("每周紧急事件计数越界");
  if (state.processing.batches.filter((batch) => ["pending", "started"].includes(batch.status)).length > state.processing.queue_capacity) throw new Error("加工队列超过容量");
  if (state.construction.filter((project) => !["complete", "cancelled"].includes(project.status)).length > 2) throw new Error("进行中工程超过2个");
  if (!Array.isArray(state.recovery_points) || !state.recovery_archive || !Array.isArray(state.recovery_archive.weekly) || !Array.isArray(state.recovery_archive.year_start)) throw new Error("恢复点结构无效");
  if (state.recovery_points.length > 7 || state.recovery_archive.weekly.length > 4 || state.recovery_archive.year_start.length > 1) throw new Error("恢复点保留数量越界");
  if (state.recovery_ledger_chunks !== undefined) {
    if (!Array.isArray(state.recovery_ledger_chunks)) throw new Error("恢复共享账本结构无效");
    let previousEnd = -1;
    for (const chunk of state.recovery_ledger_chunks) {
      if (!Number.isInteger(chunk.start_index) || chunk.start_index < 0 || !Number.isInteger(chunk.count) || chunk.count <= 0 || typeof chunk.entries_compressed !== "string") throw new Error("恢复共享账本分块无效");
      if (chunk.start_index < previousEnd) throw new Error("恢复共享账本分块重叠或乱序");
      previousEnd = chunk.start_index + chunk.count;
    }
  }
  for (const [reservationId, reservation] of Object.entries(state.inventory.reservations ?? {})) {
    const quantity = state.inventory.warehouse.lots.filter((lot) => lot.reserved_for === reservationId).reduce((sum, lot) => sum + lot.quantity, 0);
    if (quantity !== reservation.quantity) throw new Error(`库存保留数量不一致: ${reservationId}`);
  }
  for (const lot of state.inventory.warehouse.lots.filter((entry) => entry.reserved_for)) {
    if (!state.inventory.reservations?.[lot.reserved_for]) throw new Error(`库存批次引用未知保留: ${lot.reserved_for}`);
  }
  return true;
}
