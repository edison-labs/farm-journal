export const CONTENT_VERSION = "0.2.0";
export const CONTENT_SCHEMA_VERSION = 1;

export const QUALITY_TIERS = Object.freeze([
  { id: "quality_normal", min: 0, max: 59, multiplier: 1.0, name: "普通" },
  { id: "quality_fine", min: 60, max: 74, multiplier: 1.15, name: "优良" },
  { id: "quality_premium", min: 75, max: 89, multiplier: 1.4, name: "精品" },
  { id: "quality_exceptional", min: 90, max: 97, multiplier: 1.8, name: "极品" },
  { id: "quality_heirloom", min: 98, max: 100, multiplier: 2.5, name: "传世" },
]);

const cropRows = [
  ["crop_turnip", "芜菁", "spring", 25, 4, null, 1, 48, 4, 1.0, "low", 10],
  ["crop_potato", "土豆", "spring", 35, 6, null, 1.25, 75, 6, 1.0, "medium", 10],
  ["crop_wheat_s", "春小麦", "spring", 20, 5, null, 1, 44, 4, 0.8, "low", 60],
  ["crop_cabbage", "卷心菜", "spring", 65, 9, null, 1, 150, 12, 1.5, "high", 4],
  ["crop_strawberry", "草莓", "spring", 140, 8, 4, 1, 72, 4, 1.3, "medium", 4],
  ["crop_clover", "三叶草", "spring", 15, 6, 3, 2, 10, -6, 0.6, "low", 60],
  ["crop_cucumber", "黄瓜", "summer", 50, 6, 4, 1, 50, 5, 1.0, "medium", 4],
  ["crop_tomato", "番茄", "summer", 110, 8, 4, 1, 70, 6, 1.4, "high", 4],
  ["crop_corn", "玉米", "summer", 100, 10, 5, 1.5, 55, 8, 0.9, "low", 60],
  ["crop_melon", "甜瓜", "summer", 140, 10, null, 1, 230, 14, 1.5, "high", 4],
  ["crop_soybean", "大豆", "summer", 35, 6, null, 2, 35, -4, 0.8, "low", 60],
  ["crop_carrot", "胡萝卜", "autumn", 35, 5, null, 1, 70, 4, 0.9, "low", 10],
  ["crop_pumpkin", "南瓜", "autumn", 90, 10, null, 1, 180, 15, 1.4, "high", 10],
  ["crop_sweet_potato", "红薯", "autumn", 70, 7, 5, 1.5, 52, 7, 1.0, "medium", 10],
  ["crop_beet", "甜菜", "autumn", 45, 6, null, 1, 90, 6, 1.0, "medium", 10],
  ["crop_winter_wheat", "冬小麦", "winter", 25, 7, null, 1, 60, 4, 0.7, "low", 60],
  ["crop_radish", "冬萝卜", "winter", 45, 6, null, 1, 95, 6, 0.9, "low", 10],
  ["crop_kale", "羽衣甘蓝", "winter", 60, 7, 5, 1, 75, 6, 1.2, "medium", 4],
  ["crop_onion", "洋葱", "winter", 40, 6, null, 1, 85, 6, 0.8, "low", 10],
];

export const CROPS = Object.freeze(cropRows.map((row) => ({
  id: row[0], schema_version: 1, name: row[1], seasons: [row[2]], seed_item_id: `seed_${row[0].slice(5)}`,
  product_item_id: `item_${row[0].slice(5)}`, seed_price: row[3], growth_days: row[4], regrow_days: row[5],
  yield_per_cell: row[6], base_sell_price: row[7], fertility_cost: Math.max(0, row[8]), soil_restore: Math.max(0, -row[8]),
  care_load: row[9], risk: row[10], water_use: 5, shelf_life: row[11], resistance_tags: [], product_tags: ["crop"],
  unlock_condition: { op: "gte", path: "calendar.year", value: 1 },
  harvest_outcome: row[0] === "crop_clover" ? { type: "feed_conversion", feed_item_id: "item_feed", feed_units_per_product: 1, cash_product: false } : { type: "inventory_product", cash_product: true },
})));

const weatherRows = [
  ["weather_sunny", "晴朗", 0, 18, ["clear"], 0, 0],
  ["weather_cloudy", "多云", 0, 10, ["cloud"], 0, 0],
  ["weather_light_rain", "小雨", 30, 6, ["rain", "mild"], 0, -1],
  ["weather_heavy_rain", "大雨", 50, 4, ["rain", "severe", "wet"], 0, -2],
  ["weather_storm", "风暴", 60, 8, ["rain", "storm", "severe"], -8, -5],
  ["weather_heatwave", "高温", 0, 35, ["heat", "severe"], -5, -2],
  ["weather_fog", "雾", 0, 6, ["fog"], 0, 0],
  ["weather_snow", "小雪", 15, 4, ["snow", "mild"], 0, -1],
  ["weather_blizzard", "暴雪", 35, 8, ["snow", "blizzard", "severe"], -5, -6],
  ["weather_cold_snap", "寒潮", 0, 12, ["cold", "severe"], 0, -6],
];

export const WEATHER = Object.freeze(weatherRows.map((row) => ({
  id: row[0], schema_version: 1, name: row[1], precipitation: row[2], evaporation: row[3], tags: row[4],
  crop_health_delta: row[5], animal_mood_delta: row[6], animal_risk: row[0] === "weather_blizzard" ? 0.03 : 0,
  exploration_yield_multiplier: row[0] === "weather_heavy_rain" ? 0.8 : 1,
  exploration_event_multiplier: row[0] === "weather_fog" ? 1.2 : 1,
  forecast_neighbors: row[0] === "weather_cloudy" ? ["weather_sunny", "weather_light_rain"] :
    row[0] === "weather_storm" ? ["weather_heavy_rain"] :
    row[0] === "weather_blizzard" ? ["weather_snow", "weather_cold_snap"] :
      row[0] === "weather_heatwave" ? ["weather_sunny"] : ["weather_cloudy", row[0]],
})));

export const WEATHER_WEIGHTS = Object.freeze({
  spring: { weather_sunny: 30, weather_cloudy: 25, weather_light_rain: 30, weather_heavy_rain: 10, weather_storm: 5 },
  summer: { weather_sunny: 40, weather_cloudy: 15, weather_light_rain: 15, weather_storm: 10, weather_heatwave: 20 },
  autumn: { weather_sunny: 30, weather_cloudy: 30, weather_light_rain: 25, weather_storm: 5, weather_fog: 10 },
  winter: { weather_sunny: 15, weather_cloudy: 25, weather_snow: 35, weather_blizzard: 15, weather_cold_snap: 10 },
});

