/**
 * What Sportybet returns for a match: whether it is found, every market and outcome it lists, and what
 * each of our markets resolves to. Run on the server (Sportybet may block other locations):
 *   npm run sportycheck                          picks the next few big-league matches by itself
 *   npm run sportycheck -- <fixture id>          a fixture from this app (the id in /match/<id>)
 *   npm run sportycheck -- "Home team" "Away team"   by team names, next 3 days
 * Read-only: it requests no booking code.
 */
import { PrismaClient } from "@prisma/client";
import { eventDetail, findEvents, resolveSelection, type SbEvent } from "../src/lib/booking/sportybet";
import { MARKET_OPTIONS, type MarketKey } from "../src/lib/markets";

const db = new PrismaClient();
type Leg = { fixtureId: string; home: string; away: string; kickoff: Date };

async function report(e: SbEvent) {
  console.log(`\nFound ${e.eventId}: ${e.homeTeamName} v ${e.awayTeamName} at ${new Date(e.estimateStartTime).toISOString()}`);
  const d = await eventDetail(e.eventId);
  console.log(d ? `Full market list: ${d.markets?.length} markets` : "Full market list unavailable; using the listing's markets only");
  const full = d ? { ...e, ...d, markets: [...(d.markets ?? []), ...(e.markets ?? [])] } : e;
  for (const m of full.markets ?? []) {
    console.log(`  [${m.id}] ${m.desc ?? (m as { name?: string }).name ?? ""}${m.specifier ? ` {${m.specifier}}` : ""}: ${(m.outcomes ?? []).map((o) => `${o.desc}#${o.id}${o.isActive === 0 ? "(off)" : ""}`).join(" | ")}`);
  }
  console.log("\nOur markets:");
  for (const o of MARKET_OPTIONS) {
    const k = o.value.slice(2) as MarketKey;
    if (/_(over|under)$/.test(k) && /^(corners|shots|tackles)/.test(k)) continue; // line markets need a line
    const r = resolveSelection(full, k);
    console.log(`  ${o.label.padEnd(36)} ${"error" in r ? `✗ ${r.error}` : `✓ market ${r.marketId}${r.specifier ? ` {${r.specifier}}` : ""} outcome ${r.outcomeId}`}`);
  }
}

async function main() {
  const [a, b] = process.argv.slice(2);
  let legs: Leg[];
  if (b) {
    console.log(`Looking for ${a} v ${b} in the next 3 days…`);
    legs = Array.from({ length: 72 }, (_, h) => ({ fixtureId: String(h), home: a, away: b, kickoff: new Date(Date.now() + h * 3600_000) }));
  } else {
    const fx = a
      ? await db.fixture.findMany({ where: { id: a }, include: { homeTeam: true, awayTeam: true } })
      : await db.fixture.findMany({
        where: { status: "SCHEDULED", kickoffUtc: { gt: new Date(Date.now() + 3600_000), lt: new Date(Date.now() + 3 * 86_400_000) }, league: { focusGroup: { in: ["england", "europe-strong"] } } },
        include: { homeTeam: true, awayTeam: true }, orderBy: { kickoffUtc: "asc" }, take: 8,
      });
    if (!fx.length) { console.log(a ? `No fixture ${a}` : "No big-league fixtures in the next 3 days."); return; }
    legs = fx.map((f) => ({ fixtureId: f.id, home: f.homeTeam.name, away: f.awayTeam.name, kickoff: f.kickoffUtc }));
    console.log(`Looking for ${legs.length} match(es) on Sportybet:`);
  }
  const { found, error, scanned, sample } = await findEvents(legs);
  console.log(`Sportybet listing: ${scanned} upcoming events read${sample.length ? ` (e.g. ${sample.join(", ")})` : ""}`);
  if (error) console.log(`search stopped early: ${error}`);
  if (!scanned) console.log("Sportybet returned no events at all: the server may be blocked, or SPORTYBET_REGION is wrong.");
  if (!b) for (const l of legs) console.log(`  ${found.has(l.fixtureId) ? "✓" : "✗"} ${l.home} v ${l.away} (${l.kickoff.toISOString().slice(0, 16)})`);
  const first = [...found.values()][0];
  if (!first) { console.log("\nNone found on Sportybet."); return; }
  await report(first);
}
main().finally(() => db.$disconnect());
