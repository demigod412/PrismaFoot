import Link from "next/link";
export const metadata = { title: "More" };
const LINKS = [
  { href: "/fixtures", t: "Fixtures", d: "14-day board with league and market filters" },
  { href: "/accuracy", t: "Accuracy", d: "Brier, log loss and baselines on locked calls" },
  { href: "/methodology", t: "Methodology", d: "Formulas, model version and data sources" },
  { href: "/settings", t: "Settings", d: "Data keys, scanner floors, timezone" },
];
export default function More() {
  return (
    <ul className="space-y-2">
      {LINKS.map((l) => (
        <li key={l.href}><Link href={l.href} className="focus-ring glass block p-4"><div className="text-sm font-medium">{l.t}</div><div className="text-xs text-slate-400">{l.d}</div></Link></li>
      ))}
    </ul>
  );
}
