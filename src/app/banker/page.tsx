import Link from "next/link";
import { unstable_cache } from "next/cache";
import { prisma } from "@/lib/db";
import { dataMode } from "@/lib/mode";
import { BANKERS, GOTD_TARGET, rolloverChains, streaks, type BankerConfig, type StoredLeg } from "@/lib/banker";
import type { Candidate } from "@/lib/builder";
import { GROUP_LABEL, MARKET_OPTIONS, type MarketGroup } from "@/lib/markets";
import { BANKER_TZ, buildBankers, ensureBankers, loadBankers, nextDayKey, rebuiltHistory, type SettledBanker } from "@/lib/pipeline/banker";
import { dayKeyIn, fmtIn } from "@/lib/time";
import { tz } from "@/lib/tz";
import { BuilderResult, type BuilderSlip } from "@/components/BuilderResult";
import { EmptyState } from "@/components/EmptyState";
import { Card, Chip, SectionTitle, cn, pct } from "@/components/ui";

export const metadata = { title: "Daily banker" };
export const dynamic = "force-dynamic";
const STEPS = [2, 3, 4, 5, 7];
const HISTORY_DAYS = 28;

const groupOf = (market: string) => {
  const g = MARKET_OPTIONS.find((o) => o.value === `k:${market}`)?.group;
  return g ? GROUP_LABEL[g as MarketGroup] : "";
};

/** A stored or live slip in the shape the result card takes. */
function asSlip(legs: (StoredLeg | Candidate)[], zone: string): BuilderSlip {
  const rows = legs.map((l) => "matchId" in l
    ? { fixtureId: l.matchId, market: l.market, label: l.label, match: l.match, league: l.league, p: l.p, odds: l.odds, real: l.real, group: GROUP_LABEL[l.group as MarketGroup] ?? l.group, when: fmtIn(new Date(l.startMs), zone, "EEE HH:mm") }
    : { fixtureId: l.fixtureId, market: l.market, label: l.label, match: l.match, league: l.league, p: l.p, odds: l.odds, real: l.real, group: groupOf(l.market), when: fmtIn(new Date(l.kickoff), zone, "EEE HH:mm") });
  const odds = rows.reduce((s, l) => s * l.odds, 1), p = rows.reduce((s, l) => s * l.p, 1);
  return { odds, p, adjusted: p, edge: p * odds - 1, real: rows.every((l) => l.real), legs: rows };
}

