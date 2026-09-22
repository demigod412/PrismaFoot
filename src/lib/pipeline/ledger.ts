import type { Prisma, PrismaClient, Provider } from "@prisma/client";
import { addDays, format } from "date-fns";
import { fitBinary } from "../model/calibration";
import { MODEL_VERSION } from "../model/constants";
import { allMarkets } from "../markets";
import { computeAccuracy, dailySeries, devig, tableFavourites, type ScoredCall, type Triple } from "../accuracy";
import type { FootballProvider } from "../providers/types";
import { LOCK_MINUTES } from "./predict";

const DAY = 86_400_000;
const json = (x: unknown) => JSON.parse(JSON.stringify(x)) as Prisma.InputJsonValue;

/**
 * T-15 lock. For every fixture reaching its lock moment, stamp the latest prediction that was generated BEFORE
 * that moment. lockedAt is set to the lock moment itself. A locked row is never modified again.
 */
export async function lockDue(db: PrismaClient, now = new Date()) {
  const due = await db.fixture.findMany({
    where: { kickoffUtc: { lte: new Date(now.getTime() + LOCK_MINUTES * 60_000), gte: new Date(now.getTime() - 7 * DAY) },
      predictions: { some: {}, none: { lockedAt: { not: null } } } },
    select: { id: true, kickoffUtc: true },
  });
  let locked = 0;
  for (const f of due) {
    const lockAt = new Date(f.kickoffUtc.getTime() - LOCK_MINUTES * 60_000);
    const p = await db.prediction.findFirst({ where: { fixtureId: f.id, generatedAt: { lte: lockAt } }, orderBy: { revision: "desc" } });
    if (!p) continue; // no call existed before the lock moment → nothing is scored for this match
    const r = await db.prediction.updateMany({ where: { id: p.id, lockedAt: null }, data: { lockedAt: lockAt } });
    locked += r.count;
  }
  return locked;
}

/**
 * Results refresh, cheap by design: only runs when a fixture that should have finished is not yet marked finished,
 * then asks the provider for those dates only (1 request per date).
 */
export async function syncResults(db: PrismaClient, p: FootballProvider, provider: Provider, now = new Date()) {
  const pending = await db.fixture.findMany({
    where: { provider, status: { in: ["SCHEDULED", "LIVE"] }, kickoffUtc: { lte: new Date(now.getTime() - 105 * 60_000), gte: new Date(now.getTime() - 3 * DAY) } },
    select: { kickoffUtc: true },
  });
  if (!pending.length) return { checked: 0, updated: 0 };
  const dates = [...new Set(pending.map((f) => format(f.kickoffUtc, "yyyy-MM-dd")))];
  let updated = 0;
  for (const date of dates) {
    const rs = await p.getResults({ date });
    for (const r of rs) {
      if (r.homeGoals == null || r.awayGoals == null) continue;
      const u = await db.fixture.updateMany({ where: { provider, externalId: r.externalId }, data: { status: r.status, homeGoals: r.homeGoals, awayGoals: r.awayGoals } });
      updated += u.count;
    }
  }
  return { checked: dates.length, updated };
}

/** Append a Result for every finished fixture without one; a changed score appends a correction (never edits). */
export async function settle(db: PrismaClient, provider?: Provider) {
  const fin = await db.fixture.findMany({
    where: { status: "FINISHED", homeGoals: { not: null }, awayGoals: { not: null }, ...(provider ? { provider } : {}), kickoffUtc: { gte: new Date(Date.now() - 30 * DAY) } },
    include: { results: { orderBy: { settledAt: "desc" }, take: 1 } },
  });
  let created = 0, corrected = 0;
  for (const f of fin) {
    const last = f.results[0];
    if (last && last.homeGoals === f.homeGoals && last.awayGoals === f.awayGoals) continue;
    await db.result.create({ data: { fixtureId: f.id, homeGoals: f.homeGoals!, awayGoals: f.awayGoals!, source: f.provider, supersedesId: last?.id ?? null } });
    if (last) corrected++; else created++;
  }
  return { created, corrected };
}

