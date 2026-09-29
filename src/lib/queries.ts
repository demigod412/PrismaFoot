import "server-only";
import type { Prisma } from "@prisma/client";
import { prisma } from "./db";
import { dataMode } from "./mode";
import { FIXTURE_WINDOW_DAYS } from "./window";

const DAY = 86_400_000;

/** Latest prediction revision per fixture (the locked one if locked, otherwise newest). */
/*
 * ── Why a list query omits four columns ─────────────────────────────────────────────────────────────
 *
 * A Prediction carries four Json blobs: `matrix` (an 11×11 score grid), `topScorelines`, `rationale` and
 * `features`. On a single match page they are the point. In a list they are dead weight — and once the
 * league allowlist went from about twenty competitions to 263, that weight stopped being survivable.
 *
 * The scanner loads every fixture in a three-week window. At twenty leagues that was a few hundred rows;
 * at 263 it is ten thousand-plus, and Prisma deserialising all those blobs into JS objects took
 * next-server to 1.5GB and got it OOM-killed — three times, twice inside ten minutes. The processes were
 * not leaking; one request genuinely asked for that much.
 *
 * So lists omit them, and the pages that need them ask. `omit` rather than an explicit `select` on
 * purpose: a column added later is then included automatically instead of silently missing everywhere.
 */
export const HEAVY_JSON = { matrix: true, topScorelines: true, rationale: true, features: true } as const;

export const withLatestPrediction = {
  homeTeam: true, awayTeam: true, league: true,
  predictions: { orderBy: [{ lockedAt: { sort: "desc", nulls: "last" } }, { revision: "desc" }], take: 1 },
} satisfies Prisma.FixtureInclude;

/** The same, without the heavy blobs. What every list and board should use. */
export const withLatestPredictionLean = {
  homeTeam: true, awayTeam: true, league: true,
  predictions: {
    orderBy: [{ lockedAt: { sort: "desc", nulls: "last" } }, { revision: "desc" }],
    take: 1,
    omit: HEAVY_JSON,
  },
} satisfies Prisma.FixtureInclude;

/** Lean, but keeping `matrix` — for the two scanners that read the scoreline grid. */
export const withLatestPredictionMatrix = {
  homeTeam: true, awayTeam: true, league: true,
  predictions: {
    orderBy: [{ lockedAt: { sort: "desc", nulls: "last" } }, { revision: "desc" }],
    take: 1,
    omit: { topScorelines: true, rationale: true, features: true },
  },
} satisfies Prisma.FixtureInclude;

export type BoardFixture = Prisma.FixtureGetPayload<{ include: typeof withLatestPredictionLean }>;

/**
 * Fixtures for a board or a scanner.
 *
 * `matrix` is opt-in because only two scanners read it, and `take` is a hard ceiling rather than a
 * suggestion: a window that quietly grows with the league list is how one request came to ask for a
 * gigabyte and a half.
 */
interface BoardOpts { from: Date; to: Date; leagueId?: string; focus?: string; take?: number }
const boardWhere = (provider: Prisma.FixtureWhereInput["provider"], o: BoardOpts) => ({
  provider, kickoffUtc: { gte: o.from, lt: o.to },
  ...(o.leagueId ? { leagueId: o.leagueId } : {}),
  ...(o.focus ? { league: { focusGroup: o.focus } } : {}),
});

/**
 * Fixtures for a board or a list, without the heavy Json.
 *
 * `take` is a ceiling rather than a suggestion. A window that grows with the league list is how one
 * request came to ask for a gigabyte and a half; kickoff order means the cut falls furthest out.
 */
export async function getBoard(opts: BoardOpts) {
  const { provider } = await dataMode();
  return prisma.fixture.findMany({
    where: boardWhere(provider, opts),
    include: withLatestPredictionLean,
    orderBy: [{ kickoffUtc: "asc" }],
    ...(opts.take ? { take: opts.take } : {}),
  });
}

/** The same, keeping `matrix`. Only the two scanners that read the scoreline grid should use this. */
export async function getBoardWithMatrix(opts: BoardOpts) {
  const { provider } = await dataMode();
  return prisma.fixture.findMany({
    where: boardWhere(provider, opts),
    include: withLatestPredictionMatrix,
    orderBy: [{ kickoffUtc: "asc" }],
    ...(opts.take ? { take: opts.take } : {}),
  });
}

/** Fixtures a list query can carry at once. Kickoff order, so the cut falls on the furthest away. */
export const BOARD_LIMIT = Number(process.env.BOARD_LIMIT) || 2500;
/** Candidates handed to the blend builder, which serialises every one of them into the HTML. */
export const BLEND_LIMIT = Number(process.env.BLEND_LIMIT) || 250;
/*
 * Fixtures the odds builder searches over.
 *
 * Lower than the others because the builder is the one page that multiplies: every fixture becomes
 * twenty-odd candidate legs, and the slip search then works over the lot. Six hundred fixtures is
 * already fifteen thousand legs, which is far more than enough to hit any target the page offers —
 * fourteen days of 263 competitions would be a quarter of a million.
 */
export const BUILDER_LIMIT = Number(process.env.BUILDER_LIMIT) || 600;

export async function getLeagues() {
  const { provider } = await dataMode();
  return prisma.league.findMany({ where: { provider }, orderBy: [{ focusGroup: "asc" }, { name: "asc" }] });
}

export async function getMatch(id: string) {
  const fx = await prisma.fixture.findUnique({ where: { id }, include: { ...withLatestPrediction, results: { orderBy: { settledAt: "desc" }, take: 1 } } });
  if (!fx) return null;
  const teamGames = (teamId: string) => prisma.fixture.findMany({
    where: { status: "FINISHED", kickoffUtc: { lt: fx.kickoffUtc }, OR: [{ homeTeamId: teamId }, { awayTeamId: teamId }] },
    include: { homeTeam: true, awayTeam: true }, orderBy: { kickoffUtc: "desc" }, take: 10,
  });
  const [homeLast, awayLast, h2h] = await Promise.all([
    teamGames(fx.homeTeamId), teamGames(fx.awayTeamId),
    prisma.fixture.findMany({
      where: { status: "FINISHED", OR: [{ homeTeamId: fx.homeTeamId, awayTeamId: fx.awayTeamId }, { homeTeamId: fx.awayTeamId, awayTeamId: fx.homeTeamId }] },
      include: { homeTeam: true, awayTeam: true }, orderBy: { kickoffUtc: "desc" }, take: 6,
    }),
  ]);
  return { fx, homeLast, awayLast, h2h };
}

export async function next48h() {
  const now = new Date();
  return getBoard({ from: new Date(now.getTime() - 2 * 3600_000), to: new Date(now.getTime() + 2 * DAY) });
}
export async function window14d() {
  const now = new Date();
  return getBoard({ from: new Date(now.getTime() - 2 * 3600_000), to: new Date(now.getTime() + FIXTURE_WINDOW_DAYS * DAY) });
}
