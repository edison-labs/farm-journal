export const SEASONS = Object.freeze(["spring", "summer", "autumn", "winter"]);
export const SEASON_NAMES = Object.freeze({ spring: "春季", summer: "夏季", autumn: "秋季", winter: "冬季" });

export function clamp(value, min = 0, max = 100) {
  if (!Number.isFinite(value)) throw new RangeError(`非有限数值: ${value}`);
  return Math.min(max, Math.max(min, value));
}

export function halfUp(value) {
  if (!Number.isFinite(value)) throw new RangeError(`金额不是有限数值: ${value}`);
  const sign = value < 0 ? -1 : 1;
  return sign * Math.floor(Math.abs(value) + 0.5 + Number.EPSILON);
}

export function ceilDiv(a, b) {
  return Math.ceil(a / b);
}

export function deepClone(value) {
  return globalThis.structuredClone
    ? globalThis.structuredClone(value)
    : JSON.parse(JSON.stringify(value));
}

function canonicalValue(value) {
  if (value === null || typeof value === "boolean" || typeof value === "string") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError("规范序列化拒绝 NaN/Infinity");
    return Object.is(value, -0) ? 0 : value;
  }
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (typeof value === "object") {
    const output = {};
    for (const key of Object.keys(value).sort()) {
      if (value[key] !== undefined) output[key] = canonicalValue(value[key]);
    }
    return output;
  }
  throw new TypeError(`不支持规范序列化的类型: ${typeof value}`);
}

export function canonicalStringify(value) {
  return JSON.stringify(canonicalValue(value));
}

// Small dependency-free LZW codec used only for redundant local snapshots.
// Gameplay data is decoded and checksum-verified before it is trusted.
export function compressText(text) {
  const bytes = new TextEncoder().encode(String(text));
  if (!bytes.length) return "";
  const dictionary = new Map();
  let nextCode = 256;
  let phrase = String.fromCharCode(bytes[0]);
  const codes = [];
  for (let index = 1; index < bytes.length; index += 1) {
    const character = String.fromCharCode(bytes[index]);
    const combined = phrase + character;
    if (dictionary.has(combined)) phrase = combined;
    else {
      codes.push(phrase.length === 1 ? phrase.charCodeAt(0) : dictionary.get(phrase));
      if (nextCode < 65535) dictionary.set(combined, nextCode++);
      phrase = character;
    }
  }
  codes.push(phrase.length === 1 ? phrase.charCodeAt(0) : dictionary.get(phrase));
  let binary = "";
  for (let offset = 0; offset < codes.length; offset += 8192) {
    const chunk = codes.slice(offset, offset + 8192);
    binary += String.fromCharCode(...chunk.flatMap((code) => [code >>> 8, code & 0xff]));
  }
  return btoa(binary);
}

export function decompressText(encoded) {
  if (!encoded) return "";
  const binary = atob(encoded);
  if (binary.length % 2) throw new Error("压缩文本长度无效");
  const codes = [];
  for (let index = 0; index < binary.length; index += 2) codes.push((binary.charCodeAt(index) << 8) | binary.charCodeAt(index + 1));
  const dictionary = [];
  let nextCode = 256;
  let phrase = String.fromCharCode(codes[0]);
  const parts = [phrase];
  for (let index = 1; index < codes.length; index += 1) {
    const code = codes[index];
    const entry = code < 256 ? String.fromCharCode(code) : dictionary[code] ?? (code === nextCode ? phrase + phrase[0] : null);
    if (entry === null) throw new Error("压缩文本字典无效");
    parts.push(entry);
    if (nextCode < 65535) dictionary[nextCode++] = phrase + entry[0];
    phrase = entry;
  }
  const byteString = parts.join("");
  const bytes = new Uint8Array(byteString.length);
  for (let index = 0; index < byteString.length; index += 1) bytes[index] = byteString.charCodeAt(index);
  return new TextDecoder().decode(bytes);
}

function rotr(value, bits) {
  return (value >>> bits) | (value << (32 - bits));
}

