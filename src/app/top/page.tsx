import Link from "next/link";
import { prisma } from "@/lib/db";
import { dataMode } from "@/lib/mode";
import { withLatestPrediction } from "@/lib/queries";
import { bestTip, tipHit, TOP_N, WINDOWS, type Tip } from "@/lib/top";
import { dayKey, fmtUtc, fmtWat, watDayStart } from "@/lib/time";
import { ConfidenceBadge } from "@/components/ConfidenceBadge";
import { EmptyState } from "@/components/EmptyState";
import { PullToRefresh } from "@/components/PullToRefresh";
import { Card, Chip, SectionTitle, cn, pct } from "@/components/ui";

export const metadata = { title: "Top 20 tips" };
const DAY = 86_400_000;
const windowLabel = (d: number) => (d === 1 ? "Today" : d === 7 ? "Next 7 days" : `Next ${d} days`);

const FOCUS = [[undefined, "All competitions"], ["international", "International"], ["europe-strong", "Europe strongest"], ["england", "England"]] as const;

export default async function Top({ searchParams }: { searchParams: Promise<{ days?: string; focus?: string }> }) {
  const sp = await searchParams;
  const days = WINDOWS.includes(Number(sp.days) as never) ? Number(sp.days) : 1;
  const focus = FOCUS.some(([f]) => f === sp.focus) ? sp.focus : undefined;
  const href = (o: { days?: number; focus?: string | null }) => { const q = new URLSearchParams({ days: String(o.days ?? days) }); const f = o.focus === null ? undefined : o.focus ?? focus; if (f) q.set("focus", f); return `/top?${q}`; };
  const { provider, demo } = await dataMode();
  const now = new Date();
  const end = new Date(watDayStart(dayKey(now)).getTime() + days * DAY); // end of the last WAT day in the window

  const fixtures = await prisma.fixture.findMany({
    where: { provider, status: "SCHEDULED", kickoffUtc: { gt: now, lt: end }, ...(focus ? { league: { focusGroup: focus } } : {}) },
    include: withLatestPrediction, orderBy: { kickoffUtc: "asc" },
  });
  const ranked = fixtures
    .map((f) => ({ f, t: f.predictions[0] ? bestTip(f.predictions[0], f.homeTeam.shortName ?? f.homeTeam.name, f.awayTeam.shortName ?? f.awayTeam.name) : null }))
    .filter((x): x is { f: typeof x.f; t: Tip } => !!x.t)
    .sort((a, b) => b.t.strength - a.t.strength || a.f.kickoffUtc.getTime() - b.f.kickoffUtc.getTime())
    .slice(0, TOP_N);

  // Track record: for each of the last 7 WAT days, re-rank that day's pre-kickoff calls and score the top 20.
  const since = new Date(watDayStart(dayKey(now)).getTime() - 7 * DAY);
  const past = await prisma.fixture.findMany({
    where: { provider, status: "FINISHED", homeGoals: { not: null }, kickoffUtc: { gte: since, lt: watDayStart(dayKey(now)) } },
    include: { homeTeam: true, awayTeam: true, predictions: { orderBy: { revision: "desc" } } },
  });
  const byDay = new Map<string, { tip: Tip; hit: boolean }[]>();
  for (const f of past) {
    const pre = f.predictions.find((p) => p.generatedAt < f.kickoffUtc); // latest call made before kickoff
    if (!pre) continue;
    const t = bestTip(pre, f.homeTeam.name, f.awayTeam.name); if (!t) continue;
    const k = dayKey(f.kickoffUtc);
    byDay.set(k, [...(byDay.get(k) ?? []), { tip: t, hit: tipHit(t.market, f.homeGoals!, f.awayGoals!) }]);
  }
  const record = [...byDay.entries()].sort(([a], [b]) => b.localeCompare(a)).map(([day, xs]) => {
    const top = xs.sort((a, b) => b.tip.strength - a.tip.strength).slice(0, TOP_N);
    return { day, n: top.length, hits: top.filter((x) => x.hit).length, avgP: top.reduce((s, x) => s + x.tip.p, 0) / (top.length || 1) };
  });
  const tot = record.reduce((s, r) => ({ n: s.n + r.n, h: s.h + r.hits, p: s.p + r.avgP * r.n }), { n: 0, h: 0, p: 0 });

  return (
    <PullToRefresh>
      <header className="mb-4">
        <h1 className="text-2xl font-semibold tracking-tight md:text-3xl">Top 20 tips</h1>
        <p className="mt-1 max-w-2xl text-sm text-slate-400">The strongest single tip from each match, ranked by model probability with a small boost for confidence. One tip per match, Medium or High confidence only. Strong is not certain: a 75% tip still loses one time in four.</p>
      </header>

      <nav data-no-ptr aria-label="Time window" className="-mx-4 mb-5 flex gap-1.5 overflow-x-auto px-4 pb-1 md:mx-0 md:px-0">
        {WINDOWS.map((d) => <Link key={d} href={href({ days: d })}><Chip active={d === days}>{windowLabel(d)}</Chip></Link>)}
      </nav>
      <div data-no-ptr className="-mx-4 mb-5 flex gap-1.5 overflow-x-auto px-4 pb-1 md:mx-0 md:px-0">
        {FOCUS.map(([f, label]) => <Link key={label} href={href({ focus: f ?? null })}><Chip active={focus === f}>{label}</Chip></Link>)}
      </div>

      {ranked.length === 0 ? (
        <EmptyState title={`No qualifying tips ${days === 1 ? "left today" : "in this window"}`}
          body={days === 1 ? "Today's remaining matches have no Medium or High confidence tip at 55% or above. Try a longer window." : "No upcoming matches in this window have a qualifying tip yet."}
          action={days < 7 ? { href: href({ days: Math.min(7, days + 1) }), label: `Show ${windowLabel(Math.min(7, days + 1)).toLowerCase()}` } : undefined} />
      ) : (
        <ol className="glass divide-y divide-white/[0.05] px-1 py-1">
          {ranked.map(({ f, t }, i) => {
            const p = f.predictions[0];
            return (
              <li key={f.id}>
                <Link href={`/match/${f.id}`} className="focus-ring grid grid-cols-[2rem_1fr_auto] items-center gap-3 rounded-xl px-3 py-3 transition-colors duration-200 hover:bg-white/[0.04] md:grid-cols-[2.5rem_7rem_1fr_auto]">
                  <span className={cn("num text-lg font-semibold", i < 3 ? "text-edge" : "text-slate-500")}>{i + 1}</span>
                  <span className="hidden leading-tight md:block">
                    <span className="num block text-sm text-slate-200">{fmtWat(f.kickoffUtc, "EEE HH:mm")}</span>
                    <span className="num block text-[10px] text-slate-500">{fmtUtc(f.kickoffUtc)} UTC</span>
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate text-sm text-slate-100">{f.homeTeam.shortName ?? f.homeTeam.name} v {f.awayTeam.shortName ?? f.awayTeam.name}</span>
                    <span className="block truncate text-[11px] text-slate-500"><span className="num md:hidden">{fmtWat(f.kickoffUtc, "EEE HH:mm")} · </span>{f.league.name}</span>
                    <span className="mt-1 inline-block rounded-md border border-edge/40 bg-edge/10 px-1.5 py-0.5 text-xs text-edge">{t.label}</span>
                  </span>
                  <span className="flex flex-col items-end gap-1">
                    <span className="num text-xl font-semibold text-slate-50">{pct(t.p)}</span>
                    <ConfidenceBadge band={p.band} />
                    <span className="num text-[10px] text-slate-500">fair odds {(1 / t.p).toFixed(2)}</span>
                  </span>
                </Link>
              </li>
            );
          })}
        </ol>
      )}

      <Card className="mt-6">
        <SectionTitle aside="last 7 days">Top 20 track record</SectionTitle>
        {record.length === 0 ? (
          <p className="text-sm text-slate-400">{demo ? "Demo data has no finished matches with pre-kickoff calls yet." : "Fills in as today's matches finish. Each day's list is rebuilt from the calls made before kickoff and scored against the final result."}</p>
        ) : (
          <>
            <p className="mb-3 text-sm text-slate-300">
              <span className="num text-slate-50">{tot.h}/{tot.n}</span> hit ({pct(tot.h / tot.n)}) against an average model probability of <span className="num">{pct(tot.p / tot.n)}</span>. If those two numbers stay close, the percentages can be trusted.
            </p>
            <table className="num w-full text-xs">
              <thead className="text-slate-500"><tr><th className="text-left font-normal">Day</th><th className="font-normal">Tips</th><th className="font-normal">Hit</th><th className="font-normal">Rate</th><th className="font-normal">Avg p</th></tr></thead>
              <tbody>{record.map((r) => (
                <tr key={r.day} className="border-t hairline"><td className="py-1.5">{r.day}</td><td className="text-center">{r.n}</td><td className="text-center">{r.hits}</td>
                  <td className={cn("text-center", r.hits / r.n >= r.avgP - 0.05 ? "text-edge" : "text-miss")}>{pct(r.hits / r.n)}</td><td className="text-center text-slate-400">{pct(r.avgP)}</td></tr>
              ))}</tbody>
            </table>
          </>
        )}
      </Card>
    </PullToRefresh>
  );
}
