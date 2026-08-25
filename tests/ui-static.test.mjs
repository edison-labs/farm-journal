import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

function focusHelpersFrom(source) {
  const start = source.indexOf("const FOCUSABLE_SELECTOR");
  const end = source.indexOf("function applySettings");
  assert.ok(start >= 0 && end > start, "focus helper block must remain discoverable");
  return Function(`${source.slice(start, end)}; return { captureRenderFocus, focusKeyFor, restoreRenderFocus };`)();
}

function fakeElement({ tagName = "BUTTON", attributes = {}, text = "", owner = null, hidden = false, hiddenInputs = [] } = {}) {
  const element = {
    tagName,
    id: attributes.id ?? "",
    textContent: text,
    name: attributes.name ?? "",
    value: attributes.value ?? "",
    focused: false,
    getAttribute(name) { return attributes[name] ?? null; },
    querySelectorAll(selector) { return selector === 'input[type="hidden"][name]' ? hiddenInputs : []; },
    closest(selector) {
      if (selector === "[data-command], [data-special], [data-special-form]") {
        if (owner) return owner;
        if (attributes["data-command"] || attributes["data-special"] || attributes["data-special-form"]) return element;
        return null;
      }
      if (selector === '[hidden], [aria-hidden="true"], [inert]') return hidden ? element : null;
      return null;
    },
    focus(options) { element.focused = true; element.focusOptions = options; },
  };
  return element;
}

function fakeRoot(controls) {
  return {
    focused: false,
    contains(element) { return controls.includes(element); },
    querySelectorAll() { return controls; },
    focus(options) { this.focused = true; this.focusOptions = options; },
  };
}

