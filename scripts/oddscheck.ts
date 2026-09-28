/**
 * What bet names does the odds feed actually offer?
 *   cd /var/www/pitchedge && sudo -u ubuntu npm run oddscheck
 *
 * The value list can only rank a market the bookmaker prices. `apiFootballKey` maps the handful we know
 * about, and anything unmapped is silently dropped — so a market can look "missing from Best value" when
 * the truth is that no price for it was ever fetched.
 *
 * This prints every distinct bet name in a real odds response, marks which ones we map, and lists the
 * rest. That turns "can the new markets appear in Best value?" from a guess into a fact: if a bet name
 * for them exists, mapping it is one line; if it does not, no amount of code will conjure a price.
 *
 * Costs one provider request per fixture sampled (default 3).
 */
import { PrismaClient } from "@prisma/client";
import { getPrimaryProvider, primaryProviderId, PROVIDER_ENUM } from "../src/lib/providers";
import { apiFootballKey } from "../src/lib/odds";

const db = new PrismaClient();
(async () => {
  const sample = Number(process.argv[2]) || 3;
  const p = await getPrimaryProvider();
  if (!p) { console.log("No usable provider key — nothing to ask."); return; }
  const id = await primaryProviderId();
  if (id !== "api-football") {
    console.log(`Primary provider is "${id}", which publishes no odds. Best value is empty by definition there.`);
    return;
  }

  // Fixtures with a league season, soonest first: odds exist closest to kickoff.
  const fixtures = await db.fixture.findMany({
    where: { provider: PROVIDER_ENUM[id], status: "SCHEDULED", kickoffUtc: { gt: new Date() } },
    orderBy: { kickoffUtc: "asc" }, take: sample,
    include: { league: true, homeTeam: true, awayTeam: true },
  });
  if (!fixtures.length) { console.log("No upcoming fixtures to sample."); return; }

  const seen = new Map<string, Set<string>>();
  for (const fx of fixtures) {
    console.log(`\n${fx.league.country} · ${fx.league.name} — ${fx.homeTeam.name} v ${fx.awayTeam.name}`);
    type Resp = { bookmakers?: { bets?: { name: string; values?: { value: string }[] }[] }[] }[];
    const raw = (await p.rawOdds?.(fx.externalId)) as Resp | undefined;
    if (!raw?.length) { console.log("  no odds returned for this fixture"); continue; }
    for (const bk of raw[0]?.bookmakers ?? []) {
      for (const bet of bk.bets ?? []) {
        const vals = seen.get(bet.name) ?? new Set<string>();
        for (const v of bet.values ?? []) vals.add(String(v.value));
        seen.set(bet.name, vals);
      }
    }
  }

  if (!seen.size) {
    console.log("\nNothing sampled. The odds endpoint returned no bookmakers for these fixtures —");
    console.log("usually because they are too far from kickoff, or the plan does not include odds.");
    return;
  }

  const mapped: string[] = [], unmapped: string[] = [];
  for (const [bet, values] of [...seen.entries()].sort()) {
    const hit = [...values].some((v) => apiFootballKey(bet, v) !== null);
    (hit ? mapped : unmapped).push(`${bet}  [${[...values].slice(0, 6).join(", ")}${values.size > 6 ? ", …" : ""}]`);
  }
  console.log(`\n── mapped, so these can appear in Best value (${mapped.length}) ──`);
  for (const m of mapped) console.log(`  ${m}`);
  console.log(`\n── offered but NOT mapped (${unmapped.length}) ──`);
  for (const m of unmapped) console.log(`  ${m}`);
  console.log("\nIf a bet name here covers a market you want in Best value, that mapping is one line in");
  console.log("src/lib/odds.ts. If a market is absent from this list, the feed does not price it and no");
  console.log("amount of code will produce a quote for it.");
})().catch((e) => { console.error(e); process.exitCode = 1; }).finally(() => db.$disconnect());
