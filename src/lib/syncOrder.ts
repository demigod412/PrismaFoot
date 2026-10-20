/**
 * Which competitions a bounded sync run takes, and in what order.
 *
 * Chosen by urgency (kicking off soon) then staleness FIRST, and only then are the pooled ones moved to
 * the back of the chosen set — they read this run's domestic results — grouped by pool so one cached pool
 * fit serves every competition in it.
 *
 * Until 0.23.0 "pooled last" was the primary key of the whole queue, applied before the cap. With ~250
 * domestic competitions ahead of them and a cap of 60, the Champions League, Europa League, Conference
 * League and every national-team competition sat permanently past the cut and never synced from 0.14.1 on.
 */
export function planRun<T>(eligible: T[], o: { max: number; pool: (l: T) => string; urgent: (l: T) => number; lastSynced: (l: T) => number }): T[] {
  return [...eligible]
    .sort((x, y) => o.urgent(x) - o.urgent(y) || o.lastSynced(x) - o.lastSynced(y))
    .slice(0, o.max)
    .map((l, i) => ({ l, i }))
    .sort((x, y) => Number(!!o.pool(x.l)) - Number(!!o.pool(y.l)) || o.pool(x.l).localeCompare(o.pool(y.l)) || x.i - y.i)
    .map(({ l }) => l);
}
