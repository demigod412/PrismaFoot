import type { Prisma, PrismaClient } from "@prisma/client";
import { fitLeague, type HistMatch } from "../model/ratings";
import { predictFixture, type NewsInput } from "../model/predict";
import { IDENTITY_SET, type Calibrator, type CalibratorSet } from "../model/calibration";
import { MODEL_VERSION } from "../model/constants";
import { POOL_SETTINGS } from "../leagues";

export type NewsLoader = (fx: { id: string; externalId: string; kickoffUtc: Date; homeExt: string; awayExt: string }) =>
  Promise<{ home: NewsInput; away: NewsInput } | null>;

const DAY = 86_400_000;

async function loadCalibrators(db: PrismaClient): Promise<{ set: CalibratorSet; residual: number }> {
  const rows = await db.calibrationModel.findMany({ where: { modelVersion: MODEL_VERSION, active: true } });
  if (!rows.length) return { set: IDENTITY_SET, residual: 0 };
  const by = (m: string): Calibrator => {
    const r = rows.find((x) => x.market === m);
    return r ? { method: r.method as Calibrator["method"], n: r.n, knots: r.knots as [number, number][] } : IDENTITY_SET.home;
  };
  const set: CalibratorSet = { home: by("1x2_home"), draw: by("1x2_draw"), away: by("1x2_away"), over15: by("ou15"), over25: by("ou25"), over35: by("ou35"), over45: by("ou45"), btts: by("btts") };
  // residual proxy: average |f(x) − x| over the 1X2 knots
  const ks = [set.home, set.draw, set.away].flatMap((c) => c.knots);
  const residual = ks.reduce((s, [x, y]) => s + Math.abs(y - x), 0) / (ks.length || 1);
  return { set, residual };
}