export const ANIMAL_SPECIES = Object.freeze([
  { id: "animal_chicken", name: "鸡", juvenile_days: 7, growing_days: 7, purchase_price: 600, feed_units: 1, feed_item_tags: ["feed"], product_item_id: "item_egg", product_units: 1, production_formula: "health_mood_probability", production_probability: null, production_period_days: 1, housing_tags: ["coop"], capacity_cost: 1, illness_production_penalty: 0.30, overcrowd_production_penalty: 0.10, disease_quality_penalty: 20, base_disease_risk: 0.002, trait_slots: [] },
  { id: "animal_duck", name: "鸭", juvenile_days: 7, growing_days: 7, purchase_price: 900, feed_units: 1, feed_item_tags: ["feed"], product_item_id: "item_duck_egg", product_units: 1, production_formula: "fixed_probability", production_probability: 0.72, production_period_days: 1, housing_tags: ["coop"], capacity_cost: 1, illness_production_penalty: 0.30, overcrowd_production_penalty: 0.10, disease_quality_penalty: 20, base_disease_risk: 0.002, trait_slots: [] },
  { id: "animal_cow", name: "奶牛", juvenile_days: 14, growing_days: 14, purchase_price: 4800, feed_units: 3, feed_item_tags: ["feed"], product_item_id: "item_milk", product_units: 3, production_formula: "fixed_probability", production_probability: 0.90, production_period_days: 1, housing_tags: ["barn"], capacity_cost: 1, illness_production_penalty: 0.30, overcrowd_production_penalty: 0.10, disease_quality_penalty: 20, base_disease_risk: 0.002, trait_slots: [] },
  { id: "animal_goat", name: "山羊", juvenile_days: 14, growing_days: 14, purchase_price: 3600, feed_units: 2, feed_item_tags: ["feed"], product_item_id: "item_goat_milk", product_units: 2, production_formula: "fixed_probability", production_probability: 0.90, production_period_days: 1, housing_tags: ["barn"], capacity_cost: 1, illness_production_penalty: 0.30, overcrowd_production_penalty: 0.10, disease_quality_penalty: 20, base_disease_risk: 0.002, trait_slots: [] },
  { id: "animal_sheep", name: "绵羊", juvenile_days: 14, growing_days: 14, purchase_price: 3200, feed_units: 2, feed_item_tags: ["feed"], product_item_id: "item_wool", product_units: 5, production_formula: "fixed_probability", production_probability: 1, production_period_days: 7, housing_tags: ["barn"], capacity_cost: 1, illness_production_penalty: 0.30, overcrowd_production_penalty: 0.10, disease_quality_penalty: 20, base_disease_risk: 0.002, trait_slots: [] },
]);

export const HOUSING_CARE_RULES = Object.freeze([
  { id: "care_coop", housing_tag: "coop", work_formula: "per_occupied_housing", units_per_wp: null },
  { id: "care_barn", housing_tag: "barn", work_formula: "ceil_animals_per_units", units_per_wp: 2 },
]);

export const ANIMAL_TREATMENTS = Object.freeze([
  { id: "treatment_basic_care", name: "基础诊疗", cost: 80, work_points: 1, health_restore: 5, recovery_days: 2, single_charge: true, tags: ["medical", "general"] },
]);

export const FINANCIAL_ASSISTANCE = Object.freeze({
  id: "finance_bridge_7d_v1", name: "七日低息周转", principal: 500, fee: 10, duration_days: 7, compound_interest: false, once_per_save: true,
});

export const RECIPES = Object.freeze([
  { id: "recipe_mayo", name: "蛋黄酱", inputs: [{ item_id: "item_egg", quantity: 2 }], outputs: [{ item_id: "item_mayo", quantity: 1 }], operation_cost: 6, duration_days: 1, facility_tags: ["workshop"] },
  { id: "recipe_cheese", name: "奶酪", inputs: [{ item_id: "item_milk", quantity: 3 }], outputs: [{ item_id: "item_cheese", quantity: 1 }], operation_cost: 12, duration_days: 1, facility_tags: ["workshop"] },
  { id: "recipe_yogurt", name: "酸奶", inputs: [{ item_id: "item_milk", quantity: 2 }], outputs: [{ item_id: "item_yogurt", quantity: 2 }], operation_cost: 8, duration_days: 1, facility_tags: ["workshop"] },
  { id: "recipe_flour", name: "面粉", inputs: [{ item_id: "item_wheat", quantity: 3, substitute_tags: ["grain"] }], outputs: [{ item_id: "item_flour", quantity: 2 }], operation_cost: 8, duration_days: 1, facility_tags: ["workshop"] },
  { id: "recipe_bread", name: "面包", inputs: [{ item_id: "item_flour", quantity: 2 }], outputs: [{ item_id: "item_bread", quantity: 3 }], operation_cost: 10, duration_days: 1, facility_tags: ["workshop"] },
  { id: "recipe_jam", name: "草莓果酱", inputs: [{ item_id: "item_strawberry", quantity: 3 }], outputs: [{ item_id: "item_jam", quantity: 2 }], operation_cost: 10, duration_days: 1, facility_tags: ["workshop"] },
  { id: "recipe_pickle", name: "腌黄瓜", inputs: [{ item_id: "item_cucumber", quantity: 3 }], outputs: [{ item_id: "item_pickle", quantity: 2 }], operation_cost: 10, duration_days: 1, facility_tags: ["workshop"] },
  { id: "recipe_yarn", name: "毛线", inputs: [{ item_id: "item_wool", quantity: 2 }], outputs: [{ item_id: "item_yarn", quantity: 3 }], operation_cost: 10, duration_days: 1, facility_tags: ["workshop"] },
]);

export const BUILDINGS = Object.freeze([
  { id: "build_plot_b", name: "开垦B田区", cost: 1200, work_required: 6, prerequisite: null, capabilities: [{ key: "plot_b", value: true }] },
  { id: "build_storage_2", name: "扩建仓库", cost: 1600, work_required: 8, prerequisite: "storage_1", capabilities: [{ key: "storage_capacity", value: 240 }] },
  { id: "build_coop_2", name: "扩建鸡舍", cost: 1800, work_required: 10, prerequisite: "coop_1", capabilities: [{ key: "coop_capacity", value: 8 }] },
  { id: "build_workshop", name: "修复加工坊", cost: 2800, work_required: 14, prerequisite: "spring_week_1", capabilities: [{ key: "processing_queues", value: 2 }] },
  { id: "build_barn", name: "修复畜棚", cost: 3500, work_required: 18, prerequisite: "resident_craftsman_trust_20", capabilities: [{ key: "barn_capacity", value: 2 }] },
  { id: "build_well_2", name: "改良水井", cost: 2200, work_required: 12, prerequisite: "two_plots", capabilities: [{ key: "well_coverage", value: 4 }] },
  { id: "build_weather_station", name: "简易气象站", cost: 4000, work_required: 16, prerequisite: "resident_weather_familiarity_20", capabilities: [{ key: "forecast_days", value: 7 }] },
  { id: "build_greenhouse", name: "温室", cost: 12000, work_required: 40, prerequisite: "year_2", capabilities: [{ key: "greenhouse_plots", value: 2 }] },
]);

