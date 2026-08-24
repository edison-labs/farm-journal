import { ceilDiv } from "../core/utils.js";
import { HOUSING_CARE_RULES } from "../content/definitions.js";

export const WORK_PRIORITIES = Object.freeze({
  medical: 100,
  feeding: 90,
  harvest: 80,
  irrigation: 70,
  processing: 50,
  construction: 50,
  social: 20,
  exploration: 10,
});

export function resetDailyWork(state) {
  state.work_plan = {
    ...state.work_plan,
    farm_day: state.calendar.absolute_day,
    used_wp: 0,
    used_focus: 0,
    tasks: [],
    confirmed: false,
    forecast: state.work_plan.forecast ?? [],
  };
}

export function spendWork(state, wp, focus = 0, task = {}) {
  if (!Number.isInteger(wp) || wp < 0 || !Number.isInteger(focus) || focus < 0) throw new RangeError("工时和专注必须为非负整数");
  if (state.work_plan.used_wp + wp > state.work_plan.capacity) throw new Error("工时不足");
  if (state.work_plan.used_focus + focus > state.work_plan.focus_capacity) throw new Error("专注槽不足");
  state.work_plan.used_wp += wp;
  state.work_plan.used_focus += focus;
  state.work_plan.tasks.push({ id: task.id ?? `task_${state.calendar.absolute_day}_${state.work_plan.tasks.length + 1}`, wp, focus, priority: task.priority ?? 0, label: task.label ?? "未命名任务", source: task.source ?? "player" });
}

export function routineCropCost(state, cropDefinitions) {
  const load = state.plots.filter((plot) => plot.unlocked && plot.crop).reduce((sum, plot) => {
    const definition = cropDefinitions.find((crop) => crop.id === plot.crop.crop_id);
    return sum + (definition?.care_load ?? 0);
  }, 0);
  return ceilDiv(load, 2);
}

export function housingCareCost(state, rules = HOUSING_CARE_RULES) {
  let total = 0;
  for (const housing of state.housing) {
    const count = state.animals.filter((animal) => animal.housing_id === housing.id).length;
    if (!count) continue;
    const rule = rules.find((entry) => housing.tags.includes(entry.housing_tag));
    if (!rule) throw new Error(`圈舍${housing.id}缺少照料工时规则`);
    if (rule.work_formula === "per_occupied_housing") total += 1;
    else if (rule.work_formula === "ceil_animals_per_units") total += ceilDiv(count, rule.units_per_wp);
    else throw new Error(`未知圈舍照料工时公式: ${rule.work_formula}`);
  }
  return total;
}

export function forecastWork(state, cropDefinitions, days = 3) {
  return Array.from({ length: days }, (_, offset) => {
    const distance = offset + 1;
    const dueHarvests = [];
    let careLoad = 0;
    for (const plot of state.plots.filter((entry) => entry.unlocked && entry.crop)) {
      const definition = cropDefinitions.find((crop) => crop.id === plot.crop.crop_id);
      careLoad += definition?.care_load ?? 0;
      const target = plot.crop.harvest_index > 0 && definition?.regrow_days ? definition.regrow_days : definition?.growth_days;
      const optimisticGrowth = plot.crop.growth_points + distance;
      if (["mature", "grace", "overripe"].includes(plot.crop.status) || optimisticGrowth >= target) dueHarvests.push(plot.plot_id);
    }
    const routine = Math.ceil(careLoad / 2);
    const harvest = dueHarvests.length;
    const existingProcessing = state.processing.batches.filter((batch) => ["pending", "started"].includes(batch.status) && batch.remaining_days <= distance).length;
    const readyConstruction = state.construction.filter((project) => project.status === "ready" && project.ready_day + 1 <= state.calendar.absolute_day + distance).length;
    const expectedWp = routine + harvest;
    return {
      distance, expected_wp: expectedWp, routine_wp: routine, harvest_wp: harvest, due_harvest_plots: dueHarvests,
      completing_processing: existingProcessing, activating_construction: readyConstruction,
      over_capacity: expectedWp > state.work_plan.capacity,
      weather_uncertainty: distance === 1 ? "低" : distance === 2 ? "中" : "较高",
      suggestion: expectedWp > state.work_plan.capacity ? "利用成熟后1日宽限错峰，优先健康较低田区" : harvest > 1 ? "保留收获工时并减少可选探索" : "工时余量正常",
    };
  });
}

export function prioritizeTasks(tasks, capacity) {
  const sorted = tasks.map((task, index) => ({ ...task, original_index: index })).sort((a, b) => b.priority - a.priority || a.original_index - b.original_index);
  const accepted = [];
  const rejected = [];
  let used = 0;
  for (const task of sorted) {
    if (used + task.wp <= capacity) { accepted.push(task); used += task.wp; }
    else rejected.push(task);
  }
  return { accepted, rejected, used };
}
