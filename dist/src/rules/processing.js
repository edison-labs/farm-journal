import { RECIPES, byId } from "../content/definitions.js";
import { clamp, deepClone, halfUp } from "../core/utils.js";
import { addSkillXp } from "./dsl.js";
import { addItem, inventoryValue, restoreLots, takeItems, weightedQuality } from "./inventory.js";
import { spendWork, WORK_PRIORITIES } from "./work.js";

export function queueProcessing(state, recipeId) {
  if (state.flags.nonessential_paused) throw new Error("资金保护已暂停非必要加工");
  const recipe = byId(RECIPES, recipeId);
  if (state.processing.queue_capacity <= 0) throw new Error("加工坊尚未启用");
  if (state.processing.batches.filter((batch) => ["pending", "started"].includes(batch.status)).length >= state.processing.queue_capacity) throw new Error("加工队列已满");
  const operationCost = halfUp(recipe.operation_cost * (1 - Math.min(0.10, state.skills.processing.level * 0.02)));
  if (state.economy.cash < operationCost) throw new Error("资金不足以支付操作费");
  const rollback = {
    cash: state.economy.cash,
    inventory: deepClone(state.inventory),
    processing: deepClone(state.processing),
    workPlan: deepClone(state.work_plan),
  };
  const allInputs = [];
  try {
    for (const input of recipe.inputs) allInputs.push(...takeItems(state, input.item_id, input.quantity, { substitute_tags: input.substitute_tags }));
    if (state.processing.planning_day !== state.calendar.absolute_day) {
      spendWork(state, 1, 1, { id: `processing_plan_${state.calendar.absolute_day}`, priority: WORK_PRIORITIES.processing, label: "安排当日加工队列" });
      state.processing.planning_day = state.calendar.absolute_day;
    }
    state.economy.cash -= operationCost;
    const batch = {
      id: `batch_${state.calendar.absolute_day}_${state.processing.batches.length + 1}`,
      recipe_id: recipeId,
      status: "pending",
      queued_day: state.calendar.absolute_day,
      started_day: null,
      remaining_days: recipe.duration_days,
      operation_cost: operationCost,
      input_lots: allInputs,
      input_base_value: inventoryValue(allInputs),
      input_quality: weightedQuality(allInputs),
    };
    state.processing.batches.push(batch);
    return batch;
  } catch (error) {
    state.economy.cash = rollback.cash;
    state.inventory = rollback.inventory;
    state.processing = rollback.processing;
    state.work_plan = rollback.workPlan;
    throw error;
  }
}

export function cancelProcessing(state, batchId) {
  const batch = state.processing.batches.find((entry) => entry.id === batchId);
  if (!batch || batch.status === "complete" || batch.status === "cancelled") throw new Error("加工批次不可取消");
  let refund = 0;
  const inputsReturned = batch.status === "pending";
  if (inputsReturned) restoreLots(state, batch.input_lots, "processing_cancelled_unstarted");
  else {
    refund = halfUp(batch.input_base_value * 0.8);
    state.economy.cash += refund;
  }
  batch.status = "cancelled";
  batch.cancel_refund = refund;
  batch.input_lots = [];
  return { batch_id: batchId, refund, operation_cost_refunded: 0, inputs_returned: inputsReturned };
}

export function advanceProcessing(state) {
  const completed = [];
  for (const batch of state.processing.batches.filter((entry) => ["pending", "started"].includes(entry.status))) {
    if (batch.status === "pending") {
      batch.status = "started";
      batch.started_day = state.calendar.absolute_day;
    }
    batch.remaining_days -= 1;
    if (batch.remaining_days <= 0) {
      const recipe = byId(RECIPES, batch.recipe_id);
      const skillBonus = Math.min(10, state.skills.processing.level * 2);
      const facilityBonus = 0;
      const outputQuality = clamp(batch.input_quality + skillBonus + facilityBonus);
      for (const output of recipe.outputs) addItem(state, output.item_id, output.quantity, outputQuality, { source: `processing:${batch.id}` });
      batch.status = "complete";
      batch.completed_day = state.calendar.absolute_day;
      batch.output_quality = outputQuality;
      batch.input_lots = [];
      addSkillXp(state, "processing", 1);
      completed.push(batch.id);
    }
  }
  return completed;
}
