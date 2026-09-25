import "server-only";
import { cookies } from "next/headers";
import { DEFAULT_TZ, isTimeZone, TZ_COOKIE } from "./time";

/**
 * The viewing device's timezone, from its cookie, falling back to the server default.
 * Kept out of time.ts so client components can still import the pure formatters.
 */
export async function tz(): Promise<string> {
  try {
    const v = (await cookies()).get(TZ_COOKIE)?.value;
    return isTimeZone(v) ? v : DEFAULT_TZ;
  } catch {
    return DEFAULT_TZ; // outside a request (scripts, build-time)
  }
}
