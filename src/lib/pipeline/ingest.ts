import type { PrismaClient, Provider } from "@prisma/client";
import { addDays, format } from "date-fns";

const ymd = (d: Date) => format(d, "yyyy-MM-dd");
import type { FootballProvider, PFixture } from "../providers/types";
import { PROVIDER_ENUM, THROTTLE_MS } from "../providers";
import { LEAGUE_ALLOWLIST, POOL_SETTINGS } from "../leagues";
import { rateAndPredictLeague } from "./predict";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

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
    let injuryCalls = 0;
    for (const l of leagues) {
      const entry = allow.find((a) => a.id === l.externalId)!;
      const pool = entry.pool ? POOL_SETTINGS[entry.pool] : undefined;
      const league = await db.league.upsert({
        where: { provider_externalId_season: { provider, externalId: l.externalId, season: l.season } },
        update: { name: l.name, country: l.country, code: l.code, focusGroup: entry.focus, ratingPool: entry.pool ?? null, neutral: !!entry.neutral },
        create: { provider, externalId: l.externalId, name: l.name, country: l.country, code: l.code, season: l.season, focusGroup: entry.focus, ratingPool: entry.pool ?? null, neutral: !!entry.neutral },
      });
      // Whole seasons in one request each (current + previous; 3 seasons for national teams).
      const fixtures: PFixture[] = [];
      const errors: string[] = [];
      // Finals tournaments (World Cup, Euro…) only exist in their own year: don't ask for earlier "seasons".
      const nSeasons = entry.neutral ? 1 : pool?.seasons ?? 2;
      for (let k = 0; k < nSeasons; k++) {
        try { fixtures.push(...(await p.getFixtures({ leagueId: l.externalId, season: l.season - k }))); }
        catch (e) { errors.push(`${l.season - k}: ${(e as Error).message}`); }
        await sleep(THROTTLE_MS[p.id]);
      }
      // Upcoming games: always ask for the next 14 days explicitly (some plans leave future fixtures out of season lists).
      try {
        fixtures.push(...(await p.getFixtures({ leagueId: l.externalId, season: l.season, from: ymd(now), to: ymd(addDays(now, 14)) })));
      } catch (e) { errors.push(`next 14 days: ${(e as Error).message}`); }
      await sleep(THROTTLE_MS[p.id]);
      const oldest = addDays(now, -(pool?.historyDays ?? opts.historyDays ?? 450)).getTime();
      const keep = fixtures.filter((f) => f.kickoffUtc.getTime() >= oldest && f.kickoffUtc.getTime() <= addDays(now, 14).getTime());
      if (!keep.length) { report[l.name] = { fixtures: 0, errors }; continue; } // don't mark synced when nothing came back
      const seen = new Set<string>();
      for (const f of keep) {
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
      const upcoming = keep.filter((f) => f.status === "SCHEDULED" && f.kickoffUtc > now).length;
      report[l.name] = { fixtures: keep.length, upcoming, ...(errors.length ? { errors } : {}), ...await rateAndPredictLeague(db, league.id, {
        now,
        newsLoader: async (fx) => {
          if (fx.kickoffUtc.getTime() - now.getTime() > 24 * 3600_000) return null; // only fetch news close to kickoff
          if (injuryCalls >= (Number(process.env.MAX_INJURY_CALLS) || 25)) return null; // protect the daily quota
          injuryCalls++;
          const inj = await p.getInjuries(fx.externalId);
          await sleep(THROTTLE_MS[p.id]);
          if (!inj) return null; // unsupported ⇒ missing_news, never invented
          // News is now "complete" (we checked). We only have confirmed-out lists, not who is a regular starter,
          // so φ_news stays 1 until the Phase 3 lineup-history job can tag starter-level players.
          // Counting every absentee would be an invented adjustment.
          void inj;
          return { home: { confirmedStarterAbsences: 0 }, away: { confirmedStarterAbsences: 0 } };
        },
      }) };
    }
    await db.syncLog.update({ where: { id: log.id }, data: { ok: true, finishedAt: new Date(), message: JSON.stringify(report).slice(0, 2000) } });
    return report;
  } catch (e) {
    await db.syncLog.update({ where: { id: log.id }, data: { ok: false, finishedAt: new Date(), message: (e as Error).message.slice(0, 2000) } });
    throw e;
  }
}
