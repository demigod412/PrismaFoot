import Link from "next/link";
import type { BoardFixture } from "@/lib/queries";
import { fmtIn, fmtUtc } from "@/lib/time";
import { tz } from "@/lib/tz";
import { ProbBar } from "./ProbBar";
import { ConfidenceBadge } from "./ConfidenceBadge";
import { pct } from "./ui";
import { bestTip } from "@/lib/top";
import { fixtureView } from "@/lib/fixtureView";

export async function MatchRow({ fx, pick }: { fx: BoardFixture; pick?: { label: string; p: number } }) {
  const p = fx.predictions[0];
  const view = fixtureView(fx, new Date());
  // Show a score whenever one exists: a sync that caught a match in progress stores the running score.
  const hasScore = fx.homeGoals != null && fx.awayGoals != null;
  const tip = p && !pick ? bestTip(p, "Home", "Away") : null;
  const zone = await tz();
  return (
    <Link href={`/match/${fx.id}`}
      className="focus-ring group grid grid-cols-[3.25rem_1fr_auto] items-center gap-3 rounded-xl px-3 py-3 transition-colors duration-200 ease-out hover:bg-white/[0.04] md:grid-cols-[4rem_1fr_9rem_auto]">
      <div className="leading-tight">
        <div className="num text-sm text-slate-100">{fmtIn(fx.kickoffUtc, zone)}</div>
        <div className="num text-[10px] text-slate-500">{fmtUtc(fx.kickoffUtc)} UTC</div>
      </div>
      <div className="min-w-0">
        <div className="flex items-center justify-between gap-2">
          <span className="truncate text-sm text-slate-100">{fx.homeTeam.shortName ?? fx.homeTeam.name}</span>
          {hasScore && <span className="num text-sm text-slate-100">{fx.homeGoals}</span>}
        </div>
        <div className="flex items-center justify-between gap-2">
          <span className="truncate text-sm text-slate-300">{fx.awayTeam.shortName ?? fx.awayTeam.name}</span>
          {hasScore && <span className="num text-sm text-slate-100">{fx.awayGoals}</span>}
        </div>
        <div className="mt-1 text-[11px] text-slate-500 md:hidden">{fx.league.name}</div>
      </div>
      <div className="hidden md:block">{p ? <ProbBar home={p.calHome} draw={p.calDraw} away={p.calAway} size="sm" /> : <span className="text-xs text-slate-500">No call yet</span>}</div>
      <div className="flex flex-col items-end gap-1">
        {p && <ConfidenceBadge band={p.band} />}
        {pick ? <span className="num text-xs text-edge">{pick.label} {pct(pick.p)}</span>
          : tip ? <span className="num text-[11px] text-edge">{tip.short} {pct(tip.p)}</span>
          : p && <span className="num text-[11px] text-slate-400">1X2 {pct(Math.max(p.calHome, p.calDraw, p.calAway))}</span>}
        {view === "live"
          ? <span className="inline-flex items-center gap-1 text-[10px] font-medium text-miss">
              <span aria-hidden className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-miss" />LIVE
            </span>
          : view === "finished"
            // Kicked off over 105 minutes ago but no score yet: the results job runs every 15 minutes.
            ? <span className="text-[10px] text-slate-500">{hasScore ? "FT" : "result pending"}</span>
            : null}
      </div>
      {/* Mobile: the 1 X 2 bar needs its own full-width line — the three-column row above has no
          space for it, which is why it used to be desktop-only. Same component, so the two views
          can never drift apart. */}
      {p && <div className="col-span-3 -mt-1 md:hidden"><ProbBar home={p.calHome} draw={p.calDraw} away={p.calAway} size="sm" /></div>}
    </Link>
  );
}
