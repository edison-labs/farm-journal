import { ITEMS, RESIDENTS } from "../content/definitions.js";
import { deterministicRoll } from "../core/rng.js";
import { addSkillXp, relationshipChange } from "./dsl.js";
import { priceLots } from "./economy.js";
import { releaseReservation, reserveItems, takeReservedItems } from "./inventory.js";

function reservationId(orderId) { return `order:${orderId}`; }

export function generateWeeklyOrders(state) {
  const current = state.orders.filter((order) => ["offered", "accepted"].includes(order.status));
  const needed = Math.max(0, 3 - current.length);
  const eligibleItems = ITEMS.filter((item) => !item.tags.includes("seed") && !item.tags.includes("feed") && !item.tags.includes("unique") && item.base_price > 1);
  const generated = [];
  for (let index = 0; index < needed; index += 1) {
    const roll = deterministicRoll(state.save_seed, "orders", state.calendar.week_block, "item", index).value;
    const item = eligibleItems[Math.floor(roll * eligibleItems.length)];
    const resident = RESIDENTS[(state.calendar.week_block + index) % RESIDENTS.length];
    const multiplier = 1.15 + 0.05 * Math.floor(deterministicRoll(state.save_seed, "orders", state.calendar.week_block, "reward", index).value * 5);
    const order = {
      id: `order_${state.calendar.week_block}_${index + 1}`,
      item_id: item.id,
      item_tags: item.tags,
      quantity: 3 + Math.floor(deterministicRoll(state.save_seed, "orders", state.calendar.week_block, "quantity", index).value * 6),
      minimum_quality: 0,
      created_day: state.calendar.absolute_day,
      deadline_day: state.calendar.absolute_day + 3 + Math.floor(deterministicRoll(state.save_seed, "orders", state.calendar.week_block, "deadline", index).value * 5),
      reward_multiplier: Math.min(1.35, multiplier),
      publisher_id: resident.id,
      status: "offered",
      followup_flag: `order_complete_${state.calendar.week_block}_${index + 1}`,
    };
    state.orders.push(order);
    generated.push(order.id);
  }
  return generated;
}

export function acceptOrder(state, orderId) {
  const order = state.orders.find((entry) => entry.id === orderId && entry.status === "offered");
  if (!order) throw new Error("订单不存在或不可接受");
  order.status = "accepted";
  const reservation = reserveItems(state, reservationId(order.id), order.item_id, order.quantity, order.minimum_quality);
  order.reserved_quantity = reservation.reserved;
  order.reservation_status = reservation.missing ? "needs_restock" : "reserved";
  return order;
}

export function reserveOrder(state, orderId) {
  const order = state.orders.find((entry) => entry.id === orderId && entry.status === "accepted");
  if (!order) throw new Error("订单不存在或尚未接受");
  const reservation = reserveItems(state, reservationId(order.id), order.item_id, order.quantity, order.minimum_quality);
  order.reserved_quantity = reservation.reserved;
  order.reservation_status = reservation.missing ? "needs_restock" : "reserved";
  return reservation;
}

export function deliverOrder(state, orderId) {
  const order = state.orders.find((entry) => entry.id === orderId && ["offered", "accepted"].includes(entry.status));
  if (!order) throw new Error("订单不存在或不可交付");
  if (state.calendar.absolute_day > order.deadline_day) throw new Error("订单已经逾期");
  const reservation = reserveItems(state, reservationId(order.id), order.item_id, order.quantity, order.minimum_quality, { require_full: true });
  order.reserved_quantity = reservation.reserved;
  const lots = takeReservedItems(state, reservationId(order.id), order.item_id, order.quantity).filter((lot) => {
    if (lot.quality < order.minimum_quality) throw new Error("订单物品品质不足");
    return true;
  });
  const businessMultiplier = 1 + Math.min(0.05, state.skills.business.level * 0.01);
  const price = priceLots(state, lots, order.reward_multiplier * businessMultiplier);
  price.business_skill_multiplier = businessMultiplier;
  state.economy.cash += price.total;
  for (const line of price.lines) {
    const key = `${price.week_key}:${line.item_id}`;
    state.economy.weekly_sales[key] = (state.economy.weekly_sales[key] ?? 0) + line.quantity;
  }
  order.status = "complete";
  order.completed_day = state.calendar.absolute_day;
  order.payout = price.total;
  order.price_snapshot = price;
  order.reserved_quantity = 0;
  order.reservation_status = "consumed";
  state.flags[order.followup_flag] = true;
  relationshipChange(state, order.publisher_id, 2, 1);
  addSkillXp(state, "business", 3);
  return order;
}

export function abandonOrder(state, orderId) {
  const order = state.orders.find((entry) => entry.id === orderId && ["offered", "accepted"].includes(entry.status));
  if (!order) throw new Error("订单不存在或不可放弃");
  order.status = "abandoned";
  order.reserved_quantity = 0;
  order.reservation_status = "released";
  releaseReservation(state, reservationId(order.id));
  order.abandoned_day = state.calendar.absolute_day;
  relationshipChange(state, order.publisher_id, 0, -1);
  return order;
}

export function expireOrders(state) {
  const expired = [];
  for (const order of state.orders.filter((entry) => ["offered", "accepted"].includes(entry.status) && state.calendar.absolute_day > entry.deadline_day)) {
    const wasAccepted = order.status === "accepted";
    order.status = "expired";
    order.reserved_quantity = 0;
    order.reservation_status = "released";
    releaseReservation(state, reservationId(order.id));
    relationshipChange(state, order.publisher_id, 0, wasAccepted ? -1 : 0);
    expired.push(order.id);
  }
  return expired;
}
