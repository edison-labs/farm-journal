import { ANIMAL_SPECIES, ANIMAL_TREATMENTS, byId } from "../content/definitions.js";
import { auditedRoll, deterministicRound } from "../core/rng.js";
import { clamp } from "../core/utils.js";
import { addSkillXp } from "./dsl.js";
import { addItem } from "./inventory.js";
import { weatherDefinition } from "./weather.js";
import { spendWork, WORK_PRIORITIES } from "./work.js";

export function treatAnimal(state, animalId, treatmentId = "treatment_basic_care", options = {}) {
  const animal = state.animals.find((entry) => entry.id === animalId);
  if (!animal) throw new Error("动物不存在");
  if (!animal.illness) throw new Error("动物当前没有需要诊疗的异常");
  const treatment = byId(ANIMAL_TREATMENTS, treatmentId);
  if (animal.illness.treatment?.status === "recovering") return { animal_id: animalId, treatment_id: treatment.id, cost: 0, health_restore: 0, recovering: true, duplicate_business_action: true };
  if (state.economy.cash < treatment.cost) throw new Error("资金不足以进行基础诊疗");
  spendWork(state, treatment.work_points, 0, { id: `treat_${animalId}`, priority: WORK_PRIORITIES.medical, label: `${treatment.name}：${animal.name}`, source: options.source ?? "player" });
  state.economy.cash -= treatment.cost;
  animal.health = clamp(animal.health + treatment.health_restore);
  animal.illness.status = "treated";
  animal.illness.treatment = { id: treatment.id, status: "recovering", treated_day: state.calendar.absolute_day, recovery_day: state.calendar.absolute_day + treatment.recovery_days, charged: treatment.cost };
  return { animal_id: animalId, treatment_id: treatment.id, cost: treatment.cost, health_restore: treatment.health_restore, recovery_day: animal.illness.treatment.recovery_day, recovered: false };
}

export function animalDefinition(speciesId) {
  return byId(ANIMAL_SPECIES, speciesId);
}

export function eggProbability(animal, housing, definition) {
  const illnessPenalty = animal.illness ? definition.illness_production_penalty : 0;
  const occupancy = housing.occupancy ?? 0;
  const overcrowdPenalty = occupancy > housing.capacity ? definition.overcrowd_production_penalty : 0;
  return clamp(0.55 + 0.002 * animal.health + 0.0015 * animal.mood - illnessPenalty - overcrowdPenalty, 0.25, 0.95);
}

export function productionProbability(animal, housing, definition) {
  if (definition.production_formula === "health_mood_probability") return eggProbability(animal, housing, definition);
  if (definition.production_formula === "fixed_probability") {
    const illnessPenalty = animal.illness ? definition.illness_production_penalty : 0;
    const overcrowdPenalty = (housing.occupancy ?? 0) > housing.capacity ? definition.overcrowd_production_penalty : 0;
    return clamp(definition.production_probability - illnessPenalty - overcrowdPenalty, 0, 1);
  }
  throw new Error(`未知动物生产公式: ${definition.production_formula}`);
}

export function diseaseProbability(animal, housing, definition, weather, skillLevel) {
  const occupancyRisk = (housing.occupancy ?? 0) > housing.capacity ? 0.02 : 0;
  return clamp(definition.base_disease_risk + Math.max(0, 60 - animal.health) * 0.002 + Math.max(0, 40 - housing.cleanliness) * 0.0015 + weather.animal_risk + occupancyRisk - skillLevel * 0.001, 0, 0.20);
}

export function animalProductQuality(state, animal, housing, definition) {
  const diseasePenalty = animal.illness ? definition.disease_quality_penalty : 0;
  const facility = housing.level > 1 ? 4 : 0;
  const random = Math.floor(auditedRoll(state, "animal_quality", animal.id, animal.age_days) * 9) - 4;
  return clamp(35 + 0.25 * animal.health + 0.15 * animal.mood + 0.08 * animal.affinity + 2 * state.skills.husbandry.level + facility - diseasePenalty + random);
}

