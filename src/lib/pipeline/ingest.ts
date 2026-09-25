import type { PrismaClient, Provider } from "@prisma/client";
import { addDays, format } from "date-fns";

const ymd = (d: Date) => format(d, "yyyy-MM-dd");
import type { FootballProvider, PFixture } from "../providers/types";
import { PROVIDER_ENUM, THROTTLE_MS } from "../providers/constants";
import { entryFor, LEAGUE_ALLOWLIST, POOL_SETTINGS } from "../leagues";
import { FIXTURE_WINDOW_DAYS } from "../window";
import { rateAndPredictLeague } from "./predict";
import { lockDue, refitCalibration, settle, snapshotAccuracy } from "./ledger";
import { providerCalls } from "../providers/http";

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
  providerCalls.reset();
  try {
    // Pooled competitions (European cups, internationals) last, so they see this run's domestic results.
    // Within that, least-recently-synced first: a run that gets cut short (a long first sync, a dropped
    // session, an out-of-memory kill) then resumes with the leagues it never reached rather than
    // starting over on the same ones.
    const lastSynced = new Map((await db.league.findMany({ where: { provider }, select: { externalId: true, lastSyncAt: true } }))
      .map((l) => [l.externalId, l.lastSyncAt?.getTime() ?? 0]));
    /**
     * Match statistics, bookmaker odds and injuries are capped per SYNC, not per league, so whichever
     * leagues come first spend the whole budget. Those markets (corners, shots, value) only matter where
     * people actually bet, so the budget is reserved for the strong European leagues, England and other
     * top flights. Without this, ordering by staleness handed all 85 calls to whatever obscure league
     * happened to sort first — one run spent 30 stats calls on Kenya's second tier.
     */
    const majorLeague = (l: { externalId: string; name: string; country: string }) => {
      const e = entryFor(allow, l);
      if (!e || e.pool) return false;
      return e.focus === "europe-strong" || e.focus === "england" || (e.tier ?? 1) === 1;
    };
    const leagues = (await p.getLeagues()).filter((l) => entryFor(allow, l))
      .sort((x, y) => Number(!!entryFor(allow, x)?.pool) - Number(!!entryFor(allow, y)?.pool)
        || (lastSynced.get(x.externalId) ?? 0) - (lastSynced.get(y.externalId) ?? 0));
    const labelCount = new Map<string, number>();
    for (const l of leagues) { const k = `${l.country} · ${l.name}`; labelCount.set(k, (labelCount.get(k) ?? 0) + 1); }
    const label = (l: { name: string; country: string; externalId: string }) => {
      const k = `${l.country} · ${l.name}`;
      return labelCount.get(k)! > 1 ? `${k} #${l.externalId}` : k;
    };
    /**
     * Progress on stderr, one line per competition. The report is a single blob printed at the end,
     * which tells you nothing during a sync that now covers 265 competitions -- and nothing at all if
     * the run is killed. stderr keeps stdout parseable; cron captures both.
     */
    const note = (msg: string) => process.stderr.write(`${new Date().toISOString()} ${msg}\n`);
    note(`sync starting: ${leagues.length} competitions (* = gets the capped stats/odds/injury budget)`);
    let done = 0;
    let injuryCalls = 0, statsCalls = 0, oddsCalls = 0;
    const HISTORY_HOURS = Number(process.env.HISTORY_REFRESH_HOURS) || 24;
    const ODDS_CAP = Number(process.env.MAX_ODDS_CALLS) || 30;
    const STATS_CAP = Number(process.env.MAX_STATS_CALLS) || 30;
    for (const l of leagues) {
      const entry = entryFor(allow, l)!;
      const pool = entry.pool ? POOL_SETTINGS[entry.pool] : undefined;
      const league = await db.league.upsert({
        where: { provider_externalId_season: { provider, externalId: l.externalId, season: l.season } },
        update: { name: l.name, country: l.country, code: l.code, focusGroup: entry.focus, ratingPool: entry.pool ?? null, feedsPool: entry.feeds ?? null, neutral: !!entry.neutral, tier: entry.tier ?? 1 },
        create: { provider, externalId: l.externalId, name: l.name, country: l.country, code: l.code, season: l.season, focusGroup: entry.focus, ratingPool: entry.pool ?? null, feedsPool: entry.feeds ?? null, neutral: !!entry.neutral, tier: entry.tier ?? 1 },
      });
      const major = majorLeague(l);
      // Whole seasons in one request each (current + previous; 3 seasons for national teams).
      const fixtures: PFixture[] = [];
      const errors: string[] = [];
      // Finals tournaments (World Cup, Euro…) only exist in their own year: don't ask for earlier "seasons".
      // The current season is always re-read — its results change. Previous seasons are finished and
      // immutable, so re-downloading them every three hours was two thirds of the provider quota for
      // nothing; they refresh once a day instead.
      const historyDue = !league.historyAt || now.getTime() - league.historyAt.getTime() >= HISTORY_HOURS * 3600_000;
      const nSeasons = entry.neutral ? 1 : historyDue ? pool?.seasons ?? 2 : 1;
      for (let k = 0; k < nSeasons; k++) {
        try { fixtures.push(...(await p.getFixtures({ leagueId: l.externalId, season: l.season - k }))); }
        catch (e) { errors.push(`${l.season - k}: ${(e as Error).message}`); }
        await sleep(THROTTLE_MS[p.id]);
      }
      // Upcoming games: always ask for the upcoming window explicitly (some plans leave future fixtures out of season lists).
      try {
        fixtures.push(...(await p.getFixtures({ leagueId: l.externalId, season: l.season, from: ymd(now), to: ymd(addDays(now, FIXTURE_WINDOW_DAYS)) })));
      } catch (e) { errors.push(`upcoming window: ${(e as Error).message}`); }
      await sleep(THROTTLE_MS[p.id]);
      const oldest = addDays(now, -(pool?.historyDays ?? opts.historyDays ?? 450)).getTime();
      const keep = fixtures.filter((f) => f.kickoffUtc.getTime() >= oldest && f.kickoffUtc.getTime() <= addDays(now, FIXTURE_WINDOW_DAYS).getTime());
      if (!keep.length) { report[label(l)] = { fixtures: 0, errors }; note(`[${++done}/${leagues.length}] ${label(l)} — no fixtures${errors.length ? `: ${errors[0]}` : ""}`); continue; } // don't mark synced when nothing came back
      const seen = new Set<string>();
      for (const f of keep) {
        if (seen.has(f.externalId)) continue; seen.add(f.externalId);
        const [h, a] = await Promise.all([upsertTeam(db, provider, league.id, f.home), upsertTeam(db, provider, league.id, f.away)]);
        const data = {
          leagueId: league.id, season: f.season, round: f.round, kickoffUtc: f.kickoffUtc, status: f.status,
          homeTeamId: h.id, awayTeamId: a.id, homeGoals: f.homeGoals ?? null, awayGoals: f.awayGoals ?? null,
          ...(f.htHome != null && f.htAway != null ? { htHome: f.htHome, htAway: f.htAway } : {}),
          venue: f.venue,
          // only overwrite stats the provider actually sent (don't wipe backfilled corners/shots)
          ...(f.homeXg != null ? { homeXg: f.homeXg, awayXg: f.awayXg } : {}),
          ...(f.homeShots != null ? { homeShots: f.homeShots, awayShots: f.awayShots } : {}),
        };
        await db.fixture.upsert({ where: { provider_externalId: { provider, externalId: f.externalId } }, update: data, create: { provider, externalId: f.externalId, ...data } });
      }
      await db.league.update({ where: { id: league.id }, data: { lastSyncAt: new Date(), ...(historyDue ? { historyAt: new Date() } : {}) } });

      // Corners + total shots backfill (API-Football /fixtures/statistics: one request per match, newest first, capped per run)
      let stats = 0;
      if (p.id === "api-football" && major && statsCalls < STATS_CAP) {
        const need = await db.fixture.findMany({ where: { leagueId: league.id, status: "FINISHED", statsFetched: false, kickoffUtc: { gte: addDays(now, -400) } }, orderBy: { kickoffUtc: "desc" }, take: STATS_CAP - statsCalls });
        for (const f of need) {
          try {
            const st = await p.getStats(f.externalId);
            await db.fixture.update({ where: { id: f.id }, data: { statsFetched: true, ...(st ? { homeCorners: st.homeCorners, awayCorners: st.awayCorners, ...(st.homeShots != null ? { homeShots: st.homeShots, awayShots: st.awayShots } : {}) } : {}) } });
            stats++;
          } catch (e) { errors.push(`stats: ${(e as Error).message}`); break; }
          statsCalls++; await sleep(THROTTLE_MS[p.id]);
        }
      }
      // Bookmaker odds for the value list and the market baseline (API-Football), capped per run
      let quotes = 0;
      if (p.getLeagueOdds && major && oddsCalls < ODDS_CAP) {
        const soon = await db.fixture.findMany({ where: { leagueId: league.id, status: "SCHEDULED", kickoffUtc: { gt: now, lte: addDays(now, 7) } }, select: { id: true, externalId: true } });
        if (soon.length) {
          const byExt = new Map(soon.map((f) => [f.externalId, f.id]));
          for (let page = 1, pages = 1; page <= Math.min(pages, 5) && oddsCalls < ODDS_CAP; page++) {
            try {
              const r = await p.getLeagueOdds(l.externalId, l.season, page); oddsCalls++;
              if (!r) break;
              pages = r.pages;
              const rows = r.items.flatMap((it) => { const fid = byExt.get(it.fixtureExt); return fid ? Object.entries(it.quotes).map(([market, q]) => ({ fixtureId: fid, market, odds: q!.odds, best: q!.best, books: q!.books })) : []; });
              if (rows.length) { await db.oddsQuote.createMany({ data: rows }); quotes += rows.length; }
            } catch (e) { errors.push(`odds: ${(e as Error).message}`); break; }
            await sleep(THROTTLE_MS[p.id]);
          }
        }
      }
      const upcoming = new Set(keep.filter((f) => f.status === "SCHEDULED" && f.kickoffUtc > now).map((f) => f.externalId)).size;
      report[label(l)] = { fixtures: seen.size, upcoming, ...(stats ? { stats } : {}), ...(quotes ? { quotes } : {}), ...(errors.length ? { errors } : {}), ...await rateAndPredictLeague(db, league.id, {
        now,
        newsLoader: async (fx) => {
          if (fx.kickoffUtc.getTime() - now.getTime() > 24 * 3600_000) return null; // only fetch news close to kickoff
          if (!major) return null; // the injury budget goes to the leagues people bet on
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
      const r = report[label(l)] as { fixtures?: number; upcoming?: number; predictions?: number };
      note(`[${++done}/${leagues.length}] ${label(l)}${major ? " *" : ""} — ${r.fixtures ?? 0} fixtures, ${r.upcoming ?? 0} upcoming, ${r.predictions ?? 0} predictions · ${providerCalls.get()} requests so far`);
    }
    note(`all ${leagues.length} competitions done in ${providerCalls.get()} provider requests; running the ledger`);
    // Ledger: lock due calls, append results, refit calibration, refresh daily accuracy rows
    report.providerRequests = providerCalls.get();
    report.ledger = {
      locked: await lockDue(db, new Date()),
      settled: await settle(db, provider),
      calibration: await refitCalibration(db, provider),
      accuracyDays: await snapshotAccuracy(db, provider),
    };
    await db.syncLog.update({ where: { id: log.id }, data: { ok: true, finishedAt: new Date(), message: JSON.stringify(report).slice(0, 2000) } });
    return report;
  } catch (e) {
    await db.syncLog.update({ where: { id: log.id }, data: { ok: false, finishedAt: new Date(), message: (e as Error).message.slice(0, 2000) } });
    throw e;
  }
}
