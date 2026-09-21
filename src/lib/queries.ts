import "server-only";
import type { Prisma } from "@prisma/client";
import { prisma } from "./db";
import { dataMode } from "./mode";

const DAY = 86_400_000;

/** Latest prediction revision per fixture (the locked one if locked, otherwise newest). */
export const withLatestPrediction = {
  homeTeam: true, awayTeam: true, league: true,
  predictions: { orderBy: [{ lockedAt: { sort: "desc", nulls: "last" } }, { revision: "desc" }], take: 1 },
} satisfies Prisma.FixtureInclude;

export type BoardFixture = Prisma.FixtureGetPayload<{ include: typeof withLatestPrediction }>;

export async function getBoard(opts: { from: Date; to: Date; leagueId?: string; focus?: string }) {
  const { provider } = await dataMode();
  return prisma.fixture.findMany({
    where: {
      provider, kickoffUtc: { gte: opts.from, lt: opts.to },
      ...(opts.leagueId ? { leagueId: opts.leagueId } : {}),
      ...(opts.focus ? { league: { focusGroup: opts.focus } } : {}),
    },
    include: withLatestPrediction,
    orderBy: [{ kickoffUtc: "asc" }],
  });
}

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
  return getBoard({ from: new Date(now.getTime() - 2 * 3600_000), to: new Date(now.getTime() + 14 * DAY) });
}
