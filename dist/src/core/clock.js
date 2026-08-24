import { advanceOffline } from "./day.js";
import { dateKeyDifference, deepClone, rolloverDateKey } from "./utils.js";

const SIX_HOURS = 6 * 60 * 60 * 1000;

export function synchronizeToNow(inputState, now) {
  const state = deepClone(inputState);
  if (!Number.isFinite(now)) throw new TypeError("当前时间必须是毫秒时间戳");
  if (now < state.last_trusted_time) {
    const rollback = state.last_trusted_time - now;
    state.clock.rollback_ms = rollback;
    if (rollback >= SIX_HOURS) {
      state.clock.status = "locked_rollback";
      return { state, advanced: 0, active_days: 0, rest_days: 0, locked: true, reason: "系统时间回拨达到6小时，现实推进已锁定" };
    }
    return { state, advanced: 0, active_days: 0, rest_days: 0, locked: false, reason: "小于6小时回拨，沿用上次可信时间" };
  }
  if (state.clock.status === "locked_rollback") state.clock.status = "normal";
  state.clock.rollback_ms = 0;
  const targetKey = rolloverDateKey(now, state.timezone, state.rollover_hour);
  const difference = dateKeyDifference(targetKey, state.last_real_date_key);
  if (difference <= 0) {
    state.last_trusted_time = now;
    return { state, advanced: 0, active_days: 0, rest_days: 0, locked: false };
  }
  const result = advanceOffline(state, difference);
  result.state.last_trusted_time = now;
  result.state.last_real_date_key = targetKey;
  result.state.clock.status = "normal";
  return { ...result, advanced: difference, locked: false };
}

export function migrateTimezone(inputState, timezone, now) {
  const state = deepClone(inputState);
  if (state.clock.timezone_migrated_at_day !== null && state.calendar.absolute_day - state.clock.timezone_migrated_at_day < 84) throw new Error("时区迁移仍在84牧场日冷却期");
  try { new Intl.DateTimeFormat("en", { timeZone: timezone }).format(new Date(now)); }
  catch { throw new Error("时区无效，请输入有效的 IANA 时区，例如 Asia/Shanghai"); }
  state.timezone = timezone;
  state.clock.timezone_migrated_at_day = state.calendar.absolute_day;
  state.last_real_date_key = rolloverDateKey(now, timezone, state.rollover_hour);
  state.last_trusted_time = Math.max(state.last_trusted_time, now);
  state.daily_ledgers.push({ type: "timezone_migration", day: state.calendar.absolute_day, timezone, message: "时区已迁移；牧场日期未重复推进。" });
  return state;
}
