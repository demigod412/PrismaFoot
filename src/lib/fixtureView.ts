import type { FixtureStatus } from "@prisma/client";

/**
 * How long a match occupies the "live" window: 90 minutes plus the interval.
 * The results job uses the same figure to decide a match should have ended.
 */
export const MATCH_MINUTES = 105;
/**
 * A match the provider has actually reported as in progress gets longer: a cup tie going to extra
 * time and penalties runs past 135 minutes. Beyond this the LIVE status is treated as stale.
 */
export const LIVE_STATUS_MINUTES = 180;

export const FIXTURE_VIEWS = ["upcoming", "live", "finished"] as const;
export type FixtureView = (typeof FIXTURE_VIEWS)[number];
export const VIEW_LABEL: Record<FixtureView, string> = { upcoming: "Upcoming", live: "Live", finished: "Finished" };

export const isFixtureView = (s: string | undefined): s is FixtureView => !!s && (FIXTURE_VIEWS as readonly string[]).includes(s);

/**
 * Which tab a fixture belongs in.
 *
 * The stored status alone is not enough. A provider status of LIVE is only written when a job happens
 * to run while the match is in progress, and the full sync runs every three hours — so a 15:00 kickoff
 * typically still reads SCHEDULED until 18:00, by which time it is over. Kickoff time therefore decides
 * it for anything still marked SCHEDULED:
 *
 *   kickoff in the future                      → upcoming
 *   kicked off within 105 minutes              → live
 *   kicked off longer ago                      → finished (played; the result may not be in yet)
 *
 * A fixture the provider has reported as LIVE gets a 180-minute window instead, so a cup tie going to
 * extra time and penalties is not filed as finished while it is still being played.
 *
 * Postponed and cancelled matches belong in none of the three: they have not been played and are not
 * available to bet. They are counted separately rather than hidden without trace.
 */
export function fixtureView(fx: { status: FixtureStatus; kickoffUtc: Date }, now: Date): FixtureView | "off" {
  if (fx.status === "POSTPONED" || fx.status === "CANCELLED") return "off";
  if (fx.status === "FINISHED") return "finished";
  const sinceKickoff = now.getTime() - fx.kickoffUtc.getTime();
  if (sinceKickoff < 0) return "upcoming";
  const window = fx.status === "LIVE" ? LIVE_STATUS_MINUTES : MATCH_MINUTES;
  return sinceKickoff <= window * 60_000 ? "live" : "finished";
}

export function countViews<T extends { status: FixtureStatus; kickoffUtc: Date }>(fixtures: T[], now: Date) {
  const n: Record<FixtureView | "off", number> = { upcoming: 0, live: 0, finished: 0, off: 0 };
  for (const f of fixtures) n[fixtureView(f, now)]++;
  return n;
}
