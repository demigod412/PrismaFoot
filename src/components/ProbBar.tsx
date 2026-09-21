import { cn, pct } from "./ui";

/** 1X2 stacked bar. Segments sum to 100%; the model's most likely outcome is lime. */
export function ProbBar({ home, draw, away, size = "md", labels = true }: { home: number; draw: number; away: number; size?: "sm" | "md" | "lg"; labels?: boolean }) {
  const s = home + draw + away || 1;
  const segs = [
    { k: "1", p: home / s }, { k: "X", p: draw / s }, { k: "2", p: away / s },
  ];
  const top = Math.max(...segs.map((x) => x.p));
  const h = size === "lg" ? "h-3" : size === "md" ? "h-2" : "h-1.5";
  return (
    <div className="w-full" role="img" aria-label={`Home ${pct(segs[0].p)}, draw ${pct(segs[1].p)}, away ${pct(segs[2].p)}`}>
      <div className={cn("flex w-full gap-[2px] overflow-hidden rounded-full", h)}>
        {segs.map((x, i) => (
          <div key={x.k} style={{ width: `${x.p * 100}%` }}
            className={cn(x.p === top ? "bg-edge" : i === 1 ? "bg-slate-500/50" : "bg-ice/40")} />
        ))}
      </div>
      {labels && (
        <div className="mt-1.5 flex justify-between num text-[11px] text-slate-400">
          {segs.map((x) => (
            <span key={x.k} className={x.p === top ? "text-edge" : ""}>{x.k} {pct(x.p)}</span>
          ))}
        </div>
      )}
    </div>
  );
}
