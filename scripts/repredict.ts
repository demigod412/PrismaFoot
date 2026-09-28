/**
 * Re-price fixtures you already have, without fetching anything:
 *   cd /var/www/pitchedge && sudo -u ubuntu npm run repredict          one batch (20 leagues)
 *   cd /var/www/pitchedge && sudo -u ubuntu npm run repredict -- 5     a smaller batch
 *
 * What this is for. A new market means new columns, and existing predictions have them empty. A full
 * `npm run ingest` would fill them, but it also re-sweeps every competition from the provider — hundreds
 * of requests and enough memory pressure to stall the box, to re-download fixtures that were already
 * there. Nothing about a new market needs the provider at all: the probabilities come from the stored
 * ratings and the stored fixtures.
 *
 * So this touches no network. It refits each league from the database and rewrites the predictions for
 * its upcoming fixtures, which is the only step that needed to happen.
 *
 * ── Why it works in batches ─────────────────────────────────────────────────────────────────────────
 * Fitting a league holds its match history in memory, and doing 263 of them in one process is what made
 * the last run crawl — leagues that took two seconds each early on were taking thirty by the end. Each
 * invocation handles a fixed number and stops, so the memory goes back to the operating system in
 * between. Run it again until it reports nothing left; it is idempotent, because a prediction that
 * already carries the new markets is skipped by the revision check rather than rewritten.
 */
import { PrismaClient } from "@prisma/client";
import { LOCK_MINUTES, rateAndPredictLeague } from "../src/lib/pipeline/predict";
import { FIXTURE_WINDOW_DAYS } from "../src/lib/window";
import { PROVIDER_ENUM, primaryProviderId } from "../src/lib/providers";

const db = new PrismaClient();
const DEFAULT_BATCH = 20;

(async () => {
  const batch = Number(process.argv[2]) || DEFAULT_BATCH;
  const id = await primaryProviderId();
  const provider = PROVIDER_ENUM[id];

  /*
   * Only leagues with an upcoming fixture whose newest prediction is missing the new markets. Ordered
   * with the busiest first, so the most visible competitions are filled in the earliest batches.
   */
  /*
   * `none: { calNoRun3: { not: null } }`, not `some: { calNoRun3: null }`.
   *
   * Predictions are append-only revisions, so every earlier revision keeps the column null for good. The
   * obvious filter therefore matched every fixture that had ever been priced, the candidate list never
   * shrank, and each run handed back the same twenty competitions — correctly skipping most of them, and
   * never finishing. What identifies work remaining is a fixture with NO revision carrying the markets.
   */
  /*
   * The window has to be the predictor's window, not "anything in the future".
   *
   * rateAndPredictLeague prices fixtures from the lock boundary out to FIXTURE_WINDOW_DAYS and no
   * further. Counting every future fixture as outstanding therefore left a permanent residue of ones it
   * would never reach — a single MLS fixture months ahead sat at "1 left" through run after run. A
   * progress figure that can never reach zero is worse than no figure, because it looks like a failure.
   */
  const now = new Date();
  const needsWork = {
    status: "SCHEDULED" as const,
    kickoffUtc: {
      gt: new Date(now.getTime() + LOCK_MINUTES * 60_000),
      lte: new Date(now.getTime() + FIXTURE_WINDOW_DAYS * 86_400_000),
    },
    predictions: { none: { calNoRun3: { not: null } } },
  };
  const candidates = await db.league.findMany({
    where: { provider, fixtures: { some: needsWork } },
    select: {
      id: true, name: true, country: true,
      // Fixtures still lacking the markets, so the figure beside each league is work left, not total size.
      _count: { select: { fixtures: { where: needsWork } } },
    },
  });
  const fixturesLeft = await db.fixture.count({ where: { provider, ...needsWork } });
  candidates.sort((a, b) => b._count.fixtures - a._count.fixtures);

  if (!candidates.length) {
    console.log("Nothing left: every upcoming fixture already carries the new markets.");
    return;
  }

  const todo = candidates.slice(0, batch);
  console.log(`${fixturesLeft} fixture(s) across ${candidates.length} competition(s) still to re-price. Doing ${todo.length} now, no provider requests.\n`);

  let written = 0;
  for (const [i, lg] of todo.entries()) {
    const label = `${lg.country} · ${lg.name}`;
    process.stderr.write(`  → [${i + 1}/${todo.length}] ${label}…\n`);
    try {
      const r = await rateAndPredictLeague(db, lg.id);
      written += r.predictions;
      console.log(`  [${i + 1}/${todo.length}] ${label} — ${r.predictions} re-priced (${lg._count.fixtures} were missing the markets)`);
    } catch (e) {
      // One league's history being unfittable must not end the batch.
      console.log(`  [${i + 1}/${todo.length}] ${label} — FAILED: ${(e as Error).message.slice(0, 120)}`);
    }
  }

  // Counted again rather than subtracted: the only honest measure of progress is the query itself.
  const left = await db.fixture.count({ where: { provider, ...needsWork } });
  console.log(`\n${written} prediction(s) rewritten. ${fixturesLeft - left} fixture(s) now carry the markets.`);
  console.log(left
    ? `${left} fixture(s) left — run it again: sudo -u ubuntu npm run repredict`
    : "All done. The new markets now appear on every upcoming fixture.");
})().catch((e) => { console.error(e); process.exitCode = 1; }).finally(() => db.$disconnect());
