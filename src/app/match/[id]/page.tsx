import { notFound } from "next/navigation";
import Link from "next/link";
import type { Metadata } from "next";
import { getMatch } from "@/lib/queries";
import { fmtUtc, fmtWat } from "@/lib/time";
import { ProbBar } from "@/components/ProbBar";
import { ConfidenceBadge } from "@/components/ConfidenceBadge";
import { ScoreHeatmap } from "@/components/ScoreHeatmap";
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

  return (
    <article>
      <Link href={`/league/${fx.leagueId}`} className="focus-ring text-xs text-slate-400 hover:text-slate-200">{fx.league.name}{fx.round ? ` · ${fx.round}` : ""}</Link>

      {/* The one loud moment: the predicted score. */}
      <header className="relative mt-3 overflow-hidden rounded-[20px] border hairline bg-[radial-gradient(120%_90%_at_50%_0%,#13203a_0%,#0B1220_55%,#070B14_100%)] px-4 pb-6 pt-5 md:px-8 md:pt-7">
        <div className="flex items-center justify-between text-xs text-slate-400">
          <span className="num">{fmtWat(fx.kickoffUtc, "EEE d MMM, HH:mm")} WAT <span className="text-slate-600">/ {fmtUtc(fx.kickoffUtc)} UTC</span></span>
          {p && <ConfidenceBadge band={p.band} score={p.confidence} />}
        </div>
        <div className="mt-6 grid grid-cols-[1fr_auto_1fr] items-center gap-3">
          <h1 className="text-right text-base font-medium leading-tight text-slate-100 md:text-xl">{fx.homeTeam.name}</h1>
          <div className="text-center">
            {p ? (
              <div className="num text-[64px] font-semibold leading-none tracking-tight text-slate-50 md:text-[104px]" aria-label={`Predicted score ${p.predHomeGoals} ${p.predAwayGoals}`}>
                {p.predHomeGoals}<span className="mx-2 text-slate-600 md:mx-3">–</span>{p.predAwayGoals}
              </div>
            ) : <div className="num text-5xl text-slate-600">– –</div>}
            <div className="mt-1 text-[11px] text-slate-500">{p ? `most likely score, ${pct((p.topScorelines as { p: number }[])[0].p)}` : "no model call yet"}</div>
          </div>
          <h1 className="text-base font-medium leading-tight text-slate-100 md:text-xl">{fx.awayTeam.name}</h1>
        </div>
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
            <SectionTitle aside="top 5">Scorelines</SectionTitle>
            <ScoreHeatmap matrix={p.matrix as number[][]} homeName={H} awayName={A} />
            <ol className="num mt-3 grid grid-cols-5 gap-1 text-center text-xs">
              {(p.topScorelines as { h: number; a: number; p: number }[]).map((s) => (
                <li key={`${s.h}-${s.a}`} className="rounded-lg border hairline py-1.5"><div className="text-slate-100">{s.h}–{s.a}</div><div className="text-slate-500">{pct(s.p)}</div></li>
              ))}
            </ol>
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