test("TC-037/TC-043 小镇UI显示探索事件并允许选择1—4WP建设投入", async () => {
  const source = await readFile(new URL("../src/presentation/app.js", import.meta.url), "utf8");
  assert.match(source, /\$\{encounterCard\}<section class="grid">\$\{regions\}/);
  assert.match(source, /探索发现：\$\{esc\(encounter\.title\)\}/);
  assert.match(source, /data-special="preview-event"/);
  assert.match(source, /inventoryQuantity\(preview, item\.id\) - inventoryQuantity\(state, item\.id\)/);
  assert.match(source, /延迟结果：\$\{describeScheduledEffect\(entry\)\}/);
  assert.match(source, /\$\{skill\.name\}经验/);
  assert.match(source, /name="wp" type="number" min="1" max="\$\{investMaximum\}"/);
  assert.doesNotMatch(source, /Math\.min\(2, 4 - investedToday/);
});

test("TC-052 数字键只聚焦可见按钮并等待Enter，模态暂停全局快捷键", async () => {
  const source = await readFile(new URL("../src/presentation/app.js", import.meta.url), "utf8");
  const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
  assert.match(source, /querySelectorAll\("button:not\(:disabled\), a\[href\]"\)/);
  assert.match(source, /!element\.closest\("\[hidden\]"\)/);
  assert.match(source, /target\.focus\(\)/);
  assert.match(source, /按 Enter 确认/);
  assert.doesNotMatch(source, /data-shortcut="\$\{event\.key\}"\]`\)\?\.click\(\)/);
  assert.match(source, /if \(dialog\.open\) return/);
  assert.match(source, /event\.key === "Escape" && \(!editing \|\| document\.activeElement === search\)/);
  assert.match(source, /if \(document\.activeElement === search\) search\.value = ""/);
  assert.match(html, /<button value="cancel" autofocus>取消<\/button>/);
  assert.match(html, /<dialog id="confirm-dialog" aria-labelledby="confirm-title" aria-describedby="confirm-message">/);
});

test("TC-053 应用内减少动态设置独立于系统偏好生效", async () => {
  const source = await readFile(new URL("../src/presentation/app.js", import.meta.url), "utf8");
  const styles = await readFile(new URL("../src/presentation/styles.css", import.meta.url), "utf8");
  assert.match(source, /root\.classList\.toggle\("reduced-motion", state\.settings\.reduced_motion\)/);
  assert.match(styles, /html\.reduced-motion \*/);
});

test("TC-053 只有一个实时播报器，失效消息可清理且相同文本可再次触发", async () => {
  const source = await readFile(new URL("../src/presentation/app.js", import.meta.url), "utf8");
  const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
  assert.equal((html.match(/role="status"/g) ?? []).length, 1);
  assert.match(html, /id="live-region"[^>]*role="status"[^>]*aria-live="polite"[^>]*aria-atomic="true"/);
  assert.doesNotMatch(source, /function renderNotice\(\)[\s\S]*?role="status"[\s\S]*?\n}/);
  assert.match(source, /function clearMessage\(\) \{[\s\S]*messageDismissTimer[\s\S]*message = null;\s*announce\(""\);\s*}/);
  assert.match(source, /setMessage\(`先看看结果：\$\{eventPreview\.summary\}。确认后才会执行。`/);

  const start = source.indexOf("function announce(text)");
  const end = source.indexOf("function setMessage(text");
  assert.ok(start >= 0 && end > start, "announce helper must remain discoverable");
  const live = { textContent: "旧消息" };
  const timers = new Map();
  let nextTimer = 0;
  const setTimeoutStub = (callback) => { const id = ++nextTimer; timers.set(id, callback); return id; };
  const clearTimeoutStub = (id) => timers.delete(id);
  const { announce } = Function("live", "setTimeout", "clearTimeout", `let liveAnnouncementTimer = null; ${source.slice(start, end)}; return { announce };`)(live, setTimeoutStub, clearTimeoutStub);
  const flush = () => {
    for (const [id, callback] of [...timers]) { timers.delete(id); callback(); }
  };

  announce("相同消息");
  assert.equal(live.textContent, "");
  flush();
  assert.equal(live.textContent, "相同消息");
  announce("相同消息");
  assert.equal(live.textContent, "");
  flush();
  assert.equal(live.textContent, "相同消息");
  announce("");
  assert.equal(live.textContent, "");
  assert.equal(timers.size, 0);
});

test("TC-053 重渲染优先恢复同一稳定操作，操作消失时聚焦首个合理控件", async () => {
  const source = await readFile(new URL("../src/presentation/app.js", import.meta.url), "utf8");
  const { captureRenderFocus, restoreRenderFocus } = focusHelpersFrom(source);

  const oldAction = fakeElement({ attributes: { "data-command": "crop.irrigate", "data-payload": "plot-a" }, text: "条件灌溉" });
  const oldRoot = fakeRoot([oldAction]);
  const context = captureRenderFocus(oldRoot, oldAction);

  const unrelated = fakeElement({ attributes: { "data-special": "sync" }, text: "核对现实日期" });
  const restoredAction = fakeElement({ attributes: { "data-command": "crop.irrigate", "data-payload": "plot-a" }, text: "条件灌溉" });
  const newRoot = fakeRoot([unrelated, restoredAction]);
  assert.equal(restoreRenderFocus(context, newRoot), true);
  assert.equal(restoredAction.focused, true);
  assert.equal(unrelated.focused, false);
  assert.deepEqual(restoredAction.focusOptions, { preventScroll: true });

  const hiddenFallback = fakeElement({ attributes: { "data-special": "sync" }, text: "不可见操作", hidden: true });
  const fallback = fakeElement({ attributes: { "data-special": "export" }, text: "导出单文件备份" });
  const fallbackRoot = fakeRoot([hiddenFallback, fallback]);
  assert.equal(restoreRenderFocus(context, fallbackRoot), true);
  assert.equal(hiddenFallback.focused, false);
  assert.equal(fallback.focused, true);

  const emptyRoot = fakeRoot([]);
  assert.equal(restoreRenderFocus(context, emptyRoot), true);
  assert.equal(emptyRoot.focused, true);
});

test("TC-053 表单保存、导入和事件预览均传递重渲染焦点上下文", async () => {
  const source = await readFile(new URL("../src/presentation/app.js", import.meta.url), "utf8");
  assert.match(source, /const focusContext = captureRenderFocus\(main, event\.submitter \?\? document\.activeElement\)/);
  assert.match(source, /runCommand\("settings\.update", data, null, focusContext\)/);
  assert.match(source, /const focusContext = captureRenderFocus\(main, event\.target\);[\s\S]*?saveAndRender\(focusContext\)/);
  assert.match(source, /special\.dataset\.special === "export"[\s\S]*?render\(focusContext\)/);
  assert.match(source, /special\.dataset\.special === "preview-event"[\s\S]*?render\(focusContext\)/);
  assert.match(source, /async function runCommand\([^)]*focusContext = captureRenderFocus\(\)\)[\s\S]*?render\(focusContext\)/);
});

test("全部会消耗WP的玩家操作在按钮内显示费用，动态输入同步更新", async () => {
  const source = await readFile(new URL("../src/presentation/app.js", import.meta.url), "utf8");
  const styles = await readFile(new URL("../src/presentation/styles.css", import.meta.url), "utf8");
  const expected = [
    "animal.interact", "animal.treat", "building.invest", "crop.fertilize", "crop.harvest",
    "crop.irrigate", "crop.irrigate_batch", "crop.plant", "crop.weed", "exploration.run",
    "housing.clean", "housing.graze", "processing.queue", "resident.talk",
  ];
  const setStart = source.indexOf("const WP_CONSUMING_COMMANDS");
  const setEnd = source.indexOf("const FIXED_WORK_COSTS");
  assert.ok(setStart >= 0 && setEnd > setStart, "WP command audit set must remain discoverable");
  const actual = Function(`${source.slice(setStart, setEnd)}; return [...WP_CONSUMING_COMMANDS].sort();`)();
  assert.deepEqual(actual, expected);

  assert.match(source, /function commandButton[\s\S]*?data-wp-operation="true"[\s\S]*?workCostMarkup\(workCost, availability\)/);
  assert.match(source, /function formWorkButton[\s\S]*?data-wp-operation="true"[\s\S]*?workCostMarkup\(cost, availability\)/);
  for (const type of ["crop.fertilize", "crop.irrigate", "crop.irrigate_batch", "housing.clean", "housing.graze", "animal.treat", "processing.queue"]) {
    assert.match(source, new RegExp(`type === "${type.replaceAll(".", "\\.")}"`), `${type} must expose its conditional cost`);
  }
  assert.match(source, /formWorkButton\("播种 12 格", \{ wp: 1, primary: true \}\)/);
  assert.doesNotMatch(source, /data-command="work\.assign"/);
  assert.doesNotMatch(source, /data-command="work\.confirm"/);
  assert.match(source, /formWorkButton\("投入工时", \{ wp: investMaximum, focus: investFocus, wpInput: "wp" \}\)/);
  assert.match(source, /main\.addEventListener\("input"[\s\S]*?cost\.textContent = availability\.text/);
  assert.match(source, /wpDelta > 0[\s\S]*?消耗工时 \$\{wpDelta\} WP[\s\S]*?workCost: wpDelta > 0 \|\| focusDelta > 0/);
  assert.match(styles, /\.action-cost \{[^}]*display: inline-flex;[^}]*border: 0;[^}]*border-radius: 999px;[^}]*font-weight: 800;[^}]*text-decoration: none;/);
});

test("页头右上角问号入口打开可访问的玩家玩法说明", async () => {
  const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
  const help = await readFile(new URL("../help.html", import.meta.url), "utf8");
  const styles = await readFile(new URL("../src/presentation/styles.css", import.meta.url), "utf8");
  const build = await readFile(new URL("../scripts/build.mjs", import.meta.url), "utf8");

  assert.match(html, /<div class="header-tools">[\s\S]*?<a class="help-link" href="\.\/help\.html" target="_blank" rel="noopener" aria-label="打开玩法说明（新窗口）" title="玩法说明"><span aria-hidden="true">\?<\/span><\/a>[\s\S]*?id="status-strip"/);
  assert.match(styles, /\.header-tools \{[^}]*justify-items: end;/);
  assert.match(styles, /\.help-link \{[^}]*border-radius: 50%;[^}]*font-weight: 800;/);
  assert.match(styles, /\.help-link:hover, \.help-link:focus-visible \{[^}]*outline: 2px solid var\(--accent\);/);
  assert.match(help, /<title>玩法说明 · 田园日志<\/title>/);
  assert.match(help, /<main id="help-content"[^>]*>[\s\S]*id="quick-start"[\s\S]*id="unlocking"[\s\S]*id="resources"[\s\S]*id="weather"[\s\S]*id="pages"[\s\S]*id="day-change"[\s\S]*id="controls"[\s\S]*id="saving"/);
  assert.match(help, /<a class="help-back" href="\.\/index\.html">返回田园日志<\/a>/);
  assert.match(build, /\["index\.html", "help\.html", "README\.md", "src"\]/);
  assert.match(build, /helpMatch[\s\S]*?玩法说明入口/);
});

test("TC-052/TC-053 页头与主导航整体固定且切页定位不被吸顶区遮挡", async () => {
  const source = await readFile(new URL("../src/presentation/app.js", import.meta.url), "utf8");
  const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
  const styles = await readFile(new URL("../src/presentation/styles.css", import.meta.url), "utf8");
  assert.match(html, /<div id="site-shell" class="site-shell">[\s\S]*?<header class="site-header">[\s\S]*?<nav id="main-nav"/);
  assert.match(styles, /\.site-shell \{[^}]*position: sticky;[^}]*top: 0;[^}]*z-index: 8;[^}]*background: var\(--paper\)/);
  assert.doesNotMatch(styles, /\.main-nav \{[^}]*position: sticky;/);
  assert.match(styles, /\.main-nav button:focus-visible \{[^}]*outline: 2px solid var\(--ink\);[^}]*outline-offset: 2px;/);
  assert.match(styles, /html \{[^}]*overflow-y: scroll;[^}]*scrollbar-gutter: stable;/);
  assert.match(styles, /main \{[^}]*min-height: calc\(100vh - 6rem\);[^}]*scroll-margin-top: 5rem;/);
  assert.match(styles, /#global-search \{ scroll-margin-top: 5rem; \}/);
  assert.match(styles, /@media \(max-width: 720px\)[\s\S]*?\.main-nav \{[^}]*flex-wrap: nowrap;[^}]*overflow-x: auto;/);
  assert.match(source, /function revealCurrentNavigation\(\) \{[\s\S]*?current\.offsetLeft;[\s\S]*?nav\.scrollLeft = right - nav\.clientWidth \+ 8;/);
  assert.match(source, /function focusPageStart\(\{ alignMain = true \} = \{\}\) \{[\s\S]*?focusWithoutScroll\(main\);[\s\S]*?revealCurrentNavigation\(\);[\s\S]*?if \(!alignMain\) return;[\s\S]*?stickyHeaderHeight = siteShell\.getBoundingClientRect\(\)\.height;[\s\S]*?window\.scrollTo\(\{ top: Math\.max\(0, mainTop - stickyHeaderHeight - 8\), behavior: "auto" \}\);/);
  assert.match(source, /function focusSearch\(\) \{[\s\S]*?focusWithoutScroll\(search\);[\s\S]*?search\.scrollIntoView\(\{ block: "center", inline: "nearest", behavior: "auto" \}\);/);
  assert.doesNotMatch(source, /main\.focus\(\)/);
  assert.match(source, /nav\.addEventListener\("click"[\s\S]*?pageWasScrolled = window\.scrollY > 1;[\s\S]*?render\(null\);\s*focusPageStart\(\{ alignMain: pageWasScrolled \}\);/);
  assert.match(source, /button\.setAttribute\("aria-current"[\s\S]*?revealCurrentNavigation\(\);[\s\S]*?main\.innerHTML/);
  assert.match(source, /event\.key\.toLowerCase\(\) === "g"[^{]*\{[^}]*focusPageStart\(\);/);
  assert.match(source, /event\.key\.toLowerCase\(\) === "l"[^{]*\{[^}]*focusPageStart\(\);/);
  assert.match(source, /event\.key === "\/" && !editing\) \{ event\.preventDefault\(\); focusSearch\(\); \}/);
});
