import type { League, Prisma, PrismaClient, Fixture, Team } from "@prisma/client";
import { fitLeague, type HistMatch, type LeagueFit, type TeamPrior } from "../model/ratings";
import { predictFixture, type NewsInput } from "../model/predict";
import { IDENTITY_SET, type Calibrator, type CalibratorSet } from "../model/calibration";
import { MODEL_VERSION } from "../model/constants";
import { POOL_SETTINGS } from "../leagues";
import { fitRates, predictTotal, MIN_RATE_MATCHES, type RateFit, type RateMatch } from "../model/rates";
import { FIXTURE_WINDOW_DAYS } from "../window";

export type NewsLoader = (fx: { id: string; externalId: string; kickoffUtc: Date; homeExt: string; awayExt: string }) =>
  Promise<{ home: NewsInput; away: NewsInput } | null>;

const DAY = 86_400_000;
export const LOCK_MINUTES = Number(process.env.PREDICTION_LOCK_MINUTES ?? 15);
const PREV_SEASON_WEIGHT = 0.85;  // last season still counts, a little less (squads change)
const PRIOR_WEIGHT = 8;           // pseudo-matches behind a promoted/relegated prior
const NEWCOMER_MATCHES = 6;       // fewer matches than this in the league ⇒ use a prior
const CORNERS_LINE = 8.5, SHOTS_LINE = 24.5;

type Hist = Fixture & { homeTeam: Team; awayTeam: Team };

export async function loadCalibrators(db: PrismaClient, provider: League["provider"]): Promise<{ set: CalibratorSet; residual: number }> {
  const rows = await db.calibrationModel.findMany({ where: { modelVersion: MODEL_VERSION, active: true, provider } });
  if (!rows.length) return { set: IDENTITY_SET, residual: 0 };
  const by = (m: string): Calibrator => {
    const r = rows.find((x) => x.market === m);
    return r ? { method: r.method as Calibrator["method"], n: r.n, knots: r.knots as [number, number][] } : IDENTITY_SET.home;
  };
  const set: CalibratorSet = { home: by("1x2_home"), draw: by("1x2_draw"), away: by("1x2_away"), over15: by("ou15"), over25: by("ou25"), over35: by("ou35"), over45: by("ou45"), btts: by("btts") };
  const ks = [set.home, set.draw, set.away].flatMap((c) => c.knots);
  const residual = ks.reduce((s, [x, y]) => s + Math.abs(y - x), 0) / (ks.length || 1);
  return { set, residual };
}

/** Everything needed to predict fixtures of one league as of `now`. Built once per league per run. */
export interface LeagueContext {
  league: League;
  now: Date;
  key: (t: { id: string; externalId: string }) => string;
  hist: Hist[];
  fit: LeagueFit;
  cornerFit: RateFit | null;
  shotFit: RateFit | null;
  cal: CalibratorSet; residual: number;
  priorKeys: Set<string>;
  seasonCount: Map<string, number>; // matches this season per team key
}

/**
 * Newly promoted / relegated teams: start from their record in the league they came from, adjusted for the tier change.
 *   came up a tier:   a = 0.85·√a_prev,  d = 1.15·√d_prev
 *   came down a tier: a = 1.12·√a_prev,  d = 0.90·√d_prev
 *   no record found:  top flight → a 0.85, d 1.15 (typical promoted side); other tiers → league average
 */