export const RESIDENTS = Object.freeze([
  { id: "resident_shopkeeper", name: "沈禾", unlock_day: 1, role: "杂货店主" },
  { id: "resident_vet", name: "周岚", unlock_day: 2, role: "兽医" },
  { id: "resident_craftsman", name: "顾砚", unlock_day: 3, role: "工匠" },
  { id: "resident_restaurateur", name: "林秋", unlock_day: 5, role: "餐馆经营者" },
  { id: "resident_neighbor", name: "陶叔", unlock_day: 7, role: "邻居农场主" },
  { id: "resident_postman", name: "许遥", unlock_day: 7, role: "邮员" },
  { id: "resident_weather", name: "程雾", unlock_day: 18, role: "气象员" },
  { id: "resident_archivist", name: "季安", unlock_day: 43, role: "档案室管理员" },
]);

export const REGIONS = Object.freeze([
  { id: "region_forest", name: "林地", items: ["item_herb", "item_mushroom", "item_wood"], exploration_event_ids: ["event_farm_02_01", "event_farm_02_02", "event_farm_06_01", "event_farm_10_01"], description: "林缘的草药、菌类和倒木随着季节改变。" },
  { id: "region_riverbank", name: "河岸", items: ["item_reed", "item_clay", "item_herb"], exploration_event_ids: ["event_weather_01_01", "event_weather_03_01", "event_weather_05_01", "event_weather_08_01"], description: "河水留下材料，也留下天气将变的线索。" },
  { id: "region_old_station", name: "旧车站", items: ["item_scrap", "item_archive", "item_wood"], exploration_event_ids: ["event_farm_05_01", "event_farm_07_01", "event_farm_08_01", "event_farm_09_01"], description: "停用站房里保存着农场与小镇的旧档案。" },
]);

const itemBase = [
  ["item_feed", "通用饲料", 10, 60, ["feed"]], ["item_egg", "鸡蛋", 32, 14, ["animal_product"]],
  ["item_duck_egg", "鸭蛋", 45, 14, ["animal_product"]], ["item_milk", "牛奶", 55, 5, ["animal_product", "milk"]],
  ["item_goat_milk", "羊奶", 65, 5, ["animal_product", "milk"]], ["item_wool", "羊毛", 95, 60, ["animal_product"]],
  ["item_mayo", "蛋黄酱", 90, 45, ["processed"]], ["item_cheese", "奶酪", 220, 60, ["processed"]],
  ["item_yogurt", "酸奶", 65, 5, ["processed"]], ["item_wheat", "小麦", 44, 60, ["grain"]],
  ["item_flour", "面粉", 80, 60, ["processed", "grain"]], ["item_bread", "面包", 62, 10, ["processed"]],
  ["item_jam", "草莓果酱", 125, 45, ["processed"]], ["item_pickle", "腌黄瓜", 95, 45, ["processed"]],
  ["item_yarn", "毛线", 75, 60, ["processed"]], ["item_herb", "野生药草", 28, 10, ["forage"]],
  ["item_mushroom", "林地菌菇", 30, 4, ["forage"]], ["item_wood", "风干木料", 18, 60, ["material"]],
  ["item_reed", "河岸芦苇", 16, 10, ["material"]], ["item_clay", "细黏土", 20, 60, ["material"]],
  ["item_scrap", "旧机械零件", 35, 60, ["material"]], ["item_archive", "旧档案页", 1, 60, ["unique", "reserved"]],
  ["item_compost", "堆肥原料", 3, 60, ["material"]],
];

function expiryOutcome(id, tags) {
  if (["item_milk", "item_goat_milk", "item_yogurt", "item_jam", "item_pickle"].includes(id)) return "discard";
  if (["item_cheese", "item_yarn"].includes(id)) return "downgrade_normal";
  if (tags.includes("grain") || tags.includes("seed")) return "low_value_feed";
  return "compost";
}

export const ITEMS = Object.freeze([
  ...itemBase.map(([id, name, base_price, shelf_life, tags]) => ({ id, name, base_price, shelf_life, space: 1, tags, expiry_outcome: expiryOutcome(id, tags) })),
  ...CROPS.map((crop) => ({ id: crop.product_item_id, name: crop.name, base_price: crop.base_sell_price, shelf_life: crop.shelf_life, space: 1, tags: crop.id.includes("wheat") || crop.id === "crop_corn" ? ["crop", "grain"] : ["crop"], expiry_outcome: crop.id.includes("wheat") || crop.id === "crop_corn" ? "low_value_feed" : "compost" })),
  ...CROPS.map((crop) => ({ id: crop.seed_item_id, name: `${crop.name}种子`, base_price: crop.seed_price, shelf_life: 60, space: 0, tags: ["seed"], expiry_outcome: "low_value_feed" })),
].filter((item, index, all) => all.findIndex((candidate) => candidate.id === item.id) === index));

export const SKILLS = Object.freeze([
  { id: "farming", name: "种植" }, { id: "husbandry", name: "饲养" }, { id: "processing", name: "加工" },
  { id: "business", name: "经营" }, { id: "foraging", name: "采集" }, { id: "social", name: "交往" },
]);
export const SKILL_THRESHOLDS = Object.freeze([0, 30, 80, 150, 240, 350]);

const farmTopics = ["田埂渗水", "杂草结籽", "土色变浅", "成熟错峰", "种袋标签", "仓房通风", "集市账目", "加工余料", "订单包装", "轮作记录"];
const farmScenes = ["清晨巡查时发现了细微变化", "午后复核日志时出现了新的线索", "邻田经验提示了一个稳妥办法", "周结算前出现了一次取舍机会"];
const animalTopics = ["鸡群啄羽", "鸭舍积水", "奶牛反刍", "山羊食欲", "绵羊蹄部", "圈舍通风", "饲料气味"];
const animalScenes = ["例行喂养时观察到异常", "清洁后仍需继续留意", "天气变化放大了风险", "兽医来信给出两种处理", "一只动物主动靠近并等待回应"];
const weatherTopics = ["雨线北移", "午后热浪", "清晨浓雾", "夜间降温", "连续湿天", "阵风过境", "雪层压实", "河水上涨"];
const weatherScenes = ["气象记录出现提前信号", "田区状态与预报产生呼应", "小镇送来一份防护建议", "天气过后留下可利用的窗口"];
const mainTopics = ["旧地契", "断开的水渠", "废弃温室", "车站货单", "前任牧场主手记", "河岸界碑", "合作社名册", "年度田野档案"];
const festivalTopics = ["春播交换会", "夏夜河灯", "秋收账会", "冬日储备日", "动物照护周", "小镇旧物展"];

