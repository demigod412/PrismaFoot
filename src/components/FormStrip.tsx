import { cn } from "./ui";
export function FormStrip({ results }: { results: ("W" | "D" | "L")[] }) {
  if (!results.length) return <span className="text-xs text-slate-500">No finished matches yet</span>;
  return (
    <span className="inline-flex gap-1" aria-label={`Form ${results.join(" ")}`}>
      {results.map((r, i) => (
        <span key={i} className={cn("num grid h-5 w-5 place-items-center rounded text-[10px] font-semibold",
          r === "W" ? "bg-edge/20 text-edge" : r === "D" ? "bg-white/10 text-slate-300" : "bg-miss/15 text-miss")}>{r}</span>
      ))}
    </span>
  );
}
