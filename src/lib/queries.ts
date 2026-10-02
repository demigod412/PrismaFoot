import "server-only";
import { Prisma as PrismaNS } from "@prisma/client";
import type { Prediction, Prisma } from "@prisma/client";
import type { MarketSource } from "./markets";
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

/** Everything but the three blobs only the match page opens - `matrix` is kept. */
const MATRIX_OMIT = { topScorelines: true, rationale: true, features: true } as const;
export type MatrixSource = Omit<Prediction, "topScorelines" | "rationale" | "features">;

/** A fixture's own relations. No predictions: those are attached separately, deliberately. */
export const fixtureBaseInclude = { homeTeam: true, awayTeam: true, league: true } satisfies Prisma.FixtureInclude;

type WithBase = Prisma.FixtureGetPayload<{ include: typeof fixtureBaseInclude }>;
export type BoardFixture = WithBase & { predictions: MarketSource[] };
export type BoardFixtureWithMatrix = WithBase & { predictions: MatrixSource[] };

/*
 * -- Why the latest prediction is fetched separately -------------------------------------------------
 *
 * The obvious form is `include: { predictions: { orderBy: [...], take: 1 } }`, and every list here used
 * to do that. It is a trap wherever a fixture has more than a couple of revisions.
 *
 * Prisma cannot express "the newest row per parent" in SQL through a nested take, so it does not try. It
 * issues `SELECT <every column> FROM "Prediction" WHERE "fixtureId" IN (...)` - no ORDER BY, no LIMIT -
 * pulls EVERY revision of EVERY fixture into its query engine, and does the ordering and the take: 1
 * there, in memory.
 *
 * Measured on the sister app, which shares this design: a page showing 323 games at 23 revisions each
 * spent 2.0 seconds in SQL and 119 seconds in that in-engine sort. It is invisible from JS, because the
 * rows never reach V8, and invisible in the query log, because the one statement looks cheap and is.
 *
 * Moving the sort into JS does not help either - that was the first attempt there, and it turned 121
 * seconds into an out-of-memory kill, because the rows then get deserialised into objects. The cost is
 * fetching every revision in order to use one of them.
 *
 * So: one cheap query to pick the winners by id, then one to fetch exactly those rows.
 */
async function winningPredictionIds(fixtureIds: string[]): Promise<Map<string, string>> {
  // Four small columns. Every revision is still scanned - there is no way to know which is newest
  // without looking - but at about a hundred bytes a row that is cheap, and no Json is touched.
  const keys = await prisma.prediction.findMany({
    where: { fixtureId: { in: fixtureIds } },
    select: { id: true, fixtureId: true, lockedAt: true, revision: true },
    orderBy: [{ lockedAt: { sort: "desc", nulls: "last" } }, { revision: "desc" }],
  });
  const winner = new Map<string, string>();
  for (const k of keys) if (!winner.has(k.fixtureId)) winner.set(k.fixtureId, k.id);
  return winner;
}

function zip<T extends { id: string }, P extends { id: string }>(fixtures: T[], winner: Map<string, string>, rows: P[]) {
  const byId = new Map(rows.map((r) => [r.id, r]));
  return fixtures.map((f) => {
    const id = winner.get(f.id);
    const p = id ? byId.get(id) : undefined;
    return { ...f, predictions: p ? [p] : [] };
  });
}

/** The newest prediction per fixture, without the four heavy blobs. */
export async function attachLatestPredictions<T extends { id: string }>(fixtures: T[]): Promise<(T & { predictions: MarketSource[] })[]> {
  if (!fixtures.length) return [];
  const winner = await winningPredictionIds(fixtures.map((f) => f.id));
  const rows = winner.size
    ? await prisma.prediction.findMany({ where: { id: { in: [...winner.values()] } }, omit: HEAVY_JSON })
    : [];
  return zip(fixtures, winner, rows);
}

