export function validateNewSaveOptions(timezone, rolloverHour) {
  const hour = Number(rolloverHour);
  if (!Number.isInteger(hour) || hour < 0 || hour > 8) throw new Error("刷新点必须是0—8的整点");
  try { new Intl.DateTimeFormat("en", { timeZone: String(timezone) }).format(new Date()); }
  catch { throw new Error("请输入有效的 IANA 时区，例如 Asia/Shanghai"); }
  return { timezone: String(timezone), rollover_hour: hour };
}