function slug(index) {
  return (index + 1).toString().padStart(2, "0");
}

function standardChoices(category, subject, index, residentId = null, completionFlag = null) {
  const skill = category === "animal" ? "husbandry" : category === "resident" ? "social" : category === "weather" ? "foraging" : "farming";
  const effectsA = [{ type: "skill_xp", skill_id: skill, amount: category === "main" ? 4 : 2 }, { type: "flag", flag: `memory_${category}_${slug(index)}`, value: "careful" }, { type: "log", message: `你为“${subject}”选择了稳妥处理。` }];
  if (residentId) effectsA.splice(1, 0, { type: "relationship", resident_id: residentId, familiarity: 2, trust: 1 });
  const verbs = {
    farm: [["调整田区排程", "保留数据继续巡查"], ["先处理关键田块", "对照下次日结"], ["按风险安排工时", "暂缓并标记边界"]],
    animal: [["优先照护并复核", "保持观察记录"], ["调整圈舍与饲料", "等待下一次状态检查"], ["依健康记录处理", "请兽医留意趋势"]],
    weather: [["执行防护方案", "保留工时观察实况"], ["按湿度调整日程", "把变化用于采集判断"], ["先保护高风险区域", "等待预报窗口确认"]],
    resident: [["坦率承诺可完成的帮助", "说明现状并保持联系"], ["把共同经历写进约定", "先听完再决定"], ["核对资源后认真回应", "不勉强承诺"]],
    main: [["整理证据并推进调查", "封存线索等待印证"], ["核对账页与共同经历", "保留不同人的说法"], ["记录阶段结论", "继续经营后再回看"]],
    festival: [["按来源提交合适物资", "只参与交流与记录"], ["协调日常工时后参加", "保留资源温和回应"], ["分享照护经验", "旁听并写下回顾"]],
  };
  const labels = verbs[category][index % verbs[category].length];
  const choices = [
    { id: "choice_careful", label: labels[0], effects: effectsA },
    { id: "choice_observe", label: labels[1], effects: [{ type: "flag", flag: `memory_${category}_${slug(index)}`, value: "observed" }, { type: "log", message: `你把“${subject}”写入了后续观察清单，并保留本次没有投入额外资源的原因。` }] },
  ];
  if (completionFlag) for (const choice of choices) choice.effects.splice(-1, 0, { type: "flag", flag: completionFlag, value: true });
  return choices;
}

const farmMechanicalRewards = [
  { type: "item_add", item_id: "item_clay", quantity: 1, quality: 50 },
  { type: "item_add", item_id: "item_compost", quantity: 1, quality: 50 },
  { type: "item_add", item_id: "item_compost", quantity: 1, quality: 50 },
  { type: "item_add", item_id: "seed_turnip", quantity: 1, quality: 50 },
  { type: "item_add", item_id: "seed_turnip", quantity: 1, quality: 50 },
  { type: "item_add", item_id: "item_wood", quantity: 1, quality: 50 },
  { type: "funds", amount: 10 },
  { type: "item_add", item_id: "item_compost", quantity: 1, quality: 50 },
  { type: "item_add", item_id: "item_wood", quantity: 1, quality: 50 },
  { type: "item_add", item_id: "item_compost", quantity: 1, quality: 50 },
];

function farmChoices(subject, index, topicIndex) {
  const sequence = slug(index);
  const reward = farmMechanicalRewards[topicIndex];
  const delayedReward = reward.type === "funds" ? { type: "funds", amount: reward.amount * 2 } : { ...reward, quantity: reward.quantity * 2 };
  return [
    {
      id: `choice_handle_${sequence}`,
      label: `立即处理${subject.split("：")[0]}`,
      effects: [
        { type: "skill_xp", skill_id: "farming", amount: 2 },
        reward,
        { type: "flag", flag: `memory_farm_${sequence}`, value: "careful" },
        { type: "log", message: `你立即处理了“${subject}”，并清点了当场获得的经营收益。` },
      ],
    },
    {
      id: `choice_followup_${sequence}`,
      label: `记录${subject.split("：")[0]}并复查（次日双份回报）`,
      effects: [
        { type: "flag", flag: `memory_farm_${sequence}`, value: "observed" },
        {
          type: "schedule", delay_days: 1, source_choice: `choice_followup_${sequence}`,
          effects: [
            delayedReward,
            { type: "log", message: `次日复查“${subject}”后，你收到了记录所对应的经营回报。` },
          ],
        },
        { type: "log", message: `你记录了“${subject}”的边界与复查时间，回报将在次日确认。` },
      ],
    },
  ];
}

