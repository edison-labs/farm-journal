import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { canonicalStateDigest, createNewSave, restoreRecoveryPoint } from "../src/core/state.js";
import { synchronizeToNow, migrateTimezone } from "../src/core/clock.js";
import { executeCommand } from "../src/core/engine.js";
import { advanceOffline } from "../src/core/day.js";
import { calendarFromAbsolute, canonicalStringify, compressText, deepClone, rolloverDateKey, sha256 } from "../src/core/utils.js";
import { migrateSave } from "../src/persistence/migrations.js";
import { MemoryStorage, QuotaStorage, SaveStore, storageFootprint } from "../src/persistence/store.js";

const make = (now = Date.parse("2026-03-07T11:00:00Z"), timezone = "UTC") => createNewSave({ now, timezone, save_seed: "time-save", save_id: "save_time" });

test("TC-005 05:00刷新边界与84次有效推进准确进入第2年春1", () => {
  const beforeRollover = Date.parse("2026-03-07T04:30:00Z");
  const rolloverState = make(beforeRollover);
  assert.equal(synchronizeToNow(rolloverState, Date.parse("2026-03-07T04:59:59Z")).advanced, 0);
  const afterRollover = synchronizeToNow(rolloverState, Date.parse("2026-03-07T05:00:00Z"));
  assert.equal(afterRollover.advanced, 1);
  assert.equal(afterRollover.state.calendar.absolute_day, 2);
  assert.deepEqual(calendarFromAbsolute(85), { absolute_day: 85, year: 2, season: "spring", season_day: 1, week_block: 12 });
  const result = advanceOffline(make(), 7);
  let state = result.state;
  for (let block = 0; block < 11; block += 1) state = advanceOffline(state, 7).state;
  assert.equal(state.calendar.absolute_day, 85);
  assert.equal(state.calendar.year, 2);
  assert.equal(state.calendar.season, "spring");
  assert.equal(state.calendar.season_day, 1);
});

test("TC-006 小于6小时回拨不推进，达到6小时锁定", () => {
  const state = make();
  const small = synchronizeToNow(state, state.last_trusted_time - 5 * 3600000);
  assert.equal(small.locked, false);
  assert.equal(small.state.calendar.absolute_day, 1);
  const large = synchronizeToNow(state, state.last_trusted_time - 6 * 3600000);
  assert.equal(large.locked, true);
  assert.equal(large.state.clock.status, "locked_rollback");
});

test("TC-007 系统时间前跳按牧场日期差推进且同一now不重复推进", () => {
  const state = make(Date.parse("2026-03-07T11:00:00Z"));
  const now = Date.parse("2026-03-10T11:00:00Z");
  const first = synchronizeToNow(state, now);
  assert.equal(first.advanced, 3);
  assert.equal(first.active_days, 3);
  assert.equal(first.rest_days, 0);
  assert.equal(first.state.calendar.absolute_day, 4);
  const repeated = synchronizeToNow(first.state, now);
  assert.equal(repeated.advanced, 0);
  assert.equal(repeated.state.calendar.absolute_day, 4);
});

test("TC-008 DST按锁定时区日期键推进，不按24小时秒数", () => {
  const start = Date.parse("2026-03-07T11:00:00Z");
  const state = make(start, "America/New_York");
  const after = Date.parse("2026-03-09T10:00:00Z");
  const result = synchronizeToNow(state, after);
  assert.equal(result.advanced, 2);
  assert.equal(result.state.calendar.absolute_day, 3);
  assert.equal(rolloverDateKey(after, "America/New_York", 5), "2026-03-09");
});

test("TC-047 >7日只活跃模拟7日且同一now重复打开不再模拟", () => {
  const state = make(Date.parse("2026-03-01T06:00:00Z"));
  const now = Date.parse("2026-03-13T06:00:00Z");
  const first = synchronizeToNow(state, now);
  assert.equal(first.active_days, 7);
  assert.equal(first.rest_days, 5);
  const second = synchronizeToNow(first.state, now);
  assert.equal(second.advanced, 0);
  assert.equal(second.state.calendar.absolute_day, first.state.calendar.absolute_day);
});

