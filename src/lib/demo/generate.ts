import type { PrismaClient } from "@prisma/client";
import { makeRng, poissonSample } from "./rng";
import { buildContext, rateAndPredictLeague, writePrediction } from "../pipeline/predict";
import { refitCalibration, settle, snapshotAccuracy } from "../pipeline/ledger";
import { marketsFromMatrix, scoreMatrix } from "../model/dixonColes";

/* DEMO data: fictional clubs, simulated from hidden strengths, then rated and predicted by the real engine.
   Everything shown in DEMO mode is internally consistent Dixon–Coles output — and is labelled as demo. */
const LEAGUES = [
  { code: "DPL", name: "Demo Premier", country: "England (demo)", focus: "england", teams: ["Ashford Rovers", "Belmont City", "Carrow Athletic", "Dunmere United", "Eastgate Town", "Fenwick Albion", "Greyhaven FC", "Holloway Park", "Ivybridge Wanderers", "Kestrel Vale", "Lanford Borough", "Marlow Heath"] },
  { code: "DLI", name: "Demo Liga", country: "Spain (demo)", focus: "europe-strong", teams: ["Real Alcora", "Atlético Brenes", "CD Calvera", "UD Doñana", "Racing Elche Alto", "SD Fuensol", "Villa Garrucha", "CF Huelmo", "Deportivo Ibarra", "Unión Jaraiz"] },
  { code: "DSA", name: "Demo Serie", country: "Italy (demo)", focus: "europe-strong", teams: ["AC Brenta", "Calvino 1908", "Dolomiti FC", "US Etruria", "Fiorano Calcio", "Gargano", "Imperia Sud", "Lucca Nova", "Montebello", "Novara Alta"] },
  { code: "DNP", name: "Demo NPFL", country: "Nigeria (demo)", focus: null, teams: ["Abuja Stallions", "Benue Rangers", "Calabar Coast", "Delta Tide", "Enugu Pillars", "Gombe Hawks", "Ibadan Royals", "Jos Plateau FC", "Kano Riders", "Lagos Harbour"] },
] as const;

const DAY = 86_400_000;

