import { CROPS, byId } from "../content/definitions.js";
import { auditedRoll, deterministicRound } from "../core/rng.js";
import { clamp } from "../core/utils.js";
import { addSkillXp } from "./dsl.js";
import { addItem } from "./inventory.js";
import { spendWork, WORK_PRIORITIES } from "./work.js";
import { weatherDefinition } from "./weather.js";

export function cropDefinition(cropId) {
  return byId(CROPS, cropId);
}

export function canPlant(state, plotId, cropId) {
  const plot = state.plots.find((entry) => entry.plot_id === plotId);
  if (!plot || !plot.unlocked) return { ok: false, reason: "田区尚未解锁" };
  if (plot.crop) return { ok: false, reason: "田区已有作物" };
  const crop = cropDefinition(cropId);
  const greenhouse = plot.protection_tags.includes("greenhouse");
  if (!greenhouse && !crop.seasons.includes(state.calendar.season)) return { ok: false, reason: "当前季节不能播种该作物" };
  const remainingGrowthOpportunities = 21 - state.calendar.season_day;
  const openingCredit = state.calendar.absolute_day === 1 && !state.daily_ledgers.some((entry) => entry.type === "daily_report") ? 1 : 0;
  if (!greenhouse && crop.growth_days > remainingGrowthOpportunities + openingCredit) return { ok: false, reason: `本季仅剩${remainingGrowthOpportunities}次日结生长机会，不足首次成熟所需${crop.growth_days}点` };
  const seeds = state.inventory.seed_cabinet.quantities[crop.seed_item_id] ?? 0;
  if (seeds < plot.cells) return { ok: false, reason: `种子不足，需要${plot.cells}粒` };
  if (state.work_plan.used_wp + 1 > state.work_plan.capacity) return { ok: false, reason: "工时不足" };
  return { ok: true, plot, crop, seed_cost: plot.cells };
}

export function plantCrop(state, plotId, cropId) {
  const preview = canPlant(state, plotId, cropId);
  if (!preview.ok) throw new Error(preview.reason);
  spendWork(state, 1, 0, { id: `plant_${plotId}`, priority: WORK_PRIORITIES.harvest, label: `播种${preview.crop.name}` });
  state.inventory.seed_cabinet.quantities[preview.crop.seed_item_id] -= preview.plot.cells;
  preview.plot.crop = {
    crop_id: cropId,
    planted_day: state.calendar.absolute_day,
    health: 90,
    growth_points: 0,
    status: "growing",
    mature_day: null,
    delayed_days: 0,
    health_sum: 0,
    health_days: 0,
    care: { timely_irrigation: false, weeded: false, timely_harvest: true },
    severe_days: 0,
    harvest_index: 0,
    opening_day_credit: state.calendar.absolute_day === 1 && !state.daily_ledgers.some((entry) => entry.type === "daily_report"),
  };
  return { plot_id: plotId, crop_id: cropId, seeds_used: preview.plot.cells, wp: 1 };
}

export function weedPlot(state, plotId) {
  const plot = state.plots.find((entry) => entry.plot_id === plotId && entry.unlocked);
  if (!plot) throw new Error("田区不存在或未解锁");
  spendWork(state, 1, 0, { id: `weed_${plotId}`, priority: WORK_PRIORITIES.irrigation, label: `为${plot.name}除草` });
  plot.weeds = clamp(plot.weeds - 30);
  if (plot.crop) plot.crop.care.weeded = true;
  return { plot_id: plotId, weeds: plot.weeds };
}

export function markIrrigation(state, plotId, source = "player") {
  const plot = state.plots.find((entry) => entry.plot_id === plotId && entry.unlocked);
  if (!plot) throw new Error("田区不存在或未解锁");
  if (plot.irrigation_planned) return { plot_id: plotId, planned: true, duplicate_business_action: true };
  plot.irrigation_planned = true;
  if (source === "player") spendWork(state, 1, 0, { id: `irrigate_${plotId}`, priority: WORK_PRIORITIES.irrigation, label: `灌溉${plot.name}` });
  return { plot_id: plotId, planned: true };
}

export function cropQuality(state, plot, cropBatch) {
  const averageHealth = cropBatch.health_days ? cropBatch.health_sum / cropBatch.health_days : cropBatch.health;
  const care = Math.min(8, (cropBatch.care.timely_irrigation ? 3 : 0) + (cropBatch.care.weeded ? 2 : 0) + (cropBatch.care.timely_harvest ? 3 : 0));
  const skill = state.skills.farming.level;
  const facility = plot.protection_tags.includes("greenhouse") ? 8 : 0;
  const random = Math.floor(auditedRoll(state, "crop_quality", plot.plot_id, cropBatch.harvest_index) * 9) - 4;
  return clamp(45 + 0.5 * (averageHealth - 70) + 0.2 * (plot.fertility - 50) + care + 2 * skill + facility - 2 * cropBatch.severe_days - 3 * cropBatch.delayed_days + random);
}

