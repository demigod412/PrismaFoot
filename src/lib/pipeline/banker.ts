import type { PrismaClient, Provider } from "@prisma/client";
import { BANKERS, GOTD_TARGET, legState, pickBanker, pickGameOfDay, slipState, type BankerConfig, type StoredLeg } from "../banker";
import type { BuiltSlip, Candidate } from "../builder";
import { candidatesFor } from "../candidates";
import { leagueLabel } from "../leagues";
import { fixtureStats, type MarketSource } from "../markets";
import { dayKeyIn, dayStart, DEFAULT_TZ } from "../time";
import { TRUST_SETTING, type MarketTrust } from "../trust";
import { LOCK_MINUTES } from "./predict";

/** The banker's calendar day. One zone for everyone, because a rollover slip is shared, not per device. */
export const BANKER_TZ = process.env.BANKER_TIMEZONE ?? DEFAULT_TZ;
const DAY = 86_400_000;
const HEAVY = { matrix: true, topScorelines: true, rationale: true, features: true } as const;

export const nextDayKey = (key: string) => new Date(Date.parse(`${key}T12:00:00Z`) + DAY).toISOString().slice(0, 10);

/** Every bookable candidate kicking off between `from` and `to`, priced with the newest stored odds. */
export async function dayCandidates(db: PrismaClient, provider: Provider, from: Date, to: Date): Promise<Candidate[]> {
  const fixtures = await db.fixture.findMany({
    where: { provider, status: "SCHEDULED", kickoffUtc: { gt: from, lt: to } },
    include: { homeTeam: true, awayTeam: true, league: true }, orderBy: { kickoffUtc: "asc" }, take: 800,
  });
  if (!fixtures.length) return [];
  const ids = fixtures.map((f) => f.id);
  // Newest revision per fixture, chosen on small columns first (see queries.ts for why not a nested take).
  const keys = await db.prediction.findMany({ where: { fixtureId: { in: ids } }, select: { id: true, fixtureId: true }, orderBy: { revision: "desc" } });
  const winner = new Map<string, string>();
  for (const k of keys) if (!winner.has(k.fixtureId)) winner.set(k.fixtureId, k.id);
  const preds = await db.prediction.findMany({ where: { id: { in: [...winner.values()] } }, omit: HEAVY });
  const byFixture = new Map(preds.map((p) => [p.fixtureId, p as MarketSource]));
  const quotes = await db.oddsQuote.findMany({ where: { fixtureId: { in: ids } }, orderBy: { fetchedAt: "desc" }, select: { fixtureId: true, market: true, odds: true } });
  const q = new Map<string, Map<string, number>>();
  for (const x of quotes) { const m = q.get(x.fixtureId) ?? new Map<string, number>(); if (!m.has(x.market)) m.set(x.market, x.odds); q.set(x.fixtureId, m); }
  const row = await db.appSetting.findUnique({ where: { key: TRUST_SETTING } });
  let trust: MarketTrust = {};
  try { trust = row ? JSON.parse(row.value) : {}; } catch { /* no trust weights yet */ }
  return fixtures.flatMap((f) => {
    const p = byFixture.get(f.id);
    if (!p) return [];
    return candidatesFor({ id: f.id, kickoffUtc: f.kickoffUtc, home: f.homeTeam.shortName ?? f.homeTeam.name, away: f.awayTeam.shortName ?? f.awayTeam.name, league: leagueLabel(f.league) }, p, q.get(f.id), trust);
  });
}

const toStored = (legs: Candidate[]): StoredLeg[] => legs.map((l) => ({
  fixtureId: l.matchId, market: l.market, label: l.label, match: l.match, league: l.league,
  kickoff: new Date(l.startMs).toISOString(), p: l.p, odds: l.odds, real: l.real,
}));

/** Build the day's bankers from what can still be booked: kickoff after the lock window, before midnight. */
export async function buildBankers(db: PrismaClient, provider: Provider, day: string, now: Date) {
  const from = new Date(Math.max(now.getTime() + LOCK_MINUTES * 60_000, dayStart(day, BANKER_TZ).getTime()));
  const to = dayStart(nextDayKey(day), BANKER_TZ);
  const cands = await dayCandidates(db, provider, from, to);
  const slips = new Map<number, BuiltSlip | null>(BANKERS.map((b) => [b.target, pickBanker(cands, b)]));
  return { cands, slips, gotd: pickGameOfDay(cands) };
}

/**
 * Today's bankers, fixed the first time they are built. Called by the page and at the end of each sync,
 * whichever comes first; a banker the day cannot make yet (too few fixtures priced) is retried next time.
 */