export function updateAnimals(state, weatherId, options = {}) {
  const weather = weatherDefinition(weatherId);
  const feedStock = state.inventory.silo.quantities.item_feed ?? 0;
  let remainingFeed = feedStock;
  const housingById = Object.fromEntries(state.housing.map((housing) => [housing.id, housing]));
  for (const housing of state.housing) housing.occupancy = state.animals.filter((animal) => animal.housing_id === housing.id).length;
  const feedRatios = {};
  for (const animal of [...state.animals].sort((a, b) => a.id.localeCompare(b.id))) {
    const required = animalDefinition(animal.species_id).feed_units;
    const consumed = options.feeding_enabled === false ? 0 : Math.min(required, remainingFeed);
    remainingFeed -= consumed;
    feedRatios[animal.id] = required ? consumed / required : 1;
    state.economy.opportunity_cost.feed_consumed += consumed * 10;
  }
  state.inventory.silo.quantities.item_feed = remainingFeed;

  for (const housing of state.housing) {
    const rate = housing.capacity > 0 ? housing.occupancy / housing.capacity : housing.occupancy;
    housing.cleanliness = clamp(housing.cleanliness - (4 + 2 * rate) + (housing.clean_today ? 35 : 0));
    delete housing.clean_today;
  }

  const results = [];
  for (const animal of [...state.animals].sort((a, b) => a.id.localeCompare(b.id))) {
    const definition = animalDefinition(animal.species_id);
    const housing = housingById[animal.housing_id];
    const feedRatio = feedRatios[animal.id];
    animal.age_days += 1;
    if (animal.life_stage === "juvenile" && animal.age_days >= definition.juvenile_days) animal.life_stage = "growing";
    if (animal.life_stage === "growing" && animal.age_days >= definition.juvenile_days + definition.growing_days) animal.life_stage = "adult";
    animal.satiety = clamp(feedRatio * 100);
    if (feedRatio >= 1 && housing.cleanliness >= 50) {
      animal.health = clamp(animal.health + 1);
      animal.mood = clamp(animal.mood + 2);
    } else if (feedRatio < 1) {
      animal.health = clamp(animal.health - Math.ceil((1 - feedRatio) * 8));
      animal.mood = clamp(animal.mood - 8);
    }
    if (housing.cleanliness < 30) animal.health = clamp(animal.health - 4);
    if (housing.occupancy > housing.capacity) animal.mood = clamp(animal.mood - 5);
    if (animal.illness) {
      if (animal.illness.treatment?.status === "recovering" && animal.illness.treatment.recovery_day <= state.calendar.absolute_day) animal.illness = null;
    }
    if (animal.illness) {
      if (animal.illness.treatment?.status !== "recovering") animal.health = clamp(animal.health - 2);
      animal.illness.days += 1;
    }
    const protectedFromCold = weather.tags.includes("cold") && housing.insulation;
    const protectedFromWind = (weather.tags.includes("storm") || weather.tags.includes("blizzard")) && housing.windproof;
    animal.mood = clamp(animal.mood + (protectedFromCold || protectedFromWind ? 0 : weather.animal_mood_delta));
    if (housing.grazing_today) {
      if (weather.tags.includes("severe")) animal.mood = clamp(animal.mood + weather.animal_mood_delta);
      else animal.mood = clamp(animal.mood + 3);
    }
    if (options.offline) animal.health = Math.max(40, animal.health);

    let produced = 0;
    animal.production_modifiers ??= [];
    animal.production_modifiers = animal.production_modifiers.filter((modifier) => modifier.through_day >= state.calendar.absolute_day);
    let probability = productionProbability(animal, housing, definition);
    for (const modifier of animal.production_modifiers) probability *= modifier.multiplier;
    if (animal.life_stage === "elderly") probability *= 0.85;
    if (animal.production_cooldown > 0) animal.production_cooldown -= 1;
    const canProduce = feedRatio >= 1 && ["adult", "elderly"].includes(animal.life_stage) && animal.production_cooldown === 0;
    if (canProduce && auditedRoll(state, "animal_production", animal.id, animal.age_days) < probability) {
      produced = deterministicRound(definition.product_units, auditedRoll(state, "animal_quantity", animal.id, animal.age_days));
      if (produced > 0) addItem(state, definition.product_item_id, produced, animalProductQuality(state, animal, housing, definition), { source: `animal:${animal.id}` });
      animal.production_cooldown = Math.max(0, definition.production_period_days);
    }

    const effectiveWeather = { ...weather, animal_risk: protectedFromCold || protectedFromWind ? 0 : weather.animal_risk };
    const risk = diseaseProbability(animal, housing, definition, effectiveWeather, state.skills.husbandry.level);
    if (!animal.illness && auditedRoll(state, "animal_disease", animal.id, animal.age_days) < risk) {
      animal.illness = { id: "illness_general", started_day: state.calendar.absolute_day, days: 0, status: "abnormal" };
    }
    results.push({ animal_id: animal.id, feed_ratio: feedRatio, health: animal.health, mood: animal.mood, produced, production_probability: probability, disease_probability: risk, illness: animal.illness?.id ?? null });
  }
  for (const housing of state.housing) delete housing.grazing_today;
  if (state.animals.length) addSkillXp(state, "husbandry", new Set(state.animals.map((animal) => animal.housing_id)).size);
  return results;
}