/** The same, keeping `matrix`. Only the scanners that read the scoreline grid need this. */
export async function attachLatestPredictionsWithMatrix<T extends { id: string }>(fixtures: T[]): Promise<(T & { predictions: MatrixSource[] })[]> {
  if (!fixtures.length) return [];
  const winner = await winningPredictionIds(fixtures.map((f) => f.id));
  const rows = winner.size
    ? await prisma.prediction.findMany({ where: { id: { in: [...winner.values()] } }, omit: MATRIX_OMIT })
    : [];
  return zip(fixtures, winner, rows);
}

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
export async function getBoard(opts: BoardOpts): Promise<BoardFixture[]> {
  const { provider } = await dataMode();
  return attachLatestPredictions(await prisma.fixture.findMany({
    where: boardWhere(provider, opts),
    include: fixtureBaseInclude,
    orderBy: [{ kickoffUtc: "asc" }],
    ...(opts.take ? { take: opts.take } : {}),
  }));
}

/** The same, keeping `matrix`. Only the two scanners that read the scoreline grid should use this. */
export async function getBoardWithMatrix(opts: BoardOpts): Promise<BoardFixtureWithMatrix[]> {
  const { provider } = await dataMode();
  return attachLatestPredictionsWithMatrix(await prisma.fixture.findMany({
    where: boardWhere(provider, opts),
    include: fixtureBaseInclude,
    orderBy: [{ kickoffUtc: "asc" }],
    ...(opts.take ? { take: opts.take } : {}),
  }));
}

/** Fixtures a list query can carry at once. Kickoff order, so the cut falls on the furthest away. */
export const BOARD_LIMIT = Number(process.env.BOARD_LIMIT) || 2500;
/**
 * Settled fixtures behind the Top 50's seven-day record and the builder's fourteen-day one.
 *
 * Those tables are rebuilt per request because they depend on the chosen market, and each fixture is run
 * through the whole market catalogue to score it. Newest first, so the trim falls on the oldest day.
 */
export const RECORD_LIMIT = Number(process.env.RECORD_LIMIT) || 1200;
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

export interface QuoteRow { fixtureId: string; market: string; odds: number; best: number; books: number; fetchedAt: Date }

/*
 * -- The newest quote per fixture and market, and nothing else ---------------------------------------
 *
 * OddsQuote is append-only: every odds sync writes a fresh row per market per fixture, whether the price
 * moved or not. Nothing prunes it, so a fixture sitting in the window for a fortnight collects a row per
 * market per sync for a fortnight.
 *
 * Every caller then threw almost all of it away. `quoteMaps` walks the rows newest-first and keeps the
 * FIRST it sees per market - so of the hundreds of rows loaded for a fixture, about twenty-six were used.
 * On the value list that was two seconds of the four-second page, twice over: once for the upcoming
 * fixtures and again for the settled ones behind the record.
 *
 * DISTINCT ON does the same selection in the database, and `@@index([fixtureId, market, fetchedAt])`
 * already exists to serve exactly this ordering. Raw SQL because DISTINCT ON has no query-API equivalent,
 * and because the alternative - Prisma's `distinct`, which it may apply in memory after fetching
 * everything - would be the same bug wearing a nicer API.
 */
export async function latestQuotes(fixtureIds: string[], beforeLock = false): Promise<QuoteRow[]> {
  if (!fixtureIds.length) return [];
  const ids = PrismaNS.join(fixtureIds);
  if (!beforeLock) {
    return prisma.$queryRaw<QuoteRow[]>`
      SELECT DISTINCT ON ("fixtureId", market) "fixtureId", market, odds, best, books, "fetchedAt"
      FROM "OddsQuote" WHERE "fixtureId" IN (${ids})
      ORDER BY "fixtureId", market, "fetchedAt" DESC`;
  }
  /*
   * For a settled fixture the record must use the price as it stood at the lock, not the closing one -
   * otherwise it scores calls against odds nobody could have taken. The cutoff is per fixture, so it
   * joins the lock moment in rather than being applied afterwards in JS.
   */
  return prisma.$queryRaw<QuoteRow[]>`
    SELECT DISTINCT ON (q."fixtureId", q.market) q."fixtureId", q.market, q.odds, q.best, q.books, q."fetchedAt"
    FROM "OddsQuote" q
    JOIN (
      SELECT "fixtureId", max("lockedAt") AS lock_at FROM "Prediction"
      WHERE "lockedAt" IS NOT NULL GROUP BY "fixtureId"
    ) l ON l."fixtureId" = q."fixtureId"
    WHERE q."fixtureId" IN (${ids}) AND q."fetchedAt" <= l.lock_at
    ORDER BY q."fixtureId", q.market, q."fetchedAt" DESC`;
}
