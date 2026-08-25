import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { executeCommand } from "../src/core/engine.js";
import { createNewSave } from "../src/core/state.js";
import { MemoryStorage, SaveStore } from "../src/persistence/store.js";
import { ALL_PAGE_IDS, availablePages, onboardingProgress } from "../src/presentation/progression.js";

test("UI主路径：十页文案、关键操作、WP提示和玩法说明保持简单可用", async () => {
  const [html, app, labels, help, styles, build] = await Promise.all([
    readFile(new URL("../index.html", import.meta.url), "utf8"),
    readFile(new URL("../src/presentation/app.js", import.meta.url), "utf8"),
    readFile(new URL("../src/presentation/labels.js", import.meta.url), "utf8"),
    readFile(new URL("../help.html", import.meta.url), "utf8"),
    readFile(new URL("../src/presentation/styles.css", import.meta.url), "utf8"),
    readFile(new URL("../scripts/build.mjs", import.meta.url), "utf8"),
  ]);

  for (const page of ["今日", "田区", "动物", "仓库", "加工", "市场", "小镇", "待办", "日志", "设置"]) {
    assert.match(html, new RegExp(`data-page="[^"]+"[^>]*>${page}<`), `${page}入口必须存在`);
  }
  for (const copy of [
    "先看看情况，再做今天最重要的事。",
    "在这里播种、照料和收获。",
    "看看它们的状态，陪伴并照顾它们。",
    "查看库存，把要卖的东西放进出售箱。",
    "选好配方，把原料做成更值钱的商品。",
    "买种子和饲料，也可以看价格、接订单。",
    "找居民聊聊，也可以去探索或建设。",
    "要处理的事都放在这里。",
    "看看最近做了什么、赚了多少钱。",
    "调整显示、时间和备份。",
  ]) assert.ok(app.includes(copy), `缺少主路径文案：${copy}`);

  for (const action of [
    "更新到今天", "查看本周总结", "保存顺序",
    "需要时灌溉", "买肥料并施肥", "播种 12 格", "给缺水田区灌溉",
    "治疗", "陪它玩", "送走动物", "清理圈舍", "去放牧",
    "放入出售箱", "撤回", "开始加工", "接单", "给订单补货",
    "聊一聊", "送礼物", "开始建设", "投入工时", "取消建设",
    "保存", "更改时区", "导出备份",
  ]) assert.ok(app.includes(action), `缺少简单操作名：${action}`);

  for (const workCopy of ["今日工时", "剩余工时", "剩余专注", "今天做过的事", "完成操作后会自动记在这里。", "取消预留"]) {
    assert.ok(app.includes(workCopy), `今日工时缺少：${workCopy}`);
  }
  assert.doesNotMatch(app, /data-command="work\.assign"/);
  assert.doesNotMatch(app, /data-command="work\.confirm"/);
  for (const removedCopy of ["要做什么", "整理经营记录", "加到安排里", "确认安排"]) assert.equal(app.includes(removedCopy), false, `已移除的手动日程仍在页面：${removedCopy}`);
  assert.match(help, /看看做过哪些事，以及还剩多少 WP 和专注/);
  assert.match(app, /function weatherDetails\(weatherId, \{ tomorrow = false \} = \{\}\)/);
  assert.match(app, /class="weather-details \$\{tomorrow \? "weather-tomorrow" : "weather-current"\}"/);
  assert.match(app, /href="\.\/help\.html#weather"[^>]*>查看完整天气说明 →<\/a>/);
  assert.match(styles, /\.weather-details summary \{[^}]*display: flex;/);
  assert.match(styles, /\.weather-details summary::after \{ content: "查看影响";/);
  assert.match(help, /<section id="weather">[\s\S]*晴朗[\s\S]*多云[\s\S]*小雨[\s\S]*大雨[\s\S]*风暴[\s\S]*高温[\s\S]*雾[\s\S]*小雪[\s\S]*暴雪[\s\S]*寒潮/);
  for (const weatherId of ["sunny", "cloudy", "light_rain", "heavy_rain", "storm", "heatwave", "fog", "snow", "blizzard", "cold_snap"]) {
    assert.match(app, new RegExp(`weather_${weatherId}:`), `缺少天气说明：${weatherId}`);
  }

  for (const oldCopy of [
    "阅读日报、处理异常", "以田区为单位批量", "每只动物都有稳定身份",
    "满仓不会静默丢物品", "确认排产时锁定", "渠道倍率",
    "按期限集中展示", "结算哈希", "校验和和版本",
    "核对现实日期", "条件灌溉", "购买肥料并施用", "安排批次",
    "接受并保留现有批次", "拜访交谈", "确认今日基础日程",
  ]) assert.equal(app.includes(oldCopy), false, `旧文案仍在玩家界面：${oldCopy}`);

  assert.match(app, /data-wp-operation="true"/);
  assert.match(styles, /\.action-cost \{[^}]*display: inline-flex;[^}]*border: 0;[^}]*border-radius: 999px;[^}]*font-weight: 800;/);
  assert.doesNotMatch(styles, /\.action-cost \{[^}]*text-decoration: underline;/);
  assert.match(app, /return costs\.length \? `需 \$\{costs\.join\(" \/ "\)\}`/);
  assert.match(app, /工时不足 · 还差 \$\{missingWp\} WP/);
  assert.match(app, /plot\.fertility >= 100 \? '<span class="action-state status-good">肥力已满，无需施肥<\/span>'/);
  assert.match(styles, /\.action-state \{[^}]*min-height: 2\.4rem;[^}]*background: var\(--accent-soft\);/);
  assert.match(app, /availability\.unavailable \? "work-unavailable"/);
  assert.match(styles, /button\.work-unavailable:disabled \{[^}]*opacity: 1;[^}]*border-color: var\(--danger\);/);
  assert.match(styles, /\.action-cost\.shortage \{[^}]*color: var\(--danger\);/);
  assert.match(app, /class="notice action-notice \$\{message\.kind === "error" \? "warning" : ""\}"/);
  assert.doesNotMatch(app, /class="notice action-notice[^>]*role=/);
  assert.match(styles, /\.action-notice \{[^}]*position: fixed;[^}]*--site-shell-height/);
  assert.doesNotMatch(app, /(?:action_id|save_seed): crypto\.randomUUID\(\)/);
  assert.match(app, /function randomToken\(\)[\s\S]*crypto\?\.randomUUID[\s\S]*crypto\?\.getRandomValues/);
  assert.match(html, /<div id="site-shell" class="site-shell">[\s\S]*?<header class="site-header">[\s\S]*?<nav id="main-nav"/);
  assert.match(styles, /\.site-shell \{[^}]*position: sticky;[^}]*top: 0;[^}]*z-index: 8;/);
  assert.doesNotMatch(styles, /\.main-nav \{[^}]*position: sticky;/);
  assert.match(app, /stickyHeaderHeight = siteShell\.getBoundingClientRect\(\)\.height/);
  assert.match(app, /pageWasScrolled = window\.scrollY > 1/);
  assert.match(app, /href="#building-build_plot_b"[^>]*data-special="go-building"[^>]*>去小镇开垦 →<\/a>/);
  assert.match(app, /id="building-\$\{esc\(building\.id\)\}" class="card searchable jump-target" tabindex="-1"/);
  assert.match(app, /special\.dataset\.special === "go-building"[\s\S]*page = "town"[\s\S]*focusPageTarget/);
  assert.match(styles, /\.jump-target:focus \{[^}]*outline: 2px solid var\(--accent\);/);
  for (const status of ["适宜", "偏干", "过湿", "充足", "正常", "不足", "干净", "留意", "过多"]) {
    assert.ok(app.includes(status), `田区数值缺少状态：${status}`);
  }
  for (const threshold of ["35—75 最适宜", "20 以上不会因肥力额外掉健康", "超过 60 会伤害作物"]) {
    assert.ok(app.includes(threshold), `田区数值缺少范围说明：${threshold}`);
  }
  assert.match(app, /class="plot-metric metric-\$\{tone\}" tabindex="0" data-help=/);
  assert.match(styles, /\.metric-scale \{[^}]*linear-gradient/);
  assert.match(styles, /\.metric-state \{[^}]*color: var\(--metric-color\);[^}]*font-weight: 800;/);
  assert.match(styles, /\.plot-metric:hover::after, \.plot-metric:focus-visible::after \{ display: block; \}/);
  for (const saveLabel of ["当前存档", "当前进度", "上次保存", "牧场情况", "进行中的事", "建档时间", "存档编号"]) {
    assert.ok(app.includes(saveLabel), `存档概况缺少：${saveLabel}`);
  }
  assert.match(styles, /\.save-details > div \{[^}]*grid-template-columns:/);
  assert.match(app, /class="actions backup-actions"[\s\S]*data-special="export"[\s\S]*data-special="choose-import"[\s\S]*id="import-save"[^>]*hidden/);
  assert.match(app, /special\.dataset\.special === "choose-import"[\s\S]*#import-save/);
  assert.match(styles, /\.backup-actions button \{[^}]*min-width: 8\.5rem;[^}]*text-align: center;/);
  const saveState = createNewSave({ now: Date.parse("2026-08-20T04:00:00Z"), timezone: "Asia/Dubai", save_seed: "ui-main-save", save_id: "save_ui_main" });
  const saveStore = new SaveStore(new MemoryStorage(), "ui-main");
  const expectedSavedAt = "2026-08-24T18:45:12.000Z";
  assert.equal(saveStore.save(saveState, { now: Date.parse(expectedSavedAt) }).written_at, expectedSavedAt);
  assert.equal(saveStore.load().written_at, expectedSavedAt);
  assert.match(html, /aria-label="打开玩法说明（新窗口）"/);
  for (const section of ["quick-start", "unlocking", "resources", "weather", "pages", "day-change", "controls", "saving"]) {
    assert.match(help, new RegExp(`id="${section}"`), `玩法说明缺少章节：${section}`);
  }
  for (const copy of ["第一次玩", "先完成这两步", "播种第一块田", "陪一只动物", "功能会怎么开放？"]) {
    assert.ok(app.includes(copy), `新手引导缺少：${copy}`);
  }
  assert.match(app, /state\.flags\.progressive_navigation = true/);
  assert.match(app, /button\.hidden = !available/);
  assert.match(app, /新功能已开放：/);
  assert.match(app, /function focusNewSaveSetup\(\)[\s\S]*focusPageStart\(\);[\s\S]*input\[name="timezone"\]/);
  assert.match(app, /special\.dataset\.special === "reset"[\s\S]*renderNewSaveSetup\([^;]+, null\);[\s\S]*focusNewSaveSetup\(\);/);
  assert.match(app, /新存档已创建：[\s\S]*saveAndRender\(null\);[\s\S]*focusPageStart\(\);/);

  const legacyState = createNewSave({ now: Date.parse("2026-08-20T04:00:00Z"), timezone: "Asia/Dubai", save_seed: "legacy-navigation", save_id: "legacy_navigation" });
  assert.deepEqual([...availablePages(legacyState)], [...ALL_PAGE_IDS], "旧存档应保留全部页面");

  let guidedState = createNewSave({ now: Date.parse("2026-08-20T04:00:00Z"), timezone: "Asia/Dubai", save_seed: "guided-navigation", save_id: "guided_navigation" });
  guidedState.flags.progressive_navigation = true;
  assert.deepEqual([...availablePages(guidedState)].sort(), ["animals", "plots", "settings", "today"], "新存档只显示起步页面");
  assert.deepEqual(onboardingProgress(guidedState), { planted: false, caredForAnimal: false });

  guidedState = executeCommand(guidedState, { action_id: "guide-plant", type: "crop.plant", payload: { plot_id: "plot_a", crop_id: "crop_turnip" } }).state;
  assert.equal(availablePages(guidedState).has("warehouse"), true);
  assert.equal(availablePages(guidedState).has("market"), true);
  assert.equal(availablePages(guidedState).has("town"), false);
  assert.deepEqual(onboardingProgress(guidedState), { planted: true, caredForAnimal: false });

  guidedState = executeCommand(guidedState, { action_id: "guide-animal", type: "animal.interact", payload: { animal_id: "animal_hen_amber" } }).state;
  assert.deepEqual(onboardingProgress(guidedState), { planted: true, caredForAnimal: true });
  guidedState.calendar.absolute_day = 2;
  assert.equal(availablePages(guidedState).has("town"), true);
  assert.equal(availablePages(guidedState).has("logs"), true);
  assert.match(help, /按钮上会直接写明要花多少 WP/);
  assert.match(labels, /today: "先看看今天"/);
  assert.match(build, /\["index\.html", "help\.html", "README\.md", "src"\]/);
});
