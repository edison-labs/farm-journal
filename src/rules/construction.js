import { BUILDINGS, byId } from "../content/definitions.js";
import { deepClone, halfUp } from "../core/utils.js";
import { spendWork, WORK_PRIORITIES } from "./work.js";

function prerequisiteMet(state, prerequisite) {
  if (!prerequisite) return true;
  if (prerequisite === "storage_1" || prerequisite === "coop_1") return state.buildings.some((building) => building.id === prerequisite && building.status === "complete");
  if (prerequisite === "spring_week_1") return state.calendar.absolute_day >= 7;
  if (prerequisite === "resident_craftsman_trust_20") return state.residents.resident_craftsman.trust >= 20;
  if (prerequisite === "two_plots") return state.plots.filter((plot) => plot.unlocked).length >= 2;
  if (prerequisite === "resident_weather_familiarity_20") return state.residents.resident_weather.familiarity >= 20;
  if (prerequisite === "year_2") return state.calendar.year >= 2 || state.flags.main_greenhouse_unlocked;
  return false;
}

export function startConstruction(state, buildingId) {
  if (state.flags.nonessential_paused) throw new Error("资金保护已暂停非必要建设");
  const building = byId(BUILDINGS, buildingId);
  if (state.construction.filter((project) => !["complete", "cancelled"].includes(project.status)).length >= 2) throw new Error("同时最多进行2个工程");
  if (state.buildings.some((entry) => entry.id === buildingId && entry.status === "complete")) throw new Error("工程已经完成");
  if (state.construction.some((entry) => entry.building_id === buildingId && !["complete", "cancelled"].includes(entry.status))) throw new Error("工程已经存在");
  if (!prerequisiteMet(state, building.prerequisite)) throw new Error("工程前置条件未满足");
  if (state.economy.cash < building.cost) throw new Error("工程资金不足");
  state.economy.cash -= building.cost;
  const project = { building_id: buildingId, locked_cash: building.cost, invested_wp: 0, total_wp: building.work_required, status: "planned", started_day: null, ready_day: null };
  state.construction.push(project);
  return project;
}

export function investConstruction(state, buildingId, wp) {
  if (!Number.isInteger(wp) || wp < 1 || wp > 4) throw new RangeError("每日建设投入必须为1—4 WP");
  const project = state.construction.find((entry) => entry.building_id === buildingId && ["planned", "started"].includes(entry.status));
  if (!project) throw new Error("工程不存在或不可投入");
  if (project.last_invest_day !== state.calendar.absolute_day) project.invested_today = 0;
  const dailyRemaining = 4 - (project.invested_today ?? 0);
  if (wp > dailyRemaining) throw new Error(`该工程今日最多还可投入${dailyRemaining} WP`);
  const actualWp = Math.min(wp, project.total_wp - project.invested_wp);
  const workPlanBefore = deepClone(state.work_plan);
  const projectBefore = deepClone(project);
  try {
    const focus = project.last_invest_day === state.calendar.absolute_day ? 0 : 1;
    spendWork(state, actualWp, focus, { id: `construction_${buildingId}_${state.calendar.absolute_day}_${project.invested_today ?? 0}`, priority: WORK_PRIORITIES.construction, label: `建设${buildingId}` });
    project.status = "started";
    project.started_day ??= state.calendar.absolute_day;
    project.last_invest_day = state.calendar.absolute_day;
    project.invested_today = (project.invested_today ?? 0) + actualWp;
    project.invested_wp += actualWp;
    if (project.invested_wp >= project.total_wp) {
      project.status = "ready";
      project.ready_day = state.calendar.absolute_day;
    }
  } catch (error) {
    state.work_plan = workPlanBefore;
    Object.assign(project, projectBefore);
    throw error;
  }
  return project;
}

export function cancelConstruction(state, buildingId) {
  const project = state.construction.find((entry) => entry.building_id === buildingId && !["complete", "cancelled"].includes(entry.status));
  if (!project) throw new Error("工程不存在或不可取消");
  const refund = project.invested_wp === 0 ? project.locked_cash : halfUp(project.locked_cash * ((project.total_wp - project.invested_wp) / project.total_wp) * 0.8);
  state.economy.cash += refund;
  project.status = "cancelled";
  project.refund = refund;
  return { building_id: buildingId, refund };
}

export function activateReadyConstruction(state) {
  const activated = [];
  for (const project of state.construction.filter((entry) => entry.status === "ready" && entry.ready_day < state.calendar.absolute_day)) {
    const definition = byId(BUILDINGS, project.building_id);
    project.status = "complete";
    project.activated_day = state.calendar.absolute_day;
    state.buildings.push({ id: definition.id, status: "complete", level: 1 });
    for (const capability of definition.capabilities) {
      if (capability.key === "plot_b") state.plots.find((plot) => plot.plot_id === "plot_b").unlocked = true;
      if (capability.key === "storage_capacity") state.inventory.warehouse.capacity = capability.value;
      if (capability.key === "coop_capacity") state.housing.find((housing) => housing.id === "housing_coop_1").capacity = capability.value;
      if (capability.key === "processing_queues") state.processing.queue_capacity = capability.value;
      if (capability.key === "barn_capacity") {
        const barn = state.housing.find((housing) => housing.id === "housing_barn_1");
        barn.level = 1;
        barn.capacity = capability.value;
      }
      if (capability.key === "well_coverage") state.buildings.find((building) => building.id === "well_1").coverage = capability.value;
      if (capability.key === "greenhouse_plots") state.flags.greenhouse_plot_capacity = capability.value;
      if (capability.key === "greenhouse_plots") {
        for (let index = 1; index <= capability.value; index += 1) {
          const plotId = `plot_greenhouse_${index}`;
          if (!state.plots.some((plot) => plot.plot_id === plotId)) state.plots.push({
            plot_id: plotId, name: `温室${index}区`, unlocked: true, land_use_type: "greenhouse", cells: 12,
            moisture: 60, fertility: 60, weeds: 0, crop: null, protection_tags: ["greenhouse"], history_tags: [],
          });
        }
      }
      if (capability.key === "forecast_days") state.flags.forecast_days = capability.value;
    }
    activated.push(project.building_id);
  }
  return activated;
}
