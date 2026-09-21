import { prisma } from "@/lib/db";
import { dataMode } from "@/lib/mode";
import { EmptyState } from "@/components/EmptyState";
import { Card, SectionTitle } from "@/components/ui";
export const metadata = { title: "Accuracy" };
export default async function Accuracy() {
  const mode = await dataMode();
  const rows = await prisma.accuracyDaily.findMany({ where: { scope: "all" }, orderBy: { date: "desc" }, take: 30 });
  return (
    <>
      <h1 className="mb-1 text-2xl font-semibold tracking-tight">Accuracy ledger</h1>
      <p className="mb-5 max-w-2xl text-sm text-slate-400">Scored only on calls locked 15 minutes before kickoff. Append-only: nothing is edited or removed. Lower Brier and log loss are better.</p>
      {rows.length === 0 ? (
        <EmptyState title="No settled locked calls yet"
          body={mode.demo ? "Demo data has no locked history. The ledger fills once live fixtures are locked and settled (phase 3)." : "The lock and settle jobs start the ledger. The first scores appear after the first locked matches finish."}
          action={{ href: "/methodology", label: "How scoring works" }} />
      ) : (
        <Card><SectionTitle>Daily</SectionTitle>
          <table className="num w-full text-xs"><thead className="text-slate-500"><tr><th className="text-left font-normal">Date</th><th className="font-normal">n</th><th className="font-normal">Brier</th><th className="font-normal">Log loss</th><th className="font-normal">1X2 hit</th></tr></thead>
            <tbody>{rows.map((r) => <tr key={r.id} className="border-t hairline"><td className="py-1.5">{r.date.toISOString().slice(0, 10)}</td><td className="text-center">{r.n}</td><td className="text-center">{r.brier1x2.toFixed(3)}</td><td className="text-center">{r.logloss1x2.toFixed(3)}</td><td className="text-center">{(r.hit1x2 * 100).toFixed(0)}%</td></tr>)}</tbody>
          </table>
        </Card>
      )}
    </>
  );
}