async function newcomerPriors(db: PrismaClient, league: League, teams: Team[], countInLeague: Map<string, number>, now: Date) {
  const priors = new Map<string, TeamPrior>();
  const fitCache = new Map<string, LeagueFit>();
  for (const t of teams) {
    if ((countInLeague.get(t.id) ?? 0) >= NEWCOMER_MATCHES) continue;
    const other = await db.fixture.groupBy({
      by: ["leagueId"],
      where: {
        provider: league.provider, status: "FINISHED", leagueId: { not: league.id }, kickoffUtc: { gte: new Date(now.getTime() - 450 * DAY), lt: now },
        league: { ratingPool: null }, // domestic leagues only
        OR: [{ homeTeam: { externalId: t.externalId } }, { awayTeam: { externalId: t.externalId } }],
      },
      _count: { _all: true },
    });
    const best = other.sort((a, b) => b._count._all - a._count._all)[0];
    let prior: TeamPrior = league.tier === 1 ? { a: 0.85, d: 1.15, weight: PRIOR_WEIGHT } : { a: 1, d: 1, weight: PRIOR_WEIGHT };
    if (best && best._count._all >= 8) {
      const otherLeague = await db.league.findUnique({ where: { id: best.leagueId } });
      if (otherLeague) {
        let f = fitCache.get(otherLeague.id);
        if (!f) {
          const oh = await db.fixture.findMany({
            where: { leagueId: otherLeague.id, status: "FINISHED", homeGoals: { not: null }, kickoffUtc: { gte: new Date(now.getTime() - 450 * DAY), lt: now } },
            include: { homeTeam: true, awayTeam: true },
          });
          f = fitLeague(oh.map((x) => ({ homeId: x.homeTeam.externalId, awayId: x.awayTeam.externalId, date: x.kickoffUtc, homeGoals: x.homeGoals!, awayGoals: x.awayGoals! })), now);
          fitCache.set(otherLeague.id, f);
        }
        const r = f.teams.get(t.externalId);
        if (r) {
          const aRel = Math.sqrt(r.attack / f.base), dRel = Math.sqrt(r.defence);
          const diff = otherLeague.tier - league.tier; // > 0: came up from a lower tier
          prior = diff > 0 ? { a: 0.85 * aRel, d: 1.15 * dRel, weight: PRIOR_WEIGHT }
            : diff < 0 ? { a: 1.12 * aRel, d: 0.9 * dRel, weight: PRIOR_WEIGHT }
            : { a: aRel, d: dRel, weight: PRIOR_WEIGHT };
        }
      }
    }
    priors.set(t.id, prior);
  }
  return priors;
}

export async function buildContext(db: PrismaClient, leagueId: string, now: Date): Promise<LeagueContext> {
  const league = await db.league.findUniqueOrThrow({ where: { id: leagueId } });
  const pool = league.ratingPool ? POOL_SETTINGS[league.ratingPool] : undefined;
  // Pooled competitions (national teams, European cups) are rated together with every league that feeds the pool,
  // matching teams by provider id across competitions.
  const leagueIds = league.ratingPool
    ? (await db.league.findMany({ where: { provider: league.provider, OR: [{ ratingPool: league.ratingPool }, { feedsPool: league.ratingPool }] }, select: { id: true } })).map((l) => l.id)
    : [leagueId];
  const key = (t: { id: string; externalId: string }) => (league.ratingPool ? t.externalId : t.id);

  const hist = await db.fixture.findMany({
    where: { leagueId: { in: leagueIds }, status: "FINISHED", homeGoals: { not: null }, kickoffUtc: { gte: new Date(now.getTime() - (pool?.historyDays ?? 450) * DAY), lt: now } },
    include: { homeTeam: true, awayTeam: true }, orderBy: { kickoffUtc: "asc" },
  });
  const ms: HistMatch[] = hist.map((f) => ({
    homeId: key(f.homeTeam), awayId: key(f.awayTeam), date: f.kickoffUtc, homeGoals: f.homeGoals!, awayGoals: f.awayGoals!,
    homeXg: f.homeXg, awayXg: f.awayXg, homeShots: f.homeShots, awayShots: f.awayShots,
    weight: f.season < league.season ? PREV_SEASON_WEIGHT : 1,
  }));

  const leagueTeams = await db.team.findMany({ where: { leagueId } });
  const countInLeague = new Map<string, number>(), seasonCount = new Map<string, number>();
  for (const f of hist) {
    for (const t of [f.homeTeam, f.awayTeam]) {
      countInLeague.set(key(t), (countInLeague.get(key(t)) ?? 0) + 1);
      if (f.season >= league.season) seasonCount.set(key(t), (seasonCount.get(key(t)) ?? 0) + 1);
    }
  }
  const priors = league.ratingPool ? new Map<string, TeamPrior>() : await newcomerPriors(db, league, leagueTeams, countInLeague, now);
  const fit = fitLeague(ms, now, { halfLifeDays: pool?.halfLifeDays, priors });

  const rateSet = (hk: "Corners" | "Shots") => hist.flatMap<RateMatch>((f) => {
    const h = f[`home${hk}`], a = f[`away${hk}`];
    return h != null && a != null ? [{ homeId: key(f.homeTeam), awayId: key(f.awayTeam), date: f.kickoffUtc, h, a }] : [];
  });
  const cornerMs = rateSet("Corners"), shotMs = rateSet("Shots");
  const { set, residual } = await loadCalibrators(db, league.provider);
  return {
    league, now, key, hist, fit,
    cornerFit: cornerMs.length >= MIN_RATE_MATCHES ? fitRates(cornerMs, now) : null,
    shotFit: shotMs.length >= MIN_RATE_MATCHES ? fitRates(shotMs, now) : null,
    cal: set, residual, priorKeys: new Set(priors.keys()), seasonCount,
  };
}

