import { formatInTimeZone, fromZonedTime } from "date-fns-tz";

/** Cookie holding the viewing device's IANA timezone. Per device: no accounts, nothing shared. */
export const TZ_COOKIE = "pe_tz";
/** Server-wide fallback, used until a device picks its own. */
export const DEFAULT_TZ = process.env.DEFAULT_TIMEZONE ?? "Africa/Lagos";

/** True for an IANA zone this runtime can actually format (rejects junk from a hand-edited cookie). */
export function isTimeZone(s: string | null | undefined): s is string {
  if (!s || s.length > 64 || !/^[A-Za-z][A-Za-z0-9+_\-/]*$/.test(s)) return false;
  try { new Intl.DateTimeFormat("en-GB", { timeZone: s }); return true; } catch { return false; }
}

export const fmtIn = (d: Date, zone: string, f = "HH:mm") => formatInTimeZone(d, zone, f);
export const fmtUtc = (d: Date, f = "HH:mm") => formatInTimeZone(d, "UTC", f);

/**
 * Offset label for the chosen zone, e.g. "UTC+1", "UTC-5", "UTC+5:30".
 * Locale-independent on purpose: Intl's short names render Lagos as "GMT+1" on some
 * ICU builds and "WAT" on others, which made the old hardcoded "WAT" wrong half the time.
 */
export function tzOffsetLabel(zone: string, at: Date = new Date()): string {
  const raw = formatInTimeZone(at, zone, "xxx"); // "+01:00" | "-05:00" | "Z"
  if (raw === "Z" || raw === "+00:00") return "UTC";
  const [h, m] = raw.slice(1).split(":");
  return `UTC${raw[0]}${Number(h)}${m === "00" ? "" : `:${m}`}`;
}
/** "Africa/Lagos" → "Lagos" */
export const tzCity = (zone: string) => (zone.split("/").pop() ?? zone).replace(/_/g, " ");

/** Calendar day in `zone`, as yyyy-MM-dd. */
export const dayKeyIn = (d: Date, zone: string) => formatInTimeZone(d, zone, "yyyy-MM-dd");

/** True only for real calendar dates in yyyy-MM-dd form (rejects 2026-13-45, 2026-02-30, garbage). */
export function isDayKey(s: string | undefined): s is string {
  if (!s || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T12:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

/**
 * Start of a calendar day in `zone`, as a UTC instant.
 * Uses the zone's real rules, so DST changeovers and half-hour offsets are handled —
 * the old version assumed a fixed +1 for Lagos and 0 for everywhere else.
 */
export function dayStart(key: string, zone: string): Date {
  return fromZonedTime(`${key}T00:00:00`, zone);
}
