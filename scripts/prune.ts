/**
 * Prune superseded prediction revisions.
 *
 *   cd /var/www/pitchedge && sudo -u ubuntu npm run prune            report only, deletes nothing
 *   cd /var/www/pitchedge && sudo -u ubuntu npm run prune -- --apply actually delete
 *   ... npm run prune -- --apply --keep 5                            keep more history per fixture
 *
 * Locked revisions are never candidates: they are the accuracy ledger. See src/lib/pipeline/prune.ts.
 *
 * Reporting is the default and --apply is required, because this is the only maintenance job here that
 * destroys rows. A dry run prints exactly what the real run would remove.
 */
import { PrismaClient } from "@prisma/client";
import { prunePredictions } from "../src/lib/pipeline/prune";

const db = new PrismaClient();

(async () => {
  const args = process.argv.slice(2);
  const apply = args.includes("--apply");
  const ki = args.indexOf("--keep");
  const keep = ki >= 0 ? Number(args[ki + 1]) : undefined;

  const before = await db.prediction.count();
  const locked = await db.prediction.count({ where: { lockedAt: { not: null } } });
  const perFixture = await db.prediction.groupBy({ by: ["fixtureId"], _count: { _all: true } });
  const avg = perFixture.length ? before / perFixture.length : 0;
  const max = perFixture.reduce((m, f) => Math.max(m, f._count._all), 0);
  console.log(`${before} prediction(s) across ${perFixture.length} fixture(s) — ${avg.toFixed(1)} per fixture on average, ${max} at most.`);
  console.log(`${locked} are locked and will never be touched (they are the accuracy ledger).\n`);

  const r = await prunePredictions(db, { keep, dryRun: !apply });
  if (!r.candidates) { console.log(`Nothing to prune: no fixture has more than ${r.keep} unlocked revision(s).`); return; }

  if (!apply) {
    const left = before - r.candidates;
    console.log(`Would delete ${r.candidates} superseded unlocked revision(s), keeping the newest ${r.keep} per fixture.`);
    console.log(`That leaves ${left} row(s), ${(left / (perFixture.length || 1)).toFixed(1)} per fixture.\n`);
    console.log("Nothing has been deleted. To do it:  npm run prune -- --apply");
    return;
  }

  const after = await db.prediction.count();
  const lockedAfter = await db.prediction.count({ where: { lockedAt: { not: null } } });
  console.log(`Deleted ${r.deleted}. ${after} row(s) remain, ${(after / (perFixture.length || 1)).toFixed(1)} per fixture.`);
  // Checked rather than assumed: if this number moves, the ledger has been damaged and it must be loud.
  console.log(locked === lockedAfter
    ? `Locked revisions intact: ${lockedAfter}.`
    : `WARNING: locked revisions went from ${locked} to ${lockedAfter} — the ledger has changed. This should be impossible; please report it.`);
  console.log("\nDisk is reclaimed by autovacuum over the next while. To reclaim it now, without locking the table:");
  console.log("  sudo -u postgres psql -d <db> -c 'VACUUM (ANALYZE) \"Prediction\";'");
})().catch((e) => { console.error(e); process.exitCode = 1; }).finally(() => db.$disconnect());
