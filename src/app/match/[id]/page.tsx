import { notFound } from "next/navigation";
import Link from "next/link";
import type { Metadata } from "next";
import { getMatch } from "@/lib/queries";
import { fmtUtc, fmtWat } from "@/lib/time";
import { ProbBar } from "@/components/ProbBar";
import { ConfidenceBadge } from "@/components/ConfidenceBadge";
import { allMarkets, marketHit, GROUP_LABEL, type MarketGroup } from "@/lib/markets";
import { bestTip } from "@/lib/top";
import { AddToSlip } from "@/components/AddToSlip";
import { prisma } from "@/lib/db";
import { europeanHandicap } from "@/lib/model/dixonColes";
import { cn } from "@/components/ui";
import { FormStrip } from "@/components/FormStrip";
import { DataFlags } from "@/components/DataFlags";
import { CountUp } from "@/components/CountUp";
import { Card, SectionTitle, pct } from "@/components/ui";
import { outcomeOf } from "@/lib/model/metrics";

type Games = NonNullable<Awaited<ReturnType<typeof getMatch>>>["homeLast"];
const res = (g: Games[number], teamId: string): "W" | "D" | "L" => {
  const gf = g.homeTeamId === teamId ? g.homeGoals! : g.awayGoals!, ga = g.homeTeamId === teamId ? g.awayGoals! : g.homeGoals!;
  return gf > ga ? "W" : gf === ga ? "D" : "L";
};

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const m = await getMatch((await params).id);
  return { title: m ? `${m.fx.homeTeam.name} v ${m.fx.awayTeam.name}` : "Match" };
}

