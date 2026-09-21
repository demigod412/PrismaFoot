import Link from "next/link";
import type { ReactNode } from "react";
export function EmptyState({ title, body, action }: { title: string; body: ReactNode; action?: { href: string; label: string } }) {
  return (
    <div className="glass grid place-items-center px-6 py-12 text-center">
      <h3 className="text-sm font-semibold text-slate-100">{title}</h3>
      <div className="mt-1 max-w-sm text-sm text-slate-400">{body}</div>
      {action && <Link href={action.href} className="focus-ring mt-4 rounded-lg border border-edge/40 px-3 py-1.5 text-sm text-edge hover:bg-edge/10">{action.label}</Link>}
    </div>
  );
}
