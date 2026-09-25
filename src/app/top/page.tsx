import Link from "next/link";
import { prisma } from "@/lib/db";
import { dataMode } from "@/lib/mode";
import { withLatestPrediction } from "@/lib/queries";
import { selectTop, tipHit, tipsFor, TOP_N, WINDOWS, CAPS, type Tip } from "@/lib/top";
import { GROUP_LABEL, marketHit, type MarketGroup, type MarketKey } from "@/lib/markets";
import { flatStakeRoi, selectTopValue, valueTips, VALUE, type ValueTip, VALUE_CEILINGS } from "@/lib/value";
import type { QuoteMap } from "@/lib/odds";
import { dayKeyIn, dayStart, fmtIn, fmtUtc } from "@/lib/time";
import { tz } from "@/lib/tz";
import { ConfidenceBadge } from "@/components/ConfidenceBadge";
import { FilterSelect } from "@/components/FilterSelect";
import { EmptyState } from "@/components/EmptyState";
import { PullToRefresh } from "@/components/PullToRefresh";
import { AddToSlip } from "@/components/AddToSlip";
import { Card, Chip, SectionTitle, cn, pct } from "@/components/ui";

export const metadata = { title: "Top 50 tips" };
export const dynamic = "force-dynamic";
const DAY = 86_400_000;
const windowLabel = (d: number) => (d === 1 ? "Today" : `Next ${d} days`);
const FOCUS = [[undefined, "All competitions"], ["international", "International"], ["europe-strong", "Europe strongest"], ["england", "England"], ["europe-other", "Europe other"], ["americas", "Americas"], ["africa", "Africa"], ["asia", "Asia"]] as const;
const GROUPS = Object.keys(GROUP_LABEL) as MarketGroup[];

/** Latest quote per fixture+market, optionally only those fetched before a cut-off per fixture. */
function quoteMaps(rows: { fixtureId: string; market: string; odds: number; best: number; books: number; fetchedAt: Date }[], cutoff?: Map<string, Date>) {
  const out = new Map<string, QuoteMap>();
  for (const q of rows) { // rows are newest first
    const c = cutoff?.get(q.fixtureId);
    if (c && q.fetchedAt > c) continue;
    const m = out.get(q.fixtureId) ?? {};
    if (!m[q.market as MarketKey]) m[q.market as MarketKey] = { odds: q.odds, best: q.best, books: q.books };
    out.set(q.fixtureId, m);
  }
  return out;
}