const narrativeLibraries = {
  farm: [
    (title) => `围绕“${title}”，你先把田区湿度、肥力和杂草记录放在一起核对，避免只凭眼前颜色作判断。`,
    (title) => `这次${title}并不要求立刻花钱，真正的取舍是今日工时、未来收获窗口与仓储空间如何衔接。`,
    (title) => `若选择处理${title}，日报会逐项写明资源变化；若暂缓，风险也会进入未来三日的工作预测。`,
    (title) => `邻田留下的经验提醒你，${title}常与轮作和天气共同作用，单独追求某个数值反而可能挤占成熟收获。`,
    (title) => `出售箱尚未结算前仍可撤回，因此${title}带来的品质判断可以等清点批次后再决定渠道。`,
    (title) => `你在田区牌上补记${title}的日期与原因，让下次同类变化能够和真实收成对照，而不是成为模糊印象。`,
  ],
  animal: [
    (title) => `针对“${title}”，圈舍记录先列出饲料余量、清洁度、健康、心情和最近一次生产，异常来源因此可以逐项排查。`,
    (title) => `你没有把${title}当作一次孤立的概率结果：喂食先于清洁与状态结算，既有疾病先影响生产，新风险则在最后判定。`,
    (title) => `若资源紧张，${title}会进入医疗与喂养优先队列；工时不足的任务明确留在日报中，动物不会被静默删除。`,
    (title) => `天气防护、超员和饲养技能都会改变${title}的风险分量，每次随机判断使用动物自己的稳定身份并留下审计值。`,
    (title) => `你可以先观察${title}，也可以采取保守处理；两条路径都会说明健康、生产和后续照护的影响，不用猜测隐藏代价。`,
    (title) => `等圈舍恢复平稳后，关于${title}的经历仍保留在个体记录里，方便日后与兽医建议和周报趋势相互印证。`,
  ],
  weather: [
    (title) => `“${title}”出现在预报与田区记录的交界处，你同时查看降水、蒸发和作物耗水，而不是只看天气名称。`,
    (title) => `面对${title}，必要灌溉依据结算湿度是否低于35来安排；恰好35时不会浪费水井覆盖。`,
    (title) => `严重天气的连续上限和风暴周上限仍然生效，${title}不会借事件绕过确定性的七日天气块。`,
    (title) => `若把${title}转为探索机会，产量和事件概率会分别显示；若优先防护，所用工时也会写进当天计划。`,
    (title) => `实际天气与此前预报分开保存，因此${title}过后仍能核对当时掌握的信息，系统不会事后改写提示。`,
    (title) => `你把${title}留下的湿度变化记入生活日志，为下一轮播种和圈舍防护提供可复现的依据。`,
  ],
  resident: [
    (title) => `“${title}”不是一份只看即时奖励的委托。对话开始时，对方先说明来意，也允许你坦率讲出牧场现有的工时、资金和库存压力。`,
    (title) => `熟悉度记录你与${title}相关的往来次数，信任度则取决于承诺是否兑现；两者遵守各自的每周增长上限。`,
    (title) => `你可以先追问${title}背后的困难，再承诺一项真正能完成的帮助；系统不会把礼貌交谈等同于已经交付物资。`,
    (title) => `若决定赠礼，与${title}有关的物品会从可用批次中明确扣除，订单保留品与唯一剧情物品不会被误用。`,
    (title) => `每次回应都会保存事件、选项、主题和人物稳定身份，${title}因此能够在后续来信中形成具体的共同经历。`,
    (title) => `普通委托即使放弃也只留下关系反馈与短期冷却，不会让${title}变成永久失败的主线门槛。`,
    (title) => `当关系到达20、40、65和85的节点，关于${title}的新谈话才会开放，跳过日常刷礼也不会错过已经解锁的内容。`,
    (title) => `你最后把${title}写进生活与决策两层日志，让人情往来和账务支出既能相互关联，又不会混成一个模糊数字。`,
  ],
  main: [
    (title) => `关于“${title}”的线索最初只是一处可以核对的细节：日期、旧账和地块状态彼此吻合，却仍不足以替任何人下结论。`,
    (title) => `你把${title}与历史成交快照并列保存，价格配置以后即使调整，过去实际发生的收入也不会被重新计算。`,
    (title) => `小镇居民对${title}各自保留不同记忆；熟悉度能带来更多叙述，真正敏感的判断仍需要足够信任。`,
    (title) => `${title}没有强制倒计时。离线托管不会代替玩家作关键选择，超过七日的休整也不会制造永久错失。`,
    (title) => `继续调查${title}前，界面会列出所需工时、现金和物品；任何一项不足时整组效果回滚，不会留下半条线索。`,
    (title) => `天气记录为${title}提供另一条证据链：预报、实际天气和田区压力分别保存，避免用结果倒推当时的决定。`,
    (title) => `动物个体经历也可能回应${title}，但生产随机流与故事随机流彼此隔离，阅读顺序不会刷新经营结果。`,
    (title) => `你可以暂时放下${title}去播种、加工或交付订单；主线条件保留在稳定标识下，四季循环后仍能继续。`,
    (title) => `每次选择都把事件、选项、人物与主题写入决策日志，${title}的后续只引用这些事实，不替玩家虚构动机。`,
    (title) => `未知扩展模块继续原样保存在自己的命名空间中，${title}不会借未启用功能改变当前日结或旧存档。`,
    (title) => `年度报告只总结${title}已经确认的阶段、未完成目标与可行建议，不把第一年末误写成故事终点。`,
    (title) => `当证据终于能够相互印证时，${title}给出的不是唯一正确经营法，而是一段可以追溯、也允许不同立场共存的牧场历史。`,
  ],
  festival: [
    (title) => `“${title}”由小镇共同筹备，活动页先说明时间窗口、可提交物品的来源和预计反馈，不设置闪烁倒计时。`,
    (title) => `参加${title}并不要求牺牲每日喂养或成熟收获；工时冲突会先展示，玩家可以调整优先级或只参加文字交流。`,
    (title) => `若为${title}提交产品，品质、保留状态与数量分段会在确认前列明，订单锁定批次不会被重复使用。`,
    (title) => `托管不会替玩家决定${title}的主要选项，未读内容在窗口内保留，结束后也只有温和回顾而没有额外罚款。`,
    (title) => `居民评价${title}时会参考你是否可靠、是否尊重动物与土地，以及过去承诺形成的共同经历，而非单看昂贵礼物。`,
    (title) => `${title}的经营收入、关系变化和故事选择分别进入账务、生活与决策日志，周报仍能从记录重算。`,
    (title) => `即使选择不提交物资，你仍能阅读${title}的完整背景并留下回应；节庆不会成为主线永久失败条件。`,
    (title) => `活动结束后，你把${title}中真正有用的照护经验带回牧场，为下一季的排程、库存和天气防护作准备。`,
  ],
};

function narrativeBody(category, title, opening, index) {
  const library = narrativeLibraries[category];
  const counts = { farm: 3, animal: 4, weather: 3, resident: 6, main: 11, festival: 7 };
  const stride = [1, 5, 7, 11][index % 4];
  const selected = Array.from({ length: counts[category] }, (_, offset) => library[(index * 3 + offset * stride) % library.length](title));
  return [opening, ...selected].join("\n\n");
}

function makeEvent(id, category, title, body, index, options = {}) {
  const expandedBody = narrativeBody(category, title, body, index);
  return {
    id, schema_version: 1, category, tags: options.tags ?? [category],
    conditions: options.conditions ?? [{ op: "gte", path: "calendar.absolute_day", value: options.unlockDay ?? 1 }],
    base_weight: options.weight ?? 1, cooldown_days: options.cooldown ?? 21,
    exclusive_group: options.exclusive ?? null, attention_cost: options.attention ?? (category === "main" ? 3 : category === "festival" || category === "resident" ? 2 : 1),
    deadline_days: options.deadline ?? (options.urgent ? 1 : category === "main" ? 0 : 5), urgent: Boolean(options.urgent),
    festival_season: options.festival_season ?? null,
    title_key: `${id}.title`, body_key: `${id}.body`, title, body: expandedBody,
    choices: options.choices ?? standardChoices(category, title, index, options.residentId, options.completionFlag), scheduled_effects: [],
    summary_template: `关于“${title}”的决定已记录。`,
  };
}

