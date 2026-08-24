import { canonicalStringify, sha256 } from "./utils.js";

export const RNG_VERSION = "rng:v1";

export function rngKey(saveSeed, systemId, farmDate, entityId, rollIndex) {
  return [RNG_VERSION, String(saveSeed), String(systemId), String(farmDate), String(entityId), Number(rollIndex)];
}

export function rngDigest(saveSeed, systemId, farmDate, entityId, rollIndex) {
  return sha256(canonicalStringify(rngKey(saveSeed, systemId, farmDate, entityId, rollIndex)));
}

export function digestFraction(digest) {
  const top52 = Number.parseInt(digest.slice(0, 13), 16);
  return top52 / 0x10000000000000;
}

export function deterministicRoll(saveSeed, systemId, farmDate, entityId, rollIndex = 0) {
  const key = rngKey(saveSeed, systemId, farmDate, entityId, rollIndex);
  const digest = sha256(canonicalStringify(key));
  return { key, digest, value: digestFraction(digest) };
}

export function auditedRoll(state, systemId, entityId, rollIndex = 0, farmDate = state.calendar.absolute_day) {
  const roll = deterministicRoll(state.save_seed, systemId, farmDate, entityId, rollIndex);
  state.rng_audit.push({ digest: roll.digest, value: roll.value, system_id: systemId, entity_id: entityId, farm_date: farmDate, roll_index: rollIndex });
  if (state.rng_audit.length > 128) state.rng_audit.splice(0, state.rng_audit.length - 128);
  return roll.value;
}

export function deterministicRound(expected, rollValue) {
  const integer = Math.floor(expected);
  return integer + (rollValue < expected - integer ? 1 : 0);
}

export function weightedChoice(entries, rollValue) {
  const total = entries.reduce((sum, entry) => sum + entry.weight, 0);
  if (!(total > 0)) throw new RangeError("权重总和必须大于0");
  let cursor = rollValue * total;
  for (const entry of entries) {
    cursor -= entry.weight;
    if (cursor < 0) return entry.value;
  }
  return entries.at(-1).value;
}
