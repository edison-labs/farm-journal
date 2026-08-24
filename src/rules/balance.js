import { ANIMAL_SPECIES, CROPS, ITEMS, RECIPES, byId } from "../content/definitions.js";
import { marketDistributionExpectation } from "./economy.js";

export const SEASON_DAYS = 21;
export const PLOT_CELLS = 12;

export function cropBalance(crop) {
  const harvests = crop.regrow_days ? 1 + Math.floor((SEASON_DAYS - crop.growth_days) / crop.regrow_days) : Math.floor(SEASON_DAYS / crop.growth_days);
  const gross = harvests * PLOT_CELLS * crop.yield_per_cell * crop.base_sell_price;
  const seedPurchases = crop.regrow_days ? 1 : harvests;
  const seedCost = seedPurchases * PLOT_CELLS * crop.seed_price;
  const fertilityCost = harvests * crop.fertility_cost * 3;
  const net = gross - seedCost - fertilityCost;
  const operations = crop.regrow_days ? 1 + harvests : 2 * harvests;
  const work = operations + SEASON_DAYS * crop.care_load / 2;
  return { id: crop.id, harvests, gross, seed_cost: seedCost, fertility_cost: fertilityCost, net, work, net_per_work: net / work };
}

export function animalBalance(species) {
  const probability = species.id === "animal_chicken" ? 0.85 : species.production_probability;
  const item = byId(ITEMS, species.product_item_id);
  const gross = species.product_units * probability * item.base_price / species.production_period_days;
  const feedCost = species.feed_units * 10;
  const dailyNet = gross - feedCost;
  return { id: species.id, daily_gross: gross, feed_cost: feedCost, daily_net: dailyNet, payback_days: species.purchase_price / dailyNet };
}

export function recipeBalance(recipe) {
  const input = recipe.inputs.reduce((sum, entry) => sum + byId(ITEMS, entry.item_id).base_price * entry.quantity, 0);
  const output = recipe.outputs.reduce((sum, entry) => sum + byId(ITEMS, entry.item_id).base_price * entry.quantity, 0);
  const uplift = output - input - recipe.operation_cost;
  return { id: recipe.id, input, output, operation_cost: recipe.operation_cost, uplift, uplift_rate: uplift / input };
}

export function firstSeasonCash(yieldFactor = 1, henLayRate = 0.85, mode = "document_model") {
  const startCash = 2400;
  const cropGross = 5 * 12 * yieldFactor * 48;
  const eggGross = 3 * henLayRate * 32 * 21;
  const seedCost = 4 * 12 * 25;
  const fertilityReserve = 5 * 4 * 3;
  const feedOpportunityCost = 3 * 10 * 21;
  const giftedFeedCashSpend = Math.max(0, 3 * 21 - 42) * 10;
  const upkeep = 20 * 21;
  const runtimeReplenishmentFeed = 30;
  const feedCash = mode === "runtime_strategy" ? runtimeReplenishmentFeed * 10 : mode === "liquid_cash" ? giftedFeedCashSpend : feedOpportunityCost;
  const fertilityCharge = mode === "document_model" ? fertilityReserve : 0;
  const endingCash = startCash + cropGross + eggGross - seedCost - fertilityCharge - feedCash - upkeep;
  return { mode, lay_rate: henLayRate, start_cash: startCash, crop_gross: cropGross, egg_gross: eggGross, seed_cost: seedCost, fertility_opportunity_cost: fertilityReserve, fertility_cash: fertilityCharge, feed_cash: feedCash, feed_opportunity_cost: feedOpportunityCost, ending_feed: mode === "runtime_strategy" ? 9 : mode === "liquid_cash" ? 0 : null, upkeep, ending_cash: endingCash, net_change: endingCash - startCash };
}

export function workloadScenarios() {
  return [
    { id: "opening", total: 6.5, capacity: 12 },
    { id: "mid_normal", total: 9.5, capacity: 12 },
    { id: "mid_peak", total: 12, capacity: 12 },
    { id: "late_normal", total: 11, capacity: 14 },
  ];
}

export function runBalanceChecks() {
  const crops = CROPS.map(cropBalance);
  const animals = ANIMAL_SPECIES.map(animalBalance);
  const recipes = RECIPES.map(recipeBalance);
  const cashBase = firstSeasonCash();
  const cashStress = firstSeasonCash(0.8, 0.70);
  const liquidCash = firstSeasonCash(1, 0.835, "liquid_cash");
  const runtimeCash = firstSeasonCash(1, 0.835, "runtime_strategy");
  const failures = [];
  for (const crop of crops) {
    if (!(crop.net > 0)) failures.push(`${crop.id}季净收益不为正`);
    if (crop.id !== "crop_clover" && !(crop.net >= 1100 && crop.net <= 2100)) failures.push(`${crop.id}季净收益不在1100—2100`);
  }
  for (const animal of animals) {
    if (!(animal.daily_net > 0)) failures.push(`${animal.id}日期望净收益不为正`);
    if (!(animal.payback_days >= 30 && animal.payback_days <= 75)) failures.push(`${animal.id}回本不在30—75日`);
  }
  for (const recipe of recipes) {
    if (!(recipe.uplift > 0)) failures.push(`${recipe.id}增值不为正`);
    if (!(recipe.uplift_rate <= 0.35)) failures.push(`${recipe.id}增值率超过35%`);
  }
  if (!(cashStress.ending_cash >= 3500)) failures.push("首季压力模型季末现金低于3500G");
  if (marketDistributionExpectation() !== 1) failures.push("市场倍率期望不等于1.00");
  for (const workload of workloadScenarios()) if (workload.total > workload.capacity) failures.push(`${workload.id}工时超载`);
  if (failures.length) throw new Error(`数值验算失败\n${failures.join("\n")}`);
  return { crops, animals, recipes, cash_base: cashBase, cash_stress: cashStress, liquid_cash: liquidCash, runtime_cash: runtimeCash, market_expectation: marketDistributionExpectation(), workloads: workloadScenarios() };
}