export function sha256(text) {
  const bytes = new TextEncoder().encode(text);
  const bitLength = bytes.length * 8;
  const paddedLength = Math.ceil((bytes.length + 9) / 64) * 64;
  const data = new Uint8Array(paddedLength);
  data.set(bytes);
  data[bytes.length] = 0x80;
  const view = new DataView(data.buffer);
  const high = Math.floor(bitLength / 0x100000000);
  const low = bitLength >>> 0;
  view.setUint32(paddedLength - 8, high, false);
  view.setUint32(paddedLength - 4, low, false);

  const h = new Uint32Array([
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
    0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ]);
  const k = new Uint32Array([
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
  ]);
  const w = new Uint32Array(64);
  for (let offset = 0; offset < data.length; offset += 64) {
    for (let i = 0; i < 16; i += 1) w[i] = view.getUint32(offset + i * 4, false);
    for (let i = 16; i < 64; i += 1) {
      const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
      const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
    }
    let [a, b, c, d, e, f, g, hh] = h;
    for (let i = 0; i < 64; i += 1) {
      const s1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const t1 = (hh + s1 + ch + k[i] + w[i]) >>> 0;
      const s0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (s0 + maj) >>> 0;
      hh = g; g = f; f = e; e = (d + t1) >>> 0;
      d = c; c = b; b = a; a = (t1 + t2) >>> 0;
    }
    h[0] = (h[0] + a) >>> 0; h[1] = (h[1] + b) >>> 0;
    h[2] = (h[2] + c) >>> 0; h[3] = (h[3] + d) >>> 0;
    h[4] = (h[4] + e) >>> 0; h[5] = (h[5] + f) >>> 0;
    h[6] = (h[6] + g) >>> 0; h[7] = (h[7] + hh) >>> 0;
  }
  return Array.from(h, (part) => part.toString(16).padStart(8, "0")).join("");
}

export function calendarFromAbsolute(absoluteDay) {
  if (!Number.isInteger(absoluteDay) || absoluteDay < 1) throw new RangeError("牧场绝对日必须为正整数");
  const zero = absoluteDay - 1;
  const year = Math.floor(zero / 84) + 1;
  const dayOfYear = zero % 84;
  const seasonIndex = Math.floor(dayOfYear / 21);
  return {
    absolute_day: absoluteDay,
    year,
    season: SEASONS[seasonIndex],
    season_day: (dayOfYear % 21) + 1,
    week_block: Math.floor(zero / 7),
  };
}

export function advanceCalendar(calendar, days = 1) {
  return calendarFromAbsolute(calendar.absolute_day + days);
}

export function calendarLabel(calendar) {
  return `第${calendar.year}年·${SEASON_NAMES[calendar.season]}·第${calendar.season_day}日`;
}

function zonedParts(timestamp, timezone) {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  const result = {};
  for (const part of formatter.formatToParts(new Date(timestamp))) {
    if (part.type !== "literal") result[part.type] = Number(part.value);
  }
  return result;
}

function previousGregorianDate(year, month, day) {
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() - 1);
  return [date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate()];
}

export function rolloverDateKey(timestamp, timezone, rolloverHour) {
  const parts = zonedParts(timestamp, timezone);
  let tuple = [parts.year, parts.month, parts.day];
  if (parts.hour < rolloverHour) tuple = previousGregorianDate(...tuple);
  return `${tuple[0].toString().padStart(4, "0")}-${tuple[1].toString().padStart(2, "0")}-${tuple[2].toString().padStart(2, "0")}`;
}

export function gregorianDayNumber(dateKey) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateKey);
  if (!match) throw new TypeError(`无效日期键: ${dateKey}`);
  return Math.floor(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])) / 86400000);
}

export function dateKeyDifference(later, earlier) {
  return gregorianDayNumber(later) - gregorianDayNumber(earlier);
}

export function assertInvariant(condition, message) {
  if (!condition) throw new Error(message);
}

export function makeId(prefix, ...parts) {
  return `${prefix}_${sha256(canonicalStringify(parts)).slice(0, 16)}`;
}
