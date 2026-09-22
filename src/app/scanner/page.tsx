import Link from "next/link";
import { SCANNERS } from "@/lib/scanners";
export const metadata = { title: "Scanners" };
export default function Scanners() {
  return (
    <>
      <h1 className="mb-1 text-2xl font-semibold tracking-tight">Scanners</h1>
      <p className="mb-5 text-sm text-slate-400">Filters over the same calibrated probabilities everyone sees, across the upcoming fixture window (3 weeks). Floors are editable in Settings.</p>
      <ul className="grid gap-2 sm:grid-cols-2">
        {SCANNERS.map((s) => (
          <li key={s.slug}>
            <Link href={`/scanner/${s.slug}`} className="focus-ring glass block h-full p-4 transition-colors duration-200 hover:border-edge/30">
              <div className="text-sm font-medium text-slate-100">{s.name}</div>
              <p className="mt-1 text-xs leading-relaxed text-slate-400">{s.blurb}</p>
            </Link>
          </li>
        ))}
        <li><Link href="/fixtures?market=all" className="focus-ring glass block h-full p-4 hover:border-edge/30"><div className="text-sm font-medium">Europe strongest / England</div><p className="mt-1 text-xs text-slate-400">Use the focus filter on any scanner: add ?focus=europe-strong or ?focus=england.</p></Link></li>
      </ul>
    </>
  );
}
