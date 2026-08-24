import { EVENTS, REGIONS, byId } from "../content/definitions.js";
import { auditedRoll, deterministicRoll, deterministicRound } from "../core/rng.js";
import { addSkillXp, evaluateCondition } from "./dsl.js";
import { addItem } from "./inventory.js";
import { spendWork, WORK_PRIORITIES } from "./work.js";
import { weatherDefinition } from "./weather.js";

export function rollExplorationQuantity(saveSeed, farmDay, regionId, skillLevel, weatherMultiplier = 1) {
  const baseRoll = deterministicRoll(saveSeed, "exploration_quantity", farmDay, regionId, 0).value;
  const baseQuantity = 2 + Math.floor(baseRoll * 3);
  const skillExpected = baseQuantity * (1 + skillLevel * 0.02);
  const skillRoll = deterministicRoll(saveSeed, "exploration_skill_quantity", farmDay, regionId, 0).value;
  const skillQuantity = deterministicRound(skillExpected, skillRoll);
  return {
    base_quantity: baseQuantity,
    skill_expected_quantity: skillExpected,
    quantity: Math.max(1, Math.floor(skillQuantity * weatherMultiplier)),
  };
}

function attachExplorationEvent(state, region) {
  const candidates = region.exploration_event_ids
    .map((id) => byId(EVENTS, id))
    .filter((event) => evaluateCondition(state, event.conditions))
    .filter((event) => (state.events.cooldowns[event.id] ?? 0) <= state.calendar.absolute_day)
    .filter((event) => !state.events.active.some((active) => active.event_id === event.id));
  if (!candidates.length) return null;
  const index = Math.floor(auditedRoll(state, "exploration_event_pick", region.id, 0) * candidates.length);
  const event = candidates[Math.min(candidates.length - 1, index)];
  state.events.active.push({
    event_id: event.id, created_day: state.calendar.absolute_day,
    deadline_day: state.calendar.absolute_day + Math.max(3, event.deadline_days ?? 5) - 1,
    urgent: false, attention_cost: event.attention_cost, exclusive_group: event.exclusive_group,
    status: "pending", source: "exploration", region_id: region.id,
  });
  state.events.cooldowns[event.id] = state.calendar.absolute_day + event.cooldown_days;
  state.events.recent_tags.push({ day: state.calendar.absolute_day, tags: [...event.tags, region.id] });
  state.exploration.latest_encounter = { day: state.calendar.absolute_day, region_id: region.id, event_id: event.id };
  return { event_id: event.id, title: event.title, body: event.body, choices: event.choices.map(({ id, label }) => ({ id, label })) };
}

export function exploreRegion(state, regionId) {
  const region = byId(REGIONS, regionId);
  if (state.exploration.last_region_days[regionId] === state.calendar.absolute_day) throw new Error("同一区域每日最多探索一次");
  spendWork(state, 2, 1, { id: `explore_${regionId}`, priority: WORK_PRIORITIES.exploration, label: `探索${region.name}` });
  const weather = weatherDefinition(state.weather?.today_id ?? "weather_cloudy");
  const quantityRoll = rollExplorationQuantity(state.save_seed, state.calendar.absolute_day, regionId, state.skills.foraging.level, weather.exploration_yield_multiplier);
  auditedRoll(state, "exploration_quantity", regionId, 0);
  auditedRoll(state, "exploration_skill_quantity", regionId, 0);
  const quantity = quantityRoll.quantity;
  const found = [];
  for (let index = 0; index < quantity; index += 1) {
    const item = region.items[Math.floor(auditedRoll(state, "exploration_item", regionId, index) * region.items.length)];
    addItem(state, item, 1, 45 + Math.floor(auditedRoll(state, "exploration_quality", regionId, index) * 31), { source: `exploration:${regionId}` });
    found.push(item);
  }
  const recentSameRegion = state.exploration.history.slice(-3).filter((entry) => entry.region_id === regionId).length;
  const rarityDecay = recentSameRegion >= 3 ? 0.5 : 1;
  const fogBonus = weather.exploration_event_multiplier;
  const eventProbability = Math.min(1, 0.30 * rarityDecay * fogBonus);
  const eventHit = auditedRoll(state, "exploration_event", regionId, 0) < eventProbability;
  const event = eventHit ? attachExplorationEvent(state, region) : null;
  const eventTriggered = Boolean(event);
  state.exploration.last_region_days[regionId] = state.calendar.absolute_day;
  state.exploration.history.push({ day: state.calendar.absolute_day, region_id: regionId, items: found, event_triggered: eventTriggered, event_id: event?.event_id ?? null });
  addSkillXp(state, "foraging", 2 + (new Set(found).size > 1 ? 3 : 0));
  return { region_id: regionId, items: found, base_quantity: quantityRoll.base_quantity, skill_expected_quantity: quantityRoll.skill_expected_quantity, event_triggered: eventTriggered, event, event_probability: eventProbability, rarity_decay: rarityDecay, fog_bonus: fogBonus };
}
