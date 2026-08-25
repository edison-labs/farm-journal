import { ANIMAL_SPECIES, ANIMAL_TREATMENTS, BUILDINGS, CROPS, EVENTS, ITEMS, RECIPES, REGIONS, RESIDENTS, SKILLS, WEATHER, byId } from "../content/definitions.js";
import { createNewSave } from "../core/state.js";
import { validateNewSaveOptions } from "../core/new-save.js";
import { executeCommand, previewEventChoice, synchronizeCommand } from "../core/engine.js";
import { calendarLabel } from "../core/utils.js";
import { SaveStore } from "../persistence/store.js";
import { storageUsed } from "../rules/inventory.js";
import { priceLots, qualityTier } from "../rules/economy.js";
import { PAGE_NAMES, availablePages, newlyAvailablePages, onboardingProgress } from "./progression.js";
import { APP_RELEASE_NOTES, APP_VERSION, isVersionNewer } from "./version.js";
import {
  COMMAND_LABELS,
  animalLifeStageLabel,
  animalStateFieldLabel,
  commandLabel,
  constructionStatusLabel,
  cropStatusLabel,
  illnessLabel,
  inventoryAnomalyStatusLabel,
  ledgerTypeLabel,
  orderStatusLabel,
  pageSectionLabel,
  processingStatusLabel,
} from "./labels.js";

const main = document.querySelector("#main-content");
const siteShell = document.querySelector("#site-shell");
const nav = document.querySelector("#main-nav");
const statusStrip = document.querySelector("#status-strip");
const search = document.querySelector("#global-search");
const live = document.querySelector("#live-region");
const dialog = document.querySelector("#confirm-dialog");
const dialogMessage = document.querySelector("#confirm-message");
const updateEntry = document.querySelector("#update-entry");
const store = new SaveStore(localStorage);

let page = "today";
let state;
let message = null;
let recoveryDiagnostic = false;
let eventPreview = null;
let liveAnnouncementTimer = null;
let messageDismissTimer = null;
let lastSavedAt = null;
let availableUpdate = null;

const IMPORT_FAILURE_MESSAGE = "备份导入失败：文件内容无效或与当前版本不兼容。";
const RECOVERY_FAILURE_MESSAGE = "存档进入只读恢复：状态校验失败，请导出恢复诊断。";

function renderUpdateEntry() {
  updateEntry.hidden = !availableUpdate;
  if (availableUpdate) updateEntry.textContent = `新版本 ${availableUpdate.version}`;
}

async function checkForUpdate({ announceResult = false } = {}) {
  try {
    const response = await fetch(`./app-version.json?checked=${Date.now()}`, { cache: "no-store" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const manifest = await response.json();
    availableUpdate = isVersionNewer(manifest.version) ? manifest : null;
    renderUpdateEntry();
    if (announceResult) setMessage(availableUpdate ? `发现新版本 ${availableUpdate.version}，存档会保留。` : `当前 ${APP_VERSION} 已经是最新版。`);
    return availableUpdate;
  } catch {
    if (announceResult) setMessage("暂时无法检查更新，请稍后再试。", "error");
    return null;
  }
}

function applyAvailableUpdate() {
  if (!availableUpdate) return;
  try {
    if (!state.read_only_recovery) lastSavedAt = store.save(state).written_at;
    const target = new URL("./", window.location.href);
    target.searchParams.set("update", availableUpdate.version);
    target.searchParams.set("t", String(Date.now()));
    window.location.replace(target.href);
  } catch (error) {
    setMessage(userFacingError(error, "更新前无法保存当前进度，请先导出备份。"), "error");
    render();
  }
}

function renderNewSaveSetup(reason = "首次建档前，请确认现实日期规则。", focusContext = captureRenderFocus()) {
  const detected = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  main.innerHTML = `${pageHeading("创建新存档", reason)}<article class="card"><form data-special-form="new-save" class="inline-form"><label>所在时区（IANA）<input name="timezone" required value="${esc(detected)}"></label><label>每天几点刷新（0—8）<input name="rollover_hour" type="number" required min="0" max="8" step="1" value="5"></label><button class="primary">开始游戏</button></form><p class="meta">创建后仍可更改时区，但改过一次要等84个牧场日才能再改。</p></article>`;
  restoreRenderFocus(focusContext);
}

function esc(value) {
  return String(value ?? "").replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[character]));
}

function payload(value) {
  return encodeURIComponent(JSON.stringify(value));
}

