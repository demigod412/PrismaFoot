/**
 * Server self-check. Run after every update:
 *   cd /var/www/pitchedge && sudo -u ubuntu npm run selfcheck            (read-only checks + lock/settle)
 *   cd /var/www/pitchedge && sudo -u ubuntu npm run selfcheck -- --demo  (also rebuilds DEMO data and tests the full pipeline on it)
 */
import { PrismaClient, type Provider } from "@prisma/client";
import { lockDue, loadScoredCalls, settle } from "../src/lib/pipeline/ledger";
import { computeAccuracy } from "../src/lib/accuracy";
import { seedDemo } from "../src/lib/demo/generate";
import { selectTop, tipsFor } from "../src/lib/top";
import { valueTips } from "../src/lib/value";
import type { QuoteMap } from "../src/lib/odds";
import type { MarketKey } from "../src/lib/markets";

const db = new PrismaClient();
const LOCK = Number(process.env.PREDICTION_LOCK_MINUTES ?? 15);
let failures = 0;
const check = (name: string, ok: boolean, info = "") => { console.log(`${ok ? "PASS" : "FAIL"}  ${name}${info ? ` — ${info}` : ""}`); if (!ok) failures++; };

async function ledgerInvariants(provider: Provider) {
  const locked = await db.prediction.findMany({ where: { lockedAt: { not: null }, fixture: { provider } }, include: { fixture: true } });
  const perFixture = new Map<string, number>();
  let badTime = 0, badGen = 0;
  for (const p of locked) {
    perFixture.set(p.fixtureId, (perFixture.get(p.fixtureId) ?? 0) + 1);
    if (p.lockedAt!.getTime() > p.fixture.kickoffUtc.getTime() - LOCK * 60_000 + 1000) badTime++;
    if (p.generatedAt.getTime() > p.lockedAt!.getTime() + 1000) badGen++;
  }
  check(`${provider}: at most one locked call per match`, [...perFixture.values()].every((n) => n === 1), `${locked.length} locked calls`);
  check(`${provider}: every lock is at or before kickoff − ${LOCK} min`, badTime === 0, badTime ? `${badTime} late` : "");
  check(`${provider}: every locked call was generated before its lock`, badGen === 0, badGen ? `${badGen} bad` : "");
  const afterLock = await db.prediction.count({ where: { fixture: { provider, predictions: { some: { lockedAt: { not: null } } } }, lockedAt: null, generatedAt: { gt: new Date(0) } } });
  const lateRevisions = await db.$queryRawUnsafe<{ n: bigint }[]>(
    `SELECT count(*)::bigint AS n FROM "Prediction" p JOIN "Prediction" l ON l."fixtureId" = p."fixtureId" AND l."lockedAt" IS NOT NULL
     JOIN "Fixture" f ON f.id = p."fixtureId" WHERE f.provider = $1::"Provider" AND p."lockedAt" IS NULL AND p."generatedAt" > l."lockedAt"`, provider);
  check(`${provider}: no prediction was written after a lock`, Number(lateRevisions[0]?.n ?? 0) === 0, `${afterLock} unlocked earlier revisions kept as history`);
  const finNoResult = await db.fixture.count({ where: { provider, status: "FINISHED", homeGoals: { not: null }, kickoffUtc: { gte: new Date(Date.now() - 30 * 864e5) }, results: { none: {} } } });
  check(`${provider}: every finished match (30 days) has a result`, finNoResult === 0, finNoResult ? `${finNoResult} missing` : "");
  const calls = await loadScoredCalls(db, provider);
  const r = computeAccuracy(calls);
  console.log(`      ${provider}: ${r.n} scored calls · Brier ${r.n ? r.model.brier.toFixed(3) : "-"} vs always-home ${r.n ? r.alwaysHome.brier.toFixed(3) : "-"}${r.market ? ` · market ${r.market.market.brier.toFixed(3)} (n ${r.market.n})` : ""}`);
  return r;
}

(async () => {
  const demo = process.argv.includes("--demo");
  console.log(`PitchEdge self-check ${new Date().toISOString()}${demo ? " (with demo rebuild)" : ""}\n`);
  const providers = (await db.league.groupBy({ by: ["provider"] })).map((x) => x.provider);
  check("database reachable", true, `providers: ${providers.join(", ") || "none"}`);

  const locked = await lockDue(db);
  check("lock job runs", true, `${locked} newly locked`);
  for (const p of providers) {
    const s = await settle(db, p);
    check(`${p}: settle runs`, true, `${s.created} new results, ${s.corrected} corrections`);
    await ledgerInvariants(p);
  }

  if (demo) {
    await seedDemo(db);
    const r = await ledgerInvariants("DEMO");
    check("DEMO: walk-forward ledger has scored calls", r.n > 20, `${r.n}`);
    check("DEMO: model beats always-home on Brier", r.n > 0 && r.model.brier < r.alwaysHome.brier);
    check("DEMO: bookmaker baseline present", !!r.market && r.market.n > 0);
    const cal = await db.calibrationModel.count({ where: { provider: "DEMO", active: true } });
    check("DEMO: calibration maps stored", cal >= 8, `${cal}`);
    const acc = await db.accuracyDaily.count({ where: { scope: "DEMO" } });
    check("DEMO: daily accuracy rows stored", acc > 0, `${acc}`);
    const up = await db.fixture.findMany({ where: { provider: "DEMO", status: "SCHEDULED", kickoffUtc: { gt: new Date() } }, include: { homeTeam: true, awayTeam: true, predictions: { orderBy: { revision: "desc" }, take: 1 }, odds: { orderBy: { fetchedAt: "desc" } } } });
    check("DEMO: upcoming matches predicted", up.filter((f) => f.predictions[0]).length > 5, `${up.length} upcoming`);
    const top = selectTop(up.flatMap((f) => f.predictions[0] ? [{ item: f, id: f.id, startMs: f.kickoffUtc.getTime(), tips: tipsFor(f.predictions[0], f.homeTeam.name, f.awayTeam.name) }] : []));
    const dc = top.filter((t) => t.tip.group === "dc").length, u45 = top.filter((t) => t.tip.key === "under45").length, hcp = top.filter((t) => t.tip.group === "hcp").length;
    check("DEMO: Top 20 builds with caps", top.length > 0 && dc <= 2 && u45 <= 2 && hcp <= 2, `${top.length} tips · DC ${dc} · U4.5 ${u45} · win-by-2 ${hcp}`);
    const vt = up.flatMap((f) => { const p = f.predictions[0]; if (!p) return []; const q: QuoteMap = {}; for (const o of f.odds) q[o.market as MarketKey] ??= { odds: o.odds, best: o.best, books: o.books }; return valueTips(p, q, f.homeTeam.name, f.awayTeam.name); });
    check("DEMO: value list computes", true, `${vt.length} value candidates`);
    const pooled = await db.prediction.count({ where: { fixture: { provider: "DEMO" }, dataFlags: { has: "early_season" } } });
    console.log(`      DEMO: ${pooled} predictions flagged early_season`);
  }
  console.log(`\n${failures ? `${failures} check(s) FAILED` : "All checks passed"}`);
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error("FAIL  self-check crashed:", e); process.exit(1); }).finally(() => db.$disconnect());
