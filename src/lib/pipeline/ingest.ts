import type { PrismaClient, Provider } from "@prisma/client";
import { addDays, format } from "date-fns";
import type { FootballProvider, PFixture } from "../providers/types";
import { PROVIDER_ENUM, THROTTLE_MS } from "../providers";
import { LEAGUE_ALLOWLIST } from "../leagues";
import { rateAndPredictLeague } from "./predict";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const ymd = (d: Date) => format(d, "yyyy-MM-dd");

async function upsertTeam(db: PrismaClient, provider: Provider, leagueId: string, t: PFixture["home"]) {
  return db.team.upsert({
    where: { provider_externalId_leagueId: { provider, externalId: t.externalId, leagueId } },
    update: { name: t.name, shortName: t.shortName, crestUrl: t.crestUrl },
    create: { provider, externalId: t.externalId, leagueId, name: t.name, shortName: t.shortName, crestUrl: t.crestUrl },
  });
}

/**
 * Leagues (24h) → fixtures: history back 365d + next 14d → rate → predict.
 * Results for ratings come from the same fixture sync; Phase 3 adds the 15-min results job, lock and settle.
 */
export async function ingest(db: PrismaClient, p: FootballProvider, opts: { now?: Date; historyDays?: number } = {}) {
  const now = opts.now ?? new Date();
  const provider = PROVIDER_ENUM[p.id] as Provider;
  const allow = LEAGUE_ALLOWLIST[p.id as keyof typeof LEAGUE_ALLOWLIST] ?? [];
  const log = await db.syncLog.create({ data: { provider, job: "fixtures", ok: false } });
  const report: Record<string, unknown> = {};
  try {
    const leagues = (await p.getLeagues()).filter((l) => allow.some((a) => a.id === l.externalId));
    for (const l of leagues) {
      const focus = allow.find((a) => a.id === l.externalId)?.focus ?? null;
      const league = await db.league.upsert({
        where: { provider_externalId_season: { provider, externalId: l.externalId, season: l.season } },
        update: { name: l.name, country: l.country, code: l.code, focusGroup: focus },
        create: { provider, externalId: l.externalId, name: l.name, country: l.country, code: l.code, season: l.season, focusGroup: focus },
      });
      // Chunk the window: football-data caps date ranges; 30-day chunks work for all three providers.
      const fixtures: PFixture[] = [];
      const start = addDays(now, -(opts.historyDays ?? 365));
      for (let from = start; from < addDays(now, 14); from = addDays(from, 30)) {
        const to = addDays(from, 29) > addDays(now, 14) ? addDays(now, 14) : addDays(from, 29);
        const seasons = [l.season, l.season - 1];
        for (const season of seasons) {
          try { fixtures.push(...(await p.getFixtures({ from: ymd(from), to: ymd(to), leagueId: l.externalId, season }))); } catch { /* season may not exist */ }
          await sleep(THROTTLE_MS[p.id]);
          if (p.id === "football-data") break; // season param ignored there
        }
      }
      const seen = new Set<string>();
      for (const f of fixtures) {
        if (seen.has(f.externalId)) continue; seen.add(f.externalId);
        const [h, a] = await Promise.all([upsertTeam(db, provider, league.id, f.home), upsertTeam(db, provider, league.id, f.away)]);
        const data = {
          leagueId: league.id, season: f.season, round: f.round, kickoffUtc: f.kickoffUtc, status: f.status,
          homeTeamId: h.id, awayTeamId: a.id, homeGoals: f.homeGoals ?? null, awayGoals: f.awayGoals ?? null,
          homeXg: f.homeXg ?? null, awayXg: f.awayXg ?? null, homeShots: f.homeShots ?? null, awayShots: f.awayShots ?? null, venue: f.venue,
        };
        await db.fixture.upsert({ where: { provider_externalId: { provider, externalId: f.externalId } }, update: data, create: { provider, externalId: f.externalId, ...data } });
      }
      await db.league.update({ where: { id: league.id }, data: { lastSyncAt: new Date() } });
      report[l.name] = await rateAndPredictLeague(db, league.id, {
        now,
        newsLoader: async (fx) => {
          if (fx.kickoffUtc.getTime() - now.getTime() > 48 * 3600_000) return null; // only fetch news close to kickoff
          const inj = await p.getInjuries(fx.externalId);
          await sleep(THROTTLE_MS[p.id]);
          if (!inj) return null; // unsupported ⇒ missing_news, never invented
          // News is now "complete" (we checked). We only have confirmed-out lists, not who is a regular starter,
          // so φ_news stays 1 until the Phase 3 lineup-history job can tag starter-level players.
          // Counting every absentee would be an invented adjustment.
          void inj;
          return { home: { confirmedStarterAbsences: 0 }, away: { confirmedStarterAbsences: 0 } };
        },
      });
    }
    await db.syncLog.update({ where: { id: log.id }, data: { ok: true, finishedAt: new Date(), message: JSON.stringify(report).slice(0, 2000) } });
    return report;
  } catch (e) {
    await db.syncLog.update({ where: { id: log.id }, data: { ok: false, finishedAt: new Date(), message: (e as Error).message.slice(0, 2000) } });
    throw e;
  }
}