export default async function Top({ searchParams }: { searchParams: Promise<{ days?: string; focus?: string; market?: string; list?: string; cap?: string }> }) {
  const sp = await searchParams;
  const days = WINDOWS.includes(Number(sp.days) as never) ? Number(sp.days) : 1;
  const focus = FOCUS.some(([f]) => f === sp.focus) ? sp.focus : undefined;
  const group = GROUPS.includes(sp.market as MarketGroup) ? (sp.market as MarketGroup) : undefined;
  const list: "likely" | "value" = sp.list === "value" ? "value" : "likely";
  const cap = VALUE_CEILINGS.includes(Number(sp.cap) as never) ? Number(sp.cap) : 2;
  const href = (o: { days?: number; focus?: string | null; market?: string | null; list?: string; cap?: number }) => {
    const q = new URLSearchParams({ days: String(o.days ?? days) });
    const f = o.focus === null ? undefined : o.focus ?? focus; if (f) q.set("focus", f);
    const m = o.market === null ? undefined : o.market ?? group; if (m) q.set("market", m);
    const l = o.list ?? list; if (l === "value") q.set("list", "value");
    const c = o.cap ?? cap; if (l === "value" && c !== 2) q.set("cap", String(c));
    return `/top?${q}`;
  };
  const { provider, demo } = await dataMode();
  const zone = await tz();
  const now = new Date(), todayStart = dayStart(dayKeyIn(now, zone), zone);
  const end = new Date(todayStart.getTime() + days * DAY);

  const fixtures = await prisma.fixture.findMany({
    where: { provider, status: "SCHEDULED", kickoffUtc: { gt: now, lt: end }, ...(focus ? { league: { focusGroup: focus } } : {}) },
    include: withLatestPrediction, orderBy: { kickoffUtc: "asc" },
  });
  const names = (f: (typeof fixtures)[number]) => [f.homeTeam.shortName ?? f.homeTeam.name, f.awayTeam.shortName ?? f.awayTeam.name] as const;

  // ---------- current list ----------
  let likely: { f: (typeof fixtures)[number]; t: Tip }[] = [];
  let value: { f: (typeof fixtures)[number]; t: ValueTip }[] = [];
  let quotesAvailable = true;
  if (list === "likely") {
    likely = selectTop(fixtures.flatMap((f) => f.predictions[0] ? [{ item: f, id: f.id, startMs: f.kickoffUtc.getTime(), tips: tipsFor(f.predictions[0], ...names(f), group) }] : []), group)
      .map(({ item, tip }) => ({ f: item, t: tip }));
  } else {
    const qs = quoteMaps(await prisma.oddsQuote.findMany({ where: { fixtureId: { in: fixtures.map((f) => f.id) } }, orderBy: { fetchedAt: "desc" } }));
    quotesAvailable = qs.size > 0;
    value = selectTopValue(fixtures.flatMap((f) => {
      const p = f.predictions[0], q = qs.get(f.id);
      if (!p || !q) return [];
      const tips = valueTips(p, q, ...names(f), { maxOdds: cap }).filter((t) => !group || t.group === group);
      return [{ item: f, id: f.id, startMs: f.kickoffUtc.getTime(), tips }];
    })).map(({ item, tip }) => ({ f: item, t: tip }));
  }
  const shown = list === "likely" ? likely.length : value.length;
  const nextUp = shown ? null : await prisma.fixture.findFirst({ where: { provider, status: "SCHEDULED", kickoffUtc: { gt: now }, ...(focus ? { league: { focusGroup: focus } } : {}) }, orderBy: { kickoffUtc: "asc" }, include: { league: true } });

  // ---------- track record: LOCKED calls only (the call as it stood 15 minutes before kickoff) ----------
  const since = new Date(todayStart.getTime() - 7 * DAY);
  const past = await prisma.fixture.findMany({
    where: { provider, status: "FINISHED", homeGoals: { not: null }, kickoffUtc: { gte: since, lt: todayStart }, predictions: { some: { lockedAt: { not: null } } }, ...(focus ? { league: { focusGroup: focus } } : {}) },
    include: { homeTeam: true, awayTeam: true, predictions: { where: { lockedAt: { not: null } }, take: 1 } },
  });
  const pastQuotes = list === "value" ? quoteMaps(
    await prisma.oddsQuote.findMany({ where: { fixtureId: { in: past.map((f) => f.id) } }, orderBy: { fetchedAt: "desc" } }),
    new Map(past.map((f) => [f.id, f.predictions[0].lockedAt!])),
  ) : new Map<string, QuoteMap>();
  type Day = { day: string; n: number; hits: number; avgP: number; profit?: number };
  const byDay = new Map<string, (typeof past)[number][]>();
  past.forEach((f) => { const k = dayKeyIn(f.kickoffUtc, zone); byDay.set(k, [...(byDay.get(k) ?? []), f]); });
  const record: Day[] = [...byDay.entries()].sort(([a], [b]) => b.localeCompare(a)).map(([day, fs]) => {
    const res = (f: (typeof fs)[number]) => ({ h: f.homeGoals!, a: f.awayGoals!, hc: f.homeCorners, ac: f.awayCorners, hs: f.homeShots, as: f.awayShots, hh: f.htHome, ha: f.htAway });
    const lines = (f: (typeof fs)[number]) => ({ corners: f.predictions[0].cornersLine, shots: f.predictions[0].shotsLine });
    if (list === "likely") {
      const scored = selectTop(fs.map((f) => ({ item: f, id: f.id, startMs: f.kickoffUtc.getTime(), tips: tipsFor(f.predictions[0], f.homeTeam.name, f.awayTeam.name, group) })), group)
        .map(({ item, tip }) => ({ tip, hit: tipHit(tip.key, item.homeGoals!, item.awayGoals!, res(item), lines(item)) })).filter((x) => x.hit != null);
      return { day, n: scored.length, hits: scored.filter((x) => x.hit).length, avgP: scored.reduce((s, x) => s + x.tip.p, 0) / (scored.length || 1) };
    }
    const picks = selectTopValue(fs.flatMap((f) => { const q = pastQuotes.get(f.id); return q ? [{ item: f, id: f.id, startMs: f.kickoffUtc.getTime(), tips: valueTips(f.predictions[0], q, f.homeTeam.name, f.awayTeam.name, { maxOdds: cap }).filter((t) => !group || t.group === group) }] : []; }))
      .map(({ item, tip }) => ({ tip, hit: marketHit(tip.key, res(item), lines(item)) })).filter((x) => x.hit != null);
    const roi = flatStakeRoi(picks.map((x) => ({ odds: x.tip.odds, hit: !!x.hit })));
    return { day, n: roi.n, hits: roi.hits, avgP: picks.reduce((s, x) => s + x.tip.p, 0) / (picks.length || 1), profit: roi.profit };
  }).filter((r) => r.n);
  const tot = record.reduce((s, r) => ({ n: s.n + r.n, h: s.h + r.hits, p: s.p + r.avgP * r.n, profit: s.profit + (r.profit ?? 0) }), { n: 0, h: 0, p: 0, profit: 0 });

  const Row = ({ f, i, label, groupName, p, right }: { f: (typeof fixtures)[number]; i: number; label: string; groupName: string; p: number; right: React.ReactNode }) => (
      <Link href={`/match/${f.id}`} className="focus-ring grid min-w-0 flex-1 grid-cols-[2rem_1fr_auto] items-center gap-3 rounded-xl px-3 py-3 transition-colors duration-200 hover:bg-white/[0.04] md:grid-cols-[2.5rem_7rem_1fr_auto]">
        <span className={cn("num text-lg font-semibold", i < 3 ? "text-edge" : "text-slate-500")}>{i + 1}</span>
        <span className="hidden leading-tight md:block">
          <span className="num block text-sm text-slate-200">{fmtIn(f.kickoffUtc, zone, "EEE HH:mm")}</span>
          <span className="num block text-[10px] text-slate-500">{fmtUtc(f.kickoffUtc)} UTC</span>
        </span>
        <span className="min-w-0">
          <span className="block truncate text-sm text-slate-100">{names(f).join(" v ")}</span>
          <span className="block truncate text-[11px] text-slate-500"><span className="num md:hidden">{fmtIn(f.kickoffUtc, zone, "EEE HH:mm")} · </span>{f.league.name}</span>
          <span className="mt-1 inline-flex items-center gap-1.5 rounded-md border border-edge/40 bg-edge/10 px-1.5 py-0.5 text-xs text-edge"><span className="text-[10px] text-edge/70">{groupName}</span>{label}</span>
        </span>
        <span className="flex flex-col items-end gap-1">
          <span className="num text-xl font-semibold text-slate-50">{pct(p)}</span>
          {right}
        </span>
      </Link>
  );

  return (
    <PullToRefresh>
      <header className="mb-4">
        <h1 className="text-2xl font-semibold tracking-tight md:text-3xl">{list === "likely" ? `Top ${TOP_N} tips` : "Best value"}</h1>
        <p className="mt-1 max-w-2xl text-sm text-slate-400">
          {list === "likely"
            ? <>The strongest single tip from each match, ranked by model probability with a small boost for confidence. Medium or High confidence only. In the mixed list at most {CAPS.dc} double chance, {CAPS.under45} Under 4.5 and {CAPS.hcp} win-by-2 tips appear. A 75% tip still loses one time in four.</>
            : <>Tips where the model rates the outcome more likely than the bookmaker&apos;s price implies. Edge = model probability × odds − 1. Needs odds ≥ {VALUE.minOdds.toFixed(2)}, probability ≥ {Math.round(VALUE.minP * 100)}% and edge ≥ {Math.round(VALUE.minEdge * 100)}%. Value tips lose more often than &ldquo;most likely&rdquo; tips; the point is the price. ★ marks standout value: High confidence, 50%+, and an edge of 8% or more.</>}
        </p>
      </header>

      <div data-no-ptr className="mb-3 inline-flex rounded-xl border hairline p-1">
        {(["likely", "value"] as const).map((l) => (
          <Link key={l} href={href({ list: l })} className={cn("rounded-lg px-3 py-1.5 text-sm", list === l ? "bg-edge text-ink-950" : "text-slate-300")}>{l === "likely" ? "Most likely" : "Best value"}</Link>
        ))}
      </div>
      {list === "value" && (
        <div data-no-ptr className="mb-3 flex flex-wrap items-center gap-1.5">
          <span className="text-[11px] uppercase tracking-wide text-slate-500">Max odds</span>
          {VALUE_CEILINGS.map((c) => <Link key={c} href={href({ cap: c })}><Chip active={cap === c}>{c === 6 ? "any" : `≤ ${c.toFixed(2)}`}</Chip></Link>)}
        </div>
      )}
      <nav data-no-ptr aria-label="Time window" className="-mx-4 mb-3 flex gap-1.5 overflow-x-auto px-4 pb-1 md:mx-0 md:px-0">
        {WINDOWS.map((d) => <Link key={d} href={href({ days: d })}><Chip active={d === days}>{windowLabel(d)}</Chip></Link>)}
      </nav>
      <div data-no-ptr className="mb-4 grid gap-2 sm:grid-cols-2">
        <FilterSelect label="Competitions" value={focus ?? "all"} options={FOCUS.map(([f, label]) => ({ value: f ?? "all", label, href: href({ focus: f ?? null }) }))} />
        <FilterSelect label="Market" value={group ?? "all"}
          options={[{ value: "all", label: "All markets", href: href({ market: null }) }, ...GROUPS.map((g) => ({ value: g, label: GROUP_LABEL[g], href: href({ market: g }) }))]} />
      </div>
      

      {shown === 0 ? (
        <EmptyState title={list === "value" && !quotesAvailable ? "No bookmaker odds yet" : `No qualifying tips ${days === 1 ? "left today" : "in this window"}`}
          body={list === "value" && !quotesAvailable
            ? "The value list compares model probabilities with bookmaker odds, which come from API-Football. With football-data.org there are no odds, so this list stays empty."
            : nextUp && nextUp.kickoffUtc.getTime() > end.getTime()
              ? `No matches are scheduled in this window. The next one is ${nextUp.league.name} on ${fmtIn(nextUp.kickoffUtc, zone, "EEE d MMM")}.`
              : "No upcoming match in this window qualifies yet. Try a longer window."}
          action={days < 7 ? { href: href({ days: Math.min(7, days + 1) }), label: `Show ${windowLabel(Math.min(7, days + 1)).toLowerCase()}` } : undefined} />
      ) : (
        <ol className="glass divide-y divide-white/[0.05] px-1 py-1">
          {list === "likely"
            ? likely.map(({ f, t }, i) => (
              <li key={f.id} className="flex items-center"><div className="min-w-0 flex-1"><Row f={f} i={i} label={t.label} groupName={GROUP_LABEL[t.group]} p={t.p}
                right={<><ConfidenceBadge band={f.predictions[0].band} /><span className="num text-[10px] text-slate-500">fair odds {(1 / t.p).toFixed(2)}</span></>} /></div>
                <AddToSlip fixtureId={f.id} market={t.key} className="mr-3" /></li>
            ))
            : value.map(({ f, t }, i) => (
              <li key={f.id} className="flex items-center"><div className="min-w-0 flex-1"><Row f={f} i={i} label={`${t.star ? "★ " : ""}${t.label}`} groupName={GROUP_LABEL[t.group]} p={t.p}
                right={<><span className="num text-xs text-edge">edge +{Math.round(t.edge * 100)}%</span><span className="num text-[10px] text-slate-500">odds {t.odds.toFixed(2)} · fair {t.fair.toFixed(2)}</span></>} /></div>
                <AddToSlip fixtureId={f.id} market={t.key} className="mr-3" /></li>
            ))}
        </ol>
      )}

      <Card className="mt-6">
        <SectionTitle aside="last 7 days · locked calls only">{list === "likely" ? `Top ${TOP_N} track record` : "Value list track record"}</SectionTitle>
        {record.length === 0 ? (
          <p className="text-sm text-slate-400">{demo ? "No locked demo calls in this window." : "Fills in as locked calls are settled. Each day's list is rebuilt from the calls locked 15 minutes before kickoff and scored against the final result."}{list === "value" ? " Value results also need the odds that were available before the lock." : ""}</p>
        ) : (
          <>
            <p className="mb-3 text-sm text-slate-300">
              <span className="num text-slate-50">{tot.h}/{tot.n}</span> won ({pct(tot.h / tot.n)}) against an average model probability of <span className="num">{pct(tot.p / tot.n)}</span>.
              {list === "value" && <> Flat 1-unit stakes at the pre-lock odds: <span className={cn("num", tot.profit >= 0 ? "text-edge" : "text-miss")}>{tot.profit >= 0 ? "+" : ""}{tot.profit.toFixed(2)} units</span> (ROI {pct(tot.profit / tot.n)}).</>}
            </p>
            <table className="num w-full text-xs">
              <thead className="text-slate-500"><tr><th className="text-left font-normal">Day</th><th className="font-normal">Tips</th><th className="font-normal">Won</th><th className="font-normal">Rate</th><th className="font-normal">Avg p</th>{list === "value" && <th className="font-normal">Profit</th>}</tr></thead>
              <tbody>{record.map((r) => (
                <tr key={r.day} className="border-t hairline"><td className="py-1.5">{r.day}</td><td className="text-center">{r.n}</td><td className="text-center">{r.hits}</td>
                  <td className={cn("text-center", r.hits / r.n >= r.avgP - 0.05 ? "text-edge" : "text-miss")}>{pct(r.hits / r.n)}</td><td className="text-center text-slate-400">{pct(r.avgP)}</td>
                  {list === "value" && <td className={cn("text-center", (r.profit ?? 0) >= 0 ? "text-edge" : "text-miss")}>{(r.profit ?? 0).toFixed(2)}</td>}</tr>
              ))}</tbody>
            </table>
            <p className="mt-2 text-[11px] text-slate-500">Full history and baselines: <Link href="/accuracy" className="underline underline-offset-2">Accuracy ledger</Link>. Showing up to {TOP_N} per day.</p>
          </>
        )}
      </Card>
    </PullToRefresh>
  );
}
