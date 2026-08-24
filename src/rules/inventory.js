import { ITEMS, byId } from "../content/definitions.js";
import { clamp, halfUp } from "../core/utils.js";

export function itemDefinition(itemId) {
  return byId(ITEMS, itemId);
}

export function storageUsed(store) {
  return store.lots.reduce((total, lot) => total + lot.quantity * itemDefinition(lot.item_id).space, 0);
}

function nextLotId(state) {
  state.inventory.lot_sequence += 1;
  return `lot_${state.calendar.absolute_day.toString().padStart(5, "0")}_${state.inventory.lot_sequence.toString().padStart(6, "0")}`;
}

function makeLot(state, itemId, quantity, quality, options = {}) {
  return {
    lot_id: options.lot_id ?? nextLotId(state),
    item_id: itemId,
    quantity,
    quality: clamp(quality ?? 50),
    born_day: options.born_day ?? state.calendar.absolute_day,
    age: options.age ?? 0,
    degraded_50: options.degraded_50 ?? false,
    degraded_80: options.degraded_80 ?? false,
    source: options.source ?? "system",
    reserved_for: options.reserved_for ?? null,
    historical_base_price: options.historical_base_price ?? itemDefinition(itemId).base_price,
  };
}

function fitQuantity(store, item, quantity) {
  if (item.space === 0) return quantity;
  return Math.max(0, Math.min(quantity, Math.floor((store.capacity - storageUsed(store)) / item.space)));
}

function appendToStore(state, store, itemId, quantity, quality, options) {
  if (quantity <= 0) return 0;
  store.lots.push(makeLot(state, itemId, quantity, quality, options));
  return quantity;
}

export function addItem(state, itemId, quantity, quality = 50, options = {}) {
  if (!Number.isInteger(quantity) || quantity <= 0) throw new RangeError("新增物品数量必须为正整数");
  const item = itemDefinition(itemId);
  if (item.tags.includes("seed")) {
    const current = state.inventory.seed_cabinet.quantities[itemId] ?? 0;
    if (current + quantity > state.inventory.seed_cabinet.capacity) throw new Error("种子柜容量不足");
    state.inventory.seed_cabinet.quantities[itemId] = current + quantity;
    return { warehouse: 0, sale_box: 0, temporary: 0, seed_cabinet: quantity };
  }
  if (item.tags.includes("feed")) {
    const current = state.inventory.silo.quantities[itemId] ?? 0;
    if (current + quantity > state.inventory.silo.capacity) throw new Error("料仓容量不足");
    state.inventory.silo.quantities[itemId] = current + quantity;
    return { warehouse: 0, sale_box: 0, temporary: 0, silo: quantity };
  }
  let remaining = quantity;
  const warehouseQuantity = fitQuantity(state.inventory.warehouse, item, remaining);
  appendToStore(state, state.inventory.warehouse, itemId, warehouseQuantity, quality, options);
  remaining -= warehouseQuantity;
  const saleQuantity = fitQuantity(state.inventory.sale_box, item, remaining);
  appendToStore(state, state.inventory.sale_box, itemId, saleQuantity, quality, { ...options, source: `${options.source ?? "system"}:overflow`, reserved_for: "overflow_sale" });
  remaining -= saleQuantity;
  const temporaryQuantity = fitQuantity(state.inventory.temporary, item, remaining);
  appendToStore(state, state.inventory.temporary, itemId, temporaryQuantity, quality, { ...options, source: `${options.source ?? "system"}:temporary` });
  remaining -= temporaryQuantity;
  if (remaining > 0) {
    state.inventory.anomalies.push({
      id: `storage_overflow_${state.calendar.absolute_day}_${state.inventory.anomalies.length + 1}`,
      item_id: itemId,
      quantity: remaining,
      quality,
      created_day: state.calendar.absolute_day,
      status: "must_resolve",
    });
  }
  return { warehouse: warehouseQuantity, sale_box: saleQuantity, temporary: temporaryQuantity, overflow: remaining };
}

export function availableQuantity(state, itemId) {
  return state.inventory.warehouse.lots
    .filter((lot) => lot.item_id === itemId && !lot.reserved_for)
    .reduce((sum, lot) => sum + lot.quantity, 0);
}

export function availableTaggedQuantity(state, tag) {
  return state.inventory.warehouse.lots
    .filter((lot) => itemDefinition(lot.item_id).tags.includes(tag) && !lot.reserved_for)
    .reduce((sum, lot) => sum + lot.quantity, 0);
}