export function harvestCrop(state, plotId, source = "player") {
  const plot = state.plots.find((entry) => entry.plot_id === plotId && entry.unlocked);
  if (!plot?.crop || !["mature", "grace", "overripe"].includes(plot.crop.status)) throw new Error("没有可收获的成熟作物");
  if (source === "player") spendWork(state, 1, 0, { id: `harvest_${plotId}`, priority: WORK_PRIORITIES.harvest, label: `收获${plot.name}` });
  const definition = cropDefinition(plot.crop.crop_id);
  const averageHealth = plot.crop.health_days ? plot.crop.health_sum / plot.crop.health_days : plot.crop.health;
  const yieldFactor = clamp(0.70 + averageHealth / 300, 0.70, 1.05);
  const expected = plot.cells * definition.yield_per_cell * yieldFactor;
  const quantity = deterministicRound(expected, auditedRoll(state, "crop_yield", plot.plot_id, plot.crop.harvest_index));
  const quality = cropQuality(state, plot, plot.crop);
  const outcome = definition.harvest_outcome ?? { type: "inventory_product", cash_product: true };
  if (outcome.type === "feed_conversion") addItem(state, outcome.feed_item_id, quantity * outcome.feed_units_per_product, quality, { source: `harvest_feed:${plotId}` });
  else addItem(state, definition.product_item_id, quantity, quality, { source: `harvest:${plotId}` });
  plot.fertility = clamp(plot.fertility - definition.fertility_cost + definition.soil_restore);
  state.economy.opportunity_cost.fertility_consumed += definition.fertility_cost * 3;
  addSkillXp(state, "farming", 6);
  const receipt = { plot_id: plotId, crop_id: definition.id, quantity, quality, yield_factor: yieldFactor, average_health: averageHealth, harvest_outcome: outcome.type, cash_product: outcome.cash_product };
  if (definition.regrow_days) {
    plot.crop.growth_points = 0;
    plot.crop.status = "growing";
    plot.crop.mature_day = null;
    plot.crop.delayed_days = 0;
    plot.crop.harvest_index += 1;
    plot.crop.opening_day_credit = false;
    plot.crop.health_sum = 0;
    plot.crop.health_days = 0;
    plot.crop.care.timely_harvest = true;
  } else plot.crop = null;
  return receipt;
}

export function updatePlots(state, weatherId, options = {}) {
  const weather = weatherDefinition(weatherId);
  const updates = [];
  for (const plot of state.plots.filter((entry) => entry.unlocked)) {
    if (!plot.crop) {
      plot.moisture = clamp(plot.moisture + weather.precipitation - weather.evaporation);
      if (plot.fertility < 80) plot.fertility = Math.min(80, plot.fertility + 3);
      plot.weeds = clamp(plot.weeds + 2 + (weather.tags.includes("rain") ? 1 : 0));
      delete plot.irrigation_planned;
      continue;
    }
    const definition = cropDefinition(plot.crop.crop_id);
    const withoutIrrigation = plot.moisture + weather.precipitation - weather.evaporation - definition.water_use;
    const irrigation = plot.irrigation_planned && withoutIrrigation < 35 ? Math.max(0, 65 - withoutIrrigation) : 0;
    plot.moisture = clamp(withoutIrrigation + irrigation);
    if (irrigation > 0) plot.crop.care.timely_irrigation = true;
    plot.weeds = clamp(plot.weeds + 2 + (weather.tags.includes("rain") ? 1 : 0));
    let healthDelta = 0;
    if (plot.moisture >= 35 && plot.moisture <= 75 && plot.fertility >= 20 && !weather.tags.includes("severe")) healthDelta += 1;
    else if ((plot.moisture >= 20 && plot.moisture <= 34) || (plot.moisture >= 76 && plot.moisture <= 90)) healthDelta -= 3;
    else if (plot.moisture < 20 || plot.moisture > 90) healthDelta -= 8;
    if (plot.fertility < 20) healthDelta -= 3;
    if (plot.weeds > 60) healthDelta -= 2;
    if (plot.crop.status === "growing" && weather.tags.includes("severe") && !plot.protection_tags.some((tag) => ["greenhouse", "storm_cover"].includes(tag))) {
      if (weather.id !== "weather_heatwave" || plot.moisture < 45) healthDelta += weather.crop_health_delta;
      plot.crop.severe_days += 1;
    }
    if (plot.crop.status === "growing") {
      plot.crop.health = clamp(plot.crop.health + healthDelta);
      if (options.offline) plot.crop.health = Math.max(10, plot.crop.health);
      plot.crop.health_sum += plot.crop.health;
      plot.crop.health_days += 1;
    }
    const coldStopped = weather.id === "weather_cold_snap" && !definition.resistance_tags.includes("cold") && !plot.protection_tags.includes("greenhouse");
    const inSeason = (definition.seasons.includes(state.calendar.season) || plot.protection_tags.includes("greenhouse")) && !coldStopped;
    if (plot.crop.status === "growing" && inSeason && plot.moisture >= 20 && plot.moisture <= 90) {
      if (plot.crop.health >= 40) plot.crop.growth_points += 1;
      else if (plot.crop.health >= 20) plot.crop.growth_points += 0.5;
      const target = plot.crop.harvest_index > 0 && definition.regrow_days ? definition.regrow_days : definition.growth_days;
      const calendarElapsed = state.calendar.absolute_day - plot.crop.planted_day;
      if (plot.crop.opening_day_credit && calendarElapsed >= target - 1 && plot.crop.growth_points === target - 1) {
        plot.crop.growth_points += 1;
        plot.crop.opening_day_credit = false;
      }
      if (plot.crop.growth_points >= target) {
        plot.crop.status = "mature";
        plot.crop.mature_day = state.calendar.absolute_day;
      }
    } else if (["mature", "grace", "overripe"].includes(plot.crop.status)) {
      const age = state.calendar.absolute_day - plot.crop.mature_day;
      if (age === 1) plot.crop.status = "grace";
      if (age > 1) {
        plot.crop.status = "overripe";
        plot.crop.delayed_days += 1;
        plot.crop.health = clamp(plot.crop.health - 5);
        plot.crop.care.timely_harvest = false;
      }
    }
    updates.push({ plot_id: plot.plot_id, moisture: plot.moisture, health: plot.crop.health, growth_points: plot.crop.growth_points, status: plot.crop.status, irrigation });
    delete plot.irrigation_planned;
  }
  return updates;
}