test("TC-008 时区迁移不推进日期并有84牧场日冷却", () => {
  const state = make();
  const migrated = migrateTimezone(state, "Asia/Dubai", state.last_trusted_time + 1000);
  assert.equal(migrated.calendar.absolute_day, 1);
  assert.equal(migrated.timezone, "Asia/Dubai");
  assert.throws(() => migrateTimezone(migrated, "UTC", migrated.last_trusted_time + 1000), /84牧场日/);
});

test("TC-048 双槽提交指针在故障时保留完整旧态", () => {
  const storage = new MemoryStorage();
  const store = new SaveStore(storage, "test");
  const first = make();
  store.save(first);
  const second = structuredClone(first);
  second.economy.cash = 999;
  assert.throws(() => store.save(second, { failpoint: "after-slot-write" }), /模拟/);
  const loaded = store.load();
  assert.equal(loaded.state.economy.cash, 2400);
  assert.equal(loaded.read_only, false);
});

test("TC-048 损坏当前槽回退另一完整槽", () => {
  const storage = new MemoryStorage();
  const store = new SaveStore(storage, "fallback");
  const first = make();
  store.save(first);
  const second = structuredClone(first); second.economy.cash = 2000;
  store.save(second);
  const pointer = storage.getItem("fallback:pointer");
  storage.setItem(`fallback:slot:${pointer}`, "{broken");
  const loaded = store.load();
  assert.equal(loaded.state.economy.cash, 2400);
  assert.equal(loaded.recovered, true);
});

test("TC-049 内部预发布v0→v1迁移并保留未知模块", async () => {
  const legacy = JSON.parse(await readFile(new URL("../fixtures/saves/internal-v0.json", import.meta.url), "utf8"));
  const migrated = migrateSave(legacy);
  assert.equal(migrated.save_version, 1);
  assert.equal(migrated.economy.cash, 1777);
  assert.equal(migrated.modules.unknown_future_module.state.opaque_value, "preserve-me");
  assert.equal(migrated.flags.migrated_from_internal_v0, true);
  assert.equal(migrated.inventory.warehouse.lots[0].item_id, "item_feed");
  assert.equal(migrated.inventory.warehouse.lots[0].quantity, 3);
  assert.equal(migrated.daily_ledgers.some((entry) => entry.type === "migration_item_replacement" && entry.historical_value === 30), true);
});

test("TC-051 未知及关闭模块日结、导出导入前后字节等价保留", () => {
  const state = make();
  state.modules.unknown_future_module = { enabled: false, state: { opaque_value: "preserve-me", entities: [{ id: "future_1", energy: 77 }] } };
  state.modules.feature_breeding.state = { animals: [{ id: "gene_1", value: "AA" }] };
  const beforeUnknown = JSON.stringify(state.modules.unknown_future_module);
  const beforeDisabled = JSON.stringify(state.modules.feature_breeding);
  const settled = advanceOffline(state, 1).state;
  assert.equal(JSON.stringify(settled.modules.unknown_future_module), beforeUnknown);
  assert.equal(JSON.stringify(settled.modules.feature_breeding), beforeDisabled);
  const store = new SaveStore(new MemoryStorage(), "module-preserve");
  const imported = store.import(store.export(settled)).state;
  assert.equal(JSON.stringify(imported.modules.unknown_future_module), beforeUnknown);
  assert.equal(JSON.stringify(imported.modules.feature_breeding), beforeDisabled);
});

test("TC-050 导出导入校验和及篡改拒绝", () => {
  const store = new SaveStore(new MemoryStorage(), "export");
  const state = make();
  const raw = store.export(state);
  assert.equal(store.import(raw).state.save_id, state.save_id);
  const doc = JSON.parse(raw); doc.state.economy.cash += 1;
  assert.throws(() => store.import(JSON.stringify(doc)), /校验和/);
});