type FixtureWithTeams = Fixture & { homeTeam: Team; awayTeam: Team };

/**
 * Write a prediction for one fixture if its inputs changed. Returns true when a row was written.
 * Never touches a locked row; `lockAt` is only used by the demo seeder to create historic locked calls.
 */
export async function writePrediction(db: PrismaClient, ctx: LeagueContext, fx: FixtureWithTeams,
  opts: { news?: { home: NewsInput; away: NewsInput } | null; generatedAt?: Date; lockAt?: Date } = {}): Promise<boolean> {
  const prev = await db.prediction.findFirst({ where: { fixtureId: fx.id }, orderBy: { revision: "desc" } });
  if (prev?.lockedAt) return false; // locked snapshots are immutable
  const { key, hist, fit } = ctx;
  const hk = key(fx.homeTeam), ak = key(fx.awayTeam);
  const played = (k: string) => hist.filter((f) => (key(f.homeTeam) === k || key(f.awayTeam) === k) && f.kickoffUtc < fx.kickoffUtc);
  const form = (k: string) => played(k).slice(-5).reverse()
    .map((f) => { const home = key(f.homeTeam) === k; const gf = home ? f.homeGoals! : f.awayGoals!, ga = home ? f.awayGoals! : f.homeGoals!; return gf > ga ? "W" : gf === ga ? "D" : "L"; }).join("");
  const lh = played(hk).at(-1), la = played(ak).at(-1);
  const early = (ctx.seasonCount.get(hk) ?? 0) < 6 || (ctx.seasonCount.get(ak) ?? 0) < 6;

  const out = predictFixture({
    fit, homeId: hk, awayId: ak, homeName: fx.homeTeam.shortName ?? fx.homeTeam.name, awayName: fx.awayTeam.shortName ?? fx.awayTeam.name,
    kickoff: fx.kickoffUtc,
    restHomeDays: lh ? Math.round((fx.kickoffUtc.getTime() - lh.kickoffUtc.getTime()) / DAY) : null,
    restAwayDays: la ? Math.round((fx.kickoffUtc.getTime() - la.kickoffUtc.getTime()) / DAY) : null,
    newsHome: opts.news?.home ?? null, newsAway: opts.news?.away ?? null,
    formHome: form(hk), formAway: form(ak),
    calibrators: ctx.cal, calibrationResidual: ctx.residual, neutral: ctx.league.neutral,
    earlySeason: early, priorHome: ctx.priorKeys.has(hk), priorAway: ctx.priorKeys.has(ak),
  });
  const corners = ctx.cornerFit ? predictTotal(ctx.cornerFit, hk, ak, CORNERS_LINE) : null;
  const shots = ctx.shotFit ? predictTotal(ctx.shotFit, hk, ak, SHOTS_LINE) : null;
  const capLow = (x: number) => (out.band === "LOW" ? Math.min(0.89, Math.max(0.11, x)) : x);
  if (!corners) out.dataFlags.push("no_corner_data");
  if (!shots) out.dataFlags.push("no_shot_data");
  // New revision only when inputs changed, or corners/shots became available
  if (prev && prev.inputsHash === out.inputsHash && (prev.expCorners != null) === !!corners && (prev.expShots != null) === !!shots) return false;

  await db.prediction.create({ data: {
    fixtureId: fx.id, modelVersion: out.modelVersion, revision: (prev?.revision ?? 0) + 1, inputsHash: out.inputsHash,
    ...(opts.generatedAt ? { generatedAt: opts.generatedAt } : {}),
    lockedAt: opts.lockAt ?? null,
    lambdaHome: out.lambdaHome, lambdaAway: out.lambdaAway, rho: out.rho,
    rawHome: out.raw.home, rawDraw: out.raw.draw, rawAway: out.raw.away, rawOver15: out.raw.over15, rawOver25: out.raw.over25, rawOver35: out.raw.over35, rawOver45: out.raw.over45, rawBtts: out.raw.btts,
    calHome: out.cal.home, calDraw: out.cal.draw, calAway: out.cal.away, calOver15: out.cal.over15, calOver25: out.cal.over25, calOver35: out.cal.over35, calOver45: out.cal.over45, calBtts: out.cal.btts,
    predHomeGoals: out.predHomeGoals, predAwayGoals: out.predAwayGoals,
    topScorelines: out.topScorelines as unknown as Prisma.InputJsonValue, matrix: out.matrix,
    rawHomeBy2: out.rawBy2.home, rawAwayBy2: out.rawBy2.away, calHomeBy2: capLow(out.calBy2.home), calAwayBy2: capLow(out.calBy2.away),
    ...(corners ? { cornersLine: CORNERS_LINE, expCorners: corners.expected, rawCornersOver: corners.over, calCornersOver: capLow(corners.over) } : {}),
    ...(shots ? { shotsLine: SHOTS_LINE, expShots: shots.expected, rawShotsOver: shots.over, calShotsOver: capLow(shots.over) } : {}),
    confidence: out.confidence, band: out.band, dataFlags: out.dataFlags,
    rationale: out.rationale, features: out.features as Prisma.InputJsonValue,
  } });
  return true;
}

