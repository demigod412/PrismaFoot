import type { Candidate } from "./builder";
import { allMarkets, type MarketSource } from "./markets";
import { trustFor, type MarketTrust } from "./trust";

/**
 * Every market of one fixture as a slip candidate: the bookmaker price where one is stored, otherwise the
 * model's fair odds (1 / p). Shared by the odds builder and the daily banker so both price legs the same way.
 *
 * `noAuto` markets (GG2+, multiscores) are never candidates: a search chasing a price would fill itself
 * with them, since they are the longest honest prices there are. Scanner-only markets likewise.
 */
export function candidatesFor(
  f: { id: string; kickoffUtc: Date; home: string; away: string; league: string },
  p: MarketSource,
  quotes: Map<string, number> = new Map(),
  trust: MarketTrust = {},
): Candidate[] {
  return allMarkets(p, f.home, f.away).filter((m) => !m.scannerOnly && !m.noAuto).map((m) => {
    const price = quotes.get(m.key);
    return {
      matchId: f.id, league: f.league, startMs: +f.kickoffUtc, match: `${f.home} v ${f.away}`, label: m.label, market: m.key,
      group: m.group, p: m.p, odds: price && price > 1.01 ? price : 1 / m.p, real: !!price, band: p.band,
      trust: trustFor(trust, m.key),
      // Allowed in a slip, but marked: a leg that cannot be settled leaves the slip partly unscored.
      unverifiable: m.unverifiable,
    };
  });
}