test("TC-048 保留7日/4周/1年初紧凑恢复点并可还原哈希", () => {
  let state = make();
  for (let block = 0; block < 12; block += 1) state = advanceOffline(state, 7).state;
  assert.equal(state.recovery_points.length, 7);
  assert.equal(state.recovery_archive.weekly.length, 4);
  assert.equal(state.recovery_archive.year_start.length, 1);
  const point = state.recovery_archive.year_start[0];
  const restored = restoreRecoveryPoint(state, point);
  assert.equal(canonicalStateDigest(restored), point.state_hash);
  assert.equal(restored.calendar.absolute_day, point.day);
  assert.ok(JSON.stringify(state).length < 3_500_000, "84日存档应显著低于常见5MiB配额");
  for (let block = 0; block < 12; block += 1) state = advanceOffline(state, 7).state;
  assert.ok(JSON.stringify(state).length < 4_500_000, "168日存档仍应留出localStorage信封空间");
});

test("TC-048 导入前完整提交槽原始备份不会被连续自动保存覆盖", () => {
  const storage = new MemoryStorage();
  const store = new SaveStore(storage, "backup-import");
  const original = make();
  store.save(original);
  const originalSlots = { a: storage.getItem("backup-import:slot:a"), b: storage.getItem("backup-import:slot:b") };
  const incoming = make(); incoming.save_id = "save_incoming"; incoming.economy.cash = 1999;
  const imported = store.import(store.export(incoming));
  assert.equal(imported.state.save_id, "save_incoming");
  store.save(imported.state); store.save(imported.state); store.save(imported.state);
  const backup = store.latestBackup();
  assert.equal(backup.reason, "pre-import");
  const originalPointer = backup.pointer;
  assert.equal(originalPointer === "a" ? backup.slot_a_raw : backup.slot_b_raw, originalPointer === "a" ? originalSlots.a : originalSlots.b);
  assert.equal(backup.committed_raw_checksum, sha256(originalPointer === "a" ? originalSlots.a : originalSlots.b));
  assert.equal(JSON.parse(store.exportLatestBackup()).reason, "pre-import");
});

test("TC-050 迁移失败先持久备份且原槽字节完全不变", () => {
  const storage = new MemoryStorage();
  const store = new SaveStore(storage, "migration-fail");
  const unsupported = make(); unsupported.save_version = 2;
  const payload = { sequence: 1, written_at: new Date(unsupported.last_trusted_time).toISOString(), state: unsupported };
  const raw = JSON.stringify({ ...payload, checksum: sha256(canonicalStringify(payload)) });
  storage.setItem("migration-fail:slot:a", raw);
  storage.setItem("migration-fail:pointer", "a");
  const loaded = store.load();
  assert.equal(loaded.state, null);
  assert.equal(loaded.read_only, true);
  assert.equal(storage.getItem("migration-fail:slot:a"), raw);
  assert.equal(store.latestBackup().slot_a_raw, raw);
});