/** Rate every team in the league, then write a new prediction row for each unlocked fixture whose inputs changed. */
export async function rateAndPredictLeague(db: PrismaClient, leagueId: string, opts: { now?: Date; newsLoader?: NewsLoader } = {}) {
  const now = opts.now ?? new Date();
  const league = await db.league.findUniqueOrThrow({ where: { id: leagueId } });
  const pool = league.ratingPool ? POOL_SETTINGS[league.ratingPool] : undefined;
  // Pooled competitions (national teams) are rated together, matching teams by provider id across competitions.
  const leagueIds = league.ratingPool
    ? (await db.league.findMany({ where: { provider: league.provider, ratingPool: league.ratingPool }, select: { id: true } })).map((l) => l.id)
    : [leagueId];
  const key = (t: { id: string; externalId: string }) => (league.ratingPool ? t.externalId : t.id);

  const hist = await db.fixture.findMany({
    where: { leagueId: { in: leagueIds }, status: "FINISHED", homeGoals: { not: null }, kickoffUtc: { gte: new Date(now.getTime() - (pool?.historyDays ?? 450) * DAY), lt: now } },
    include: { homeTeam: true, awayTeam: true }, orderBy: { kickoffUtc: "asc" },
  });
  const ms: HistMatch[] = hist.map((f) => ({
    homeId: key(f.homeTeam), awayId: key(f.awayTeam), date: f.kickoffUtc, homeGoals: f.homeGoals!, awayGoals: f.awayGoals!,
    homeXg: f.homeXg, awayXg: f.awayXg, homeShots: f.homeShots, awayShots: f.awayShots,
  }));
  const fit = fitLeague(ms, now, { halfLifeDays: pool?.halfLifeDays });

  await db.league.update({ where: { id: leagueId }, data: { homeAdv: fit.homeAdv, rho: fit.rho, baseGoals: fit.base, volatility: fit.volatility } });
  const leagueTeams = await db.team.findMany({ where: { leagueId } });
  const snaps = leagueTeams.flatMap((t) => { const r = fit.teams.get(key(t)); return r ? [{ teamId: t.id, asOf: now, modelVersion: MODEL_VERSION, inputKind: fit.inputKind, attack: r.attack, defence: r.defence, sampleWeight: r.sampleWeight, matches: r.matches }] : []; });
  if (snaps.length) await db.teamRatingSnapshot.createMany({ data: snaps });

  const { set, residual } = await loadCalibrators(db);
  const upcoming = await db.fixture.findMany({
    where: { leagueId, status: "SCHEDULED", kickoffUtc: { gte: now, lte: new Date(now.getTime() + 14 * DAY) } },
    include: { homeTeam: true, awayTeam: true, predictions: { orderBy: { revision: "desc" }, take: 1 } },
  });

  const played = (k: string, before: Date) => [...hist].reverse().filter((f) => (key(f.homeTeam) === k || key(f.awayTeam) === k) && f.kickoffUtc < before);
  const form = (k: string, before: Date) => played(k, before).slice(0, 5)
    .map((f) => { const home = key(f.homeTeam) === k; const gf = home ? f.homeGoals! : f.awayGoals!, ga = home ? f.awayGoals! : f.homeGoals!; return gf > ga ? "W" : gf === ga ? "D" : "L"; }).join("");

  let written = 0;
  for (const fx of upcoming) {
    const prev = fx.predictions[0];
    if (prev?.lockedAt) continue; // locked snapshots are immutable
    const hk = key(fx.homeTeam), ak = key(fx.awayTeam);
    const lh = played(hk, fx.kickoffUtc)[0], la = played(ak, fx.kickoffUtc)[0];
    const news = opts.newsLoader ? await opts.newsLoader({ id: fx.id, externalId: fx.externalId, kickoffUtc: fx.kickoffUtc, homeExt: fx.homeTeam.externalId, awayExt: fx.awayTeam.externalId }) : null;
    const out = predictFixture({
      fit, homeId: hk, awayId: ak, homeName: fx.homeTeam.shortName ?? fx.homeTeam.name, awayName: fx.awayTeam.shortName ?? fx.awayTeam.name,
      kickoff: fx.kickoffUtc,
      restHomeDays: lh ? Math.round((fx.kickoffUtc.getTime() - lh.kickoffUtc.getTime()) / DAY) : null,
      restAwayDays: la ? Math.round((fx.kickoffUtc.getTime() - la.kickoffUtc.getTime()) / DAY) : null,
      newsHome: news?.home ?? null, newsAway: news?.away ?? null,
      formHome: form(hk, fx.kickoffUtc), formAway: form(ak, fx.kickoffUtc),
      calibrators: set, calibrationResidual: residual, neutral: league.neutral,
    });
    if (prev && prev.inputsHash === out.inputsHash) continue;
    await db.prediction.create({ data: {
      fixtureId: fx.id, modelVersion: out.modelVersion, revision: (prev?.revision ?? 0) + 1, inputsHash: out.inputsHash,
      lambdaHome: out.lambdaHome, lambdaAway: out.lambdaAway, rho: out.rho,
      rawHome: out.raw.home, rawDraw: out.raw.draw, rawAway: out.raw.away, rawOver15: out.raw.over15, rawOver25: out.raw.over25, rawOver35: out.raw.over35, rawOver45: out.raw.over45, rawBtts: out.raw.btts,
      calHome: out.cal.home, calDraw: out.cal.draw, calAway: out.cal.away, calOver15: out.cal.over15, calOver25: out.cal.over25, calOver35: out.cal.over35, calOver45: out.cal.over45, calBtts: out.cal.btts,
      predHomeGoals: out.predHomeGoals, predAwayGoals: out.predAwayGoals,
      topScorelines: out.topScorelines as unknown as Prisma.InputJsonValue, matrix: out.matrix,
      confidence: out.confidence, band: out.band, dataFlags: out.dataFlags,
      rationale: out.rationale, features: out.features as Prisma.InputJsonValue,
    } });
    written++;
  }
  return { fitted: fit.teams.size, pooledMatches: ms.length, inputKind: fit.inputKind, predictions: written };
}
