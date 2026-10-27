/**
 * Small formatting helpers shared by the core, the UI and plugins.
 *
 * Everything here is pure and runtime-agnostic: no DOM, no Node, no locale
 * lookups, so the output is identical in the desktop app, the browser demo and
 * the test suite.
 */

const BYTE_UNITS = ["B", "KB", "MB", "GB", "TB", "PB"] as const;

/**
 * Format a number of seconds as `m:ss` (or `h:mm:ss` once the value reaches an
 * hour). Invalid input (`NaN`, `Infinity`, negative numbers) becomes `"0:00"`.
 */
export function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const total = Math.floor(seconds);
  const secs = total % 60;
  const mins = Math.floor(total / 60) % 60;
  const hours = Math.floor(total / 3600);
  if (hours > 0) {
    return `${hours}:${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
  }
  return `${Math.floor(total / 60)}:${String(secs).padStart(2, "0")}`;
}

/** Alias of {@link formatTime}, kept for call sites that format a duration. */
export function formatDuration(seconds: number): string {
  return formatTime(seconds);
}

/**
 * Format a byte count with binary units, e.g. `"12.4 MB"`.
 * Sub-kilobyte values are shown as whole bytes (`"512 B"`); invalid or negative
 * values become `"0 B"`.
 */
export function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return "0 B";
  let value = n;
  let unit = 0;
  while (value >= 1024 && unit < BYTE_UNITS.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const label = BYTE_UNITS[unit] ?? "B";
  if (unit === 0) return `${Math.round(value)} B`;
  return `${value.toFixed(1)} ${label}`;
}

/**
 * Deterministic 8-character base36 id derived from `input`.
 *
 * Uses FNV-1a over the UTF-8 bytes of the string, so the same input always
 * produces the same id on every platform and across runs. Collisions are
 * possible in principle (32 bits), but the ids are only display keys; callers
 * that need uniqueness combine them with another field.
 */
export function hashId(input: string): string {
  const bytes = new TextEncoder().encode(input);
  let hash = 0x811c9dc5;
  for (const byte of bytes) {
    hash ^= byte;
    // `Math.imul` keeps the multiply in 32-bit space, then `>>> 0` makes it unsigned.
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(36).padStart(8, "0");
}

/** Clamp `n` into the inclusive `[min, max]` range. `NaN` becomes `min`. */
export function clamp(n: number, min: number, max: number): number {
  if (Number.isNaN(n)) return min;
  const lo = Math.min(min, max);
  const hi = Math.max(min, max);
  return Math.min(Math.max(n, lo), hi);
}

/**
 * The file name without directories and without its final extension.
 * Used as the metadata title fallback; works for both `/` and `\` paths.
 */
export function baseName(fileName: string): string {
  const slash = Math.max(fileName.lastIndexOf("/"), fileName.lastIndexOf("\\"));
  const name = slash >= 0 ? fileName.slice(slash + 1) : fileName;
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(0, dot) : name;
}
