import { prisma } from "@/lib/db";
import { dataMode } from "@/lib/mode";
import { loadScoredCalls } from "@/lib/pipeline/ledger";
import { computeAccuracy, dailySeries, type Metrics } from "@/lib/accuracy";
import { tz } from "@/lib/tz";
import { MODEL_VERSION } from "@/lib/model/constants";
import { EmptyState } from "@/components/EmptyState";
import { BrierChart } from "@/components/BrierChart";
import { Card, SectionTitle, cn, pct } from "@/components/ui";

export const metadata = { title: "Accuracy" };
export const dynamic = "force-dynamic";

const f3 = (x: number) => x.toFixed(3);

export default async function Accuracy() {
  const mode = await dataMode();
  const calls = await loadScoredCalls(prisma, mode.provider);
  const cal = await prisma.calibrationModel.findMany({ where: { provider: mode.provider, modelVersion: MODEL_VERSION, active: true }, orderBy: { market: "asc" } });
  const header = (
    <header className="mb-5">
      <h1 className="text-2xl font-semibold tracking-tight">Accuracy ledger</h1>
      <p className="mt-1 max-w-2xl text-sm text-slate-400">
        Only calls <b className="text-slate-200">locked 15 minutes before kickoff</b> are scored, against the final result. Locked calls are never edited; score corrections are appended, never overwritten. Lower Brier and log loss are better.{mode.demo ? " Demo ledger: simulated matches." : ""}
      </p>
    </header>
  );
  if (!calls.length) return (<>{header}<EmptyState title="No locked calls have been settled yet"
    body="Every prediction is locked 15 minutes before kickoff and scored after full time. The first numbers appear once the first locked matches finish."
    action={{ href: "/methodology", label: "How scoring works" }} /></>);

  const r = computeAccuracy(calls);
  const series = dailySeries(calls, await tz()).map((d) => ({ day: d.day, model: d.report.model.brier, home: d.report.alwaysHome.brier, n: d.report.n }));
  const row = (name: string, m: Metrics | null, note?: string, best?: boolean) => m && (
    <tr className="border-t hairline">
      <td className="py-2 font-sans text-slate-300">{name}{note && <span className="block text-[10px] text-slate-500">{note}</span>}</td>
      <td className={cn("text-center", best && "text-edge")}>{f3(m.brier)}</td>
      <td className="text-center">{f3(m.logloss)}</td>
      <td className="text-center">{pct(m.hit)}</td>
      <td className="text-center text-slate-500">{m.n}</td>
    </tr>
  );
  return (
    <>
      {header}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <SectionTitle aside={`${r.n} locked calls`}>1X2 probability quality</SectionTitle>
          <div className="overflow-x-auto">
            <table className="num w-full text-xs">
              <thead className="text-slate-500"><tr><th className="text-left font-normal">Forecaster</th><th className="font-normal">Brier</th><th className="font-normal">Log loss</th><th className="font-normal">Hit</th><th className="font-normal">n</th></tr></thead>
              <tbody>
                {row("PitchEdge model", r.model, MODEL_VERSION, r.model.brier <= r.alwaysHome.brier)}
                {row("Always home", r.alwaysHome, "home win every time")}
                {r.tableFav.covered ? row("League-table favourite", r.tableFav, "higher-placed side at kickoff") : null}
                {r.market && row("Model (same matches)", r.market.model, "matches with bookmaker odds")}
                {r.market && row("Bookmaker closing odds", r.market.market, "margin removed")}
              </tbody>
            </table>
          </div>
          <p className="mt-3 text-[11px] leading-relaxed text-slate-500">Brier: 0 is perfect; ~0.67 is guessing one-third each. Beating the bookmaker&apos;s odds is the hardest test and many good models don&apos;t.</p>
        </Card>
        <Card>
          <SectionTitle aside="daily, lower is better">Brier over time</SectionTitle>
          <BrierChart data={series} />
        </Card>
        <Card>
          <SectionTitle aside="favourite's probability vs how often it won">Calibration</SectionTitle>
          <table className="num w-full text-xs">
            <thead className="text-slate-500"><tr><th className="text-left font-normal">Model said</th><th className="font-normal">Calls</th><th className="font-normal">Avg said</th><th className="font-normal">Happened</th></tr></thead>
            <tbody>{r.calibration.map((b) => (
              <tr key={b.lo} className="border-t hairline"><td className="py-1.5">{Math.round(b.lo * 100)}–{Math.round(b.hi * 100)}%</td><td className="text-center">{b.n}</td><td className="text-center">{pct(b.avgP)}</td>
                <td className={cn("text-center", Math.abs(b.rate - b.avgP) <= 0.07 ? "text-edge" : "text-amber")}>{pct(b.rate)}</td></tr>
            ))}</tbody>
          </table>
          <p className="mt-3 text-[11px] text-slate-500">
            Calibration maps in use: {cal.length ? cal.map((c) => `${c.market} ${c.method}`).join(" · ") : "none yet (identity until 50 settled calls)"}.
          </p>
        </Card>
        <Card>
          <SectionTitle>By confidence band</SectionTitle>
          <table className="num w-full text-xs">
            <thead className="text-slate-500"><tr><th className="text-left font-normal">Band</th><th className="font-normal">Calls</th><th className="font-normal">Brier</th><th className="font-normal">1X2 hit</th></tr></thead>
            <tbody>{Object.entries(r.byBand).map(([b, m]) => (
              <tr key={b} className="border-t hairline"><td className="py-1.5 font-sans">{b[0] + b.slice(1).toLowerCase()}</td><td className="text-center">{m.n}</td><td className="text-center">{f3(m.brier)}</td><td className="text-center">{pct(m.hit)}</td></tr>
            ))}</tbody>
          </table>
        </Card>
        <Card className="lg:col-span-2">
          <SectionTitle aside="every market the model backed at 50%+">Markets</SectionTitle>
          <div className="overflow-x-auto">
            <table className="num w-full text-xs">
              <thead className="text-slate-500"><tr><th className="text-left font-normal">Market</th><th className="font-normal">Calls</th><th className="font-normal">Hit</th><th className="font-normal">Avg model p</th></tr></thead>
              <tbody>{r.markets.map((m) => (
                <tr key={m.key} className="border-t hairline"><td className="py-1.5 font-sans text-slate-300">{m.label}</td><td className="text-center">{m.n}</td>
                  <td className={cn("text-center", m.hit >= m.avgP - 0.05 ? "text-edge" : "text-miss")}>{pct(m.hit)}</td><td className="text-center text-slate-400">{pct(m.avgP)}</td></tr>
              ))}</tbody>
            </table>
          </div>
          <p className="mt-3 text-[11px] text-slate-500">A market is trustworthy when Hit stays close to Avg model p. Green: within 5 points or better.</p>
        </Card>
      </div>
    </>
  );
}