function farmEvents() {
  const conditions = [
    { op: "entity_state", collection: "plots", id: "plot_a", path: "moisture", compare: "lte", value: 70 },
    { op: "entity_state", collection: "plots", id: "plot_a", path: "weeds", compare: "gte", value: 15 },
    { op: "entity_state", collection: "plots", id: "plot_a", path: "fertility", compare: "lte", value: 65 },
    { op: "entity_state", collection: "plots", id: "plot_a", path: "crop.status", compare: "contains", value: "mature" },
    { op: "gte", path: "inventory.seed_cabinet.quantities.seed_turnip", value: 1 },
    { op: "gte", path: "inventory.warehouse.capacity", value: 120 },
    { op: "funds", compare: "gte", value: 0 },
    { op: "building_level", building_id: "build_workshop", compare: "gte", value: 1 },
    { op: "gte", path: "orders.length", value: 0 },
    { op: "gte", path: "calendar.year", value: 1 },
  ];
  const events = [];
  farmTopics.forEach((topic, topicIndex) => farmScenes.forEach((scene, sceneIndex) => {
    const index = topicIndex * farmScenes.length + sceneIndex;
    const title = `${topic}：${scene.slice(0, 4)}`;
    events.push(makeEvent(`event_farm_${slug(topicIndex)}_${slug(sceneIndex)}`, "farm", title, `${scene}。这件事不会立刻毁掉收成，但现在的经营选择会影响之后几日的工时、品质或库存安排。`, index, { conditions: conditions[topicIndex], choices: farmChoices(title, index, topicIndex), tags: ["farm", topicIndex < 5 ? "plot" : "business", `farm_topic_${slug(topicIndex)}`], cooldown: 14 }));
  }));
  return events;
}

function animalChoices(subject, index, speciesId, sceneIndex) {
  const sequence = slug(index);
  const immediateField = sceneIndex % 2 === 0 ? "mood" : "health";
  const immediateAmount = immediateField === "mood" ? 2 : 1;
  const delayedAmount = immediateAmount + 2;
  return [
    {
      id: `choice_care_${sequence}`,
      label: `立即照护${subject.split("：")[0]}`,
      effects: [
        { type: "skill_xp", skill_id: "husbandry", amount: 2 },
        { type: "animal_state", species_id: speciesId, field: immediateField, amount: immediateAmount },
        { type: "flag", flag: `memory_animal_${sequence}`, value: "careful" },
        { type: "log", message: `你立即照护了“${subject}”，个体状态已写入本次记录。` },
      ],
    },
    {
      id: `choice_recheck_${sequence}`,
      label: `记录${subject.split("：")[0]}并复查（次日${immediateField === "mood" ? "心情" : "健康"}+${delayedAmount}）`,
      effects: [
        {
          type: "schedule", delay_days: 1, source_choice: `choice_recheck_${sequence}`,
          effects: [
            { type: "animal_state", species_id: speciesId, field: immediateField, amount: delayedAmount },
            { type: "log", message: `次日复查“${subject}”时，持续观察让动物情绪稍有改善。` },
          ],
        },
        { type: "flag", flag: `memory_animal_${sequence}`, value: "observed" },
        { type: "log", message: `你为“${subject}”保留了次日复查安排，没有中断日常照护。` },
      ],
    },
  ];
}

function animalEvents() {
  const topicSpecies = ["animal_chicken", "animal_duck", "animal_cow", "animal_goat", "animal_sheep", "animal_chicken", "animal_chicken"];
  const events = [];
  animalTopics.forEach((topic, topicIndex) => animalScenes.forEach((scene, sceneIndex) => {
    const index = topicIndex * animalScenes.length + sceneIndex;
    const urgent = topicIndex === 2 && sceneIndex === 0;
    const speciesId = topicSpecies[topicIndex];
    const title = `${topic}：${scene.slice(0, 4)}`;
    events.push(makeEvent(`event_animal_${slug(topicIndex)}_${slug(sceneIndex)}`, "animal", title, `${scene}。日志列出了健康、清洁度和饲料余量，让处理依据清楚可追溯。`, index, { conditions: { op: "owns_animal", species_id: speciesId }, choices: animalChoices(title, index, speciesId, sceneIndex), tags: ["animal", speciesId, urgent ? "medical" : "welfare"], urgent, attention: urgent ? 3 : 1, cooldown: urgent ? 30 : 18 }));
  }));
  const replacementIndex = events.findIndex((event) => event.id === "event_animal_03_01");
  events[replacementIndex] = makeEvent(
    "event_cow_bloat_01",
    "animal",
    "奶牛腹胀异常",
    "奶牛停止进食，并反复踢向腹部。圈舍记录显示它此前健康尚可，但这次异常需要在今日决定处理方式。",
    replacementIndex,
    {
      tags: ["animal", "medical", "cow"],
      urgent: true,
      attention: 3,
      deadline: 1,
      cooldown: 30,
      conditions: {
        all: [
          { op: "owns_animal", species_id: "animal_cow" },
          { op: "animal_health_gte", species_id: "animal_cow", value: 40 },
          { op: "not_flag", flag: "trustee_frozen" },
        ],
      },
      choices: [
        {
          id: "choice_call_vet",
          label: "联系兽医（320 G）",
          conditions: [{ op: "gte", path: "economy.cash", value: 320 }],
          effects: [
            { type: "funds", amount: -320 },
            { type: "animal_state", species_id: "animal_cow", field: "health", amount: 15 },
            { type: "relationship", resident_id: "resident_vet", familiarity: 0, trust: 1 },
            { type: "animal_modifier", species_id: "animal_cow", modifier_id: "vet_recovery", production_multiplier: 0.90, duration_days: 3 },
            { type: "schedule", delay_days: 3, source_choice: "choice_call_vet", effects: [{ type: "log", message: "奶牛的三日恢复期结束，生产概率恢复正常。" }] },
            { type: "log", message: "兽医及时处理了腹胀；未来3日生产降低10%。" },
          ],
        },
        {
          id: "choice_self_check",
          label: "自行检查",
          conditions: [{ op: "gte", path: "skills.husbandry.level", value: 2 }],
          effects: [
            { type: "random_branch", system_id: "event_cow_bloat_self_check", success_probability: 0.8,
              success: [{ type: "animal_state", species_id: "animal_cow", field: "health", amount: 10 }, { type: "skill_xp", skill_id: "husbandry", amount: 3 }, { type: "log", message: "检查正确，腹胀得到缓解。" }],
              failure: [{ type: "schedule", delay_days: 1, source_choice: "choice_self_check", effects: [{ type: "funds", amount: -440, allow_assistance: true }, { type: "animal_state", species_id: "animal_cow", field: "health", amount: 15 }, { type: "log", message: "次日仍需兽医处理，并多付120 G。" }] }],
            },
          ],
        },
        {
          id: "choice_observe",
          label: "暂时观察",
          effects: [
            { type: "animal_state", species_id: "animal_cow", field: "health", amount: -8 },
            { type: "schedule_random", delay_days: 1, source_choice: "choice_observe", success_probability: 0.7,
              success: [{ type: "animal_state", species_id: "animal_cow", field: "health", amount: -8 }, { type: "flag", flag: "cow_bloat_worsened", value: true }, { type: "log", message: "腹胀加重，需要进一步处理。" }],
              failure: [{ type: "animal_state", species_id: "animal_cow", field: "health", amount: 4 }, { type: "log", message: "症状自行缓解，但观察记录被保留。" }] },
          ],
        },
      ],
    },
  );
  return events;
}

