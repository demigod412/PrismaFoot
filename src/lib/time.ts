import { formatInTimeZone } from "date-fns-tz";
export const TZ = process.env.DEFAULT_TIMEZONE ?? "Africa/Lagos";
export const fmtWat = (d: Date, f = "HH:mm") => formatInTimeZone(d, TZ, f);
export const fmtUtc = (d: Date, f = "HH:mm") => formatInTimeZone(d, "UTC", f);
export const dayKey = (d: Date) => formatInTimeZone(d, TZ, "yyyy-MM-dd");
/** Start of a WAT calendar day, as a UTC instant. */
export function watDayStart(key: string): Date {
  const [y, m, d] = key.split("-").map(Number);
  const offsetMin = TZ === "Africa/Lagos" ? 60 : 0; // WAT has no DST
  return new Date(Date.UTC(y, m - 1, d) - offsetMin * 60_000);
}
