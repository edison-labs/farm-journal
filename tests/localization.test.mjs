import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  ANIMAL_LIFE_STAGE_LABELS,
  ANIMAL_STATE_FIELD_LABELS,
  COMMAND_LABELS,
  CONSTRUCTION_STATUS_LABELS,
  CROP_STATUS_LABELS,
  ILLNESS_LABELS,
  INVENTORY_ANOMALY_STATUS_LABELS,
  LEDGER_TYPE_LABELS,
  ORDER_STATUS_LABELS,
  PAGE_SECTION_LABELS,
  PROCESSING_STATUS_LABELS,
  animalLifeStageLabel,
  commandLabel,
  constructionStatusLabel,
  cropStatusLabel,
  illnessLabel,
  inventoryAnomalyStatusLabel,
  ledgerTypeLabel,
  orderStatusLabel,
  pageSectionLabel,
  processingStatusLabel,
} from "../src/presentation/labels.js";
import { validateNewSaveOptions } from "../src/core/new-save.js";
import { createNewSave } from "../src/core/state.js";
import { migrateTimezone } from "../src/core/clock.js";
import { SaveStore, MemoryStorage } from "../src/persistence/store.js";
import { takeItems } from "../src/rules/inventory.js";

const hasChinese = (value) => /[\u3400-\u9fff]/.test(value);

test("界面中文映射完整覆盖10个页面与全部语义命令", async () => {
  const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
  const engine = await readFile(new URL("../src/core/engine.js", import.meta.url), "utf8");
  const pages = [...html.matchAll(/data-page="([^"]+)"/g)].map((match) => match[1]);
  const commands = [...engine.matchAll(/case "([^"]+)":/g)].map((match) => match[1]);

  assert.deepEqual(Object.keys(PAGE_SECTION_LABELS).sort(), [...new Set(pages)].sort());
  assert.deepEqual(Object.keys(COMMAND_LABELS).sort(), [...new Set(commands)].sort());
  for (const [key, label] of [...Object.entries(PAGE_SECTION_LABELS), ...Object.entries(COMMAND_LABELS)]) {
    assert.notEqual(label, key);
    assert.equal(hasChinese(label), true, `${key} 必须有中文显示名`);
  }
});

test("各状态域使用中文标签且未知值不回显内部枚举", () => {
  const maps = [
    CROP_STATUS_LABELS,
    ANIMAL_LIFE_STAGE_LABELS,
    ILLNESS_LABELS,
    ANIMAL_STATE_FIELD_LABELS,
    PROCESSING_STATUS_LABELS,
    ORDER_STATUS_LABELS,
    CONSTRUCTION_STATUS_LABELS,
    INVENTORY_ANOMALY_STATUS_LABELS,
    LEDGER_TYPE_LABELS,
  ];
  for (const labels of maps) for (const [key, label] of Object.entries(labels)) {
    assert.notEqual(label, key);
    assert.equal(hasChinese(label), true, `${key} 必须有中文状态名`);
  }

  const unknown = "future_internal_status";
  for (const translate of [pageSectionLabel, commandLabel, cropStatusLabel, animalLifeStageLabel, illnessLabel, processingStatusLabel, orderStatusLabel, constructionStatusLabel, inventoryAnomalyStatusLabel, ledgerTypeLabel]) {
    assert.notEqual(translate(unknown), unknown);
    assert.equal(hasChinese(translate(unknown)), true);
  }
});

test("展示层不再直接输出页面键、命令ID、状态枚举或历史命令消息", async () => {
  const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
  const source = await readFile(new URL("../src/presentation/app.js", import.meta.url), "utf8");

  assert.match(html, /田园日志 \/ 本机存档/);
  assert.doesNotMatch(html, /FARM JOURNAL|LOCAL SAVE/);
  assert.doesNotMatch(source, /page\.toUpperCase\(\)/);
  assert.doesNotMatch(source, /esc\((?:crop\.status|animal\.life_stage|animal\.illness\.id|batch\.status|order\.status|entry\.status|entry\.type)\)/);
  assert.doesNotMatch(source, /\$\{project\.status\}/);
  assert.doesNotMatch(source, /\$\{type\} 已执行并保存/);
  assert.match(source, /entry\.type === "command"[\s\S]*?commandLabel\(entry\.command_type\)/);
  assert.match(source, /ledgerTypeLabel\(entry\.type\)/);
  assert.match(source, /ledgerSummary\(entry\)/);
});

test("常见输入错误只向玩家显示中文说明", () => {
  assert.throws(() => validateNewSaveOptions("Not/A-Timezone", 5), (error) => {
    assert.match(error.message, /请输入有效的 IANA 时区/);
    assert.doesNotMatch(error.message, /RangeError/);
    return true;
  });

  const state = createNewSave({ now: Date.parse("2026-03-02T05:00:00Z"), timezone: "UTC", save_seed: "localization", save_id: "save_localization" });
  assert.throws(() => takeItems(state, "item_egg", 1), (error) => {
    assert.match(error.message, /物品不足：鸡蛋×1/);
    assert.doesNotMatch(error.message, /item_egg/);
    return true;
  });
  assert.throws(() => migrateTimezone(state, "Not/A-Timezone", Date.parse("2026-03-02T05:00:00Z")), /时区无效/);
  assert.throws(() => new SaveStore(new MemoryStorage()).import("{broken"), /备份文件格式无效，无法读取/);
});

test("损坏状态的导入与本机恢复不会向界面泄漏内部字段名", async () => {
  const source = await readFile(new URL("../src/presentation/app.js", import.meta.url), "utf8");

  assert.match(source, /const IMPORT_FAILURE_MESSAGE = "备份导入失败：文件内容无效或与当前版本不兼容。"/);
  assert.match(source, /catch \{ setMessage\(IMPORT_FAILURE_MESSAGE, "error"\)/);
  assert.match(source, /const RECOVERY_FAILURE_MESSAGE = "存档进入只读恢复：状态校验失败，请导出恢复诊断。"/);
  assert.match(source, /setMessage\(RECOVERY_FAILURE_MESSAGE, "error"\)/);
  assert.doesNotMatch(source, /备份导入失败[^\n]*userFacingError/);
  assert.doesNotMatch(source, /存档进入只读恢复：\$\{userFacingError/);
});
