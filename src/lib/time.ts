import { formatInTimeZone } from "date-fns-tz";
export const TZ = process.env.DEFAULT_TIMEZONE ?? "Africa/Lagos";
export const fmtWat = (d: Date, f = "HH:mm") => formatInTimeZone(d, TZ, f);
export const fmtUtc = (d: Date, f = "HH:mm") => formatInTimeZone(d, "UTC", f);
export const dayKey = (d: Date) => formatInTimeZone(d, TZ, "yyyy-MM-dd");
/** Start of a WAT calendar day, as a UTC instant. */
/** True only for real calendar dates in yyyy-MM-dd form (rejects 2026-13-45, 2026-02-30, garbage). */
export function isDayKey(s: string | undefined): s is string {
  if (!s || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T12:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}
export function watDayStart(key: string): Date {
  const [y, m, d] = key.split("-").map(Number);
  const offsetMin = TZ === "Africa/Lagos" ? 60 : 0; // WAT has no DST
  return new Date(Date.UTC(y, m - 1, d) - offsetMin * 60_000);
}
