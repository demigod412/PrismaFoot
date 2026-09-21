import type { PrismaClient } from "@prisma/client";
import { makeRng, poissonSample } from "./rng";
import { rateAndPredictLeague } from "../pipeline/predict";

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
  await db.prediction.deleteMany({ where: { fixture: { provider: "DEMO" } } }); // demo rows only; live ledger is never touched
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
      await db.fixture.create({ data: {
        provider: "DEMO", externalId: `${L.code}-${k}`, leagueId: league.id, season, round: `Round ${r + 1}`,
        kickoffUtc: kickoff, status: past ? "FINISHED" : "SCHEDULED", homeTeamId: teams[hi].id, awayTeamId: teams[ai].id,
        homeGoals: hg, awayGoals: ag,
      } });
    }
    await rateAndPredictLeague(db, league.id, {
      now,
      // Demo only: pretend news was checked for games inside 48h, with no confirmed absences. Flagged in data_flags.
      newsLoader: async (fx) => fx.kickoffUtc.getTime() - now.getTime() < 48 * 3600_000
        ? { home: { confirmedStarterAbsences: 0 }, away: { confirmedStarterAbsences: 0 } } : null,
    });
  }
}
