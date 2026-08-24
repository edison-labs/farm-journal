import { createNewSave, initializeRecoveryHistory, SAVE_VERSION } from "../core/state.js";
import { deepClone } from "../core/utils.js";

export const MIGRATIONS = Object.freeze({
  0: migrateV0ToV1,
});

const V0_ITEM_REPLACEMENTS = Object.freeze({
  item_old_feed_sack: { item_id: "item_feed", value_ratio: 1, reason: "内部预发布饲料袋ID合并" },
});

export function migrateV0ToV1(legacy) {
  if (legacy.save_version !== 0) throw new Error("v0→v1迁移器收到错误版本");
  const now = Number.isFinite(legacy.last_trusted_time) ? legacy.last_trusted_time : Date.parse(legacy.created_at ?? "2026-01-01T05:00:00Z");
  const fresh = createNewSave({
    now,
    timezone: legacy.timezone ?? "UTC",
    rollover_hour: legacy.rollover_hour ?? 5,
    save_seed: legacy.save_seed ?? "internal-v0-seed",
    save_id: legacy.save_id ?? "save_internal_v0",
  });
  fresh.calendar = deepClone(legacy.calendar ?? fresh.calendar);
  fresh.economy.cash = legacy.money ?? legacy.economy?.cash ?? fresh.economy.cash;
  fresh.economy.ledger_opening_cash = fresh.economy.cash;
  fresh.plots = deepClone(legacy.plots ?? fresh.plots);
  fresh.animals = deepClone(legacy.animals ?? fresh.animals);
  fresh.inventory = { ...fresh.inventory, ...(deepClone(legacy.inventory ?? {})) };
  const replaced = [];
  for (const store of [fresh.inventory.warehouse, fresh.inventory.sale_box, fresh.inventory.temporary]) {
    if (!store?.lots) continue;
    for (const lot of store.lots) {
      const mapping = V0_ITEM_REPLACEMENTS[lot.item_id];
      if (!mapping) continue;
      replaced.push({ from_item_id: lot.item_id, to_item_id: mapping.item_id, quantity: lot.quantity, historical_value: lot.historical_base_price * lot.quantity, value_ratio: mapping.value_ratio, reason: mapping.reason });
      lot.item_id = mapping.item_id;
      lot.historical_base_price *= mapping.value_ratio;
    }
  }
  fresh.flags = deepClone(legacy.flags ?? {});
  fresh.daily_ledgers = deepClone(legacy.daily_ledgers ?? []);
  fresh.modules = { ...fresh.modules, ...(deepClone(legacy.modules ?? {})) };
  fresh.save_version = 1;
  fresh.flags.migrated_from_internal_v0 = true;
  fresh.daily_ledgers.push({
    type: "migration",
    from: 0,
    to: 1,
    internal_prerelease: true,
    message: "内部预发布v0存档已迁移到v1。",
  });
  for (const entry of replaced) fresh.daily_ledgers.push({ type: "migration_item_replacement", layer: "account", from: 0, to: 1, internal_prerelease: true, ...entry, message: `${entry.from_item_id}已等值迁移为${entry.to_item_id}。` });
  initializeRecoveryHistory(fresh);
  return fresh;
}

export function migrateSave(input) {
  let state = deepClone(input);
  if (!Number.isInteger(state.save_version)) throw new Error("存档缺少save_version");
  while (state.save_version < SAVE_VERSION) {
    const migration = MIGRATIONS[state.save_version];
    if (!migration) throw new Error(`缺少${state.save_version}→${state.save_version + 1}迁移器`);
    state = migration(state);
  }
  if (state.save_version > SAVE_VERSION) throw new Error(`存档版本${state.save_version}高于当前支持版本${SAVE_VERSION}`);
  return state;
}