const weatherRewardItems = ["item_clay", "item_herb", "item_mushroom", "item_wood", "item_reed", "item_scrap", "item_wood", "item_reed"];

function weatherChoices(subject, index, topicIndex) {
  const sequence = slug(index);
  const itemId = weatherRewardItems[topicIndex];
  return [
    {
      id: `choice_gather_${sequence}`,
      label: `把握${subject.split("：")[0]}窗口`,
      effects: [
        { type: "skill_xp", skill_id: "foraging", amount: 2 },
        { type: "item_add", item_id: itemId, quantity: 1, quality: 50 },
        { type: "flag", flag: `memory_weather_${sequence}`, value: "prepared" },
        { type: "log", message: `你依据“${subject}”的实况及时采集，并记录了安全边界。` },
      ],
    },
    {
      id: `choice_revisit_${sequence}`,
      label: `待${subject.split("：")[0]}后复查（次日双份采集）`,
      effects: [
        {
          type: "schedule", delay_days: 1, source_choice: `choice_revisit_${sequence}`,
          effects: [
            { type: "item_add", item_id: itemId, quantity: 2, quality: 50 },
            { type: "log", message: `天气窗口过去后，你按“${subject}”留下的线索完成了安全采集。` },
          ],
        },
        { type: "flag", flag: `memory_weather_${sequence}`, value: "observed" },
        { type: "log", message: `你先观察“${subject}”的实况，并安排次日复查现场。` },
      ],
    },
  ];
}

function weatherEvents() {
  const topicSeasons = ["spring", "summer", "autumn", "winter", "spring", "summer", "winter", "autumn"];
  const topicWeatherTags = [
    ["clear", "cloud", "rain", "mild", "wet", "storm"], ["heat", "clear"], ["fog", "cloud"], ["cold", "snow", "cloud"],
    ["clear", "cloud", "rain", "mild", "wet", "storm"], ["storm", "clear", "cloud"], ["snow", "blizzard", "cold"], ["rain", "wet", "fog", "cloud"],
  ];
  const events = [];
  weatherTopics.forEach((topic, topicIndex) => weatherScenes.forEach((scene, sceneIndex) => {
    const index = topicIndex * weatherScenes.length + sceneIndex;
    const season = topicSeasons[topicIndex];
    const conditions = { all: [{ op: "season", value: season }, { any: topicWeatherTags[topicIndex].map((value) => ({ op: "weather_tag", value })) }] };
    const title = `${topic}：${scene.slice(0, 4)}`;
    events.push(makeEvent(`event_weather_${slug(topicIndex)}_${slug(sceneIndex)}`, "weather", title, `${scene}。你可以优先保护田区，也可以把这次变化转化为采集或排产机会。`, index, { conditions, choices: weatherChoices(title, index, topicIndex), tags: ["weather", season, ...topicWeatherTags[topicIndex], topicIndex % 2 ? "pressure" : "forecast"], cooldown: 14 }));
  }));
  return events;
}

function residentChoices(subject, index, residentId) {
  const sequence = slug(index);
  return [
    {
      id: `choice_connect_${sequence}`,
      label: `认真回应${subject.split("：")[0]}`,
      effects: [
        { type: "skill_xp", skill_id: "social", amount: 2 },
        { type: "relationship", resident_id: residentId, familiarity: 2, trust: 1 },
        { type: "flag", flag: `memory_resident_${sequence}`, value: "careful" },
        { type: "log", message: `你认真回应了“${subject}”，这次往来增加了彼此的了解与信任。` },
      ],
    },
    {
      id: `choice_resident_followup_${sequence}`,
      label: `约定稍后回复${subject.split("：")[0]}（次日熟悉+4）`,
      effects: [
        {
          type: "schedule", delay_days: 1, source_choice: `choice_resident_followup_${sequence}`,
          effects: [
            { type: "relationship", resident_id: residentId, familiarity: 4, trust: 0 },
            { type: "log", message: `次日你按约回应了“${subject}”，对方更熟悉你的经营节奏。` },
          ],
        },
        { type: "flag", flag: `memory_resident_${sequence}`, value: "observed" },
        { type: "log", message: `你说明了暂缓“${subject}”的原因，并约定次日继续联系。` },
      ],
    },
  ];
}

function residentEvents() {
  const scenes = ["送来一封措辞谨慎的信", "在店门前谈起最近的难题", "询问你对小镇变化的看法", "兑现了先前的一句承诺", "需要一批不必完美但可靠的物资", "分享了一段与农场有关的旧记忆"];
  const events = [];
  RESIDENTS.forEach((resident, residentIndex) => scenes.forEach((scene, sceneIndex) => {
    const index = residentIndex * scenes.length + sceneIndex;
    const thresholds = [0, 20, 40, 65, 85, 85];
    const conditions = { all: [
      { op: "gte", path: "calendar.absolute_day", value: resident.unlock_day },
      { op: "relationship", resident_id: resident.id, field: "familiarity", compare: "gte", value: thresholds[sceneIndex] },
    ] };
    const title = `${resident.name}：${scene.slice(0, 6)}`;
    events.push(makeEvent(`event_resident_${slug(residentIndex)}_${slug(sceneIndex)}`, "resident", title, `${resident.name}作为${resident.role}${scene}。回应会同时留下熟悉度、信任度和共同经历，而不是只增加单一好感值。`, index, { residentId: resident.id, conditions, choices: residentChoices(title, index, resident.id), tags: ["resident", resident.id, `relationship_${thresholds[sceneIndex]}`], cooldown: 21 }));
  }));
  return events;
}