/** Load every locked + settled call for a provider (the ledger), with baselines attached. */
export async function loadScoredCalls(db: PrismaClient, provider: Provider, sinceDays = 365): Promise<ScoredCall[]> {
  const since = new Date(Date.now() - sinceDays * DAY);
  const preds = await db.prediction.findMany({
    where: { lockedAt: { not: null }, modelVersion: MODEL_VERSION, fixture: { provider, kickoffUtc: { gte: since }, results: { some: {} } } },
    include: { fixture: { include: { results: { orderBy: { settledAt: "desc" }, take: 1 } } } },
  });
  if (!preds.length) return [];
  const leagueIds = [...new Set(preds.map((p) => p.fixture.leagueId))];
  const finished = await db.fixture.findMany({
    where: { leagueId: { in: leagueIds }, status: "FINISHED", homeGoals: { not: null }, kickoffUtc: { gte: new Date(since.getTime() - 300 * DAY) } },
    select: { id: true, leagueId: true, kickoffUtc: true, homeTeamId: true, awayTeamId: true, homeGoals: true, awayGoals: true, season: true },
  });
  // Table favourite uses the current season's table only
  const seasonOf = new Map(preds.map((p) => [p.fixtureId, p.fixture.season]));
  const favs = tableFavourites(
    finished.map((f) => ({ id: f.id, leagueId: `${f.leagueId}:${f.season}`, kickoff: f.kickoffUtc, homeId: f.homeTeamId, awayId: f.awayTeamId, h: f.homeGoals!, a: f.awayGoals! })),
    preds.map((p) => ({ id: p.fixtureId, leagueId: `${p.fixture.leagueId}:${seasonOf.get(p.fixtureId)}`, kickoff: p.fixture.kickoffUtc, homeId: p.fixture.homeTeamId, awayId: p.fixture.awayTeamId })),
  );
  const quotes = await db.oddsQuote.findMany({ where: { fixtureId: { in: preds.map((p) => p.fixtureId) }, market: { in: ["home", "draw", "away"] } }, orderBy: { fetchedAt: "desc" } });
  return preds.map((p) => {
    const r = p.fixture.results[0];
    const before = (m: string) => quotes.find((q) => q.fixtureId === p.fixtureId && q.market === m && q.fetchedAt <= p.lockedAt!)?.odds;
    const o = [before("home"), before("draw"), before("away")];
    return {
      fixtureId: p.fixtureId, leagueId: p.fixture.leagueId, kickoff: p.fixture.kickoffUtc, band: p.band,
      cal: [p.calHome, p.calDraw, p.calAway] as Triple, raw: [p.rawHome, p.rawDraw, p.rawAway] as Triple,
      h: r.homeGoals, a: r.awayGoals, hc: p.fixture.homeCorners, ac: p.fixture.awayCorners, hs: p.fixture.homeShots, as: p.fixture.awayShots,
      cornersLine: p.cornersLine, shotsLine: p.shotsLine,
      markets: allMarkets(p, "Home", "Away"),
      tableFav: favs.get(p.fixtureId) ?? null,
      closing: o.every((x) => x && x > 1) ? devig(o as Triple) : null,
    };
  });
}

/**
 * Refit calibration from locked + settled calls (raw → outcome), per market. Needs ≥ 50 calls to leave identity.
 * Rows are replaced (old ones deactivated), so the next prediction run uses the new maps.
 */
export async function refitCalibration(db: PrismaClient, provider: Provider) {
  const preds = await db.prediction.findMany({
    where: { lockedAt: { not: null }, modelVersion: MODEL_VERSION, fixture: { provider, results: { some: {} } } },
    include: { fixture: { include: { results: { orderBy: { settledAt: "desc" }, take: 1 } } } },
  });
  const sets: Record<string, { p: number[]; y: (0 | 1)[] }> = {};
  const add = (m: string, p: number, y: boolean) => { (sets[m] ??= { p: [], y: [] }).p.push(p); sets[m].y.push(y ? 1 : 0); };
  for (const p of preds) {
    const r = p.fixture.results[0]; const h = r.homeGoals, a = r.awayGoals, t = h + a;
    add("1x2_home", p.rawHome, h > a); add("1x2_draw", p.rawDraw, h === a); add("1x2_away", p.rawAway, a > h);
    add("ou15", p.rawOver15, t >= 2); add("ou25", p.rawOver25, t >= 3); add("ou35", p.rawOver35, t >= 4); add("ou45", p.rawOver45, t >= 5);
    add("btts", p.rawBtts, h > 0 && a > 0);
  }
  const out: Record<string, string> = {};
  for (const [market, d] of Object.entries(sets)) {
    const c = fitBinary(d.p, d.y);
    await db.calibrationModel.updateMany({ where: { provider, modelVersion: MODEL_VERSION, market, active: true }, data: { active: false } });
    await db.calibrationModel.create({ data: { provider, modelVersion: MODEL_VERSION, market, method: c.method, n: c.n, knots: c.knots } });
    out[market] = `${c.method}(${c.n})`;
  }
  return { calls: preds.length, markets: out };
}

/** Store daily accuracy rows for the last few days (recomputed; unique per day+scope). */
export async function snapshotAccuracy(db: PrismaClient, provider: Provider, days = 4) {
  const calls = await loadScoredCalls(db, provider, days + 1);
  const series = dailySeries(calls);
  for (const { day, report: r } of series) {
    const date = new Date(`${day}T00:00:00Z`);
    const ou25 = r.markets.filter((m) => m.key === "over25" || m.key === "under25");
    const btts = r.markets.filter((m) => m.key === "btts_yes" || m.key === "btts_no");
    const rate = (xs: typeof ou25) => { const n = xs.reduce((s, x) => s + x.n, 0); return n ? xs.reduce((s, x) => s + x.hit * x.n, 0) / n : 0; };
    const data = {
      n: r.n, brier1x2: r.model.brier, logloss1x2: r.model.logloss, hit1x2: r.model.hit, hitOu25: rate(ou25), hitBtts: rate(btts),
      byBand: json(r.byBand), baselineHome: json(r.alwaysHome), baselineTable: json(r.tableFav),
      ...(r.market ? { baselineMarket: json(r.market) } : {}),
    };
    await db.accuracyDaily.upsert({
      where: { date_modelVersion_scope: { date, modelVersion: MODEL_VERSION, scope: provider } },
      update: data, create: { date, modelVersion: MODEL_VERSION, scope: provider, ...data },
    });
  }
  return series.length;
}

export { computeAccuracy };
export const addDaysUtc = addDays;