export async function seedDemo(db: PrismaClient, now = new Date()) {
  // demo rows only; the live ledger is never touched
  await db.oddsQuote.deleteMany({ where: { fixture: { provider: "DEMO" } } });
  await db.accuracyDaily.deleteMany({ where: { scope: "DEMO" } });
  await db.calibrationModel.deleteMany({ where: { provider: "DEMO" } });
  await db.prediction.deleteMany({ where: { fixture: { provider: "DEMO" } } });
  await db.result.deleteMany({ where: { source: "DEMO" } });
  await db.fixture.deleteMany({ where: { provider: "DEMO" } });
  await db.teamRatingSnapshot.deleteMany({ where: { team: { provider: "DEMO" } } });
  await db.team.deleteMany({ where: { provider: "DEMO" } });
  await db.league.deleteMany({ where: { provider: "DEMO" } });

  const season = now.getUTCMonth() >= 6 ? now.getUTCFullYear() : now.getUTCFullYear() - 1;
  let li = 0;
  for (const L of LEAGUES) {
    const rng = makeRng(1000 + li++);
    const league = await db.league.create({ data: { provider: "DEMO", externalId: L.code, code: L.code, name: L.name, country: L.country, season, focusGroup: L.focus, lastSyncAt: now } });
    const teams = [];
    for (const [i, name] of L.teams.entries()) {
      teams.push(await db.team.create({ data: { provider: "DEMO", externalId: `${L.code}-${i}`, leagueId: league.id, name, shortName: name.split(" ").slice(0, 2).join(" ") } }));
    }
    const truth = teams.map(() => ({ a: Math.exp((rng() - 0.5) * 0.7), d: Math.exp((rng() - 0.5) * 0.6) }));
    const base = 1.15 + rng() * 0.25, home = 1.15 + rng() * 0.2;

    // Double round-robin: first half-season in the past, rest spread over the next 14 days (and beyond).
    // Circle-method double round-robin so no club plays twice in a round.
    const n = teams.length, idx = teams.map((_, i) => i);
    const firstLeg: [number, number][][] = [];
    for (let r = 0; r < n - 1; r++) {
      const round: [number, number][] = [];
      for (let k = 0; k < n / 2; k++) {
        const x = idx[k], y = idx[n - 1 - k];
        round.push(r % 2 === 0 ? [x, y] : [y, x]);
      }
      firstLeg.push(round);
      idx.splice(1, 0, idx.pop()!);
    }
    const schedule = [...firstLeg, ...firstLeg.map((rd) => rd.map(([x, y]) => [y, x] as [number, number]))];
    const pastRounds = Math.floor(schedule.length * 0.72);
    const flat = schedule.flatMap((rd, r) => rd.map((pr) => ({ r, pr })));
    for (let k = 0; k < flat.length; k++) {
      const { r, pr: [hi, ai] } = flat[k];
      const past = r < pastRounds;
      const offsetDays = past ? -(pastRounds - r) * 7 + Math.floor(rng() * 2) : (r - pastRounds) * 4 + rng() * 1.5 + 0.1;
      const day = new Date(now.getTime() + offsetDays * DAY);
      const kickoff = new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate(), [12, 14, 16, 19][Math.floor(rng() * 4)], rng() < 0.5 ? 0 : 30));
      if (kickoff.getTime() > now.getTime() + 14 * DAY) continue;
      const hg = past ? poissonSample(rng, base * truth[hi].a * truth[ai].d * home) : null;
      const ag = past ? poissonSample(rng, base * truth[ai].a * truth[hi].d) : null;
      const fx = await db.fixture.create({ data: {
        provider: "DEMO", externalId: `${L.code}-${k}`, leagueId: league.id, season, round: `Round ${r + 1}`,
        kickoffUtc: kickoff, status: past ? "FINISHED" : "SCHEDULED", homeTeamId: teams[hi].id, awayTeamId: teams[ai].id,
        homeGoals: hg, awayGoals: ag,
        // Demo half-times: each goal lands in the first half with probability 0.45
        ...(past ? { htHome: [...Array(hg!)].filter(() => rng() < 0.45).length, htAway: [...Array(ag!)].filter(() => rng() < 0.45).length } : {}),
        // Demo stats: stronger attacks win more corners and take more shots
        ...(past ? {
          homeCorners: poissonSample(rng, 5.3 * truth[hi].a ** 0.6 * truth[ai].d ** 0.4), awayCorners: poissonSample(rng, 4.4 * truth[ai].a ** 0.6 * truth[hi].d ** 0.4),
          homeShots: poissonSample(rng, 13.5 * truth[hi].a ** 0.7 * truth[ai].d ** 0.5), awayShots: poissonSample(rng, 11 * truth[ai].a ** 0.7 * truth[hi].d ** 0.5),
          statsFetched: true,
        } : {}),
      } });
      // Demo bookmaker: true probabilities + 6% margin + a little noise; quoted the day before kickoff.
      if (kickoff.getTime() > now.getTime() - 22 * DAY) {
        const m = marketsFromMatrix(scoreMatrix(base * truth[hi].a * truth[ai].d * home, base * truth[ai].a * truth[hi].d, -0.08));
        const price = (pt: number) => Math.max(1.02, Math.round((1 / (pt * 1.06)) * (1 + (rng() - 0.5) * 0.08) * 100) / 100);
        const probs: Record<string, number> = { home: m.home, draw: m.draw, away: m.away, dc_1x: m.home + m.draw, dc_x2: m.draw + m.away, dc_12: m.home + m.away,
          over15: m.over15, over25: m.over25, under25: 1 - m.over25, under35: 1 - m.over35, btts_yes: m.btts, btts_no: 1 - m.btts };
        await db.oddsQuote.createMany({ data: Object.entries(probs).map(([market, pt]) => ({ fixtureId: fx.id, market, odds: price(pt), best: price(pt) + 0.05, books: 6, fetchedAt: new Date(kickoff.getTime() - DAY) })) });
      }
    }

    // Walk-forward demo ledger: each of the last 3 weeks predicted only from data available before it, locked at T-15.
    for (let w = 3; w >= 1; w--) {
      const weekStart = new Date(now.getTime() - w * 7 * DAY), weekEnd = new Date(weekStart.getTime() + 7 * DAY);
      const ctx = await buildContext(db, league.id, weekStart);
      const games = await db.fixture.findMany({ where: { leagueId: league.id, kickoffUtc: { gte: weekStart, lt: weekEnd }, status: "FINISHED" }, include: { homeTeam: true, awayTeam: true } });
      for (const g of games) {
        await writePrediction(db, ctx, g, {
          news: { home: { confirmedStarterAbsences: 0 }, away: { confirmedStarterAbsences: 0 } },
          generatedAt: new Date(g.kickoffUtc.getTime() - 2 * 3600_000), lockAt: new Date(g.kickoffUtc.getTime() - 15 * 60_000),
        });
      }
    }
    await rateAndPredictLeague(db, league.id, {
      now,
      // Demo only: pretend news was checked for games inside 48h, with no confirmed absences. Flagged in data_flags.
      newsLoader: async (fx) => fx.kickoffUtc.getTime() - now.getTime() < 48 * 3600_000
        ? { home: { confirmedStarterAbsences: 0 }, away: { confirmedStarterAbsences: 0 } } : null,
    });
  }
  await settle(db, "DEMO");
  await refitCalibration(db, "DEMO");
  await snapshotAccuracy(db, "DEMO", 25);
}
