export const APP_VERSION = "0.3.0";
export const APP_RELEASE_NOTES = "新增新手引导、渐进开放、提示自动关闭和主动更新入口。";

function versionNumbers(value) {
  return String(value).split(".").map((part) => Number(part));
}

export function isVersionNewer(candidate, current = APP_VERSION) {
  const next = versionNumbers(candidate);
  const installed = versionNumbers(current);
  if (next.some((part) => !Number.isInteger(part) || part < 0) || installed.some((part) => !Number.isInteger(part) || part < 0)) return false;
  for (let index = 0; index < Math.max(next.length, installed.length); index += 1) {
    if ((next[index] ?? 0) !== (installed[index] ?? 0)) return (next[index] ?? 0) > (installed[index] ?? 0);
  }
  return false;
}