const mainRewardItems = ["item_archive", "item_clay", "item_wood", "item_scrap", "item_archive", "item_clay", "item_scrap", "item_archive"];

function mainChoices(subject, index, topicIndex, completionFlag) {
  const sequence = slug(index);
  const itemId = mainRewardItems[topicIndex];
  return [
    {
      id: `choice_advance_${sequence}`,
      label: `整理${subject}并推进`,
      effects: [
        { type: "skill_xp", skill_id: "farming", amount: 4 },
        { type: "item_add", item_id: itemId, quantity: 1, quality: 50 },
        { type: "flag", flag: completionFlag, value: true },
        { type: "flag", flag: `memory_main_${sequence}`, value: "confirmed" },
        { type: "log", message: `你整理了“${subject}”的证据，本阶段结论与实物线索已经归档。` },
      ],
    },
    {
      id: `choice_archive_${sequence}`,
      label: `封存${subject}等待印证（两日后双份线索）`,
      effects: [
        {
          type: "schedule", delay_days: 2, source_choice: `choice_archive_${sequence}`,
          effects: [
            { type: "item_add", item_id: itemId, quantity: 2, quality: 50 },
            { type: "log", message: `两日后的复核为“${subject}”补上了可保存的实物线索。` },
          ],
        },
        { type: "flag", flag: completionFlag, value: true },
        { type: "flag", flag: `memory_main_${sequence}`, value: "deferred" },
        { type: "log", message: `你封存了“${subject}”的阶段结论，并安排两日后复核线索。` },
      ],
    },
  ];
}

function mainEvents() {
  const events = [];
  mainTopics.forEach((topic, topicIndex) => ["找到第一条可核对的线索", "前一条线索在现实经营中得到回应"].forEach((scene, sceneIndex) => {
    const index = topicIndex * 2 + sceneIndex;
    const conditions = index === 0
      ? { op: "gte", path: "calendar.absolute_day", value: 7 }
      : { all: [{ op: "gte", path: "calendar.absolute_day", value: 7 + index * 4 }, { op: "flag", flag: `main_step_${slug(index - 1)}`, value: true }] };
    const title = `${topic}·${sceneIndex === 0 ? "线索" : "回声"}`;
    const completionFlag = `main_step_${slug(index)}`;
    events.push(makeEvent(`event_main_${slug(topicIndex)}_${slug(sceneIndex)}`, "main", title, `你在${topic}中${scene}。它把农场当前的选择与过去连接起来，重要结论没有硬期限，也不会因离线永久错过。`, index, { conditions, completionFlag, choices: mainChoices(title, index, topicIndex, completionFlag), tags: ["main", `chapter_${slug(topicIndex)}`, completionFlag], cooldown: 84, exclusive: `main_chapter_${slug(topicIndex)}` }));
  }));
  return events;
}

const festivalRewardItems = ["seed_turnip", "item_reed", "item_compost", "item_wood", "item_feed", "item_scrap"];

function festivalChoices(subject, index, topicIndex) {
  const sequence = slug(index);
  const itemId = festivalRewardItems[topicIndex];
  return [
    {
      id: `choice_join_${sequence}`,
      label: `参与${subject}`,
      effects: [
        { type: "skill_xp", skill_id: "social", amount: 2 },
        { type: "item_add", item_id: itemId, quantity: 1, quality: 50 },
        { type: "flag", flag: `memory_festival_${sequence}`, value: "joined" },
        { type: "log", message: `你参与了“${subject}”，并把交流所得的物资带回牧场。` },
      ],
    },
    {
      id: `choice_review_${sequence}`,
      label: `记录${subject}稍后整理（两日后双份物资）`,
      effects: [
        {
          type: "schedule", delay_days: 2, source_choice: `choice_review_${sequence}`,
          effects: [
            { type: "item_add", item_id: itemId, quantity: 2, quality: 50 },
            { type: "log", message: `两日后整理“${subject}”的交流记录时，你找回了可用于牧场的物资。` },
          ],
        },
        { type: "flag", flag: `memory_festival_${sequence}`, value: "reviewed" },
        { type: "log", message: `你记录了“${subject}”的经验，并安排两日后完成整理。` },
      ],
    },
  ];
}

function festivalEvents() {
  const topicSeasons = ["spring", "summer", "autumn", "winter", "spring", "autumn"];
  const events = [];
  festivalTopics.forEach((topic, topicIndex) => ["筹备", "回顾"].forEach((scene, sceneIndex) => {
    const index = topicIndex * 2 + sceneIndex;
    const season = topicSeasons[topicIndex];
    const conditions = { all: [{ op: "gte", path: "calendar.absolute_day", value: 14 + topicIndex * 14 }, { op: "season", value: season }] };
    const title = `${topic}·${scene}`;
    events.push(makeEvent(`event_festival_${slug(topicIndex)}_${slug(sceneIndex)}`, "festival", title, `${topic}进入${scene}阶段。活动重视物品来源、照护记录和小镇关系，不会用倒计时或强制奖励打断日常经营。`, index, { conditions, choices: festivalChoices(title, index, topicIndex), festival_season: season, tags: ["festival", season, `season_${["spring", "summer", "autumn", "winter"].indexOf(season)}`], cooldown: 84, deadline: 7 }));
  }));
  return events;
}

export const EVENTS = Object.freeze([
  ...farmEvents(), ...animalEvents(), ...weatherEvents(), ...residentEvents(), ...mainEvents(), ...festivalEvents(),
]);

export const LOCALIZATION = Object.freeze(Object.fromEntries(EVENTS.flatMap((event) => [
  [event.title_key, event.title], [event.body_key, event.body],
])));

export const CONTENT = Object.freeze({
  schema_version: CONTENT_SCHEMA_VERSION,
  content_version: CONTENT_VERSION,
  crops: CROPS,
  weather: WEATHER,
  weather_weights: WEATHER_WEIGHTS,
  animal_species: ANIMAL_SPECIES,
  animal_treatments: ANIMAL_TREATMENTS,
  housing_care_rules: HOUSING_CARE_RULES,
  financial_assistance: FINANCIAL_ASSISTANCE,
  recipes: RECIPES,
  buildings: BUILDINGS,
  residents: RESIDENTS,
  regions: REGIONS,
  items: ITEMS,
  skills: SKILLS,
  events: EVENTS,
  localization: LOCALIZATION,
});

export function byId(collection, id) {
  const value = collection.find((entry) => entry.id === id);
  if (!value) throw new RangeError(`未知内容ID: ${id}`);
  return value;
}