function randomToken() {
  if (typeof globalThis.crypto?.randomUUID === "function") return globalThis.crypto.randomUUID();
  if (typeof globalThis.crypto?.getRandomValues === "function") {
    const values = globalThis.crypto.getRandomValues(new Uint32Array(4));
    return [...values].map((value) => value.toString(16).padStart(8, "0")).join("-");
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

const WP_CONSUMING_COMMANDS = new Set([
  "crop.plant", "crop.harvest", "crop.irrigate", "crop.irrigate_batch", "crop.weed", "crop.fertilize",
  "housing.clean", "housing.graze", "animal.interact", "animal.treat", "processing.queue",
  "building.invest", "exploration.run", "resident.talk",
]);

const FIXED_WORK_COSTS = Object.freeze({
  "crop.harvest": { wp: 1 },
  "crop.weed": { wp: 1 },
  "animal.interact": { wp: 1, focus: 1 },
  "exploration.run": { wp: 2, focus: 1 },
  "resident.talk": { wp: 1, focus: 1 },
});

function workCostText({ wp = 0, focus = 0, text = "" } = {}) {
  if (text) return text;
  const costs = [];
  if (wp > 0) costs.push(`${wp} WP`);
  if (focus > 0) costs.push(`${focus} 专注`);
  return costs.length ? `需 ${costs.join(" / ")}` : "无需额外 WP";
}

function workAvailability(cost) {
  if (!cost) return { unavailable: false, text: "" };
  const normal = { unavailable: false, text: workCostText(cost) };
  if (cost.text || !state?.work_plan) return normal;
  const remainingWp = Math.max(0, state.work_plan.capacity - state.work_plan.used_wp);
  const remainingFocus = Math.max(0, state.work_plan.focus_capacity - state.work_plan.used_focus);
  const missingWp = Math.max(0, (cost.wp ?? 0) - remainingWp);
  const missingFocus = Math.max(0, (cost.focus ?? 0) - remainingFocus);
  const shortages = [];
  if (missingWp) shortages.push(`工时不足 · 还差 ${missingWp} WP`);
  if (missingFocus) shortages.push(`专注不足 · 还差 ${missingFocus}`);
  return shortages.length ? { unavailable: true, text: shortages.join(" / ") } : normal;
}

function workCostMarkup(cost, availability = workAvailability(cost)) {
  return cost ? `<span class="action-cost ${availability.unavailable ? "shortage" : ""}">${esc(availability.text)}</span>` : "";
}

function commandWorkCost(type, data) {
  if (type === "crop.fertilize") {
    const plot = state.plots.find((entry) => entry.plot_id === data.plot_id);
    return plot?.fertility >= 100 ? { text: "肥力已满 · 不扣 WP" } : { wp: 1 };
  }
  if (FIXED_WORK_COSTS[type]) return FIXED_WORK_COSTS[type];
  if (type === "crop.irrigate") {
    const plot = state.plots.find((entry) => entry.plot_id === data.plot_id);
    return plot?.irrigation_planned ? { text: "已安排 · 不再扣 WP" } : { wp: 1 };
  }
  if (type === "crop.irrigate_batch") {
    const consumesWork = data.plot_ids.some((plotId) => !state.plots.find((entry) => entry.plot_id === plotId)?.irrigation_planned);
    return consumesWork ? { wp: 1 } : { text: "已安排 · 不再扣 WP" };
  }
  if (type === "housing.clean") {
    const housing = state.housing.find((entry) => entry.id === data.housing_id);
    return housing?.clean_today ? { text: "已安排 · 不再扣 WP" } : { wp: 1 };
  }
  if (type === "housing.graze") {
    const housing = state.housing.find((entry) => entry.id === data.housing_id);
    return housing?.grazing_today ? { text: "已安排 · 不再扣 WP" } : { wp: 1 };
  }
  if (type === "animal.treat") {
    const animal = state.animals.find((entry) => entry.id === data.animal_id);
    if (animal?.illness?.treatment?.status === "recovering") return { text: "恢复中 · 不再扣 WP" };
    return { wp: byId(ANIMAL_TREATMENTS, data.treatment_id).work_points };
  }
  if (type === "processing.queue") return state.processing.planning_day === state.calendar.absolute_day
    ? { text: "今天已计工时 · 不再扣 WP" }
    : { wp: 1, focus: 1 };
  return null;
}

function commandButton(label, type, data, options = {}) {
  const workCost = options.workCost ?? commandWorkCost(type, data);
  const workOperation = WP_CONSUMING_COMMANDS.has(type) || Boolean(workCost);
  const availability = workAvailability(workCost);
  const unavailable = workOperation && availability.unavailable;
  return `<button type="button" ${options.disabled || unavailable ? "disabled" : ""} ${options.danger ? `data-danger="${esc(options.danger)}"` : ""} ${workOperation ? 'data-wp-operation="true"' : ""} data-command="${esc(type)}" data-payload="${payload(data)}" class="${options.primary ? "primary" : ""} ${options.danger ? "danger" : ""} ${unavailable ? "work-unavailable" : ""}">${esc(label)}${workCostMarkup(workCost, availability)}</button>`;
}

function formWorkButton(label, { wp = 0, focus = 0, wpInput = "", focusInput = "", primary = false, disabled = false } = {}) {
  const cost = { wp, focus };
  const availability = workAvailability(cost);
  return `<button ${disabled || availability.unavailable ? "disabled" : ""} data-base-disabled="${disabled}" ${wpInput ? `data-wp-cost-input="${esc(wpInput)}"` : `data-wp-cost="${wp}"`} ${focusInput ? `data-focus-cost-input="${esc(focusInput)}"` : `data-focus-cost="${focus}"`} data-wp-operation="true" class="${primary ? "primary" : ""} ${availability.unavailable ? "work-unavailable" : ""}">${esc(label)}${workCostMarkup(cost, availability)}</button>`;
}

function pageHeading(title, description) {
  return `<header class="page-heading"><div><p class="eyebrow">${esc(pageSectionLabel(page))}</p><h2>${esc(title)}</h2></div><p>${esc(description)}</p></header>`;
}

function isPageAvailable(pageId, snapshot = state) {
  return availablePages(snapshot).has(pageId);
}

function unlockedPageMessage(beforeState, afterState) {
  const unlocked = newlyAvailablePages(beforeState, afterState).map((pageId) => PAGE_NAMES[pageId]);
  return unlocked.length ? ` 新功能已开放：${unlocked.join("、")}。` : "";
}

function formatSaveTime(value) {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return "时间暂时无法读取";
  try {
    const parts = Object.fromEntries(new Intl.DateTimeFormat("zh-CN", {
      timeZone: state.timezone,
      year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
    }).formatToParts(timestamp).filter((part) => part.type !== "literal").map((part) => [part.type, part.value]));
    return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}:${parts.second}（${state.timezone}）`;
  } catch {
    return `${new Date(timestamp).toISOString().replace("T", " ").replace(/\.\d{3}Z$/, " UTC")}`;
  }
}

function saveSummary() {
  const unlockedPlots = state.plots.filter((plot) => plot.unlocked).length;
  const growingPlots = state.plots.filter((plot) => plot.unlocked && plot.crop).length;
  const processing = state.processing.batches.filter((batch) => ["pending", "started"].includes(batch.status)).length;
  const construction = state.construction.filter((project) => !["complete", "cancelled"].includes(project.status)).length;
  const createdAt = formatSaveTime(state.created_at);
  const savedAt = lastSavedAt ? formatSaveTime(lastSavedAt) : "还没有保存记录";
  const savedTime = lastSavedAt ? `<time datetime="${esc(lastSavedAt)}">${esc(savedAt)}</time>` : esc(savedAt);
  return `<dl class="save-details">
    <div><dt>当前进度</dt><dd>${esc(calendarLabel(state.calendar))}（总第${state.calendar.absolute_day}日）</dd></div>
    <div><dt>上次保存</dt><dd>${savedTime}</dd></div>
    <div><dt>牧场情况</dt><dd>${state.economy.cash.toLocaleString()} G · ${unlockedPlots} 块田区 · ${state.animals.length} 只动物</dd></div>
    <div><dt>进行中的事</dt><dd>作物 ${growingPlots} · 加工 ${processing} · 建设 ${construction}</dd></div>
    <div><dt>建档时间</dt><dd><time datetime="${esc(state.created_at)}">${esc(createdAt)}</time></dd></div>
    <div class="save-id"><dt>存档编号</dt><dd><code>${esc(String(state.save_id).replace(/^save_/, ""))}</code></dd></div>
  </dl>`;
}

function itemName(id) { return ITEMS.find((item) => item.id === id)?.name ?? "未知物品"; }
function cropName(id) { return CROPS.find((crop) => crop.id === id)?.name ?? "未知作物"; }
function weatherName(id) { return WEATHER.find((weather) => weather.id === id)?.name ?? "待生成"; }
function activeBuilding(id) { return state.buildings.some((building) => building.id === id && building.status === "complete"); }

const WEATHER_GUIDANCE = Object.freeze({
  weather_sunny: { status: "偏干", tone: "warning", effect: "没有降水，空田湿度减少 18；有作物的田区还会再消耗 5 点水。", advice: "湿度可能低于 35 时，安排“需要时灌溉”。" },
  weather_cloudy: { status: "平稳", tone: "good", effect: "没有降水，空田湿度减少 10；有作物的田区还会再消耗 5 点水。", advice: "按田区湿度决定是否灌溉。" },
  weather_light_rain: { status: "补水", tone: "good", effect: "空田湿度增加 24，有作物的田区增加 19；动物心情减少 1。", advice: "通常不用提前灌溉，先看田区当前湿度。" },
  weather_heavy_rain: { status: "潮湿", tone: "warning", effect: "空田湿度增加 46，有作物的田区增加 41；动物心情减少 2，探索收获约少 20%。", advice: "不要额外灌溉，并留意湿度是否会超过 90。" },
  weather_storm: { status: "危险", tone: "danger", effect: "田区会大量增湿；未防护的生长中作物额外掉 8 点健康，无防风圈舍的动物心情减少 5。", advice: "不要额外灌溉，优先检查作物防护和圈舍防风。" },
  weather_heatwave: { status: "危险", tone: "danger", effect: "空田湿度减少 35，有作物的田区减少 40；湿度低于 45 的未防护作物额外掉 5 点健康。", advice: "提前安排“需要时灌溉”，并留意动物心情。" },
  weather_fog: { status: "有雾", tone: "neutral", effect: "空田湿度减少 6，有作物的田区减少 11；探索时遇到事件的概率提高 20%。", advice: "田区照常照料；想找事件时可以去探索。" },
  weather_snow: { status: "寒冷", tone: "neutral", effect: "空田湿度增加 11，有作物的田区增加 6；动物心情减少 1。", advice: "通常不用额外灌溉，留意动物状态。" },
  weather_blizzard: { status: "危险", tone: "danger", effect: "田区会增湿；未防护的生长中作物额外掉 5 点健康，无防风圈舍的动物心情减少 6，生病风险也会升高。", advice: "检查作物防护和圈舍防风，恶劣天气不要放牧。" },
  weather_cold_snap: { status: "危险", tone: "danger", effect: "田区会变干；没有温室且不抗寒的作物停止生长，无保温圈舍的动物心情减少 6。", advice: "检查温室和圈舍保温，留意作物是否停长。" },
});

function weatherDetails(weatherId, { tomorrow = false } = {}) {
  const guide = WEATHER_GUIDANCE[weatherId] ?? { status: "待确认", tone: "neutral", effect: "天气信息尚未生成。", advice: "更新到今天后再查看。" };
  const name = weatherName(weatherId);
  return `<details class="weather-details ${tomorrow ? "weather-tomorrow" : "weather-current"}">
    <summary><span class="weather-context">${tomorrow ? "明日" : "今天"}</span><strong class="weather-name">${esc(name)}</strong><span class="weather-state status-${guide.tone}">${guide.status}</span></summary>
    <div class="weather-detail-body"><p>${esc(guide.effect)}</p><p class="meta"><strong>建议：</strong>${esc(guide.advice)}</p></div>
  </details>`;
}

function localizeTechnicalText(value) {
  let output = String(value ?? "");
  const content = [ITEMS, CROPS, ANIMAL_SPECIES, BUILDINGS, RECIPES, REGIONS, RESIDENTS, SKILLS, WEATHER, EVENTS]
    .flatMap((entries) => entries.map((entry) => [entry.id, entry.name ?? entry.title]).filter(([, label]) => label));
  const runtime = [
    ...(state?.plots ?? []).map((entry) => [entry.plot_id, entry.name]),
    ...(state?.animals ?? []).map((entry) => [entry.id, entry.name]),
    ...(state?.housing ?? []).map((entry) => [entry.id, entry.name]),
  ];
  const replacements = [...Object.entries(COMMAND_LABELS), ...content, ...runtime]
    .filter(([key, label]) => key && label)
    .sort(([left], [right]) => right.length - left.length);
  for (const [technical, label] of replacements) output = output.replaceAll(technical, label);
  return output
    .replaceAll("action_id", "操作编号")
    .replaceAll("payload", "操作内容")
    .replaceAll("save_version", "存档版本")
    .replace(/\((?:RangeError|TypeError|SyntaxError|Error)\)/g, "")
    .replace(/:\s*/g, "：");
}

function userFacingError(error, fallback = "操作未完成，请检查当前条件后重试。") {
  const raw = String(error?.message ?? error ?? "").trim();
  if (!raw) return fallback;
  if (/invalid time zone|time zone.*invalid/i.test(raw)) return "时区无效，请输入有效的 IANA 时区，例如 Asia/Shanghai。";
  if (/unexpected token|json.*(?:parse|position)|not valid json/i.test(raw)) return "备份文件格式无效，无法读取。";
  const localized = localizeTechnicalText(raw).trim();
  return /[\u3400-\u9fff]/.test(localized) ? localized : fallback;
}

function ledgerSummary(entry) {
  if (entry.type === "command") return `${commandLabel(entry.command_type)}已提交。`;
  if (entry.type === "daily_report") return "日结完成，状态校验已记录。";
  if (entry.type === "migration_item_replacement") return `旧版物品已等值迁移为${itemName(entry.to_item_id)}。`;
  if (entry.total !== undefined) return `${entry.total} G`;
  return localizeTechnicalText(entry.message ?? "已记录");
}

function inventoryQuantity(snapshot, itemId) {
  const lots = [snapshot.inventory.warehouse, snapshot.inventory.sale_box, snapshot.inventory.temporary]
    .flatMap((store) => store.lots)
    .filter((lot) => lot.item_id === itemId)
    .reduce((sum, lot) => sum + lot.quantity, 0);
  return lots + (snapshot.inventory.seed_cabinet.quantities[itemId] ?? 0) + (snapshot.inventory.silo.quantities[itemId] ?? 0);
}

function describeEffects(effects) {
  const descriptions = [];
  for (const effect of effects ?? []) {
    if (effect.type === "funds") descriptions.push(`资金 ${effect.amount >= 0 ? "+" : ""}${effect.amount} G`);
    if (effect.type === "item_add") descriptions.push(`${itemName(effect.item_id)} +${effect.quantity}`);
    if (effect.type === "item_remove") descriptions.push(`${itemName(effect.item_id)} -${effect.quantity}`);
    if (effect.type === "skill_xp") descriptions.push(`${byId(SKILLS, effect.skill_id).name}经验 +${effect.amount}`);
    if (effect.type === "relationship") descriptions.push(`${byId(RESIDENTS, effect.resident_id).name} 熟悉${(effect.familiarity ?? 0) >= 0 ? "+" : ""}${effect.familiarity ?? 0} / 信任${(effect.trust ?? 0) >= 0 ? "+" : ""}${effect.trust ?? 0}`);
    if (effect.type === "animal_state") descriptions.push(`${byId(ANIMAL_SPECIES, effect.species_id).name}${animalStateFieldLabel(effect.field)} ${effect.amount >= 0 ? "+" : ""}${effect.amount}`);
    if (effect.type === "work") descriptions.push(effect.amount >= 0 ? `消耗工时 ${effect.amount} WP` : `返还工时 ${Math.abs(effect.amount)} WP`);
  }
  return descriptions;
}

function describeScheduledEffect(entry) {
  if (entry.random) {
    const success = describeEffects(entry.random.success).join("、") || "记录状态";
    const failure = describeEffects(entry.random.failure).join("、") || "记录状态";
    return `第${entry.due_day}日：${Math.round(entry.random.success_probability * 100)}% ${success}；否则 ${failure}`;
  }
  return `第${entry.due_day}日：${describeEffects(entry.effects).join("、") || "记录状态"}`;
}

function announce(text) {
  if (liveAnnouncementTimer !== null) clearTimeout(liveAnnouncementTimer);
  live.textContent = "";
  liveAnnouncementTimer = null;
  if (!text) return;
  liveAnnouncementTimer = setTimeout(() => {
    live.textContent = text;
    liveAnnouncementTimer = null;
  }, 20);
}

function setMessage(text, kind = "good") {
  if (messageDismissTimer !== null) clearTimeout(messageDismissTimer);
  messageDismissTimer = null;
  const nextMessage = { text, kind };
  message = nextMessage;
  announce(text);
  if (kind !== "error") {
    messageDismissTimer = setTimeout(() => {
      if (message !== nextMessage) return;
      message = null;
      main.querySelector(".action-notice")?.remove();
      messageDismissTimer = null;
    }, 4000);
  }
}

function clearMessage() {
  if (messageDismissTimer !== null) clearTimeout(messageDismissTimer);
  messageDismissTimer = null;
  message = null;
  announce("");
}

const FOCUSABLE_SELECTOR = 'button:not(:disabled), input:not(:disabled):not([type="hidden"]), select:not(:disabled), textarea:not(:disabled), a[href], summary, [tabindex]:not([tabindex="-1"])';
const FOCUS_OWNER_SELECTOR = "[data-command], [data-special], [data-special-form]";

function normalizeFocusText(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function restorableControls(root = main) {
  if (!root) return [];
  return [...root.querySelectorAll(FOCUSABLE_SELECTOR)]
    .filter((element) => !element.closest('[hidden], [aria-hidden="true"], [inert]'));
}

function focusOwnerKey(owner) {
  if (!owner) return "";
  if (owner.id) return `id:${owner.id}`;
  const special = owner.getAttribute("data-special");
  if (special) {
    const details = ["data-event-id", "data-choice-id"]
      .map((name) => owner.getAttribute(name) ?? "")
      .join(":");
    return `special:${special}:${details}`;
  }
  const command = owner.getAttribute("data-command");
  if (command) {
    const payloadValue = owner.getAttribute("data-payload");
    const hiddenValues = [...owner.querySelectorAll('input[type="hidden"][name]')]
      .map((input) => `${input.name}=${input.value}`)
      .sort()
      .join("&");
    return `command:${command}:${payloadValue ?? hiddenValues}`;
  }
  const specialForm = owner.getAttribute("data-special-form");
  if (specialForm) return `special-form:${specialForm}`;
  return "";
}

function focusKeyFor(element, root = main) {
  if (!element || !root || (element !== root && !root.contains(element))) return null;
  if (element === root) return "main";
  if (element.id) return `id:${element.id}`;
  const owner = element.closest(FOCUS_OWNER_SELECTOR);
  const ownerKey = focusOwnerKey(owner);
  if (!ownerKey) return null;
  if (element === owner) return `${ownerKey}:owner`;
  const tag = element.tagName.toLocaleLowerCase();
  const name = element.getAttribute("name");
  if (name) return `${ownerKey}:${tag}:name:${name}`;
  const value = element.getAttribute("value") ?? "";
  return `${ownerKey}:${tag}:value:${value}:text:${normalizeFocusText(element.textContent)}`;
}

function captureRenderFocus(root = main, activeElement = document.activeElement) {
  if (!root || !activeElement || (activeElement !== root && !root.contains(activeElement))) return null;
  return { key: focusKeyFor(activeElement, root) };
}

function focusWithoutScroll(element) {
  try { element.focus({ preventScroll: true }); }
  catch { element.focus(); }
}

function revealCurrentNavigation() {
  const current = nav.querySelector('[aria-current="page"]');
  if (!current) return;
  const left = current.offsetLeft;
  const right = left + current.offsetWidth;
  if (left < nav.scrollLeft) nav.scrollLeft = Math.max(0, left - 8);
  else if (right > nav.scrollLeft + nav.clientWidth) nav.scrollLeft = right - nav.clientWidth + 8;
}

function focusPageStart({ alignMain = true } = {}) {
  focusWithoutScroll(main);
  revealCurrentNavigation();
  if (!alignMain) return;
  const mainTop = main.getBoundingClientRect().top + window.scrollY;
  const stickyHeaderHeight = siteShell.getBoundingClientRect().height;
  window.scrollTo({ top: Math.max(0, mainTop - stickyHeaderHeight - 8), behavior: "auto" });
}

function focusPageTarget(target) {
  if (!target) return;
  focusWithoutScroll(target);
  const targetTop = target.getBoundingClientRect().top + window.scrollY;
  const stickyHeaderHeight = siteShell.getBoundingClientRect().height;
  window.scrollTo({ top: Math.max(0, targetTop - stickyHeaderHeight - 12), behavior: "auto" });
}

function focusNewSaveSetup() {
  focusPageStart();
  focusWithoutScroll(main.querySelector('input[name="timezone"]') ?? main);
}

function focusSearch() {
  focusWithoutScroll(search);
  search.scrollIntoView({ block: "center", inline: "nearest", behavior: "auto" });
}

function restoreRenderFocus(context, root = main) {
  if (!context || !root) return false;
  if (context.key === "main") {
    focusWithoutScroll(root);
    return true;
  }
  const controls = restorableControls(root);
  const sameOperation = context.key ? controls.find((element) => focusKeyFor(element, root) === context.key) : null;
  focusWithoutScroll(sameOperation ?? controls[0] ?? root);
  return true;
}

function applySettings() {
  const root = document.documentElement;
  root.style.setProperty("--font-scale", String(state.settings.font_scale));
  root.style.setProperty("--line-height", String(state.settings.line_height));
  root.classList.toggle("grayscale", state.settings.grayscale);
  root.classList.toggle("high-contrast", state.settings.contrast === "high");
  root.classList.toggle("compact", state.settings.compact);
  root.classList.toggle("reduced-motion", state.settings.reduced_motion);
  document.title = state.settings.tab_title || "田园日志";
}

function renderStatus() {
  statusStrip.innerHTML = `
    <span>日期 <strong>${esc(calendarLabel(state.calendar))}</strong></span>
    <span>资金 <strong>${state.economy.cash.toLocaleString()} G</strong></span>
    <span>工时 <strong>${state.work_plan.used_wp}/${state.work_plan.capacity} WP</strong></span>
    <span>专注 <strong>${state.work_plan.used_focus}/${state.work_plan.focus_capacity}</strong></span>`;
  document.documentElement.style.setProperty("--site-shell-height", `${siteShell.getBoundingClientRect().height}px`);
}

function renderNotice() {
  if (!message) return "";
  return `<div class="notice action-notice ${message.kind === "error" ? "warning" : ""}"><span>${esc(message.text)}</span><button type="button" class="notice-dismiss" data-special="dismiss-message" aria-label="关闭提示" title="关闭提示">×</button></div>`;
}

function featureRoadmap() {
  const pages = availablePages(state);
  const items = [
    { done: pages.has("warehouse") && pages.has("market"), pages: "仓库、市场", when: "播种后开放" },
    { done: pages.has("town") && pages.has("logs"), pages: "小镇、日志", when: "进入第 2 日后开放" },
    { done: pages.has("tasks"), pages: "待办", when: "出现事件、订单或工程时开放" },
    { done: pages.has("processing"), pages: "加工", when: "修好加工坊后开放" },
  ];
  return `<ul class="unlock-list">${items.map((item) => `<li class="${item.done ? "unlock-done" : ""}"><span aria-hidden="true">${item.done ? "✓" : "○"}</span><strong>${item.pages}</strong><span>${item.done ? "已开放" : item.when}</span></li>`).join("")}</ul>`;
}

function renderOnboarding() {
  if (state.flags?.progressive_navigation !== true) return "";
  const progress = onboardingProgress(state);
  const complete = progress.planted && progress.caredForAnimal;
  if (complete) return `<details class="card feature-roadmap"><summary>接下来会开放什么？</summary>${featureRoadmap()}</details>`;

  return `<section class="card onboarding-card" aria-labelledby="onboarding-title">
    <p class="eyebrow">第一次玩</p>
    <h2 id="onboarding-title">先完成这两步</h2>
    <p>经营农场，用每天有限的 WP 种植、照顾动物、加工和赚钱。操作成功后会自动保存。</p>
    <ol class="onboarding-goals">
      <li class="${progress.planted ? "goal-done" : "goal-current"}"><span class="goal-marker" aria-hidden="true">${progress.planted ? "✓" : "1"}</span><div><strong>播种第一块田</strong><p>先种芜菁，4 个牧场日后可以收获。</p></div>${progress.planted ? '<span class="goal-state">已完成</span>' : '<button type="button" class="primary" data-special="onboarding-page" data-page-target="plots" data-focus-command="crop.plant">去播种 →</button>'}</li>
      <li class="${progress.caredForAnimal ? "goal-done" : progress.planted ? "goal-current" : "goal-locked"}"><span class="goal-marker" aria-hidden="true">${progress.caredForAnimal ? "✓" : "2"}</span><div><strong>陪一只动物</strong><p>${progress.planted ? "去看看开局自带的 3 只鸡。" : "完成播种后再做这一步。"}</p></div>${progress.caredForAnimal ? '<span class="goal-state">已完成</span>' : progress.planted ? '<button type="button" class="primary" data-special="onboarding-page" data-page-target="animals" data-focus-command="animal.interact">去陪动物 →</button>' : ""}</li>
    </ol>
    <details class="feature-roadmap" open><summary>功能会怎么开放？</summary>${featureRoadmap()}</details>
  </section>`;
}

function renderToday() {
  const tomorrowWeatherId = state.weather?.forecast?.[0]?.weather_id;
  const remainingWp = Math.max(0, state.work_plan.capacity - state.work_plan.used_wp);
  const remainingFocus = Math.max(0, state.work_plan.focus_capacity - state.work_plan.used_focus);
  const completedWork = state.work_plan.tasks.map((task) => {
    const costs = [];
    if (task.wp) costs.push(`${task.wp} WP`);
    if (task.focus) costs.push(`${task.focus} 专注`);
    const legacyPlan = task.source === "manual_plan";
    const prefix = legacyPlan ? "旧版预留" : "✓";
    const legacyAction = legacyPlan && !state.work_plan.confirmed ? commandButton("取消预留", "work.remove", { task_id: task.id }) : "";
    return `<li>${prefix} ${esc(localizeTechnicalText(task.label))} <span class="meta">${costs.join(" / ") || "未消耗资源"}${legacyPlan && state.work_plan.confirmed ? " · 明天清空" : ""}</span> ${legacyAction}</li>`;
  }).join("");
  const risks = [
    ...state.plots.filter((plot) => plot.crop && plot.crop.health < 40).map((plot) => `${plot.name}作物健康偏低`),
    ...state.animals.filter((animal) => animal.illness || animal.health < 60).map((animal) => `${animal.name}${animal.illness ? "出现异常" : "健康偏低"}`),
    ...state.inventory.anomalies.filter((entry) => entry.status === "must_resolve").map((entry) => `${itemName(entry.item_id)}溢出${entry.quantity}件`),
  ];
  const events = state.events.active.map((active) => {
    const event = byId(EVENTS, active.event_id);
    return `<article class="card searchable">
      <h3>${active.urgent ? "[紧急] " : ""}${esc(event.title)}</h3>
      <p class="meta">注意力 ${event.attention_cost}/6 · ${active.deadline_day ? `截止牧场日${active.deadline_day}` : "无硬期限"}</p>
      <details><summary>看看详情</summary><p class="event-body">${esc(event.body)}</p></details>
      <div class="actions">${event.choices.map((choice) => `<button type="button" data-special="preview-event" data-event-id="${event.id}" data-choice-id="${choice.id}">先看看：${esc(choice.label)}</button>`).join("")}</div>
      ${eventPreview?.event_id === event.id ? `<div class="notice"><strong>会发生什么</strong><p>${esc(eventPreview.summary)}</p>${commandButton(`选择“${eventPreview.label}”`, "event.choose", { event_id: event.id, choice_id: eventPreview.choice_id }, { primary: true, workCost: eventPreview.workCost })}</div>` : ""}
    </article>`;
  }).join("");
  const financialRelief = state.flags.financial_relief_due ? `<article class="card"><h3>七日低息周转</h3><p>可取得500 G；第7牧场日一次偿还510 G，不复利。无法全额偿还时现金保持非负、剩余欠款冻结，不再加息。</p><div class="actions">${commandButton("接受周转", "finance.accept_bridge", {}, { primary: true })}${commandButton("暂不使用", "finance.decline_bridge", {})}</div></article>` : "";
  const workForecast = state.work_plan.forecast.map((entry) => `<li>未来${entry.distance}日：预计${entry.expected_wp}/${state.work_plan.capacity} WP · 收获${entry.harvest_wp} · 天气不确定性${entry.weather_uncertainty}${entry.over_capacity ? " [超载]" : ""}<br><span class="meta">${esc(entry.suggestion)}</span></li>`).join("");
  return `${pageHeading("今日", "先看看情况，再做今天最重要的事。")}
    ${renderNotice()}
    ${renderOnboarding()}
    <section class="grid" aria-label="今日摘要">
      <article class="card weather-card"><h3>天气与田区</h3>${weatherDetails(state.weather?.today_id)}<p class="weather-plots">${state.plots.filter((plot) => plot.unlocked).map((plot) => `${esc(plot.name)} 湿度${Math.round(plot.moisture)} / 肥力${Math.round(plot.fertility)}`).join("<br>")}</p>${weatherDetails(tomorrowWeatherId, { tomorrow: true })}<p class="weather-help-link"><a href="./help.html#weather" target="_blank" rel="noopener">查看完整天气说明 →</a></p></article>
      <article class="card"><h3>今日工时</h3><ul class="metric-list"><li><span>剩余工时</span><strong>${remainingWp} / ${state.work_plan.capacity} WP</strong></li><li><span>剩余专注</span><strong>${remainingFocus} / ${state.work_plan.focus_capacity}</strong></li></ul><h4 class="work-log-title">今天做过的事</h4><ul class="plain-list">${completedWork || "<li>还没有消耗工时的操作。</li>"}</ul><p class="meta">完成操作后会自动记在这里。</p></article>
      <article class="card"><h3>要留意的事</h3>${risks.length ? `<ul class="plain-list">${risks.map((risk) => `<li class="status-warning">${esc(risk)}</li>`).join("")}</ul>` : "<p class=\"status-good\">今天一切正常。</p>"}<div class="actions"><button type="button" data-special="sync">更新到今天</button>${isPageAvailable("logs") ? '<button type="button" data-special="weekly-summary">查看本周总结</button>' : ""}</div></article>
    </section>${financialRelief}<article class="card"><h3>未来3日工时预测</h3><ul class="plain-list">${workForecast}</ul></article>
    <form class="inline-form" data-command="work.set_priority"><label>托管时先做<select name="category"><option value="medical">医疗安全</option><option value="feeding">喂养</option><option value="harvest">成熟收获</option><option value="irrigation">灌溉</option><option value="construction">建设</option><option value="exploration">探索</option></select></label><label>优先值<input name="priority" type="number" min="0" max="120" value="50"></label><button>保存顺序</button></form>
    <h2>今天的事件</h2>
    <section class="grid">${events || '<p class="empty">今天没有要处理的事件。</p>'}</section>`;
}

function cropSelect(name = "crop_id") {
  return `<select name="${name}">${CROPS.map((crop) => `<option value="${crop.id}">${esc(crop.name)}（${crop.growth_days}日）</option>`).join("")}</select>`;
}

function plotMetric(name, value) {
  const rounded = Math.round(value);
  let status;
  let tone;
  let help;
  let safeStart;
  let safeEnd;

  if (name === "湿度") {
    status = rounded < 20 ? "过干" : rounded < 35 ? "偏干" : rounded <= 75 ? "适宜" : rounded <= 90 ? "偏湿" : "过湿";
    tone = rounded < 20 || rounded > 90 ? "danger" : rounded < 35 || rounded > 75 ? "warning" : "good";
    help = "35—75 最适宜；20—90 仍可生长；低于 20 或高于 90 会停长并严重掉健康。";
    safeStart = 35;
    safeEnd = 75;
  } else if (name === "肥力") {
    status = rounded >= 80 ? "充足" : rounded >= 50 ? "正常" : rounded >= 20 ? "偏低" : "不足";
    tone = rounded >= 80 ? "good" : rounded >= 50 ? "neutral" : rounded >= 20 ? "warning" : "danger";
    help = "20 以上不会因肥力额外掉健康；数值越高越有利于收获品质；空田会自然恢复到 80。";
    safeStart = 20;
    safeEnd = 100;
  } else {
    status = rounded <= 30 ? "干净" : rounded <= 60 ? "留意" : "过多";
    tone = rounded <= 30 ? "good" : rounded <= 60 ? "warning" : "danger";
    help = "60 以内不会额外掉健康；超过 60 会伤害作物；除草一次减少 30。";
    safeStart = 0;
    safeEnd = 60;
  }

  const markerPosition = Math.min(99, Math.max(1, rounded));
  return `<li class="plot-metric metric-${tone}" tabindex="0" data-help="${esc(help)}" aria-label="${esc(`${name} ${rounded}，${status}。${help}`)}">
    <span class="metric-line"><span>${name}</span><span class="metric-reading"><strong>${rounded}</strong><span class="metric-state">${status}</span></span></span>
    <span class="metric-scale" style="--metric-position: ${markerPosition}%; --safe-start: ${safeStart}%; --safe-end: ${safeEnd}%" aria-hidden="true"><span class="metric-marker"></span></span>
  </li>`;
}

function renderPlots() {
  const cards = state.plots.map((plot) => {
    const crop = plot.crop;
    const openPlotHint = isPageAvailable("town")
      ? '<a class="inline-link" href="#building-build_plot_b" data-special="go-building" data-building-id="build_plot_b">去小镇开垦 →</a>'
      : "第 2 日开放小镇后，可以在那里开垦。";
    const actions = !plot.unlocked ? `<p class="meta">尚未开垦。${openPlotHint}</p>` : crop ? `<div class="actions">
      ${commandButton("需要时灌溉", "crop.irrigate", { plot_id: plot.plot_id })}
      ${commandButton("除草", "crop.weed", { plot_id: plot.plot_id })}
      ${plot.fertility >= 100 ? '<span class="action-state status-good">肥力已满，无需施肥</span>' : commandButton("买肥料并施肥", "crop.fertilize", { plot_id: plot.plot_id, use_compost: false })}
      ${commandButton("收获", "crop.harvest", { plot_id: plot.plot_id }, { primary: ["mature", "grace", "overripe"].includes(crop.status), disabled: !["mature", "grace", "overripe"].includes(crop.status) })}
    </div>` : `<form class="inline-form" data-command="crop.plant"><input type="hidden" name="plot_id" value="${plot.plot_id}"><label>种什么${cropSelect()}</label>${formWorkButton("播种 12 格", { wp: 1, primary: true })}</form>`;
    return `<article class="card searchable"><h3>${esc(plot.name)} ${plot.unlocked ? "" : "[未开垦]"}</h3>
      <ul class="metric-list plot-metrics">${plotMetric("湿度", plot.moisture)}${plotMetric("肥力", plot.fertility)}${plotMetric("杂草", plot.weeds)}</ul>
      ${crop ? `<p class="lead">${esc(cropName(crop.crop_id))} · ${esc(cropStatusLabel(crop.status))}</p><p>进度 ${crop.growth_points} / ${byId(CROPS, crop.crop_id).growth_days} · 健康 ${Math.round(crop.health)}</p>` : plot.unlocked ? "<p>现在空着，肥力每天会恢复到80。</p>" : ""}${actions}</article>`;
  }).join("");
  const irrigable = state.plots.filter((plot) => plot.unlocked && plot.crop).map((plot) => plot.plot_id);
  const coverage = state.buildings.find((building) => building.id === "well_1")?.coverage ?? 0;
  return `${pageHeading("田区", "在这里播种、照料和收获。")}${renderNotice()}${irrigable.length ? `<article class="card"><h3>一起灌溉</h3><p>水井每天能照顾${coverage}个田区，同一天不会重复扣工时。</p><div class="actions">${commandButton("给缺水田区灌溉", "crop.irrigate_batch", { plot_ids: irrigable.slice(0, coverage) })}</div></article>` : ""}<section class="grid">${cards}</section>`;
}

function renderAnimals() {
  const animals = state.animals.map((animal) => `<article class="card searchable"><h3>${esc(animal.name)}</h3><p class="lead">${esc(byId(ANIMAL_SPECIES, animal.species_id).name)} · ${esc(animalLifeStageLabel(animal.life_stage))}</p>
    <ul class="metric-list"><li><span>健康</span><strong>${Math.round(animal.health)}</strong></li><li><span>心情</span><strong>${Math.round(animal.mood)}</strong></li><li><span>亲密</span><strong>${Math.round(animal.affinity)}</strong></li><li><span>饱食</span><strong>${Math.round(animal.satiety)}</strong></li></ul>
    <p class="meta">${animal.illness ? `身体不舒服：${esc(illnessLabel(animal.illness.id))}；治疗要80 G / 1 WP` : "身体正常"}</p><div class="actions">${animal.illness ? commandButton("治疗", "animal.treat", { animal_id: animal.id, treatment_id: "treatment_basic_care" }, { primary: true }) : ""}${commandButton("陪它玩", "animal.interact", { animal_id: animal.id })}${commandButton("送走动物", "animal.sell", { animal_id: animal.id }, { danger: `确定要送走${animal.name}吗？送走后无法撤回。` })}</div></article>`).join("");
  const housing = state.housing.map((entry) => `<article class="card"><h3>${esc(entry.name)}</h3><p>住了 ${entry.occupancy ?? state.animals.filter((animal) => animal.housing_id === entry.id).length}/${entry.capacity} · 清洁 ${Math.round(entry.cleanliness)}</p><p class="meta">保温 ${entry.insulation ? "有" : "无"} · 防风 ${entry.windproof ? "有" : "无"}</p><div class="actions">${commandButton("清理圈舍", "housing.clean", { housing_id: entry.id }, { disabled: entry.level === 0 })}${commandButton("去放牧", "housing.graze", { housing_id: entry.id }, { disabled: entry.level === 0 || !entry.grazing_allowed })}</div></article>`).join("");
  const speciesOptions = ANIMAL_SPECIES.map((species) => `<option value="${species.id}">${esc(species.name)} · ${species.purchase_price} G</option>`).join("");
  return `${pageHeading("动物", "看看它们的状态，陪伴并照顾它们。")}${renderNotice()}<section class="grid">${animals}</section><h2>购买动物</h2><article class="card"><form class="inline-form" data-command="animal.buy"><label>动物<select name="species_id">${speciesOptions}</select></label><label>名字<input name="name" required maxlength="24" value="新伙伴"></label><button>购买</button></form><p class="meta">有合适的空圈舍、容量和足够资金时才能购买。</p></article><h2>圈舍</h2><section class="grid">${housing}</section>`;
}

function aggregateLots(lots) {
  const groups = new Map();
  for (const lot of lots) {
    const key = `${lot.item_id}:${Math.floor(lot.quality / 10)}`;
    const group = groups.get(key) ?? { item_id: lot.item_id, quantity: 0, quality: 0, age: 0 };
    group.quantity += lot.quantity;
    group.quality += lot.quality * lot.quantity;
    group.age = Math.max(group.age, lot.age);
    groups.set(key, group);
  }
  return [...groups.values()].map((group) => ({ ...group, quality: group.quality / group.quantity }));
}

function renderWarehouse() {
  const groups = aggregateLots(state.inventory.warehouse.lots);
  const rows = groups.map((group) => {
    const preview = priceLots(state, [{ item_id: group.item_id, quantity: 1, quality: group.quality }]);
    const line = preview.lines[0];
    const tier = qualityTier(group.quality);
    const breakdown = line ? `预计每件 ${line.subtotal} G（已算入品质、行情和本周销量）` : "现在不能出售";
    return `<tr class="searchable"><td>${esc(itemName(group.item_id))}</td><td>${group.quantity}</td><td>${Math.round(group.quality)}（${esc(tier.name)}）</td><td>${group.age}日</td><td><p class="meta">${esc(breakdown)}</p>${commandButton("放入出售箱", "inventory.sell", { item_id: group.item_id, quantity: 1 })}</td></tr>`;
  }).join("");
  const seeds = Object.entries(state.inventory.seed_cabinet.quantities).filter(([, quantity]) => quantity > 0).map(([id, quantity]) => `<li>${esc(itemName(id))}<strong>${quantity}</strong></li>`).join("");
  const saleLots = state.inventory.sale_box.lots.map((lot) => `<li>${esc(itemName(lot.item_id))}×${lot.quantity} · 品质${Math.round(lot.quality)} ${commandButton("撤回", "inventory.retract_sale", { lot_id: lot.lot_id })}</li>`).join("");
  return `${pageHeading("仓库", "查看库存，把要卖的东西放进出售箱。")}${renderNotice()}
    <section class="grid"><article class="card"><h3>容量</h3><p class="lead">${storageUsed(state.inventory.warehouse)} / ${state.inventory.warehouse.capacity}</p><p>出售箱 ${storageUsed(state.inventory.sale_box)} / ${state.inventory.sale_box.capacity} · 临时区 ${storageUsed(state.inventory.temporary)} / ${state.inventory.temporary.capacity}</p></article>
    <article class="card"><h3>种子柜</h3><ul class="metric-list">${seeds || "<li>没有种子</li>"}</ul></article><article class="card"><h3>料仓</h3><p class="lead">饲料 ${state.inventory.silo.quantities.item_feed ?? 0} / ${state.inventory.silo.capacity}</p></article></section>
    <h2>出售箱（次日日结到账）</h2><article class="card"><ul class="plain-list">${saleLots || "<li>出售箱为空。</li>"}</ul></article>
    <h2>仓库物品</h2><div class="card table-wrap"><table><thead><tr><th>物品</th><th>数量</th><th>品质</th><th>存放天数</th><th>操作</th></tr></thead><tbody>${rows || '<tr><td colspan="5">仓库里还没有产品。</td></tr>'}</tbody></table></div>`;
}

function renderProcessing() {
  const unlocked = state.processing.queue_capacity > 0;
  const recipeCards = RECIPES.map((recipe) => `<article class="card searchable"><h3>${esc(recipe.name)}</h3><p>${recipe.inputs.map((input) => `${esc(itemName(input.item_id))}×${input.quantity}`).join(" + ")} → ${recipe.outputs.map((output) => `${esc(itemName(output.item_id))}×${output.quantity}`).join(" + ")}</p><p class="meta">花费 ${recipe.operation_cost} G · 需要 ${recipe.duration_days} 天</p><div class="actions">${commandButton("开始加工", "processing.queue", { recipe_id: recipe.id }, { disabled: !unlocked })}</div></article>`).join("");
  const batches = state.processing.batches.map((batch) => `<li>${esc(byId(RECIPES, batch.recipe_id).name)} · ${esc(processingStatusLabel(batch.status))} · 剩余${batch.remaining_days}日 ${["pending", "started"].includes(batch.status) ? commandButton("取消", "processing.cancel", { batch_id: batch.id }) : ""}</li>`).join("");
  return `${pageHeading("加工", "选好配方，把原料做成更值钱的商品。")}${renderNotice()}${unlocked ? "" : '<p class="notice warning">加工坊还没修好。去“小镇”的建设区修复它。</p>'}<article class="card"><h3>正在加工 ${state.processing.batches.filter((batch) => ["pending", "started"].includes(batch.status)).length}/${state.processing.queue_capacity}</h3><ul class="plain-list">${batches || "<li>现在没有加工任务。</li>"}</ul></article><h2>可以做什么</h2><section class="grid">${recipeCards}</section>`;
}

function renderMarket() {
  const orderRows = state.orders.filter((order) => ["offered", "accepted"].includes(order.status)).map((order) => `<tr class="searchable"><td>${esc(itemName(order.item_id))}×${order.quantity}</td><td>${Math.round(order.reward_multiplier * 100)}%</td><td>第${order.deadline_day}日</td><td>${esc(orderStatusLabel(order.status))}${order.status === "accepted" ? ` · 已留出${order.reserved_quantity ?? 0}/${order.quantity}` : ""}</td><td><div class="actions">${order.status === "offered" ? commandButton("接单", "order.accept", { order_id: order.id }) : commandButton("给订单补货", "order.reserve", { order_id: order.id })}${commandButton("交付", "order.deliver", { order_id: order.id })}${commandButton("放弃", "order.abandon", { order_id: order.id })}</div></td></tr>`).join("");
  const salePreview = aggregateLots(state.inventory.sale_box.lots).map((group) => {
    const quote = priceLots(state, [{ item_id: group.item_id, quantity: group.quantity, quality: group.quality }]);
    return `<li>${esc(itemName(group.item_id))}×${group.quantity}：预计到账 <strong>${quote.total} G</strong></li>`;
  }).join("");
  const marketItems = [...new Set([...state.inventory.warehouse.lots, ...state.inventory.sale_box.lots].map((lot) => lot.item_id))];
  const trend = marketItems.map((itemId) => {
    const quote = priceLots(state, [{ item_id: itemId, quantity: 1, quality: 50 }]);
    const line = quote.lines[0];
    return `<li>${esc(itemName(itemId))}：本周价格 ×${line.market_multiplier} · 已卖${line.previous_week_quantity}件 · 下一件约${line.subtotal} G</li>`;
  }).join("");
  return `${pageHeading("市场", "买种子和饲料，也可以看价格、接订单。")}${renderNotice()}
    <section class="grid"><article class="card"><h3>购买种子</h3><form class="inline-form" data-command="market.buy_seed"><label>作物${cropSelect()}</label><label>数量<input name="quantity" type="number" min="1" max="120" value="12"></label><button>购买</button></form></article>
    <article class="card"><h3>购买饲料</h3><form class="inline-form" data-command="market.buy_feed"><label>数量<input name="quantity" type="number" min="1" max="120" value="21"></label><button>购买</button></form><p class="meta">每份10 G；自动托管最多用现有资金的30%，一次补到7天用量。</p></article></section>
    <section class="grid"><article class="card"><h3>预计卖多少钱</h3><ul class="plain-list">${salePreview || "<li>出售箱还是空的。先去仓库放入商品。</li>"}</ul></article><article class="card"><h3>本周价格</h3><ul class="plain-list">${trend || "<li>还没有可以查看价格的商品。</li>"}</ul></article></section>
    <h2>本周订单</h2><div class="card table-wrap"><table><thead><tr><th>要什么</th><th>奖励</th><th>截止</th><th>状态</th><th>操作</th></tr></thead><tbody>${orderRows || '<tr><td colspan="5">本周还没有订单。每周一最多会来3个。</td></tr>'}</tbody></table></div>`;
}

function renderTown() {
  const giftOptions = aggregateLots(state.inventory.warehouse.lots.filter((lot) => !lot.reserved_for && !byId(ITEMS, lot.item_id).tags.includes("unique"))).map((group) => `<option value="${group.item_id}">${esc(itemName(group.item_id))} × ${group.quantity}</option>`).join("");
  const residents = RESIDENTS.map((resident) => {
    const relation = state.residents[resident.id];
    const locked = state.calendar.absolute_day < resident.unlock_day;
    return `<article class="card searchable"><h3>${esc(resident.name)} · ${esc(resident.role)}</h3><p>熟悉 ${relation.familiarity} · 信任 ${relation.trust}</p><p class="meta">${locked ? `第${resident.unlock_day}日认识` : `本周增加：熟悉${relation.weekly_familiarity_gain}/12 · 信任${relation.weekly_trust_gain}/8；已送礼${relation.gifts_this_week}/2`}</p><div class="actions">${commandButton("聊一聊", "resident.talk", { resident_id: resident.id }, { disabled: locked })}</div>${locked || !giftOptions ? "" : `<form class="inline-form" data-command="resident.gift"><input type="hidden" name="resident_id" value="${resident.id}"><label>送什么<select name="item_id">${giftOptions}</select></label><button>送礼物</button></form>`}</article>`;
  }).join("");
  const latestEncounter = state.exploration.latest_encounter;
  const encounterActive = latestEncounter && state.events.active.some((active) => active.event_id === latestEncounter.event_id && active.status === "pending");
  const encounter = encounterActive ? byId(EVENTS, latestEncounter.event_id) : null;
  const encounterCard = encounter ? `<article class="card notice" aria-label="本次探索事件"><h3>发现：${esc(encounter.title)}</h3><p class="meta">${esc(byId(REGIONS, latestEncounter.region_id).name)} · 已放进待办</p><p class="event-body">${esc(encounter.body)}</p><div class="actions">${encounter.choices.map((choice) => `<button type="button" data-special="preview-event" data-event-id="${encounter.id}" data-choice-id="${choice.id}">先看看：${esc(choice.label)}</button>`).join("")}</div>${eventPreview?.event_id === encounter.id ? `<div class="notice"><strong>会发生什么</strong><p>${esc(eventPreview.summary)}</p>${commandButton(`选择“${eventPreview.label}”`, "event.choose", { event_id: encounter.id, choice_id: eventPreview.choice_id }, { primary: true, workCost: eventPreview.workCost })}</div>` : ""}</article>` : "";
  const regions = REGIONS.map((region) => `<article class="card searchable"><h3>${esc(region.name)}</h3><p>${esc(region.description)}</p><div class="actions">${commandButton("探索", "exploration.run", { region_id: region.id })}</div></article>`).join("");
  const projects = BUILDINGS.map((building) => {
    const project = state.construction.find((entry) => entry.building_id === building.id && !["cancelled"].includes(entry.status));
    const complete = activeBuilding(building.id);
    const investedToday = project?.last_invest_day === state.calendar.absolute_day ? project.invested_today ?? 0 : 0;
    const investMaximum = project ? Math.min(4 - investedToday, project.total_wp - project.invested_wp) : 0;
    const investFocus = project?.last_invest_day === state.calendar.absolute_day ? 0 : 1;
    return `<article id="building-${esc(building.id)}" class="card searchable jump-target" tabindex="-1"><h3>${esc(building.name)}</h3><p>${building.cost.toLocaleString()} G · 共需${building.work_required} WP</p><p class="meta">${complete ? "已经建好" : project ? `${constructionStatusLabel(project.status)} ${project.invested_wp}/${project.total_wp} WP；今天已投${investedToday}/4 WP` : "还没开始"}</p><div class="actions">${!complete && !project ? commandButton("开始建设", "building.start", { building_id: building.id }) : ""}${project && ["planned", "started"].includes(project.status) && investMaximum > 0 ? `<form class="inline-form" data-command="building.invest"><input type="hidden" name="building_id" value="${building.id}"><label>投入多少WP<input name="wp" type="number" min="1" max="${investMaximum}" value="${investMaximum}"></label>${formWorkButton("投入工时", { wp: investMaximum, focus: investFocus, wpInput: "wp" })}</form>` : ""}${project && !["complete", "cancelled"].includes(project.status) ? commandButton("取消建设", "building.cancel", { building_id: building.id }, { danger: `确定要取消“${building.name}”吗？退款会按当前进度计算。` }) : ""}</div></article>`;
  }).join("");
  return `${pageHeading("小镇", "找居民聊聊，也可以去探索或建设。")}${renderNotice()}<h2>居民</h2><section class="grid">${residents}</section><h2>去探索</h2>${encounterCard}<section class="grid">${regions}</section><h2>建设</h2><section class="grid">${projects}</section>`;
}

function renderTasks() {
  const activeEvents = state.events.active.map((active) => `<li><strong>${esc(byId(EVENTS, active.event_id).title)}</strong> · ${active.deadline_day ? `截止第${active.deadline_day}日` : "无硬期限"}</li>`).join("");
  const orders = state.orders.filter((order) => ["offered", "accepted"].includes(order.status)).map((order) => `<li>${esc(itemName(order.item_id))}×${order.quantity} · 截止第${order.deadline_day}日</li>`).join("");
  const construction = state.construction.filter((project) => !["cancelled", "complete"].includes(project.status)).map((project) => `<li>${esc(byId(BUILDINGS, project.building_id).name)} · ${project.invested_wp}/${project.total_wp} WP</li>`).join("");
  return `${pageHeading("待办", "要处理的事都放在这里。")}${renderNotice()}<section class="grid"><article class="card"><h3>事件</h3><ul class="plain-list">${activeEvents || "<li>没有要处理的事件。</li>"}</ul></article><article class="card"><h3>订单</h3><ul class="plain-list">${orders || "<li>没有进行中的订单。</li>"}</ul></article><article class="card"><h3>建设</h3><ul class="plain-list">${construction || "<li>没有正在建设的项目。</li>"}</ul></article><article class="card"><h3>仓库问题</h3><ul class="plain-list">${state.inventory.anomalies.map((entry) => `<li>${esc(itemName(entry.item_id))}×${entry.quantity} · ${esc(inventoryAnomalyStatusLabel(entry.status))}</li>`).join("") || "<li>仓库一切正常。</li>"}</ul></article></section>`;
}

function renderLogs() {
  const daily = state.daily_ledgers.slice(-50).reverse().map((entry) => `<tr class="searchable"><td>${entry.day ?? "—"}</td><td>${esc(ledgerTypeLabel(entry.type))}</td><td>${esc(ledgerSummary(entry))}</td></tr>`).join("");
  const weekly = state.weekly_reports.slice().reverse().map((report) => `<li>第${report.week_block + 1}周 · 赚了${report.income} G · 余额${report.cash} G · 用掉${Math.round(report.work_utilization * 100)}%工时</li>`).join("");
  const annual = state.annual_reports.slice().reverse().map((report) => `<li>第${report.year}年 · 赚了${report.total_income} G · 花了${report.total_expenses} G · 净收入${report.net_cash_flow} G · 余额${report.cash} G</li>`).join("");
  return `${pageHeading("日志", "看看最近做了什么、赚了多少钱。")}${renderNotice()}<section class="grid"><article class="card"><h3>每周总结</h3><ul class="plain-list">${weekly || "<li>第7天后会有第一份总结。</li>"}</ul></article><article class="card"><h3>每年总结</h3><ul class="plain-list">${annual || "<li>过完84个牧场日后会有年度总结。</li>"}</ul></article></section><h2>最近记录</h2><div class="card table-wrap"><table><thead><tr><th>第几天</th><th>类型</th><th>发生了什么</th></tr></thead><tbody>${daily || '<tr><td colspan="3">还没有记录。</td></tr>'}</tbody></table></div>`;
}

function renderSettings() {
  return `${pageHeading("设置", "调整显示、时间和备份。")}${renderNotice()}
    <section class="grid"><article class="card"><h3>显示</h3><form data-special-form="settings" class="inline-form">
      <label><input type="checkbox" name="grayscale" ${state.settings.grayscale ? "checked" : ""}> 黑白显示</label>
      <label><input type="checkbox" name="compact" ${state.settings.compact ? "checked" : ""}> 紧凑布局</label>
      <label><input type="checkbox" name="reduced_motion" ${state.settings.reduced_motion ? "checked" : ""}> 减少动态</label>
      <label>对比度<select name="contrast"><option value="normal" ${state.settings.contrast === "normal" ? "selected" : ""}>标准</option><option value="high" ${state.settings.contrast === "high" ? "selected" : ""}>高对比</option></select></label>
      <label>字体<input name="font_scale" type="number" min="0.8" max="1.5" step="0.1" value="${state.settings.font_scale}"></label>
      <label>行距<input name="line_height" type="number" min="1.2" max="2.2" step="0.1" value="${state.settings.line_height}"></label>
      <label>浏览器标签标题<input name="tab_title" value="${esc(state.settings.tab_title)}"></label><button>保存</button></form></article>
    <article class="card"><h3>时间</h3><p>当前时区 ${esc(state.timezone)} · 每天 ${state.rollover_hour}:00 刷新</p><form data-command="timezone.migrate" class="inline-form"><label>新时区<input name="timezone" value="${esc(state.timezone)}"></label><input type="hidden" name="now" value="${Date.now()}"><button>更改时区</button></form><p class="meta">改过后要等84个牧场日才能再改，日期不会重复。</p></article>
    <article class="card"><h3>版本更新</h3><p>当前版本 <strong>${esc(APP_VERSION)}</strong></p><p class="meta">${availableUpdate ? `发现 ${esc(availableUpdate.version)}：${esc(availableUpdate.notes ?? "包含新的功能和修复。")} 存档会保留。` : `更新只替换程序，当前浏览器里的存档会保留。${esc(APP_RELEASE_NOTES)}`}</p><div class="actions"><button type="button" data-special="check-update">检查更新</button>${availableUpdate ? '<button type="button" class="primary" data-special="apply-update">更新到最新版</button>' : ""}</div></article>
    <article class="card"><h3>备份</h3>${recoveryDiagnostic ? '<p class="notice warning">两个本机存档都打不开。原文件没有被改动；请先导出诊断，再决定是否新建。</p>' : ""}<div class="actions backup-actions"><button type="button" data-special="export">${recoveryDiagnostic ? "导出诊断" : "导出备份"}</button><button type="button" data-special="choose-import">导入备份</button><input id="import-save" type="file" accept="application/json,.json" hidden></div><p class="meta">导入前会检查文件，并保留导入前的存档。</p></article>
    <article class="card"><h3>当前存档</h3>${saveSummary()}<p class="meta save-reset-note">创建新存档会替换现在的进度，建议先导出备份。</p><button type="button" class="danger" data-special="reset" data-danger="确认创建全新存档？请先导出当前存档；浏览器中的当前进度将被替换。">创建新存档</button></article></section>`;
}

function render(focusContext = captureRenderFocus()) {
  applySettings();
  renderStatus();
  const pages = availablePages(state);
  if (!pages.has(page)) page = "today";
  for (const button of nav.querySelectorAll("button")) {
    const available = pages.has(button.dataset.page);
    button.hidden = !available;
    button.setAttribute("aria-current", available && button.dataset.page === page ? "page" : "false");
  }
  revealCurrentNavigation();
  const renderers = { today: renderToday, plots: renderPlots, animals: renderAnimals, warehouse: renderWarehouse, processing: renderProcessing, market: renderMarket, town: renderTown, tasks: renderTasks, logs: renderLogs, settings: renderSettings };
  main.innerHTML = renderers[page]();
  filterCurrentPage();
  restoreRenderFocus(focusContext);
}

function assignShortcuts() {
  for (const element of main.querySelectorAll("[data-shortcut]")) {
    delete element.dataset.shortcut;
    element.removeAttribute("aria-keyshortcuts");
  }
  const targets = [...main.querySelectorAll("button:not(:disabled), a[href]")]
    .filter((element) => !element.closest("[hidden]"))
    .slice(0, 9);
  targets.forEach((element, index) => {
    element.dataset.shortcut = String(index + 1);
    element.setAttribute("aria-keyshortcuts", String(index + 1));
  });
}

async function confirmAction(text) {
  dialogMessage.textContent = text;
  dialog.showModal();
  return new Promise((resolve) => dialog.addEventListener("close", () => resolve(dialog.returnValue === "confirm"), { once: true }));
}

function normalizeForm(form) {
  const output = Object.fromEntries(new FormData(form));
  for (const key of ["quantity", "wp", "focus", "now", "font_scale", "line_height"]) if (output[key] !== undefined) output[key] = Number(output[key]);
  if (output.priority !== undefined) output.priority = Number(output.priority);
  return output;
}

function saveAndRender(focusContext = captureRenderFocus()) {
  lastSavedAt = store.save(state).written_at;
  render(focusContext);
}

async function runCommand(type, data, danger = null, focusContext = captureRenderFocus()) {
  try {
    if (danger && !(await confirmAction(danger))) return;
    const commandPayload = { ...data };
    if (danger) commandPayload.confirmed = true;
    const beforeState = state;
    const result = executeCommand(state, { action_id: randomToken(), type, payload: commandPayload });
    state = result.state;
    const encounter = result.receipt.result?.event;
    const resultMessage = encounter ? `发现“${encounter.title}”，已经放进待办。` : `${commandLabel(type)}完成了，已经保存。`;
    setMessage(`${resultMessage}${unlockedPageMessage(beforeState, state)}`);
    saveAndRender(focusContext);
  } catch (error) {
    setMessage(userFacingError(error), "error");
    render(focusContext);
  }
}

function filterCurrentPage() {
  const query = search.value.trim().toLocaleLowerCase();
  for (const element of main.querySelectorAll(".searchable")) element.hidden = Boolean(query) && !element.textContent.toLocaleLowerCase().includes(query);
  assignShortcuts();
}

nav.addEventListener("click", (event) => {
  const button = event.target.closest("[data-page]");
  if (!button || !isPageAvailable(button.dataset.page)) return;
  const pageWasScrolled = window.scrollY > 1;
  page = button.dataset.page;
  clearMessage();
  render(null);
  focusPageStart({ alignMain: pageWasScrolled });
});

updateEntry.addEventListener("click", applyAvailableUpdate);

main.addEventListener("click", async (event) => {
  const command = event.target.closest("[data-command]");
  if (command && command.tagName === "BUTTON") {
    const focusContext = captureRenderFocus(main, command);
    await runCommand(command.dataset.command, JSON.parse(decodeURIComponent(command.dataset.payload)), command.dataset.danger ?? null, focusContext);
    return;
  }
  const special = event.target.closest("[data-special]");
  if (!special) return;
  const focusContext = captureRenderFocus(main, special);
  if (special.dataset.special === "check-update") {
    await checkForUpdate({ announceResult: true });
    render(focusContext);
    return;
  }
  if (special.dataset.special === "apply-update") {
    applyAvailableUpdate();
    return;
  }
  if (special.dataset.special === "dismiss-message") {
    clearMessage();
    special.closest(".action-notice")?.remove();
    focusWithoutScroll(main);
    return;
  }
  if (special.dataset.special === "onboarding-page") {
    const targetPage = special.dataset.pageTarget;
    if (!isPageAvailable(targetPage)) return;
    page = targetPage;
    clearMessage();
    render(null);
    const command = special.dataset.focusCommand;
    const target = main.querySelector(`form[data-command="${command}"] button, button[data-command="${command}"]`);
    focusPageTarget(target ?? main);
    return;
  }
  if (special.dataset.special === "sync") {
    try {
      const beforeState = state;
      const result = synchronizeCommand(state, Date.now());
      state = result.state;
      const resultMessage = result.locked ? result.reason : result.advanced ? `已经过了${result.active_days}个活跃日，休整了${result.rest_days}日。` : "已经是今天，不用重复更新。";
      setMessage(`${resultMessage}${unlockedPageMessage(beforeState, state)}`, result.locked ? "error" : "good");
      saveAndRender(focusContext);
    } catch (error) { setMessage(userFacingError(error, "现实日期核对失败，请稍后重试。"), "error"); render(focusContext); }
  }
  if (special.dataset.special === "weekly-summary") {
    if (!isPageAvailable("logs")) { setMessage("日志会在第 2 日开放。", "good"); render(focusContext); return; }
    page = "logs"; setMessage("已打开本周总结。", "good"); render(null); focusPageStart();
  }
  if (special.dataset.special === "export") {
    const blob = new Blob([recoveryDiagnostic ? store.exportDiagnostics() : store.export(state)], { type: "application/json" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `farm-journal-${state.save_id}.json`;
    link.click();
    URL.revokeObjectURL(link.href);
    setMessage("备份已经导出。", "good"); render(focusContext);
  }
  if (special.dataset.special === "choose-import") document.querySelector("#import-save")?.click();
  if (special.dataset.special === "go-building") {
    event.preventDefault();
    if (!isPageAvailable("town")) { setMessage("小镇会在第 2 日开放。", "good"); render(focusContext); return; }
    page = "town";
    clearMessage();
    render(null);
    focusPageTarget(document.getElementById(`building-${special.dataset.buildingId}`));
  }
  if (special.dataset.special === "preview-event") {
    try {
      const eventId = special.dataset.eventId;
      const choiceId = special.dataset.choiceId;
      const preview = previewEventChoice(state, eventId, choiceId);
      const event = byId(EVENTS, eventId);
      const choice = event.choices.find((entry) => entry.id === choiceId);
      const changes = [];
      const cashDelta = preview.economy.cash - state.economy.cash;
      if (cashDelta) changes.push(`资金 ${cashDelta > 0 ? "+" : ""}${cashDelta} G`);
      const wpDelta = preview.work_plan.used_wp - state.work_plan.used_wp;
      const focusDelta = preview.work_plan.used_focus - state.work_plan.used_focus;
      if (wpDelta > 0) changes.push(`消耗工时 ${wpDelta} WP`);
      else if (wpDelta < 0) changes.push(`返还工时 ${Math.abs(wpDelta)} WP`);
      if (focusDelta > 0) changes.push(`消耗专注 ${focusDelta}`);
      else if (focusDelta < 0) changes.push(`返还专注 ${Math.abs(focusDelta)}`);
      for (const item of ITEMS) {
        const quantityDelta = inventoryQuantity(preview, item.id) - inventoryQuantity(state, item.id);
        if (quantityDelta) changes.push(`${item.name} ${quantityDelta > 0 ? "+" : ""}${quantityDelta}`);
      }
      for (const skill of SKILLS) {
        const xpDelta = preview.skills[skill.id].xp - state.skills[skill.id].xp;
        if (xpDelta) changes.push(`${skill.name}经验 ${xpDelta > 0 ? "+" : ""}${xpDelta}`);
      }
      const scheduled = preview.events.scheduled_effects.slice(state.events.scheduled_effects.length);
      for (const entry of scheduled) changes.push(`延迟结果：${describeScheduledEffect(entry)}`);
      for (const animal of state.animals) {
        const after = preview.animals.find((entry) => entry.id === animal.id);
        if (after && after.health !== animal.health) changes.push(`${animal.name}健康 ${after.health - animal.health > 0 ? "+" : ""}${after.health - animal.health}`);
      }
      for (const resident of RESIDENTS) {
        const before = state.residents[resident.id]; const after = preview.residents[resident.id];
        if (after.trust !== before.trust || after.familiarity !== before.familiarity) changes.push(`${resident.name} 熟悉${after.familiarity - before.familiarity >= 0 ? "+" : ""}${after.familiarity - before.familiarity} / 信任${after.trust - before.trust >= 0 ? "+" : ""}${after.trust - before.trust}`);
      }
      eventPreview = {
        event_id: eventId,
        choice_id: choiceId,
        label: choice.label,
        summary: changes.join("；") || "此选择只记录可追溯的观察与记忆，不立即扣除资源。",
        workCost: wpDelta > 0 || focusDelta > 0 ? { wp: Math.max(0, wpDelta), focus: Math.max(0, focusDelta) } : null,
      };
      setMessage(`先看看结果：${eventPreview.summary}。确认后才会执行。`, "good");
      render(focusContext);
    } catch (error) { setMessage(userFacingError(error, "无法生成事件预览，请稍后重试。"), "error"); render(focusContext); }
  }
  if (special.dataset.special === "reset") {
    if (!(await confirmAction(special.dataset.danger))) return;
    renderNewSaveSetup("替换当前进度前，请重新确认锁定时区与刷新点；提交后才会覆盖存档。", null);
    focusNewSaveSetup();
  }
});

main.addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.target;
  const focusContext = captureRenderFocus(main, event.submitter ?? document.activeElement);
  if (form.dataset.command) {
    await runCommand(form.dataset.command, normalizeForm(form), null, focusContext);
    return;
  }
  if (form.dataset.specialForm === "new-save") {
    try {
      const options = validateNewSaveOptions(form.elements.timezone.value, form.elements.rollover_hour.value);
      state = createNewSave({ now: Date.now(), ...options, save_seed: randomToken() });
      state.flags.progressive_navigation = true;
      recoveryDiagnostic = false; page = "today";
      setMessage(`新存档已创建：${options.timezone}，每日${options.rollover_hour}:00刷新。`, "good");
      saveAndRender(null);
      focusPageStart();
    } catch (error) {
      const errorMessage = userFacingError(error, "无法创建新存档，请检查时区与刷新点。" );
      setMessage(errorMessage, "error");
      renderNewSaveSetup(errorMessage, null);
      focusNewSaveSetup();
    }
    return;
  }
  if (form.dataset.specialForm === "settings") {
    const data = normalizeForm(form);
    data.grayscale = form.elements.grayscale.checked;
    data.compact = form.elements.compact.checked;
    data.reduced_motion = form.elements.reduced_motion.checked;
    await runCommand("settings.update", data, null, focusContext);
  }
});

main.addEventListener("input", (event) => {
  const form = event.target.closest("form");
  if (!form) return;
  for (const button of form.querySelectorAll('[data-wp-operation="true"]')) {
    const wpInput = button.dataset.wpCostInput ? form.elements.namedItem(button.dataset.wpCostInput) : null;
    const focusInput = button.dataset.focusCostInput ? form.elements.namedItem(button.dataset.focusCostInput) : null;
    const wp = wpInput ? Number(wpInput.value) : Number(button.dataset.wpCost ?? 0);
    const focus = focusInput ? Number(focusInput.value) : Number(button.dataset.focusCost ?? 0);
    const availability = workAvailability({ wp, focus });
    button.disabled = button.dataset.baseDisabled === "true" || availability.unavailable;
    button.classList.toggle("work-unavailable", availability.unavailable);
    const cost = button.querySelector(".action-cost");
    if (cost) {
      cost.textContent = availability.text;
      cost.classList.toggle("shortage", availability.unavailable);
    }
  }
});

main.addEventListener("change", async (event) => {
  if (event.target.id !== "import-save" || !event.target.files[0]) return;
  const focusContext = captureRenderFocus(main, event.target);
  try {
    const result = store.import(await event.target.files[0].text());
    if (!result.state) throw new Error(result.error);
    state = result.state;
    recoveryDiagnostic = false;
    setMessage("备份已经导入。", "good"); saveAndRender(focusContext);
  } catch { setMessage(IMPORT_FAILURE_MESSAGE, "error"); render(focusContext); }
});

search.addEventListener("input", filterCurrentPage);
window.addEventListener("resize", () => document.documentElement.style.setProperty("--site-shell-height", `${siteShell.getBoundingClientRect().height}px`));
document.addEventListener("keydown", (event) => {
  if (dialog.open) return;
  const editing = ["INPUT", "TEXTAREA", "SELECT"].includes(document.activeElement?.tagName);
  if (event.key === "Escape" && (!editing || document.activeElement === search)) {
    event.preventDefault();
    if (document.activeElement === search) search.value = "";
    page = "today";
    clearMessage();
    render(null);
    focusPageStart();
    return;
  }
  if (event.key === "/" && !editing) { event.preventDefault(); focusSearch(); }
  if (!editing && event.key.toLowerCase() === "g") { page = "today"; clearMessage(); render(null); focusPageStart(); }
  if (!editing && event.key.toLowerCase() === "l") {
    if (isPageAvailable("logs")) { page = "logs"; clearMessage(); render(null); focusPageStart(); }
    else { setMessage("日志会在第 2 日开放。", "good"); render(); }
  }
  if (!editing && /^[1-9]$/.test(event.key)) {
    const target = main.querySelector(`[data-shortcut="${event.key}"]`);
    if (target) {
      event.preventDefault();
      target.focus();
      announce(`已选择快捷项 ${event.key}：${target.textContent.trim()}。按 Enter 确认。`);
    }
  }
});

function initialize() {
  void checkForUpdate();
  const loaded = store.load();
  if (loaded.state) {
    state = loaded.state;
    lastSavedAt = loaded.written_at ?? null;
    if (loaded.recovered) setMessage("当前槽损坏，已从另一完整槽恢复。", "error");
  } else if (loaded.empty) {
    state = createNewSave({ now: Date.now(), save_seed: "new-save-setup" });
    state.read_only_recovery = true;
    renderNewSaveSetup();
    return;
  } else {
    state = createNewSave({ now: Date.now(), save_seed: "recovery-diagnostic-session" });
    state.read_only_recovery = true;
    recoveryDiagnostic = true;
    setMessage("两个存档槽均无法读取，原始数据已保留。请在设置页导出恢复诊断。", "error");
  }
  if (recoveryDiagnostic) { render(); return; }
  try {
    const synchronized = synchronizeCommand(state, Date.now());
    state = synchronized.state;
    if (synchronized.advanced) setMessage(`回归结算完成：活跃${synchronized.active_days}日，休整${synchronized.rest_days}日。`);
    lastSavedAt = store.save(state).written_at;
  } catch (error) {
    state.read_only_recovery = true;
    setMessage(RECOVERY_FAILURE_MESSAGE, "error");
  }
  render();
}

initialize();
