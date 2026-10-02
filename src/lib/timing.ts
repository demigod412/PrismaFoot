/**
 * One line per phase of an expensive page, to stderr — on a systemd box, `journalctl -u pitchedge`.
 *
 * Added after a sister app spent five rounds of plausible-but-wrong diagnoses on a page that took two
 * minutes to render three hundred rows. Reading the code could not explain it, because the cost was not
 * in the code: Prisma was fetching every prediction revision for every row and sorting them inside its
 * query engine, where neither the JS heap nor the query log showed anything unusual. The page measuring
 * itself is what finally located it in one request.
 *
 * Each mark prints as it happens rather than being collected into one line at the end. The first version
 * buffered and printed on completion, and the one request that mattered was OOM-killed — which discards
 * whatever Node had buffered for stderr, so the only diagnostic for the only interesting run was lost.
 * Breadcrumbs that survive the process beat a tidy line.
 *
 * Deliberately always on. It is one short line on pages that take seconds, so it costs nothing worth
 * measuring, and the moment it is behind a flag it will be off on the machine that has the problem.
 */
export function phases(label: string) {
  const t0 = Date.now();
  let last = t0;
  const mem = () => {
    const m = process.memoryUsage();
    return `rss=${Math.round(m.rss / 1048576)}MB heap=${Math.round(m.heapUsed / 1048576)}MB`;
  };
  return {
    mark(name: string, extra?: string) {
      const now = Date.now();
      console.error(`[timing] ${label} ${name}=${now - last}ms${extra ? ` (${extra})` : ""} at=${now - t0}ms ${mem()}`);
      last = now;
    },
    done(extra?: string) {
      console.error(`[timing] ${label} DONE total=${Date.now() - t0}ms ${mem()}${extra ? ` ${extra}` : ""}`);
    },
  };
}