export function takeItems(state, itemId, quantity, options = {}) {
  if (!Number.isInteger(quantity) || quantity <= 0) throw new RangeError("取用数量必须为正整数");
  const matching = state.inventory.warehouse.lots
    .filter((lot) => !lot.reserved_for && (lot.item_id === itemId || (options.substitute_tags ?? []).some((tag) => itemDefinition(lot.item_id).tags.includes(tag))))
    .sort((a, b) => b.age - a.age || a.quality - b.quality || a.lot_id.localeCompare(b.lot_id));
  if (matching.reduce((sum, lot) => sum + lot.quantity, 0) < quantity) throw new Error(`物品不足：${itemDefinition(itemId).name}×${quantity}`);
  let remaining = quantity;
  const taken = [];
  for (const lot of matching) {
    if (remaining === 0) break;
    const amount = Math.min(remaining, lot.quantity);
    taken.push({ ...lot, quantity: amount });
    lot.quantity -= amount;
    remaining -= amount;
  }
  state.inventory.warehouse.lots = state.inventory.warehouse.lots.filter((lot) => lot.quantity > 0);
  return taken;
}

export function reserveItems(state, reservationId, itemId, quantity, minimumQuality = 0, options = {}) {
  if (!reservationId) throw new Error("保留必须包含稳定用途ID");
  if (!Number.isInteger(quantity) || quantity < 0) throw new RangeError("保留数量必须为非负整数");
  const already = state.inventory.warehouse.lots
    .filter((lot) => lot.reserved_for === reservationId && lot.item_id === itemId && lot.quality >= minimumQuality)
    .reduce((sum, lot) => sum + lot.quantity, 0);
  let remaining = Math.max(0, quantity - already);
  const originalLots = state.inventory.warehouse.lots.map((lot) => ({ ...lot }));
  const originalSequence = state.inventory.lot_sequence;
  const originalReservation = state.inventory.reservations[reservationId] ? { ...state.inventory.reservations[reservationId] } : null;
  const available = state.inventory.warehouse.lots
    .filter((lot) => !lot.reserved_for && lot.item_id === itemId && lot.quality >= minimumQuality)
    .sort((a, b) => b.age - a.age || a.quality - b.quality || a.lot_id.localeCompare(b.lot_id));
  for (const lot of available) {
    if (!remaining) break;
    const amount = Math.min(remaining, lot.quantity);
    if (amount === lot.quantity) lot.reserved_for = reservationId;
    else {
      lot.quantity -= amount;
      state.inventory.warehouse.lots.push({ ...lot, lot_id: nextLotId(state), quantity: amount, reserved_for: reservationId });
    }
    remaining -= amount;
  }
  const reserved = quantity - remaining;
  if (options.require_full && remaining) {
    state.inventory.warehouse.lots = originalLots;
    state.inventory.lot_sequence = originalSequence;
    if (originalReservation) state.inventory.reservations[reservationId] = originalReservation;
    else delete state.inventory.reservations[reservationId];
    throw new Error(`可保留物品不足：${itemDefinition(itemId).name}×${quantity}`);
  }
  state.inventory.reservations[reservationId] = { reservation_id: reservationId, item_id: itemId, quantity: reserved, minimum_quality: minimumQuality };
  return { reservation_id: reservationId, requested: quantity, reserved, missing: remaining };
}

export function takeReservedItems(state, reservationId, itemId, quantity) {
  if (!Number.isInteger(quantity) || quantity <= 0) throw new RangeError("取用保留品数量必须为正整数");
  const matching = state.inventory.warehouse.lots
    .filter((lot) => lot.reserved_for === reservationId && lot.item_id === itemId)
    .sort((a, b) => b.age - a.age || a.quality - b.quality || a.lot_id.localeCompare(b.lot_id));
  if (matching.reduce((sum, lot) => sum + lot.quantity, 0) < quantity) throw new Error(`保留物品不足：${itemDefinition(itemId).name}×${quantity}`);
  let remaining = quantity;
  const taken = [];
  for (const lot of matching) {
    if (!remaining) break;
    const amount = Math.min(remaining, lot.quantity);
    taken.push({ ...lot, quantity: amount, reserved_for: null });
    lot.quantity -= amount;
    remaining -= amount;
  }
  state.inventory.warehouse.lots = state.inventory.warehouse.lots.filter((lot) => lot.quantity > 0);
  delete state.inventory.reservations[reservationId];
  return taken;
}

export function releaseReservation(state, reservationId) {
  let quantity = 0;
  for (const lot of state.inventory.warehouse.lots.filter((entry) => entry.reserved_for === reservationId)) {
    quantity += lot.quantity;
    lot.reserved_for = null;
  }
  delete state.inventory.reservations[reservationId];
  return { reservation_id: reservationId, released: quantity };
}

export function restoreLots(state, lots, source = "restored") {
  for (const lot of lots) addItem(state, lot.item_id, lot.quantity, lot.quality, { ...lot, lot_id: undefined, source });
}

export function weightedQuality(lots) {
  const quantity = lots.reduce((sum, lot) => sum + lot.quantity, 0);
  if (!quantity) return 0;
  return lots.reduce((sum, lot) => sum + lot.quality * lot.quantity, 0) / quantity;
}