export default async function Banker({ searchParams }: { searchParams: Promise<{ day?: string; steps?: string }> }) {
  const sp = await searchParams;
  const { provider } = await dataMode();
  const zone = await tz();
  const now = new Date();
  const today = dayKeyIn(now, BANKER_TZ), tomorrow = nextDayKey(today);
  const showTomorrow = sp.day === "tomorrow";
  const steps = STEPS.includes(Number(sp.steps)) ? Number(sp.steps) : 4;
  const href = (o: { day?: string; steps?: number }) => `/banker?day=${o.day ?? (showTomorrow ? "tomorrow" : "today")}&steps=${o.steps ?? steps}`;

  // Today's bankers are fixed the first time anyone (a page view or the sync) builds them.
  let ensureError: string | null = null;
  try { await ensureBankers(prisma, provider, now); } catch (e) { ensureError = (e as Error).message; }
  const stored = await loadBankers(prisma, provider, HISTORY_DAYS + 1, now);
  const todays = stored.filter((b) => b.day === today);
  const preview = showTomorrow ? await buildBankers(prisma, provider, tomorrow, now) : null;

  // Rebuilt history is the same work for every viewer; cache it like the builder's record.
  const rebuilt = await unstable_cache(async () => Object.fromEntries(await Promise.all(BANKERS.map(async (b) =>
    [String(b.target), await rebuiltHistory(prisma, provider, b, HISTORY_DAYS, now)] as const))),
  ["banker-rebuilt", provider, today], { revalidate: 600, tags: ["banker-record"] })();

  const gotdToday = todays.find((b) => b.target === GOTD_TARGET);
  const gotd = showTomorrow ? (preview?.gotd ? asSlip([preview.gotd], zone) : null) : gotdToday ? asSlip(gotdToday.legs, zone) : null;
  const stateMap = (b: SettledBanker | undefined) => (b ? Object.fromEntries(b.legs.map((l) => [l.fixtureId, l.state])) : undefined);

  return (
    <>
      <header className="mb-4">
        <h1 className="text-2xl font-semibold tracking-tight md:text-3xl">Daily banker</h1>
        <p className="mt-1 max-w-2xl text-sm text-slate-400">
          The safest combination the day offers at <span className="num">1.74</span> (at least 6 games) and <span className="num">2.25</span> (at least 8 games), built for rollovers,
          plus the single safest game of the day. Picked once from the {fmtIn(now, BANKER_TZ, "zzz")} calendar day and then <strong className="text-slate-300">fixed</strong>,
          so a slip you booked this morning never changes. Only markets Sportybet books as one selection; no leg above 1.45; Low-confidence calls never used.
        </p>
        <div data-no-ptr className="mt-3 flex flex-wrap gap-1.5">
          <Link href={href({ day: "today" })}><Chip active={!showTomorrow}>Today</Chip></Link>
          <Link href={href({ day: "tomorrow" })}><Chip active={showTomorrow}>Tomorrow (provisional)</Chip></Link>
        </div>
        {showTomorrow && <p className="mt-2 text-[11px] text-amber">Tomorrow&apos;s slips are previews: they are fixed at the first sync after midnight and may differ.</p>}
        {ensureError && <p className="mt-2 text-[11px] text-miss">Could not build today&apos;s banker: {ensureError}</p>}
      </header>

      <Card className="mb-4">
        <SectionTitle aside="priced 1.20-1.60 · High confidence first">Game of the day</SectionTitle>
        {gotd ? <BuilderResult unpriced="est." slip={gotd} index={0} target={gotd.odds} title={gotd.legs[0].match} states={showTomorrow ? undefined : stateMap(gotdToday)} />
          : <p className="text-sm text-slate-400">No pick yet for {showTomorrow ? "tomorrow" : "today"}: nothing still to play is priced 1.20-1.60 with Medium or High confidence.</p>}
      </Card>

      <div className="space-y-4">
        {BANKERS.map((cfg) => {
          const fixed = todays.find((b) => b.target === cfg.target);
          const live = preview?.slips.get(cfg.target);
          const slip = showTomorrow ? (live ? asSlip(live.legs, zone) : null) : fixed ? asSlip(fixed.legs, zone) : null;
          return (
            <div key={cfg.target}>
              {slip ? (
                <>
                  <BuilderResult unpriced="est." slip={slip} index={0} target={cfg.target} title={`${cfg.label} · ${cfg.plan}`} states={showTomorrow ? undefined : stateMap(fixed)} />
                  {fixed && !showTomorrow && fixed.state !== "pending" && (
                    <p className={cn("mt-1 text-xs", fixed.state === "won" ? "text-edge" : "text-miss")}>Today&apos;s {cfg.label} {fixed.state} at {fixed.settledOdds.toFixed(2)}.</p>
                  )}
                </>
              ) : (
                <EmptyState title={`No ${cfg.label} ${showTomorrow ? "for tomorrow yet" : "today"}`}
                  body={`Fewer than ${cfg.minLegs} safe, bookable legs reach ${cfg.target.toFixed(2)} among the games still to play. It is retried at every sync until the day can make one.`} />
              )}
            </div>
          );
        })}
      </div>

      <h2 className="mb-2 mt-8 text-lg font-semibold tracking-tight">Rollover record</h2>
      <div data-no-ptr className="mb-3 flex flex-wrap items-center gap-1.5 text-xs text-slate-400">
        Roll over
        {STEPS.map((n) => <Link key={n} href={href({ steps: n })}><Chip active={steps === n}>{n} times</Chip></Link>)}
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        {BANKERS.map((cfg) => <RolloverCard key={cfg.target} cfg={cfg} steps={steps}
          published={stored.filter((b) => b.target === cfg.target && b.day !== today)}
          rebuilt={rebuilt[String(cfg.target)] ?? []} todayP={todays.find((b) => b.target === cfg.target)?.p ?? null} />)}
      </div>

      <p className="mt-6 text-[11px] leading-relaxed text-slate-500">
        A rollover multiplies the risk with the price: four 1.74 wins in a row pay about {Math.pow(1.74, 4).toFixed(1)}× the stake, and four 1.74 slips each at 60% land together only about 13% of the time.
        More legs at the same total price never make a slip safer — they make each leg shorter. Probabilities are model estimates, not guarantees; legs on the same day are not fully independent.
        Never stake more than you can afford to lose. 18+.
      </p>
    </>
  );
}