test("TC-048 真实5MiB双槽加受限原始备份可保存5年并逐点恢复", () => {
  let state = make();
  for (let day = 0; day < 419; day += 1) state = advanceOffline(state, 1, { weather_id: "weather_cloudy" }).state;
  const storage = new QuotaStorage(5 * 1024 * 1024);
  const store = new SaveStore(storage, "quota-five-years");
  const settleStarted = performance.now();
  const day421 = advanceOffline(state, 1, { weather_id: "weather_cloudy" }).state;
  const settleMs = performance.now() - settleStarted;
  state = day421;
  const saveStarted = performance.now();
  store.save(state); store.save(state); store.preserveRawBackup("five-year-quota-test");
  const saveMs = performance.now() - saveStarted;
  const footprint = storageFootprint(storage);
  const slotABytes = new TextEncoder().encode(storage.getItem("quota-five-years:slot:a") ?? "").length;
  const slotBBytes = new TextEncoder().encode(storage.getItem("quota-five-years:slot:b") ?? "").length;
  assert.ok(footprint < 5 * 1024 * 1024);
  assert.ok(settleMs < 2000, `第421日单步日结耗时应低于2秒，实际${settleMs.toFixed(1)}ms`);
  assert.ok(saveMs < 3000, `五年态双槽与备份保存应低于3秒，实际${saveMs.toFixed(1)}ms`);
  assert.equal(store.load().state.calendar.absolute_day, 421);
  const points = [...state.recovery_points, ...state.recovery_archive.weekly, ...state.recovery_archive.year_start];
  assert.equal(points.length, 12);
  for (const point of points) assert.equal(canonicalStateDigest(restoreRecoveryPoint(state, point)), point.state_hash);
  const sharedPoints = points.filter((point) => point.snapshot_format === "shared_history_v2" && point.history_cursors.daily_ledgers > 0);
  const minimumLedgerIndex = Math.min(...sharedPoints.map((point) => point.history_cursors.daily_ledger_total - point.history_cursors.daily_ledgers));
  assert.equal(state.recovery_ledger_chunks.every((chunk) => chunk.start_index + chunk.count > minimumLedgerIndex), true);
  assert.equal(state.recovery_ledger_chunks.reduce((sum, chunk) => sum + chunk.count, 0) <= 256, true);
  assert.equal(store.latestBackup().reason, "five-year-quota-test");
  const slotsBeforeReplacement = store.rawSlots();
  store.preserveRawBackup("five-year-replacement");
  assert.ok(storageFootprint(storage) < 5 * 1024 * 1024);
  assert.deepEqual(store.rawSlots(), slotsBeforeReplacement);
  assert.equal(store.latestBackup().reason, "five-year-replacement");
  const incoming = structuredClone(state); incoming.save_id = "quota_imported";
  assert.equal(store.import(store.export(incoming)).state.save_id, "quota_imported");
  assert.ok(storageFootprint(storage) < 5 * 1024 * 1024);
  assert.ok(footprint > 0);
  assert.ok(slotABytes > 0 && slotBBytes > 0);
});

test("TC-009/TC-048 恢复点保留当时action_id收据窗口和幂等语义", () => {
  let state = make();
  const command = { action_id: "receipt-before-recovery", type: "market.buy_feed", payload: { quantity: 1 } };
  state = executeCommand(state, command).state;
  state = advanceOffline(state, 1, { weather_id: "weather_cloudy" }).state;
  const point = state.recovery_points.at(-1);
  const restored = restoreRecoveryPoint(state, point);
  const duplicate = executeCommand(restored, command);
  assert.equal(duplicate.duplicate, true);
  assert.equal(duplicate.state.economy.cash, restored.economy.cash);
});

test("TC-048 内部预发布self_contained_v2恢复点保持只读兼容", () => {
  const state = make();
  const legacySnapshot = deepClone({ ...state, rng_audit: [], recovery_points: [], recovery_archive: { weekly: [], year_start: [] } });
  delete legacySnapshot.recovery_ledger_chunks;
  const legacyDigestState = deepClone({ ...legacySnapshot, rng_audit: [], action_receipts: {}, recovery_points: [], recovery_archive: { weekly: [], year_start: [] } });
  const point = {
    snapshot_format: "self_contained_v2",
    day: 1,
    state_hash: sha256(canonicalStringify(legacyDigestState)),
    history_cursors: { daily_ledgers: 0, weekly_reports: 0, annual_reports: 0, rng_audit: 0, action_receipt_ids: [], farm_day: 1 },
    state_compressed: compressText(JSON.stringify(legacySnapshot)),
  };
  const restored = restoreRecoveryPoint(state, point);
  assert.equal(restored.calendar.absolute_day, 1);
  assert.deepEqual(restored.recovery_points, []);
});