export default async function MatchPage({ params }: { params: Promise<{ id: string }> }) {
  const data = await getMatch((await params).id);
  if (!data) notFound();
  const { fx, homeLast, awayLast, h2h } = data;
  const p = fx.predictions[0];
  const H = fx.homeTeam.shortName ?? fx.homeTeam.name, A = fx.awayTeam.shortName ?? fx.awayTeam.name;
  const done = fx.status === "FINISHED" && fx.homeGoals != null;
  const split = (g: Games, teamId: string, venue: "home" | "away") =>
    g.filter((x) => (venue === "home" ? x.homeTeamId : x.awayTeamId) === teamId).slice(0, 5).map((x) => res(x, teamId));

  const quotes = p ? await prisma.oddsQuote.findMany({ where: { fixtureId: fx.id }, orderBy: { fetchedAt: "desc" } }) : [];
  const oddsOf = (k: string) => quotes.find((q) => q.market === k)?.odds;
  const open = fx.status === "SCHEDULED" && fx.kickoffUtc > new Date();
  const markets = p ? allMarkets(p, fx.homeTeam.shortName ?? fx.homeTeam.name, fx.awayTeam.shortName ?? fx.awayTeam.name) : [];
  const tip = p ? bestTip(p, fx.homeTeam.shortName ?? fx.homeTeam.name, fx.awayTeam.shortName ?? fx.awayTeam.name) : null;
  return (
    <article>
      <Link href={`/league/${fx.leagueId}`} className="focus-ring text-xs text-slate-400 hover:text-slate-200">{fx.league.name}{fx.round ? ` · ${fx.round}` : ""}</Link>

      {/* The one loud moment: the strongest tip (no correct-score call). */}
      <header className="relative mt-3 overflow-hidden rounded-[20px] border hairline bg-[radial-gradient(120%_90%_at_50%_0%,#13203a_0%,#0B1220_55%,#070B14_100%)] px-4 pb-6 pt-5 md:px-8 md:pt-7">
        <div className="flex items-center justify-between text-xs text-slate-400">
          <span className="num">{fmtWat(fx.kickoffUtc, "EEE d MMM, HH:mm")} WAT <span className="text-slate-600">/ {fmtUtc(fx.kickoffUtc)} UTC</span></span>
          {p && <ConfidenceBadge band={p.band} score={p.confidence} />}
        </div>
        <div className="mt-6 grid grid-cols-[1fr_auto_1fr] items-center gap-3">
          <h1 className="text-right text-base font-medium leading-tight text-slate-100 md:text-xl">{fx.homeTeam.name}</h1>
          <div className="text-center text-xs text-slate-600">vs</div>
          <h1 className="text-base font-medium leading-tight text-slate-100 md:text-xl">{fx.awayTeam.name}</h1>
        </div>
        {p && tip && (
          <div className="mx-auto mt-6 max-w-md rounded-2xl border border-edge/40 bg-edge/[0.07] px-4 py-4 text-center">
            <div className="text-[11px] uppercase tracking-wide text-edge/80">Best tip · {GROUP_LABEL[tip.group]}</div>
            <div className="mt-1 text-lg font-medium text-slate-50 md:text-xl">{tip.label}</div>
            <CountUp value={tip.p} className="num mt-1 block text-5xl font-semibold leading-none text-edge md:text-6xl" />
            <div className="num mt-2 text-[11px] text-slate-400">fair odds {(1 / tip.p).toFixed(2)}</div>
          </div>
        )}
        {p && !tip && <p className="mx-auto mt-6 max-w-md text-center text-sm text-slate-400">No tip reaches 55% at Medium or High confidence for this match.</p>}
        {p && (
          <>
            <div className="mx-auto mt-7 max-w-xl"><ProbBar home={p.calHome} draw={p.calDraw} away={p.calAway} size="lg" /></div>
            <div className="mx-auto mt-5 max-w-xl overflow-x-auto">
              <table className="w-full border-separate border-spacing-1 text-center" aria-label="Goal lines">
                <thead>
                  <tr className="text-[10px] text-slate-500">
                    <th className="w-16 text-left font-normal">Goals</th>
                    {["1.5", "2.5", "3.5", "4.5"].map((l) => <th key={l} className="num font-normal">{l}</th>)}
                    <th className="font-normal">BTTS</th>
                  </tr>
                </thead>
                <tbody>
                  {([["Over", [p.calOver15, p.calOver25, p.calOver35, p.calOver45]], ["Under", [1 - p.calOver15, 1 - p.calOver25, 1 - p.calOver35, 1 - p.calOver45]]] as const).map(([side, vals], r) => (
                    <tr key={side}>
                      <th className="text-left text-[11px] font-normal text-slate-400">{side}</th>
                      {vals.map((v, i) => (
                        <td key={i} className="rounded-lg border hairline bg-white/[0.02] py-1.5">
                          <CountUp value={v} className={`num text-sm md:text-base ${v >= 0.6 ? "text-edge" : "text-slate-100"}`} />
                        </td>
                      ))}
                      <td className="rounded-lg border hairline bg-white/[0.02] py-1.5">
                        <CountUp value={r === 0 ? p.calBtts : 1 - p.calBtts} className={`num text-sm md:text-base ${(r === 0 ? p.calBtts : 1 - p.calBtts) >= 0.6 ? "text-edge" : "text-slate-100"}`} />
                        <div className="text-[9px] text-slate-500">{r === 0 ? "yes" : "no"}</div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="num mt-4 text-center text-[11px] text-slate-500">λ {p.lambdaHome.toFixed(2)} – {p.lambdaAway.toFixed(2)} · ρ {p.rho.toFixed(3)} · {p.modelVersion} r{p.revision}{p.lockedAt ? " · locked" : ""}</div>
          </>
        )}
      </header>

      {done && p && (
        <Card className="mt-4">
          <SectionTitle aside={p.lockedAt ? `locked ${fmtWat(p.lockedAt, "d MMM HH:mm")} WAT` : "pre-lock call (not scored)"}>Result vs call</SectionTitle>
          {(() => {
            const o = outcomeOf(fx.homeGoals!, fx.awayGoals!);
            const called = [p.calHome, p.calDraw, p.calAway].indexOf(Math.max(p.calHome, p.calDraw, p.calAway));
            const brier = [p.calHome, p.calDraw, p.calAway].reduce((s, q, k) => s + (q - (k === o ? 1 : 0)) ** 2, 0);
            return (
              <div className="grid grid-cols-3 gap-3 text-sm">
                <div><div className="text-xs text-slate-500">Final</div><div className="num text-xl">{fx.homeGoals}–{fx.awayGoals}</div></div>
                <div><div className="text-xs text-slate-500">1X2 call</div><div className={called === o ? "text-edge" : "text-miss"}>{called === o ? "Hit" : "Miss"}</div></div>
                <div><div className="text-xs text-slate-500">Brier</div><div className="num">{brier.toFixed(3)}</div></div>
              </div>
            );
          })()}
        </Card>
      )}

      {p && (
        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          <Card>
            <SectionTitle>Why this call</SectionTitle>
            <ul className="space-y-2.5 text-sm leading-relaxed text-slate-300">
              {(p.rationale as string[]).map((b, i) => <li key={i} className="flex gap-2.5"><span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-edge" />{b}</li>)}
            </ul>
            <div className="mt-4 border-t hairline pt-3"><DataFlags flags={p.dataFlags} /></div>
          </Card>
          <Card>
            <SectionTitle aside="calibrated probability">All markets</SectionTitle>
            <div className="space-y-3">
              {(Object.keys(GROUP_LABEL) as MarketGroup[]).map((g) => {
                const rows = markets.filter((m) => m.group === g);
                return (
                  <div key={g}>
                    <div className="mb-1 text-[11px] text-slate-500">{GROUP_LABEL[g]}</div>
                    {rows.length ? (
                      <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
                        {rows.map((m) => {
                          const h = done ? marketHit(m.key, { h: fx.homeGoals!, a: fx.awayGoals!, hc: fx.homeCorners, ac: fx.awayCorners, hs: fx.homeShots, as: fx.awayShots }, { corners: p.cornersLine, shots: p.shotsLine }) : null;
                          return (
                            <div key={m.key} className={cn("rounded-lg border px-2.5 py-1.5", tip?.key === m.key ? "border-edge/50 bg-edge/10" : "hairline bg-white/[0.02]")}>
                              <div className="flex items-start justify-between gap-1">
                                <div className="truncate text-[11px] text-slate-400" title={m.label}>{m.short}</div>
                                {open && <AddToSlip fixtureId={fx.id} market={m.key} className="-mr-1 -mt-0.5 scale-90" />}
                              </div>
                              <div className="flex items-baseline justify-between">
                                <span className={cn("num text-sm", m.p >= 0.6 ? "text-edge" : "text-slate-100")}>{pct(m.p)}</span>
                                {h != null && <span className={cn("text-[10px]", h ? "text-edge" : "text-miss")}>{h ? "hit" : "miss"}</span>}
                                {h == null && oddsOf(m.key) && <span className={cn("num text-[10px]", m.p * oddsOf(m.key)! - 1 >= 0.03 ? "text-edge" : "text-slate-500")} title="median bookmaker odds">@{oddsOf(m.key)!.toFixed(2)}</span>}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    ) : <p className="text-xs text-slate-500">{g === "corners" || g === "shots" ? "Needs match statistics history (API-Football). Appears once 80+ league matches have stats." : "Not available for this match yet."}</p>}
                    {g === "corners" && p.expCorners != null && <p className="num mt-1 text-[10px] text-slate-500">expected corners {p.expCorners.toFixed(1)}</p>}
                    {g === "shots" && p.expShots != null && <p className="num mt-1 text-[10px] text-slate-500">expected total shots {p.expShots.toFixed(1)}</p>}
                    {g === "hcp" && (
                      <table className="num mt-2 w-full text-[11px]">
                        <thead className="text-slate-500"><tr><th className="text-left font-normal">European handicap</th><th className="font-normal">{H}</th><th className="font-normal">Draw</th><th className="font-normal">{A}</th></tr></thead>
                        <tbody>{[-2, -1, 1, 2].map((hc) => { const [x, d, y] = europeanHandicap(p.matrix as number[][], hc); return (
                          <tr key={hc} className="border-t hairline"><td className="py-1 text-slate-400">{H} {hc > 0 ? `+${hc}` : hc}</td><td className="text-center">{pct(x)}</td><td className="text-center text-slate-400">{pct(d)}</td><td className="text-center">{pct(y)}</td></tr>
                        ); })}</tbody>
                      </table>
                    )}
                  </div>
                );
              })}
            </div>
          </Card>
        </div>
      )}

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card>
          <SectionTitle aside="newest first">Form</SectionTitle>
          <dl className="space-y-3 text-sm">
            {[{ name: H, g: homeLast, id: fx.homeTeamId, v: "home" as const }, { name: A, g: awayLast, id: fx.awayTeamId, v: "away" as const }].map((t) => (
              <div key={t.id}>
                <dt className="mb-1 text-slate-200">{t.name}</dt>
                <dd className="grid gap-1.5 text-xs text-slate-400">
                  <div className="flex items-center justify-between">Last 5 <FormStrip results={t.g.slice(0, 5).map((x) => res(x, t.id))} /></div>
                  <div className="flex items-center justify-between">Last 10 <FormStrip results={t.g.slice(0, 10).map((x) => res(x, t.id))} /></div>
                  <div className="flex items-center justify-between">{t.v === "home" ? "At home" : "Away"} <FormStrip results={split(t.g, t.id, t.v)} /></div>
                </dd>
              </div>
            ))}
          </dl>
        </Card>
        <Card>
          <SectionTitle>Head to head</SectionTitle>
          {h2h.length ? (
            <ul className="divide-y divide-white/[0.05] text-sm">
              {h2h.map((g) => (
                <li key={g.id} className="flex items-center justify-between py-2">
                  <span className="num text-xs text-slate-500">{fmtWat(g.kickoffUtc, "d MMM yy")}</span>
                  <span className="flex-1 truncate px-3 text-right text-slate-300">{g.homeTeam.shortName ?? g.homeTeam.name}</span>
                  <span className="num text-slate-100">{g.homeGoals}–{g.awayGoals}</span>
                  <span className="flex-1 truncate px-3 text-slate-300">{g.awayTeam.shortName ?? g.awayTeam.name}</span>
                </li>
              ))}
            </ul>
          ) : <p className="text-sm text-slate-400">No previous meetings in stored history.</p>}
        </Card>
      </div>
    </article>
  );
}
