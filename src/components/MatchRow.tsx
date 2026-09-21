import Link from "next/link";
import type { BoardFixture } from "@/lib/queries";
import { fmtUtc, fmtWat } from "@/lib/time";
import { ProbBar } from "./ProbBar";
import { ConfidenceBadge } from "./ConfidenceBadge";
import { pct } from "./ui";

export function MatchRow({ fx, pick }: { fx: BoardFixture; pick?: { label: string; p: number } }) {
  const p = fx.predictions[0];
  const done = fx.status === "FINISHED";
  return (
    <Link href={`/match/${fx.id}`}
      className="focus-ring group grid grid-cols-[3.25rem_1fr_auto] items-center gap-3 rounded-xl px-3 py-3 transition-colors duration-200 ease-out hover:bg-white/[0.04] md:grid-cols-[4rem_1fr_9rem_auto]">
      <div className="leading-tight">
        <div className="num text-sm text-slate-100">{fmtWat(fx.kickoffUtc)}</div>
        <div className="num text-[10px] text-slate-500">{fmtUtc(fx.kickoffUtc)} UTC</div>
      </div>
      <div className="min-w-0">
        <div className="flex items-center justify-between gap-2">
          <span className="truncate text-sm text-slate-100">{fx.homeTeam.shortName ?? fx.homeTeam.name}</span>
          <span className="num text-sm text-slate-300">{done ? fx.homeGoals : p?.predHomeGoals ?? "–"}</span>
        </div>
        <div className="flex items-center justify-between gap-2">
          <span className="truncate text-sm text-slate-300">{fx.awayTeam.shortName ?? fx.awayTeam.name}</span>
          <span className="num text-sm text-slate-300">{done ? fx.awayGoals : p?.predAwayGoals ?? "–"}</span>
        </div>
        <div className="mt-1 text-[11px] text-slate-500 md:hidden">{fx.league.name}</div>
      </div>
      <div className="hidden md:block">{p ? <ProbBar home={p.calHome} draw={p.calDraw} away={p.calAway} size="sm" /> : <span className="text-xs text-slate-500">No call yet</span>}</div>
      <div className="flex flex-col items-end gap-1">
        {p && <ConfidenceBadge band={p.band} />}
        {pick ? <span className="num text-xs text-edge">{pick.label} {pct(pick.p)}</span>
          : p && <span className="num text-[11px] text-slate-400">O2.5 {pct(p.calOver25)}</span>}
        {done && <span className="text-[10px] text-slate-500">FT</span>}
      </div>
    </Link>
  );
}