export async function ensureBankers(db: PrismaClient, provider: Provider, now = new Date()) {
  const day = dayKeyIn(now, BANKER_TZ);
  const have = new Set((await db.dailyBanker.findMany({ where: { provider, day }, select: { target: true } })).map((r) => r.target));
  const missing = [...BANKERS.map((b) => b.target), GOTD_TARGET].filter((t) => !have.has(t));
  if (!missing.length) return { day, created: 0 };
  const built = await buildBankers(db, provider, day, now);
  let created = 0;
  for (const t of missing) {
    const cfg = BANKERS.find((b) => b.target === t);
    const legs = cfg ? built.slips.get(t)?.legs : built.gotd ? [built.gotd] : undefined;
    if (!legs?.length) continue;
    const odds = legs.reduce((s, l) => s * l.odds, 1), p = legs.reduce((s, l) => s * l.p, 1);
    await db.dailyBanker.upsert({
      where: { provider_day_target: { provider, day, target: t } }, update: {},
      create: { provider, day, target: t, minLegs: cfg?.minLegs ?? 1, legs: toStored(legs) as never, odds, p, real: legs.every((l) => l.real) },
    });
    created++;
  }
  return { day, created };
}

export interface SettledBanker {
  day: string; target: number; legs: (StoredLeg & { state: ReturnType<typeof legState> })[];
  odds: number; p: number; real: boolean; state: "won" | "lost" | "pending"; settledOdds: number;
}

/** Stored bankers for the last `days` days with every leg settled from its fixture, newest first. */
export async function loadBankers(db: PrismaClient, provider: Provider, days: number, now = new Date()): Promise<SettledBanker[]> {
  const since = dayKeyIn(new Date(now.getTime() - days * DAY), BANKER_TZ);
  const rows = await db.dailyBanker.findMany({ where: { provider, day: { gte: since } }, orderBy: [{ day: "desc" }, { target: "asc" }] });
  const ids = [...new Set(rows.flatMap((r) => (r.legs as unknown as StoredLeg[]).map((l) => l.fixtureId)))];
  const fx = new Map((await db.fixture.findMany({ where: { id: { in: ids } } })).map((f) => [f.id, f]));
  return rows.map((r) => {
    const legs = (r.legs as unknown as StoredLeg[]).map((l) => {
      const f = fx.get(l.fixtureId);
      return { ...l, state: legState(l, f && { ...f, ...fixtureStats(f) }) };
    });
    const s = slipState(legs);
    return { day: r.day, target: r.target, legs, odds: r.odds, p: r.p, real: r.real, state: s.state, settledOdds: s.odds };
  });
}

/**
 * What the banker WOULD have been on past days before it was being stored, rebuilt from the locked calls
 * at fair odds (no historic bookmaker prices) — so the rollover record is not empty on day one. Shown
 * separately from published bankers, and never mixed into them.
 */
export async function rebuiltHistory(db: PrismaClient, provider: Provider, cfg: BankerConfig, days: number, now = new Date()) {
  const today = dayKeyIn(now, BANKER_TZ);
  const stored = new Set((await db.dailyBanker.findMany({ where: { provider, target: cfg.target }, select: { day: true } })).map((r) => r.day));
  const start = dayStart(dayKeyIn(new Date(now.getTime() - days * DAY), BANKER_TZ), BANKER_TZ);
  const locked = await db.prediction.findMany({
    where: { lockedAt: { not: null }, fixture: { provider, kickoffUtc: { gte: start, lt: dayStart(today, BANKER_TZ) } } },
    omit: HEAVY, include: { fixture: { include: { homeTeam: true, awayTeam: true, league: true } } },
  });
  const byDay = new Map<string, typeof locked>();
  for (const l of locked) { const k = dayKeyIn(l.fixture.kickoffUtc, BANKER_TZ); if (!stored.has(k)) byDay.set(k, [...(byDay.get(k) ?? []), l]); }
  return [...byDay.entries()].sort(([a], [b]) => a.localeCompare(b)).flatMap(([day, ps]) => {
    const cands = ps.flatMap((x) => candidatesFor({ id: x.fixtureId, kickoffUtc: x.fixture.kickoffUtc, home: x.fixture.homeTeam.shortName ?? x.fixture.homeTeam.name,
      away: x.fixture.awayTeam.shortName ?? x.fixture.awayTeam.name, league: leagueLabel(x.fixture.league) }, x));
    const slip = pickBanker(cands, cfg);
    if (!slip) return [];
    const legs = toStored(slip.legs).map((l) => { const f = ps.find((x) => x.fixtureId === l.fixtureId)!.fixture; return { ...l, state: legState(l, { ...f, ...fixtureStats(f) }) }; });
    const s = slipState(legs);
    return [{ day, legs, state: s.state, odds: s.odds, p: slip.p }];
  });
}