function RolloverCard({ cfg, steps, published, rebuilt, todayP }: {
  cfg: BankerConfig; steps: number; published: SettledBanker[]; todayP: number | null;
  rebuilt: { day: string; state: "won" | "lost" | "pending"; odds: number; p: number }[];
}) {
  // Published bankers win over rebuilt ones for the same day; oldest first for the chain arithmetic.
  const pubDays = new Set(published.map((b) => b.day));
  const series = [
    ...published.map((b) => ({ day: b.day, state: b.state, odds: b.settledOdds, p: b.p, kind: "published" as const })),
    ...rebuilt.filter((r) => !pubDays.has(r.day)).map((r) => ({ ...r, kind: "rebuilt" as const })),
  ].sort((a, b) => a.day.localeCompare(b.day));
  const settled = series.filter((d) => d.state !== "pending");
  const won = settled.filter((d) => d.state === "won").length;
  const ch = rolloverChains(settled, steps);
  const st = streaks(settled);
  const avgP = settled.length ? settled.reduce((s, d) => s + d.p, 0) / settled.length : todayP ?? 1 / cfg.target;
  return (
    <Card>
      <SectionTitle aside={`last ${HISTORY_DAYS} days`}>{cfg.label}</SectionTitle>
      {settled.length === 0 ? <p className="text-sm text-slate-400">Fills in as days settle. Days before the banker was stored are rebuilt from the locked calls at fair odds.</p> : (
        <>
          <div className="num mb-3 grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
            <div><div className="text-[11px] text-slate-500">Days won</div><span className="text-edge">{won}</span>/{settled.length} <span className="text-slate-500">({pct(won / settled.length)})</span></div>
            <div><div className="text-[11px] text-slate-500">{steps}-step rollovers</div><span className="text-edge">{ch.completed}</span> cashed · <span className="text-miss">{ch.busted}</span> bust</div>
            <div><div className="text-[11px] text-slate-500">Win streak</div>now {st.current} · best {st.best}</div>
            <div><div className="text-[11px] text-slate-500">Expected {steps} in a row</div>{pct(Math.pow(avgP, steps))}</div>
          </div>
          {ch.open && <p className="mb-2 text-xs text-slate-300">Chain in progress: {ch.open.reached} of {steps} won since {ch.open.start} (×{ch.open.multiplier.toFixed(2)} so far).</p>}
          <table className="num w-full text-xs">
            <thead className="text-slate-500"><tr><th className="text-left font-normal">Day</th><th className="font-normal">Odds</th><th className="font-normal">Chance</th><th className="font-normal">Result</th></tr></thead>
            <tbody>{[...series].reverse().map((d) => (
              <tr key={d.day} className="border-t hairline">
                <td className="py-1.5">{d.day}{d.kind === "rebuilt" && <span className="ml-1 text-[10px] text-slate-500">rebuilt</span>}</td>
                <td className="text-center">{d.odds.toFixed(2)}</td><td className="text-center text-slate-400">{pct(d.p)}</td>
                <td className={cn("text-center", d.state === "won" ? "text-edge" : d.state === "lost" ? "text-miss" : "text-slate-500")}>{d.state}</td>
              </tr>
            ))}</tbody>
          </table>
        </>
      )}
    </Card>
  );
}
