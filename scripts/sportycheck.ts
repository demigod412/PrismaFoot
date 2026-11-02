/**
 * What Sportybet returns for one match: whether it is found, and every market and outcome it lists, with
 * what each of our markets resolves to. Run on the server (Sportybet may block other locations):
 *   npm run sportycheck -- <fixture id>          a fixture from this app (the id in /match/<id>)
 *   npm run sportycheck -- "Arsenal" "Chelsea"   by team names, next 3 days
 * Read-only: it requests no booking code.
 */
import { PrismaClient } from "@prisma/client";
import { eventDetail, findEvents, resolveSelection } from "../src/lib/booking/sportybet";
import { MARKET_OPTIONS, type MarketKey } from "../src/lib/markets";

const db = new PrismaClient();
async function main() {
  const [a, b] = process.argv.slice(2);
  if (!a) { console.log('usage: npm run sportycheck -- <fixtureId> | "Home team" "Away team"'); return; }
  let home = a, away = b ?? "", kickoff = new Date();
  if (!b) {
    const f = await db.fixture.findUnique({ where: { id: a }, include: { homeTeam: true, awayTeam: true } });
    if (!f) { console.log(`No fixture ${a}`); return; }
    home = f.homeTeam.name; away = f.awayTeam.name; kickoff = f.kickoffUtc;
  }
  console.log(`Looking for ${home} v ${away}${b ? "" : ` at ${kickoff.toISOString()}`}…`);
  const legs = b
    ? Array.from({ length: 72 }, (_, h) => ({ fixtureId: String(h), home, away, kickoff: new Date(Date.now() + h * 3600_000) }))
    : [{ fixtureId: "x", home, away, kickoff }];
  const { found, error } = await findEvents(legs);
  if (error) console.log(`search stopped early: ${error}`);
  const e = [...found.values()][0];
  if (!e) { console.log("Not found on Sportybet."); return; }
  console.log(`Found ${e.eventId}: ${e.homeTeamName} v ${e.awayTeamName} at ${new Date(e.estimateStartTime).toISOString()}`);
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
main().finally(() => db.$disconnect());
