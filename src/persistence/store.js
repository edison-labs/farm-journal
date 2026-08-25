import { SAVE_VERSION, validateState } from "../core/state.js";
import { canonicalStringify, compressText, decompressText, deepClone, sha256 } from "../core/utils.js";
import { migrateSave } from "./migrations.js";

export class MemoryStorage {
  constructor(initial = {}) { this.data = new Map(Object.entries(initial)); }
  getItem(key) { return this.data.has(key) ? this.data.get(key) : null; }
  setItem(key, value) { this.data.set(key, String(value)); }
  removeItem(key) { this.data.delete(key); }
}

function makeEnvelope(state, sequence, now = Date.now()) {
  const payload = { sequence, written_at: new Date(now).toISOString(), state };
  return { ...payload, checksum: sha256(canonicalStringify(payload)) };
}

function parseEnvelope(raw) {
  if (!raw) throw new Error("存档槽为空");
  const envelope = JSON.parse(raw);
  const payload = { sequence: envelope.sequence, written_at: envelope.written_at, state: envelope.state };
  const expected = sha256(canonicalStringify(payload));
  if (expected !== envelope.checksum) throw new Error("存档校验和不匹配");
  if (!Number.isInteger(payload.state?.save_version)) throw new Error("存档缺少save_version");
  return { ...envelope, source_version: payload.state.save_version };
}

function decodeEnvelope(raw) {
  const envelope = parseEnvelope(raw);
  const payload = { state: envelope.state };
  const migrated = migrateSave(payload.state);
  validateState(migrated);
  return { ...envelope, state: migrated };
}

export function storageFootprint(storage) {
  const entries = storage?.data instanceof Map
    ? [...storage.data]
    : Object.keys(storage ?? {}).map((key) => [key, storage.getItem(key)]);
  return entries.reduce((sum, [key, value]) => sum + 2 * (String(key).length + String(value ?? "").length), 0);
}

export class QuotaStorage extends MemoryStorage {
  constructor(quotaBytes = 5 * 1024 * 1024, initial = {}) { super(initial); this.quotaBytes = quotaBytes; }
  setItem(key, value) {
    const previous = this.getItem(key);
    super.setItem(key, value);
    if (storageFootprint(this) > this.quotaBytes) {
      if (previous === null) super.removeItem(key); else super.setItem(key, previous);
      const error = new Error(`本地存储配额不足（上限${this.quotaBytes}字节）`);
      error.name = "QuotaExceededError";
      throw error;
    }
  }
}

export class SaveStore {
  constructor(storage = globalThis.localStorage, prefix = "farm-journal") {
    if (!storage) throw new Error("当前环境没有可用本地存储");
    this.storage = storage;
    this.prefix = prefix;
  }

  key(name) { return `${this.prefix}:${name}`; }

  rawSlots() {
    return {
      pointer: this.storage.getItem(this.key("pointer")),
      slot_a_raw: this.storage.getItem(this.key("slot:a")),
      slot_b_raw: this.storage.getItem(this.key("slot:b")),
    };
  }

  preserveRawBackup(reason) {
    const slots = this.rawSlots();
    if (!slots.slot_a_raw && !slots.slot_b_raw) return null;
    const committed = slots.pointer === "a" || slots.pointer === "b" ? slots.pointer : slots.slot_a_raw ? "a" : "b";
    const committedRaw = committed === "a" ? slots.slot_a_raw : slots.slot_b_raw;
    const sequence = Number(this.storage.getItem(this.key("backup:sequence")) ?? 0) + 1;
    const backup = {
      format: "farm-journal-raw-backup-v3", sequence, reason, captured_at: new Date().toISOString(), pointer: slots.pointer,
      committed_slot: committed,
      committed_raw_compressed: committedRaw ? compressText(committedRaw) : null,
      committed_raw_checksum: committedRaw ? sha256(committedRaw) : null,
      fallback_checksum: committed === "a" ? (slots.slot_b_raw ? sha256(slots.slot_b_raw) : null) : (slots.slot_a_raw ? sha256(slots.slot_a_raw) : null),
    };
    const raw = JSON.stringify(backup);
    // A fixed replacement key prevents a temporary two-backup peak under the
    // browser's small localStorage quota.  setItem is atomic for one key; if it
    // fails, the previously exported backup and both save slots remain intact.
    this.storage.setItem(this.key("backup:current"), raw);
    try { this.storage.setItem(this.key("backup:sequence"), String(sequence)); }
    catch (error) { throw new Error(`备份内容已安全写入，但序列元数据更新失败: ${error.message}`); }
    return backup;
  }

