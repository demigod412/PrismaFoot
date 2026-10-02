/**
 * Prune what the app no longer reads: superseded prediction revisions, and odds quotes for fixtures that
 * are long finished.
 *
 *   cd /var/www/pitchedge && sudo -u ubuntu npm run prune            report only, deletes nothing
 *   cd /var/www/pitchedge && sudo -u ubuntu npm run prune -- --apply actually delete
 *   ... npm run prune -- --apply --keep 5                            keep more revisions per fixture
 *   ... npm run prune -- --apply --days 30                           keep odds further back
 *
 * Locked revisions are never candidates: they are the accuracy ledger. See src/lib/pipeline/prune.ts.
 *
 * Reporting is the default and --apply is required, because this is the only maintenance job here that
 * destroys rows. A dry run prints exactly what the real run would remove.
 */
import { PrismaClient } from "@prisma/client";
import { prunePredictions, pruneQuotes, refreshStats } from "../src/lib/pipeline/prune";

const db = new PrismaClient();

(async () => {
  const args = process.argv.slice(2);
  const apply = args.includes("--apply");
  const num = (flag: string) => { const i = args.indexOf(flag); return i >= 0 ? Number(args[i + 1]) : undefined; };
  const keep = num("--keep"), days = num("--days");

  // ── predictions ────────────────────────────────────────────────────────────────────────────────
  const before = await db.prediction.count();
  const locked = await db.prediction.count({ where: { lockedAt: { not: null } } });
  const perFixture = await db.prediction.groupBy({ by: ["fixtureId"], _count: { _all: true } });
  const avg = perFixture.length ? before / perFixture.length : 0;
  const max = perFixture.reduce((m, f) => Math.max(m, f._count._all), 0);
  console.log(`PREDICTIONS: ${before} across ${perFixture.length} fixture(s) — ${avg.toFixed(1)} per fixture on average, ${max} at most.`);
  console.log(`  ${locked} are locked and will never be touched (they are the accuracy ledger).`);

  const r = await prunePredictions(db, { keep, dryRun: !apply });
  if (!r.candidates) {
    console.log(`  Nothing to prune: no fixture has more than ${r.keep} unlocked revision(s).`);
  } else if (!apply) {
    const left = before - r.candidates;
    console.log(`  Would delete ${r.candidates}, keeping the newest ${r.keep} per fixture — leaving ${left} (${(left / (perFixture.length || 1)).toFixed(1)} per fixture).`);
  } else {
    const after = await db.prediction.count();
    const lockedAfter = await db.prediction.count({ where: { lockedAt: { not: null } } });
    console.log(`  Deleted ${r.deleted}. ${after} remain, ${(after / (perFixture.length || 1)).toFixed(1)} per fixture.`);
    // Checked rather than assumed: if this number moves, the ledger has been damaged and it must be loud.
    console.log(locked === lockedAfter
      ? `  Locked revisions intact: ${lockedAfter}.`
      : `  WARNING: locked revisions went from ${locked} to ${lockedAfter} — the ledger has changed. This should be impossible; please report it.`);
  }

  // ── odds quotes ────────────────────────────────────────────────────────────────────────────────
  const qBefore = await db.oddsQuote.count();
  const q = await pruneQuotes(db, { days, dryRun: !apply });
  console.log(`\nODDS QUOTES: ${qBefore} stored.`);
  if (!q.candidates) console.log(`  Nothing to prune: none belong to a fixture older than ${q.days} days.`);
  else if (!apply) console.log(`  Would delete ${q.candidates} for fixtures older than ${q.days} days — leaving ${qBefore - q.candidates}.`);
  else console.log(`  Deleted ${q.deleted} for fixtures older than ${q.days} days. ${await db.oddsQuote.count()} remain.`);

  if (!apply) { console.log("\nNothing has been deleted. To do it:  npm run prune -- --apply"); return; }

  /*
   * Worth more than the deleting. Refreshing stale statistics took the Top 50's odds lookup from 1.9s
   * to 248ms with no change to the index or the query - Postgres simply did not know the table's shape.
   */
  await refreshStats(db);
  console.log("\nPlanner statistics refreshed for both tables.");
  console.log("\nDisk is reclaimed by autovacuum over the next while. To reclaim it now, without locking either table:");
  console.log("  sudo -u postgres psql -d pitchedge -c 'VACUUM (ANALYZE) \"Prediction\"; VACUUM (ANALYZE) \"OddsQuote\";'");
})().catch((e) => { console.error(e); process.exitCode = 1; }).finally(() => db.$disconnect());
