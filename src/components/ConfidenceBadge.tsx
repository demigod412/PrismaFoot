import type { ConfidenceBand } from "@prisma/client";
import { cn } from "./ui";

const STYLE: Record<ConfidenceBand, string> = {
  HIGH: "text-edge border-edge/40 bg-edge/10",
  MEDIUM: "text-amber border-amber/40 bg-amber/10",
  LOW: "text-slate-300 border-white/15 bg-white/5",
};
const LABEL: Record<ConfidenceBand, string> = { HIGH: "High", MEDIUM: "Medium", LOW: "Low" };

export function ConfidenceBadge({ band, score, className }: { band: ConfidenceBand; score?: number; className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded-md border px-1.5 py-0.5 text-[11px] font-medium", STYLE[band], className)}
      title={score != null ? `Confidence ${score}/100` : undefined}>
      {LABEL[band]}{score != null && <span className="num opacity-70">{score}</span>}
    </span>
  );
}
