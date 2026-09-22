"use client";
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

/** Daily 1X2 Brier score (lower is better): model vs the always-home baseline. */
export function BrierChart({ data }: { data: { day: string; model: number; home: number; n: number }[] }) {
  return (
    <div className="h-56 w-full">
      <ResponsiveContainer>
        <LineChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -18 }}>
          <CartesianGrid stroke="rgba(255,255,255,0.06)" vertical={false} />
          <XAxis dataKey="day" tick={{ fill: "#64748b", fontSize: 10 }} tickFormatter={(d: string) => d.slice(5)} />
          <YAxis domain={[0.3, 1.2]} tick={{ fill: "#64748b", fontSize: 10 }} />
          <Tooltip contentStyle={{ background: "#0B1220", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 10, fontSize: 12 }}
            formatter={(v: number, name: string) => [v.toFixed(3), name]} labelFormatter={(d: string, p) => `${d} · ${p?.[0]?.payload?.n ?? 0} calls`} />
          <Legend wrapperStyle={{ fontSize: 11 }} />
          <Line type="monotone" dataKey="model" name="Model" stroke="#C8F542" strokeWidth={2} dot={false} isAnimationActive={false} />
          <Line type="monotone" dataKey="home" name="Always home" stroke="#7DD3FC" strokeWidth={1.5} strokeDasharray="4 3" dot={false} isAnimationActive={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
