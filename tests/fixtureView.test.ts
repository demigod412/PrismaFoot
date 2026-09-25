import { describe, expect, it } from "vitest";
import { countViews, fixtureView, isFixtureView, LIVE_STATUS_MINUTES, MATCH_MINUTES } from "@/lib/fixtureView";
import type { FixtureStatus } from "@prisma/client";

const NOW = new Date("2026-09-26T18:00:00Z");
const at = (minutesFromNow: number, status: FixtureStatus = "SCHEDULED") =>
  ({ status, kickoffUtc: new Date(NOW.getTime() + minutesFromNow * 60_000) });

describe("which tab a fixture belongs in", () => {
  it("puts matches that have not kicked off in upcoming", () => {
    expect(fixtureView(at(1), NOW)).toBe("upcoming");
    expect(fixtureView(at(60), NOW)).toBe("upcoming");
    expect(fixtureView(at(60 * 24 * 5), NOW)).toBe("upcoming");
  });

  it("puts a match inside its 105 minutes in live", () => {
    expect(fixtureView(at(0), NOW)).toBe("live");
    expect(fixtureView(at(-1), NOW)).toBe("live");
    expect(fixtureView(at(-MATCH_MINUTES), NOW)).toBe("live");
  });

  it("puts a match past 105 minutes in finished, even while still marked SCHEDULED", () => {
    // The whole point: the full sync runs every three hours, so a 15:00 kickoff usually still reads
    // SCHEDULED until 18:00. Time decides, not the stale status.
    expect(fixtureView(at(-(MATCH_MINUTES + 1)), NOW)).toBe("finished");
    expect(fixtureView(at(-60 * 5), NOW)).toBe("finished");
  });

  it("trusts an explicit status over the clock", () => {
    // Marked finished early (abandoned) — believe it.
    expect(fixtureView(at(-10, "FINISHED"), NOW)).toBe("finished");
  });

  it("gives a reported-live match room for extra time, but not forever", () => {
    // A cup tie through extra time and penalties runs past 135 minutes, so 105 is too tight for a
    // fixture the provider says is in progress.
    expect(fixtureView(at(-130, "LIVE"), NOW)).toBe("live");
    expect(fixtureView(at(-LIVE_STATUS_MINUTES, "LIVE"), NOW)).toBe("live");
    // Past that the LIVE flag is stale, not a four-hour match.
    expect(fixtureView(at(-(LIVE_STATUS_MINUTES + 1), "LIVE"), NOW)).toBe("finished");
    // A merely SCHEDULED fixture gets the tighter window.
    expect(fixtureView(at(-130), NOW)).toBe("finished");
  });

  it("keeps postponed and cancelled out of all three tabs", () => {
    expect(fixtureView(at(120, "POSTPONED"), NOW)).toBe("off");
    expect(fixtureView(at(-120, "CANCELLED"), NOW)).toBe("off");
    expect(fixtureView(at(-10, "POSTPONED"), NOW)).toBe("off");
  });

  it("counts a day into the three tabs plus the ones that are off", () => {
    const day = [at(90), at(240), at(-30), at(-60 * 4, "FINISHED"), at(-60 * 6), at(30, "POSTPONED")];
    expect(countViews(day, NOW)).toEqual({ upcoming: 2, live: 1, finished: 2, off: 1 });
  });

  it("validates the query parameter", () => {
    for (const ok of ["upcoming", "live", "finished"]) expect(isFixtureView(ok)).toBe(true);
    for (const bad of ["", undefined, "all", "UPCOMING", "played"]) expect(isFixtureView(bad as string)).toBe(false);
  });
});
