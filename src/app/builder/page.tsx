import Link from "next/link";
import { prisma } from "@/lib/db";
import { dataMode } from "@/lib/mode";
import { getBoard } from "@/lib/queries";
import { allMarkets, GROUP_LABEL, marketHit, type MarketKey } from "@/lib/markets";
import { buildSlips, legHint, oneInN, SAFE_MAX_LEG_ODDS, type Candidate } from "@/lib/builder";

import { FIXTURE_WINDOW_DAYS } from "@/lib/window";
import { dayKeyIn, dayStart, fmtIn } from "@/lib/time";
import { tz } from "@/lib/tz";
import { BuilderResult } from "@/components/BuilderResult";
import { FilterSelect } from "@/components/FilterSelect";
import { EmptyState } from "@/components/EmptyState";
import { Card, Chip, SectionTitle, cn, pct } from "@/components/ui";

export const metadata = { title: "Odds builder" };
export const dynamic = "force-dynamic";
const DAY = 86_400_000;
const TARGETS = [3, 5, 10, 30, 100];
const WINDOWS: [number, string][] = [[1, "Today"], [2, "Next 2 days"], [3, "Next 3 days"], [7, "This week"], [14, "Next 14 days"]];

export default async function Builder({ searchParams }: { searchParams: Promise<{ target?: string; days?: string; mode?: string; legs?: string; min?: string; even?: string }> }) {
  const sp = await searchParams;
  const target = Math.min(1000, Math.max(1.2, Number(sp.target) || 5));
  const days = WINDOWS.some(([d]) => d === Number(sp.days)) ? Number(sp.days) : 2;
  const mode: "value" | "safe" = sp.mode === "safe" ? "safe" : "value";
  const maxLegs = Math.min(15, Math.max(2, Number(sp.legs) || 12));
  const minLegs = Math.min(maxLegs, Math.max(1, Number(sp.min) || 1));
  // Even legs by default: an accumulator of six similar prices is what people mean by a six-fold,
  // not one 1.60 propped up by five near-certainties. "even=0" opts out.
  const evenLegs = sp.even !== "0";
  const href = (o: Partial<{ target: number; days: number; mode: string; legs: number; min: number; even: boolean }>) =>
    `/builder?target=${o.target ?? target}&days=${o.days ?? days}&mode=${o.mode ?? mode}&legs=${o.legs ?? maxLegs}&min=${o.min ?? minLegs}&even=${(o.even ?? evenLegs) ? 1 : 0}`;

  // The cap applies when the user has actually chosen Safest. With no bookmaker odds the toggle is
  // hidden and the search runs in safe mode anyway; capping there would silently change that view.
  const legCap = mode === "safe" ? SAFE_MAX_LEG_ODDS : undefined;
  const zone = await tz();
  const now = new Date();
  const fixtures = await getBoard({ from: now, to: new Date(now.getTime() + Math.min(days, FIXTURE_WINDOW_DAYS) * DAY) });
  const quotes = await prisma.oddsQuote.findMany({ where: { fixtureId: { in: fixtures.map((f) => f.id) } }, orderBy: { fetchedAt: "desc" } });

  // Every market of every match is a candidate: main lines, alternative lines and specials.
  const candidates: Candidate[] = fixtures.flatMap((f) => {
    const p = f.predictions[0];
    if (!p || f.kickoffUtc <= now) return [];
    const q = new Map<string, number>();
    for (const x of quotes) if (x.fixtureId === f.id && !q.has(x.market)) q.set(x.market, x.odds); // newest first
    const H = f.homeTeam.shortName ?? f.homeTeam.name, A = f.awayTeam.shortName ?? f.awayTeam.name;
    return allMarkets(p, H, A).map((m) => {
      const price = q.get(m.key);
      return {
        matchId: f.id, league: f.league.name, startMs: +f.kickoffUtc, match: `${H} v ${A}`, label: m.label, market: m.key,
        group: m.group, p: m.p, odds: price && price > 1.01 ? price : 1 / m.p, real: !!price, band: p.band,
      };
    });
  });
  const withOdds = candidates.some((c) => c.real);
  const slips = buildSlips(candidates, { target, maxLegs, minLegs, mode: withOdds ? mode : "safe", band: "LOW", maxLegOdds: legCap, evenLegs }, 3);
  const hint = legHint(target);

  // Track record: build the same target from locked calls on each of the last 14 days and score it.
  const since = new Date(now.getTime() - 14 * DAY);
  const locked = await prisma.prediction.findMany({
    where: { lockedAt: { not: null }, fixture: { kickoffUtc: { gte: since, lt: dayStart(dayKeyIn(now, zone), zone) }, results: { some: {} } } },
    include: { fixture: { include: { homeTeam: true, awayTeam: true, league: true, results: { orderBy: { settledAt: "desc" }, take: 1 } } } },
  });
  const byDay = new Map<string, typeof locked>();
  for (const l of locked) { const k = dayKeyIn(l.fixture.kickoffUtc, zone); byDay.set(k, [...(byDay.get(k) ?? []), l]); }
  const record = [...byDay.entries()].sort(([a], [b]) => b.localeCompare(a)).flatMap(([day, ps]) => {
    const cands: Candidate[] = ps.flatMap((x) => {
      const H = x.fixture.homeTeam.shortName ?? x.fixture.homeTeam.name, A = x.fixture.awayTeam.shortName ?? x.fixture.awayTeam.name;
      return allMarkets(x, H, A).map((m) => ({ matchId: x.fixtureId, league: x.fixture.league.name, startMs: +x.fixture.kickoffUtc, match: `${H} v ${A}`,
        label: m.label, market: m.key, group: m.group, p: m.p, odds: 1 / m.p, real: false, band: x.band }));
    });
    const [built] = buildSlips(cands, { target, maxLegs, minLegs, mode: "safe", band: "LOW", maxLegOdds: legCap, evenLegs }, 1);
    if (!built) return [];
    const res = (id: string) => { const f = ps.find((x) => x.fixtureId === id)!.fixture, r = f.results[0];
      return { h: r.homeGoals, a: r.awayGoals, hc: f.homeCorners, ac: f.awayCorners, hs: f.homeShots, as: f.awayShots, hh: r.htHome, ha: r.htAway }; };
    const legs = built.legs.map((l) => marketHit(l.market as MarketKey, res(l.matchId)));
    if (legs.some((h) => h == null)) return [];
    return [{ day, legs: built.legs.length, odds: built.odds, won: legs.every(Boolean), hits: legs.filter(Boolean).length }];
  });
  const won = record.filter((r) => r.won).length;

  return (
    <>
      <header className="mb-4">
        <h1 className="text-2xl font-semibold tracking-tight md:text-3xl">Odds builder</h1>
        <p className="mt-1 max-w-2xl text-sm text-slate-400">
          Pick a target price and a window; the builder assembles the combination that reaches it with the best chance —
          one leg per match, at most 2 per competition and 2 of the same market type.
          Setting a minimum number of legs spreads the same price over more, shorter-priced picks — each leg safer,
          though the combined chance still follows the price you aim at.
          {withOdds ? " Bookmaker prices are used where they exist, so value legs are preferred." : " No bookmaker prices are stored, so the model's fair odds are used: the target itself sets the chance."}
          {legCap ? ` Safest never uses a leg priced above ${legCap.toFixed(2)}, so the target is reached with more, shorter picks.` : ""}
          {evenLegs
            ? ` Even legs is on: legs are kept to a similar price — ${target.toFixed(2)} over ${Math.max(2, minLegs > 1 ? minLegs : legHint(target).min)} legs means about ${Math.pow(target, 1 / Math.max(2, minLegs > 1 ? minLegs : legHint(target).min)).toFixed(2)} each, rather than one long leg carried by near-certainties.`
            : " Even legs is off: legs may be any mix of prices that reaches the target."}
        </p>
      </header>

      <div className="mb-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <div data-no-ptr className="flex flex-wrap gap-1.5">
          {TARGETS.map((t) => <Link key={t} href={href({ target: t })}><Chip active={target === t}>{t} odds</Chip></Link>)}
        </div>
        <form action="/builder" className="flex items-center gap-2">
          <input type="hidden" name="days" value={days} /><input type="hidden" name="mode" value={mode} /><input type="hidden" name="legs" value={maxLegs} />
          <label className="flex min-w-0 flex-1 items-center gap-2 rounded-xl border hairline bg-white/[0.02] px-3 py-2">
            <span className="shrink-0 text-[11px] uppercase tracking-wide text-slate-500">Custom</span>
            <input name="target" type="number" step="0.1" min="1.2" max="1000" defaultValue={target}
              className="focus-ring num w-full min-w-0 bg-transparent text-sm text-slate-100 outline-none" />
          </label>
          <button className="focus-ring rounded-xl border border-edge/40 px-3 py-2 text-sm text-edge hover:bg-edge/10">Go</button>
        </form>
        <FilterSelect label="Window" value={String(days)} options={WINDOWS.map(([d, l]) => ({ value: String(d), label: l, href: href({ days: d }) }))} />
        <FilterSelect label="Max legs" value={String(maxLegs)} options={[4, 6, 8, 10, 12, 15].map((n) => ({ value: String(n), label: `${n} legs`, href: href({ legs: n }) }))} />
        <FilterSelect label="Min legs" value={String(minLegs)}
          options={[1, 3, 4, 5, 6, 8].map((n) => ({ value: String(n), label: n === 1 ? "no minimum" : `at least ${n}`, href: href({ min: n }) }))} />
        <FilterSelect label="Leg prices" value={evenLegs ? "even" : "mixed"}
          options={[{ value: "even", label: "Even", href: href({ even: true }) }, { value: "mixed", label: "Any mix", href: href({ even: false }) }]} />
      </div>
      {withOdds && (
        <div data-no-ptr className="mb-5 inline-flex rounded-xl border hairline p-1">
          {(["value", "safe"] as const).map((m) => (
            <Link key={m} href={href({ mode: m })} className={cn("rounded-lg px-3 py-1.5 text-sm", mode === m ? "bg-edge text-ink-950" : "text-slate-300")}>
              {m === "value" ? "Best value" : "Safest"}
            </Link>
          ))}
        </div>
      )}

      {slips.length === 0 ? (
        <EmptyState title="No combination reaches that target"
          body={legCap
            ? `Safest only uses legs priced ${legCap.toFixed(2)} or shorter, and nothing in this window reaches ${target.toFixed(2)} that way within ${maxLegs} legs${minLegs > 1 ? ` (at least ${minLegs})` : ""}. Try a longer window, a lower target, more legs, or switch to Best value.`
            : `Nothing in this window adds up to ${target.toFixed(2)} within the leg limits${minLegs > 1 ? ` (at least ${minLegs} legs)` : ""}. Try a longer window, a lower target, or a smaller minimum.`}
          action={{ href: href({ days: Math.min(14, days * 2) }), label: "Widen the window" }} />
      ) : (
        <div className="space-y-4">
          {slips.map((s, i) => (
            <BuilderResult key={i} index={i} target={target}
              slip={{ odds: s.odds, p: s.p, adjusted: s.adjusted, real: s.real, edge: s.edge,
                legs: s.legs.map((l) => ({ fixtureId: l.matchId, market: l.market, label: l.label, match: l.match, league: l.league, p: l.p, odds: l.odds, real: l.real, group: GROUP_LABEL[l.group as keyof typeof GROUP_LABEL] ?? l.group, when: fmtIn(new Date(l.startMs), zone, "EEE HH:mm") })) }} />
          ))}
        </div>
      )}

      <Card className="mt-6">
        <SectionTitle aside="locked calls only · last 14 days">Track record at this target</SectionTitle>
        {record.length === 0 ? <p className="text-sm text-slate-400">Fills in as locked calls are settled: each past day is rebuilt at this target and scored.</p> : (
          <>
            <p className="mb-3 text-sm text-slate-300">
              A <span className="num">{target.toFixed(2)}</span> slip built on each of the last {record.length} day{record.length === 1 ? "" : "s"} would have won{" "}
              <span className={cn("num", won ? "text-edge" : "text-miss")}>{won}</span>. Expected at this price: about 1 in {oneInN(hint.chance)}.
            </p>
            <table className="num w-full text-xs">
              <thead className="text-slate-500"><tr><th className="text-left font-normal">Day</th><th className="font-normal">Legs</th><th className="font-normal">Odds</th><th className="font-normal">Legs won</th><th className="font-normal">Slip</th></tr></thead>
              <tbody>{record.map((r) => (
                <tr key={r.day} className="border-t hairline"><td className="py-1.5">{r.day}</td><td className="text-center">{r.legs}</td><td className="text-center">{r.odds.toFixed(2)}</td>
                  <td className="text-center text-slate-400">{r.hits}/{r.legs}</td><td className={cn("text-center", r.won ? "text-edge" : "text-miss")}>{r.won ? "won" : "lost"}</td></tr>
              ))}</tbody>
            </table>
          </>
        )}
        <p className="mt-3 text-[11px] leading-relaxed text-slate-500">
          Long accumulators lose most of the time by design: at {target.toFixed(2)} the chance is about {pct(hint.chance)}, roughly 1 in {oneInN(hint.chance)}.
          Combined chances assume the legs are independent; a small haircut is applied because they are not. Never stake more than you can lose. 18+.
        </p>
      </Card>
    </>
  );
}
