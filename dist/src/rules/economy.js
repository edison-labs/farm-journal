import { QUALITY_TIERS, byId, ITEMS } from "../content/definitions.js";
import { deterministicRoll, weightedChoice } from "../core/rng.js";
import { gregorianDayNumber, halfUp } from "../core/utils.js";

export function qualityTier(score) {
  return QUALITY_TIERS.find((tier) => score >= tier.min && score <= tier.max) ?? QUALITY_TIERS[0];
}

export function marketWeekKey(realDateKey) {
  const day = gregorianDayNumber(realDateKey);
  const utcDay = new Date(day * 86400000).getUTCDay();
  const fromMonday = (utcDay + 6) % 7;
  const monday = new Date((day - fromMonday) * 86400000);
  return monday.toISOString().slice(0, 10);
}

export function weeklyMarketMultiplier(saveSeed, itemId, weekKey) {
  const roll = deterministicRoll(saveSeed, "market_weekly", weekKey, itemId, 0).value;
  return weightedChoice([
    { value: 0.90, weight: 10 }, { value: 0.95, weight: 20 }, { value: 1.00, weight: 40 },
    { value: 1.05, weight: 20 }, { value: 1.10, weight: 10 },
  ], roll);
}

export function segmentedSalePrice(basePrice, quantity, multipliers = {}) {
  const quality = multipliers.quality ?? 1;
  const market = multipliers.market ?? 1;
  const channel = multipliers.channel ?? 1;
  const tiers = [
    { upTo: 20, volume: 1 },
    { upTo: 50, volume: 0.9 },
    { upTo: Infinity, volume: 0.8 },
  ];
  let previous = 0;
  let total = 0;
  const breakdown = [];
  for (const tier of tiers) {
    const amount = Math.max(0, Math.min(quantity, tier.upTo) - previous);
    if (amount > 0) {
      const unitPrice = halfUp(basePrice * quality * market * tier.volume * channel);
      total += unitPrice * amount;
      breakdown.push({ from: previous + 1, to: previous + amount, quantity: amount, volume: tier.volume, unit_price: unitPrice, subtotal: unitPrice * amount });
    }
    previous = tier.upTo;
    if (quantity <= tier.upTo) break;
  }
  return { total, breakdown };
}

export function priceLots(state, lots, channelMultiplier = 1) {
  const grouped = new Map();
  for (const lot of lots) {
    const tier = qualityTier(lot.quality);
    const key = `${lot.item_id}:${tier.id}`;
    const group = grouped.get(key) ?? { item_id: lot.item_id, tier, quantity: 0 };
    group.quantity += lot.quantity;
    grouped.set(key, group);
  }
  const weekKey = marketWeekKey(state.last_real_date_key);
  const lines = [];
  let total = 0;
  const runningByItem = new Map();
  for (const group of grouped.values()) {
    const item = byId(ITEMS, group.item_id);
    const ledgerPrevious = state.economy.weekly_sales[`${weekKey}:${group.item_id}`] ?? 0;
    const previous = runningByItem.get(group.item_id) ?? ledgerPrevious;
    const market = weeklyMarketMultiplier(state.save_seed, group.item_id, weekKey);
    const before = segmentedSalePrice(item.base_price, previous, { quality: group.tier.multiplier, market, channel: channelMultiplier }).total;
    const after = segmentedSalePrice(item.base_price, previous + group.quantity, { quality: group.tier.multiplier, market, channel: channelMultiplier }).total;
    const subtotal = after - before;
    total += subtotal;
    lines.push({ item_id: group.item_id, quantity: group.quantity, quality_tier: group.tier.id, base_price: item.base_price, market_multiplier: market, channel_multiplier: channelMultiplier, previous_week_quantity: previous, subtotal });
    runningByItem.set(group.item_id, previous + group.quantity);
  }
  return { total, lines, week_key: weekKey };
}

export function marketDistributionExpectation() {
  return (90 * 10 + 95 * 20 + 100 * 40 + 105 * 20 + 110 * 10) / 10000;
}
