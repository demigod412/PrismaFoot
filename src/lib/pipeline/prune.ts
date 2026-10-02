import type { PrismaClient } from "@prisma/client";

/**
 * Delete superseded prediction revisions.
 *
 * ── What this exists for ───────────────────────────────────────────────────────────────────────────
 * Predictions are append-only: every sync or re-price that changes a fixture's inputs writes a new
 * revision rather than editing the old one. That is the right design — a call that was shown has to stay
 * recoverable — but a fixture accumulates revisions for as long as it sits in the window, and the hourly
 * sync plus `repredict` both add to the pile.
 *
 * Every list pays for it. Finding "the newest revision per fixture" has to scan every revision of every
 * fixture in the window, because there is no way to know which is newest without looking. On the sister
 * app, which shares this design, that reached 18.7 revisions per game and 73 at the worst — nineteen rows
 * read for every row used, and the single largest cost on the busiest pages.
 *
 * ── What is never deleted ──────────────────────────────────────────────────────────────────────────
 * Any revision with `lockedAt` set. Those are the ledger: the call exactly as it stood fifteen minutes
 * before kickoff, which is the only thing the accuracy page scores and the one record that must never be
 * rewritten or thinned. The delete filters on `WHERE "lockedAt" IS NULL`, so a locked row cannot be
 * selected as a candidate at all — that is the whole safety argument.
 *
 * Beyond that, the newest `keep` unlocked revisions per fixture survive, so the current call and a short
 * history behind it are always present.
 *
 * ── Why raw SQL ────────────────────────────────────────────────────────────────────────────────────
 * "The newest N per group" is a window function. Through the query API it becomes one query per fixture,
 * which is the exact pathology this is meant to relieve. One statement, done in the database, reading
 * nothing into the application.
 */
export interface PruneResult { candidates: number; deleted: number; keep: number; dryRun: boolean }

const KEEP_DEFAULT = Number(process.env.PREDICTION_KEEP_REVISIONS) || 3;
/** Deleted in batches so a backlog cannot become one enormous transaction on the first run. */
const BATCH = 5_000;

export async function prunePredictions(
  db: PrismaClient,
  opts: { keep?: number; dryRun?: boolean } = {},
): Promise<PruneResult> {
  const keep = Math.max(1, opts.keep ?? KEEP_DEFAULT);
  const dryRun = opts.dryRun ?? false;

  const [{ n }] = await db.$queryRaw<[{ n: bigint }]>`
    SELECT count(*)::bigint AS n FROM (
      SELECT row_number() OVER (PARTITION BY "fixtureId" ORDER BY revision DESC) AS rn
      FROM "Prediction" WHERE "lockedAt" IS NULL
    ) t WHERE t.rn > ${keep}
  `;
  const candidates = Number(n);
  if (dryRun || !candidates) return { candidates, deleted: 0, keep, dryRun };

  let deleted = 0;
  for (;;) {
    const n = await db.$executeRaw`
      DELETE FROM "Prediction" WHERE id IN (
        SELECT id FROM (
          SELECT id, row_number() OVER (PARTITION BY "fixtureId" ORDER BY revision DESC) AS rn
          FROM "Prediction" WHERE "lockedAt" IS NULL
        ) t WHERE t.rn > ${keep} LIMIT ${BATCH}
      )
    `;
    deleted += n;
    if (n < BATCH) break;
  }
  return { candidates, deleted, keep, dryRun };
}


/**
 * Delete odds quotes for fixtures that are long finished.
 *
 * `OddsQuote` is append-only in the same way predictions are: every odds sync writes a fresh row per
 * market per fixture, whether the price moved or not. Unlike predictions, nothing has ever pruned it, so
 * it holds every price ever seen for every fixture ever synced.
 *
 * What the app actually reads is narrow. Live pages want the newest quote per market, which
 * `latestQuotes` selects with DISTINCT ON. The two track records want the price as it stood at the lock,
 * for the last seven days (Top 50) and fourteen (builder). Nothing reads a quote attached to a fixture
 * older than that — but the DISTINCT ON still has to scan past all of them.
 *
 * So the cut is by fixture kickoff, not by row age or count. That keeps the rule trivially safe to reason
 * about: a fixture outside both record windows can have no quote anyone will ever ask for. Deleting the
 * oldest rows per market instead would risk dropping the pre-lock price a record still needs, which is
 * the one price that must survive.
 */
const QUOTE_KEEP_DAYS = Number(process.env.ODDS_KEEP_DAYS) || 21;

export interface QuotePruneResult { candidates: number; deleted: number; days: number; dryRun: boolean }

export async function pruneQuotes(
  db: PrismaClient,
  opts: { days?: number; dryRun?: boolean } = {},
): Promise<QuotePruneResult> {
  const days = Math.max(15, opts.days ?? QUOTE_KEEP_DAYS); // never inside the builder's 14-day record
  const dryRun = opts.dryRun ?? false;
  const cutoff = new Date(Date.now() - days * 86_400_000);

  const [{ n }] = await db.$queryRaw<[{ n: bigint }]>`
    SELECT count(*)::bigint AS n FROM "OddsQuote" q
    JOIN "Fixture" f ON f.id = q."fixtureId"
    WHERE f."kickoffUtc" < ${cutoff}
  `;
  const candidates = Number(n);
  if (dryRun || !candidates) return { candidates, deleted: 0, days, dryRun };

  let deleted = 0;
  for (;;) {
    const n = await db.$executeRaw`
      DELETE FROM "OddsQuote" WHERE id IN (
        SELECT q.id FROM "OddsQuote" q
        JOIN "Fixture" f ON f.id = q."fixtureId"
        WHERE f."kickoffUtc" < ${cutoff}
        LIMIT ${BATCH}
      )
    `;
    deleted += n;
    if (n < BATCH) break;
  }
  return { candidates, deleted, days, dryRun };
}


/**
 * Refresh planner statistics for the two tables this file deletes from.
 *
 * Worth more than the deleting, as it turned out. The odds lookup on the Top 50 was taking 1.9 seconds
 * with a perfectly good index sitting unused, because Postgres had stale statistics for `OddsQuote` and
 * was estimating a sequential scan to be cheaper. A single ANALYZE took the same query to 248ms. The index
 * had been there all along; the planner simply did not know the shape of the table.
 *
 * Autovacuum does run ANALYZE, but on its own thresholds — and a table that grows steadily by insert
 * without ever being deleted from can sit a long way out of date. Deleting a batch of rows is exactly the
 * moment the estimates stop being true, so this runs straight after.
 *
 * ANALYZE only, never VACUUM FULL: it takes no exclusive lock and cannot interrupt a request.
 */
export async function refreshStats(db: PrismaClient): Promise<void> {
  await db.$executeRawUnsafe('ANALYZE "Prediction"');
  await db.$executeRawUnsafe('ANALYZE "OddsQuote"');
}
