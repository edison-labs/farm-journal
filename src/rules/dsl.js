import { SKILL_THRESHOLDS } from "../content/definitions.js";
import { auditedRoll } from "../core/rng.js";
import { clamp, deepClone, halfUp } from "../core/utils.js";
import { addItem, availableQuantity, takeItems } from "./inventory.js";
import { startConstruction } from "./construction.js";

export function getPath(root, path) {
  return path.split(".").reduce((value, key) => value?.[key], root);
}

function compare(actual, operator, expected) {
  if (operator === "eq") return actual === expected;
  if (operator === "gte") return actual >= expected;
  if (operator === "lte") return actual <= expected;
  if (operator === "contains") return Array.isArray(actual) ? actual.includes(expected) : String(actual).includes(String(expected));
  throw new Error(`不支持的比较运算: ${operator}`);
}

export function evaluateCondition(state, condition) {
  if (!condition) return true;
  if (Array.isArray(condition)) return condition.every((entry) => evaluateCondition(state, entry));
  if (condition.all) return condition.all.every((entry) => evaluateCondition(state, entry));
  if (condition.any) return condition.any.some((entry) => evaluateCondition(state, entry));
  if (condition.not) return !evaluateCondition(state, condition.not);
  switch (condition.op) {
    case "eq": case "gte": case "lte": case "contains":
      return compare(getPath(state, condition.path), condition.op, condition.value);
    case "date": return compare(state.calendar.absolute_day, condition.compare ?? "eq", condition.value);
    case "season": return state.calendar.season === condition.value;
    case "weather_tag": return (state.weather?.today_tags ?? []).includes(condition.value);
    case "funds": return compare(state.economy.cash, condition.compare ?? "gte", condition.value);
    case "item_quantity": return compare(availableQuantity(state, condition.item_id), condition.compare ?? "gte", condition.value);
    case "building_level": {
      const building = state.buildings.find((entry) => entry.id === condition.building_id);
      return compare(building?.level ?? 0, condition.compare ?? "gte", condition.value);
    }
    case "skill_level": return compare(state.skills[condition.skill_id]?.level ?? 0, condition.compare ?? "gte", condition.value);
    case "relationship": return compare(state.residents[condition.resident_id]?.[condition.field] ?? 0, condition.compare ?? "gte", condition.value);
    case "flag": return state.flags[condition.flag] === condition.value;
    case "not_flag": return !state.flags[condition.flag];
    case "cooldown_ready": return (state.events.cooldowns[condition.event_id] ?? 0) <= state.calendar.absolute_day;
    case "owns_animal": return state.animals.some((animal) => animal.species_id === condition.species_id);
    case "animal_health_gte": return state.animals.some((animal) => animal.species_id === condition.species_id && animal.health >= condition.value);
    case "entity_state": {
      const collection = state[condition.collection];
      const entity = Array.isArray(collection) ? collection.find((entry) => entry.id === condition.id || entry.plot_id === condition.id) : null;
      return entity ? compare(getPath(entity, condition.path), condition.compare ?? "eq", condition.value) : false;
    }
    default: throw new Error(`条件词汇未列入白名单: ${condition.op}`);
  }
}

export function relationshipChange(state, residentId, familiarity, trust) {
  const relationship = state.residents[residentId];
  if (!relationship) throw new Error(`未知居民关系: ${residentId}`);
  if (relationship.week_block !== state.calendar.week_block) {
    relationship.week_block = state.calendar.week_block;
    relationship.weekly_familiarity_gain = 0;
    relationship.weekly_trust_gain = 0;
    relationship.gifts_this_week = 0;
  }
  const positiveFamiliarity = Math.max(0, familiarity);
  const positiveTrust = Math.max(0, trust);
  const allowedFamiliarity = Math.min(positiveFamiliarity, 12 - relationship.weekly_familiarity_gain);
  const allowedTrust = Math.min(positiveTrust, 8 - relationship.weekly_trust_gain);
  relationship.familiarity = clamp(relationship.familiarity + (familiarity < 0 ? familiarity : allowedFamiliarity));
  relationship.trust = clamp(relationship.trust + (trust < 0 ? trust : allowedTrust), -50, 100);
  relationship.weekly_familiarity_gain += allowedFamiliarity;
  relationship.weekly_trust_gain += allowedTrust;
}

export function addSkillXp(state, skillId, amount) {
  const skill = state.skills[skillId];
  if (!skill) throw new Error(`未知技能: ${skillId}`);
  skill.xp += amount;
  let level = 0;
  for (let index = 0; index < SKILL_THRESHOLDS.length; index += 1) if (skill.xp >= SKILL_THRESHOLDS[index]) level = index;
  skill.level = Math.min(5, level);
}