/** Rate the league, then predict every fixture from T-15 minutes out to the end of the window. */
export async function rateAndPredictLeague(db: PrismaClient, leagueId: string, opts: { now?: Date; newsLoader?: NewsLoader } = {}) {
  const now = opts.now ?? new Date();
  const ctx = await buildContext(db, leagueId, now);
  await db.league.update({ where: { id: leagueId }, data: { homeAdv: ctx.fit.homeAdv, rho: ctx.fit.rho, baseGoals: ctx.fit.base, volatility: ctx.fit.volatility } });
  const leagueTeams = await db.team.findMany({ where: { leagueId } });
  const snaps = leagueTeams.flatMap((t) => { const r = ctx.fit.teams.get(ctx.key(t)); return r ? [{ teamId: t.id, asOf: now, modelVersion: MODEL_VERSION, inputKind: ctx.fit.inputKind, attack: r.attack, defence: r.defence, sampleWeight: r.sampleWeight, matches: r.matches }] : []; });
  if (snaps.length) await db.teamRatingSnapshot.createMany({ data: snaps });

  // Nothing is (re)predicted inside the lock window: from T-15 the locked call is final.
  const upcoming = await db.fixture.findMany({
    where: { leagueId, status: "SCHEDULED", kickoffUtc: { gt: new Date(now.getTime() + LOCK_MINUTES * 60_000), lte: new Date(now.getTime() + FIXTURE_WINDOW_DAYS * DAY) } },
    include: { homeTeam: true, awayTeam: true },
  });
  let written = 0;
  for (const fx of upcoming) {
    const news = opts.newsLoader ? await opts.newsLoader({ id: fx.id, externalId: fx.externalId, kickoffUtc: fx.kickoffUtc, homeExt: fx.homeTeam.externalId, awayExt: fx.awayTeam.externalId }) : null;
    if (await writePrediction(db, ctx, fx, { news })) written++;
  }
  return { fitted: ctx.fit.teams.size, pooledMatches: ctx.hist.length, newcomers: ctx.priorKeys.size, inputKind: ctx.fit.inputKind, predictions: written };
}
