export const PAGE_NAMES = Object.freeze({
  today: "今日",
  plots: "田区",
  animals: "动物",
  warehouse: "仓库",
  processing: "加工",
  market: "市场",
  town: "小镇",
  tasks: "待办",
  logs: "日志",
  settings: "设置",
});

export const ALL_PAGE_IDS = Object.freeze(Object.keys(PAGE_NAMES));

function hasCompletedCommand(state, commandTypes) {
  const expected = new Set(Array.isArray(commandTypes) ? commandTypes : [commandTypes]);
  if (Object.values(state.action_receipts ?? {}).some((receipt) => expected.has(receipt.type))) return true;
  return (state.daily_ledgers ?? []).some((entry) => entry.type === "command" && expected.has(entry.command_type));
}

export function onboardingProgress(state) {
  return {
    planted: state.plots.some((plot) => Boolean(plot.crop)) || hasCompletedCommand(state, "crop.plant"),
    caredForAnimal: hasCompletedCommand(state, ["animal.interact", "housing.clean", "housing.graze", "animal.treat"]),
  };
}

function hasProducts(state) {
  return [state.inventory.warehouse, state.inventory.sale_box, state.inventory.temporary]
    .some((store) => (store?.lots?.length ?? 0) > 0);
}

function hasTownProgress(state) {
  return (state.construction?.length ?? 0) > 0
    || (state.exploration?.history?.length ?? 0) > 0
    || Object.values(state.residents ?? {}).some((resident) => resident.familiarity > 0 || resident.trust > 0);
}

function hasTasks(state) {
  return (state.events?.active?.length ?? 0) > 0
    || (state.orders ?? []).some((order) => ["offered", "accepted"].includes(order.status))
    || (state.construction ?? []).some((project) => !["complete", "cancelled"].includes(project.status))
    || (state.inventory?.anomalies ?? []).some((entry) => entry.status === "must_resolve");
}

export function availablePages(state) {
  if (state.flags?.progressive_navigation !== true) return new Set(ALL_PAGE_IDS);

  const available = new Set(["today", "plots", "animals", "settings"]);
  const progress = onboardingProgress(state);
  const commerceReady = progress.planted || hasProducts(state) || (state.orders?.length ?? 0) > 0;
  if (commerceReady) {
    available.add("warehouse");
    available.add("market");
  }
  if (state.calendar.absolute_day >= 2 || hasTownProgress(state)) {
    available.add("town");
    available.add("logs");
  }
  if (hasTasks(state)) available.add("tasks");
  if (state.processing.queue_capacity > 0 || state.processing.batches.length > 0) available.add("processing");
  return available;
}

export function newlyAvailablePages(beforeState, afterState) {
  const before = availablePages(beforeState);
  return [...availablePages(afterState)].filter((pageId) => !before.has(pageId));
}