function firstAnimal(state, speciesId) {
  const animal = state.animals.find((entry) => entry.species_id === speciesId);
  if (!animal) throw new Error(`没有物种 ${speciesId}`);
  return animal;
}

export function applyEffect(state, effect, context = {}) {
  switch (effect.type) {
    case "funds": {
      const before = state.economy.cash;
      const next = state.economy.cash + effect.amount;
      if (next < 0) {
        if (!effect.allow_assistance) throw new Error("资金不足，效果事务已回滚");
        state.flags.financial_relief_due = true;
        state.economy.cash = 0;
      } else state.economy.cash = halfUp(next);
      if (context.source === "scheduled_event") state.daily_ledgers.push({ type: "scheduled_funds", layer: "account", day: state.calendar.absolute_day, source_event: context.event_id ?? null, source_choice: context.choice_id ?? null, cash_delta: state.economy.cash - before });
      return;
    }
    case "item_add": addItem(state, effect.item_id, effect.quantity, effect.quality ?? 50, { source: context.source ?? "event" }); return;
    case "item_remove": takeItems(state, effect.item_id, effect.quantity); return;
    case "work": state.work_plan.used_wp = clamp(state.work_plan.used_wp + effect.amount, 0, state.work_plan.capacity); return;
    case "state": {
      const current = getPath(state, effect.path);
      const keys = effect.path.split(".");
      const finalKey = keys.pop();
      const parent = keys.reduce((value, key) => value[key], state);
      parent[finalKey] = effect.mode === "set" ? effect.value : clamp(current + effect.amount, effect.min ?? 0, effect.max ?? 100);
      return;
    }
    case "flag": state.flags[effect.flag] = effect.value_from_day_offset ? state.calendar.absolute_day + effect.value_from_day_offset : effect.value; return;
    case "relationship": relationshipChange(state, effect.resident_id, effect.familiarity ?? 0, effect.trust ?? 0); return;
    case "skill_xp": addSkillXp(state, effect.skill_id, effect.amount); return;
    case "animal_state": {
      const animal = firstAnimal(state, effect.species_id);
      animal[effect.field] = clamp((animal[effect.field] ?? 0) + effect.amount);
      return;
    }
    case "animal_modifier": {
      const animal = firstAnimal(state, effect.species_id);
      animal.production_modifiers ??= [];
      animal.production_modifiers = animal.production_modifiers.filter((modifier) => modifier.id !== effect.modifier_id);
      animal.production_modifiers.push({ id: effect.modifier_id, multiplier: effect.production_multiplier, through_day: state.calendar.absolute_day + effect.duration_days - 1, source_event: context.event_id ?? null, source_choice: context.choice_id ?? null });
      return;
    }
    case "schedule":
      state.events.scheduled_effects.push({ due_day: state.calendar.absolute_day + effect.delay_days, source_event: context.event_id ?? null, source_choice: effect.source_choice ?? context.choice_id ?? null, effects: deepClone(effect.effects), random: null });
      return;
    case "schedule_random":
      state.events.scheduled_effects.push({ due_day: state.calendar.absolute_day + effect.delay_days, source_event: context.event_id ?? null, source_choice: effect.source_choice ?? context.choice_id ?? null, effects: [], random: { success_probability: effect.success_probability, success: deepClone(effect.success), failure: deepClone(effect.failure) } });
      return;
    case "random_branch": {
      const value = auditedRoll(state, effect.system_id, context.event_id ?? "dsl", context.roll_index ?? 0);
      applyEffects(state, value < effect.success_probability ? effect.success : effect.failure, { ...context, roll_index: (context.roll_index ?? 0) + 1 });
      return;
    }
    case "create_order": state.orders.push(deepClone(effect.order)); return;
    case "start_building": {
      startConstruction(state, effect.building_id);
      return;
    }
    case "log":
      state.daily_ledgers.push({ type: "effect_log", layer: context.source === "event" || context.source === "scheduled_event" ? "decision" : "operation", day: state.calendar.absolute_day, source: context.source ?? "event", message: effect.message });
      return;
    default: throw new Error(`效果词汇未列入白名单: ${effect.type}`);
  }
}

export function applyEffects(state, effects, context = {}) {
  for (const effect of effects) applyEffect(state, effect, context);
  return state;
}

export function previewEffects(state, effects, context = {}) {
  const preview = deepClone(state);
  applyEffects(preview, effects, context);
  return preview;
}
