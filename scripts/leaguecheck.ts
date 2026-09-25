/**
 * League check. Lists what your provider plan actually offers and how the allowlist maps onto it:
 *   cd /var/www/pitchedge && sudo -u ubuntu npm run leaguecheck
 *   cd /var/www/pitchedge && sudo -u ubuntu npm run leaguecheck -- --missing   (only the unmatched)
 *
 * The allowlist matches leagues by country + name, so a name the provider spells differently is
 * silently skipped rather than reported as an error. This is how you find those: the "not matched"
 * section is every competition your plan includes that PitchEdge is ignoring.
 */
import { entryFor, LEAGUE_ALLOWLIST } from "../src/lib/leagues";
import { getPrimaryProvider, primaryProviderId } from "../src/lib/providers";

const onlyMissing = process.argv.includes("--missing");

async function main() {
  const id = await primaryProviderId();
  const provider = await getPrimaryProvider();
  if (!provider) {
    console.log(`No usable key for the primary provider (${id}). Set one in Settings or .env.`);
    process.exit(1);
  }
  const allow = LEAGUE_ALLOWLIST[id as keyof typeof LEAGUE_ALLOWLIST] ?? [];
  console.log(`Provider: ${id} · allowlist entries: ${allow.length}\n`);

  const leagues = await provider.getLeagues();
  const matched = leagues.filter((l) => entryFor(allow, l));
  const missed = leagues.filter((l) => !entryFor(allow, l));

  if (!onlyMissing) {
    const byCountry = new Map<string, typeof matched>();
    for (const l of matched) byCountry.set(l.country, [...(byCountry.get(l.country) ?? []), l]);
    console.log(`SYNCED — ${matched.length} of ${leagues.length} competitions your plan lists\n`);
    for (const country of [...byCountry.keys()].sort()) {
      const rows = byCountry.get(country)!;
      console.log(`  ${country}`);
      for (const l of rows.sort((a, b) => a.name.localeCompare(b.name))) {
        const e = entryFor(allow, l)!;
        const bits = [`season ${l.season}`, e.tier ? `tier ${e.tier}` : "tier 1", e.focus ?? "no filter"];
        if (e.pool) bits.push(`pool ${e.pool}`);
        if (e.feeds) bits.push(`feeds ${e.feeds}`);
        console.log(`    ${l.name.padEnd(34)} ${bits.join(" · ")}`);
      }
    }
    console.log("");
  }

  console.log(`NOT MATCHED — ${missed.length} competitions your plan includes that are not synced`);
  console.log("(expected for youth, women's, reserve, cup and friendly competitions; a top or second");
  console.log(" tier appearing here means the allowlist spells its name differently)\n");
  const missedByCountry = new Map<string, string[]>();
  for (const l of missed) missedByCountry.set(l.country, [...(missedByCountry.get(l.country) ?? []), l.name]);
  for (const country of [...missedByCountry.keys()].sort()) {
    console.log(`  ${country}: ${[...new Set(missedByCountry.get(country)!)].sort().join(", ")}`);
  }

  // Allowlist entries that matched nothing: either not on your plan, or the name is wrong.
  const unused = allow.filter((a) => !leagues.some((l) => entryFor([a], l)));
  console.log(`\nALLOWLIST ENTRIES THAT MATCHED NOTHING — ${unused.length} of ${allow.length}`);
  console.log("(each is either outside your plan or spelled differently by the provider)\n");
  for (const a of unused) {
    console.log(`  ${a.id ? `id ${a.id}` : `${a.match!.country} ${String(a.match!.name)}`}${a.tier ? ` (tier ${a.tier})` : ""}`);
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
