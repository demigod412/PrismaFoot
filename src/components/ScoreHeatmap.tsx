import { pct } from "./ui";

/** Rows = home goals, columns = away goals. Opacity scales with probability; the most likely cell is outlined. */
export function ScoreHeatmap({ matrix, homeName, awayName }: { matrix: number[][]; homeName: string; awayName: string }) {
  const size = Math.min(6, matrix.length);
  const cells = matrix.slice(0, size).map((r) => r.slice(0, size));
  const max = Math.max(...cells.flat());
  return (
    <div className="overflow-x-auto">
      <table className="num mx-auto border-separate border-spacing-1 text-[11px]" aria-label="Scoreline probabilities">
        <caption className="mb-2 text-left font-sans text-xs text-slate-400">{homeName} goals down, {awayName} goals across</caption>
        <thead><tr><th />{cells[0].map((_, j) => <th key={j} className="w-11 font-normal text-slate-500">{j}</th>)}</tr></thead>
        <tbody>
          {cells.map((row, i) => (
            <tr key={i}>
              <th className="pr-1 font-normal text-slate-500">{i}</th>
              {row.map((p, j) => (
                <td key={j} className="h-9 w-11 rounded-md text-center"
                  style={{ background: `rgba(200,245,66,${(0.06 + 0.7 * (p / max)).toFixed(3)})`, color: p / max > 0.55 ? "#070B14" : "#CBD5E1", outline: p === max ? "1px solid #C8F542" : undefined }}
                  title={`${i}-${j}: ${pct(p)}`}>
                  {(p * 100).toFixed(p >= 0.1 ? 0 : 1)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
