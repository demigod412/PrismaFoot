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