export function queueForSale(state, itemId, quantity) {
  const item = itemDefinition(itemId);
  const lots = takeItems(state, itemId, quantity);
  const required = quantity * item.space;
  if (storageUsed(state.inventory.sale_box) + required > state.inventory.sale_box.capacity) {
    restoreLots(state, lots, "sale_rejected");
    throw new Error("出售箱容量不足");
  }
  for (const lot of lots) state.inventory.sale_box.lots.push({ ...lot, lot_id: nextLotId(state), source: "manual_sale", reserved_for: "sale" });
  return lots;
}

export function retractSaleLot(state, lotId) {
  const index = state.inventory.sale_box.lots.findIndex((lot) => lot.lot_id === lotId);
  if (index < 0) throw new Error("出售箱批次不存在");
  const lot = state.inventory.sale_box.lots[index];
  const item = itemDefinition(lot.item_id);
  if (storageUsed(state.inventory.warehouse) + item.space * lot.quantity > state.inventory.warehouse.capacity) throw new Error("仓库容量不足，无法撤回");
  state.inventory.sale_box.lots.splice(index, 1);
  state.inventory.warehouse.lots.push({ ...lot, reserved_for: null, source: "sale_retracted" });
  return { lot_id: lotId, item_id: lot.item_id, quantity: lot.quantity };
}

function degradeLot(lot, item) {
  const threshold50 = Math.ceil(item.shelf_life * 0.5);
  const threshold80 = Math.ceil(item.shelf_life * 0.8);
  if (lot.age >= threshold50 && !lot.degraded_50) {
    lot.quality = clamp(lot.quality - 5);
    lot.degraded_50 = true;
  }
  if (lot.age >= threshold80 && !lot.degraded_80) {
    lot.quality = clamp(lot.quality - 10);
    lot.degraded_80 = true;
  }
}

export function ageInventory(state) {
  const expired = [];
  for (const store of [state.inventory.warehouse, state.inventory.temporary]) {
    for (const lot of store.lots) {
      if (lot.born_day === state.calendar.absolute_day) continue;
      lot.age += 1;
      const item = itemDefinition(lot.item_id);
      degradeLot(lot, item);
      if (lot.age > item.shelf_life) expired.push({ store, lot, item });
    }
  }
  for (const entry of expired) {
    const reservationId = entry.lot.reserved_for;
    entry.store.lots = entry.store.lots.filter((lot) => lot.lot_id !== entry.lot.lot_id);
    if (reservationId && state.inventory.reservations[reservationId]) {
      const reservation = state.inventory.reservations[reservationId];
      reservation.quantity = Math.max(0, reservation.quantity - entry.lot.quantity);
      if (!reservation.quantity) delete state.inventory.reservations[reservationId];
      const orderId = reservationId.startsWith("order:") ? reservationId.slice("order:".length) : null;
      const order = orderId ? state.orders.find((candidate) => candidate.id === orderId && candidate.status === "accepted") : null;
      if (order) {
        order.reserved_quantity = Math.max(0, (order.reserved_quantity ?? 0) - entry.lot.quantity);
        order.reservation_status = "needs_restock";
      }
    }
    if (entry.item.expiry_outcome === "discard") state.daily_ledgers.push({ type: "inventory_expired", layer: "operation", item_id: entry.item.id, quantity: entry.lot.quantity, outcome: "discarded" });
    else if (entry.item.expiry_outcome === "downgrade_normal") addItem(state, entry.item.id, entry.lot.quantity, 50, { source: "expired_downgrade" });
    else if (entry.item.expiry_outcome === "low_value_feed") addItem(state, "item_feed", entry.lot.quantity, 50, { source: `expired_feed:${entry.item.id}` });
    else if (entry.item.expiry_outcome === "compost") addItem(state, "item_compost", entry.lot.quantity, 50, { source: `expired:${entry.item.id}` });
    else throw new Error(`未知过期处理词汇: ${entry.item.expiry_outcome}`);
  }
  const staleTemporary = state.inventory.temporary.lots.filter((lot) => lot.born_day < state.calendar.absolute_day);
  for (const lot of staleTemporary) {
    state.inventory.temporary.lots = state.inventory.temporary.lots.filter((candidate) => candidate.lot_id !== lot.lot_id);
    state.inventory.anomalies.push({ id: `temporary_expired_${lot.lot_id}`, item_id: lot.item_id, quantity: lot.quantity, quality: lot.quality, created_day: state.calendar.absolute_day, status: "must_resolve" });
  }
  return expired.length;
}

export function inventoryValue(lots) {
  return halfUp(lots.reduce((sum, lot) => sum + lot.historical_base_price * lot.quantity, 0));
}