  listBackups() {
    const backups = [];
    const entries = [["current", this.storage.getItem(this.key("backup:current"))]];
    // Read-only compatibility with early internal v1 backup keys.
    const count = Number(this.storage.getItem(this.key("backup:sequence")) ?? 0);
    if (!entries[0][1] && count) entries.push([String(count), this.storage.getItem(this.key(`backup:${count}`))]);
    for (const [, raw] of entries) {
      if (raw) {
        const stored = JSON.parse(raw);
        if (stored.format === "farm-journal-raw-backup-v3") {
          const committedRaw = stored.committed_raw_compressed ? decompressText(stored.committed_raw_compressed) : null;
          if (committedRaw && sha256(committedRaw) !== stored.committed_raw_checksum) throw new Error("迁移前备份校验和不匹配");
          backups.push({ ...stored, slot_a_raw: stored.committed_slot === "a" ? committedRaw : null, slot_b_raw: stored.committed_slot === "b" ? committedRaw : null });
        } else if (stored.format === "farm-journal-raw-backup-v2") {
          const slot_a_raw = stored.slot_a_compressed ? decompressText(stored.slot_a_compressed) : null;
          const slot_b_raw = stored.slot_b_compressed ? decompressText(stored.slot_b_compressed) : null;
          if ((slot_a_raw && sha256(slot_a_raw) !== stored.slot_a_checksum) || (slot_b_raw && sha256(slot_b_raw) !== stored.slot_b_checksum)) throw new Error("迁移前备份校验和不匹配");
          backups.push({ ...stored, slot_a_raw, slot_b_raw });
        } else backups.push(stored);
      }
    }
    return backups;
  }

  latestBackup() { return this.listBackups().at(-1) ?? null; }
  exportLatestBackup() {
    const backup = this.latestBackup();
    if (!backup) throw new Error("没有可导出的迁移前或导入前备份");
    return JSON.stringify(backup, null, 2);
  }

  save(state, options = {}) {
    validateState(state);
    const pointer = this.storage.getItem(this.key("pointer"));
    const active = pointer === "a" || pointer === "b" ? pointer : "b";
    const target = active === "a" ? "b" : "a";
    const current = this.tryDecode(active);
    const sequence = (current?.sequence ?? 0) + 1;
    const envelope = makeEnvelope(deepClone(state), sequence, options.now ?? Date.now());
    const raw = JSON.stringify(envelope);
    this.storage.setItem(this.key(`slot:${target}`), raw);
    if (options.failpoint === "after-slot-write") throw new Error("模拟：写槽后、提交指针前崩溃");
    decodeEnvelope(this.storage.getItem(this.key(`slot:${target}`)));
    this.storage.setItem(this.key("pointer"), target);
    return { slot: target, sequence, written_at: envelope.written_at, checksum: envelope.checksum };
  }

  tryDecode(slot) {
    if (slot !== "a" && slot !== "b") return null;
    try { return decodeEnvelope(this.storage.getItem(this.key(`slot:${slot}`))); }
    catch (error) { this.last_decode_error = error.message; return null; }
  }

  load() {
    const pointer = this.storage.getItem(this.key("pointer"));
    const order = pointer === "a" || pointer === "b" ? [pointer, pointer === "a" ? "b" : "a"] : ["a", "b"];
    const errors = [];
    for (const slot of order) {
      try {
        const raw = this.storage.getItem(this.key(`slot:${slot}`));
        const parsed = parseEnvelope(raw);
        if (parsed.source_version !== SAVE_VERSION) {
          const signature = sha256(raw);
          if (this.storage.getItem(this.key("backup:last-migration-signature")) !== signature) {
            this.preserveRawBackup(`pre-migration-v${parsed.source_version}-to-v1`);
            this.storage.setItem(this.key("backup:last-migration-signature"), signature);
          }
        }
        const envelope = decodeEnvelope(raw);
        return { state: envelope.state, slot, sequence: envelope.sequence, written_at: envelope.written_at, recovered: slot !== pointer, read_only: false };
      } catch (error) {
        errors.push(`${slot}:${error.message}`);
      }
    }
    const empty = !this.storage.getItem(this.key("slot:a")) && !this.storage.getItem(this.key("slot:b"));
    return { state: null, slot: null, sequence: 0, recovered: false, read_only: !empty, empty, error: empty ? null : errors.join("; ") };
  }

  exportDiagnostics() {
    return JSON.stringify({
      format: "farm-journal-recovery-diagnostic",
      exported_at: new Date().toISOString(),
      ...this.rawSlots(),
      backups: this.listBackups().map(({ sequence, reason, captured_at }) => ({ sequence, reason, captured_at })),
    }, null, 2);
  }

  export(state) {
    validateState(state);
    const payload = { format: "farm-journal-save", exported_at: new Date(state.last_trusted_time).toISOString(), state: deepClone(state) };
    return JSON.stringify({ ...payload, checksum: sha256(canonicalStringify(payload)) }, null, 2);
  }

  import(raw) {
    let document;
    try { document = JSON.parse(raw); }
    catch { throw new Error("备份文件格式无效，无法读取"); }
    const payload = { format: document.format, exported_at: document.exported_at, state: document.state };
    if (payload.format !== "farm-journal-save") throw new Error("不是田园日志存档文件");
    if (sha256(canonicalStringify(payload)) !== document.checksum) throw new Error("导入文件校验和不匹配");
    const backup = this.load();
    const persistedBackup = this.preserveRawBackup("pre-import");
    try {
      const state = migrateSave(payload.state);
      validateState(state);
      this.save(state);
      return { state, backup: backup.state ? this.export(backup.state) : null, persisted_backup: persistedBackup };
    } catch (error) {
      return { state: null, backup: backup.state ? this.export(backup.state) : null, read_only: true, error: error.message };
    }
  }
}
