"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Scissors, Trash2, Merge, Plus, Ticket, Wand2, X } from "lucide-react";
import { fmtIn, tzOffsetLabel } from "@/lib/time";
import { bookSportybet, deleteSlip, mergeInto, newSlip, optimiseSlip, removeFromSlip, renameSlip, selectSlip, splitSlip, type SlipResult } from "@/app/slips/actions";
import { combinedP, fairOdds, slipText, type Leg } from "@/lib/slips";
import { ConfidenceBadge } from "./ConfidenceBadge";
import { CopyButton } from "./CopyButton";
import { EmptyState } from "./EmptyState";
import { Card, cn, pct } from "./ui";

export type SlipLeg = Leg & { started: boolean; result: string | null; hit: boolean | null };
export interface SlipView { id: string; name: string; legs: SlipLeg[]; bookingCode: string | null; bookingUrl: string | null; bookingNote: string | null }

const btn = "focus-ring inline-flex items-center gap-1.5 rounded-lg border hairline px-2.5 py-1.5 text-xs text-slate-200 hover:border-edge/40 hover:text-edge disabled:opacity-40";

export function SlipWorkshop({ slips, activeId, zone }: { slips: SlipView[]; activeId: string | null; zone: string }) {
  const fmt = (iso: string) => fmtIn(new Date(iso), zone, "EEE d MMM HH:mm");
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<SlipResult | null>(null);
  const [mergeFrom, setMergeFrom] = useState("");
  const run = (f: () => Promise<SlipResult>) => start(async () => { const r = await f(); setMsg(r); router.refresh(); });
  const slip = slips.find((s) => s.id === activeId) ?? null;

  if (!slips.length) return (
    <>
      <h1 className="mb-4 text-2xl font-semibold tracking-tight">Slips</h1>
      <EmptyState title="No slips yet" body="Tap + next to any market on a match page or in the Top 50 to start a slip. Legs are saved on this device." action={{ href: "/top", label: "Open Top 50 tips" }} />
    </>
  );
  const open = slip?.legs.filter((l) => !l.started) ?? [];
  const p = combinedP(slip?.legs ?? []);
  return (
    <div>
      <div className="mb-4 flex items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">Slips</h1>
        <button className={btn} disabled={pending} onClick={() => run(newSlip)}><Plus size={14} />New slip</button>
      </div>
      <nav data-no-ptr className="-mx-4 mb-4 flex gap-1.5 overflow-x-auto px-4 pb-1 md:mx-0 md:px-0">
        {slips.map((s) => (
          <button key={s.id} onClick={() => run(() => selectSlip(s.id))}
            className={cn("focus-ring shrink-0 rounded-full border px-3 py-1.5 text-xs", s.id === activeId ? "border-edge/60 bg-edge/10 text-edge" : "hairline text-slate-300")}>
            {s.name} <span className="num opacity-70">{s.legs.length}</span>
          </button>
        ))}
      </nav>
      {msg && <p role="status" className={cn("mb-3 rounded-lg border px-3 py-2 text-xs", msg.ok ? "border-edge/30 text-edge" : "border-miss/40 text-miss")}>{msg.message}</p>}

      {slip && (
        <div className="grid gap-4 lg:grid-cols-[1fr_20rem]">
          <Card className="px-1 py-1 md:px-1 md:py-1">
            {slip.legs.length === 0 ? <p className="p-4 text-sm text-slate-400">Empty slip. Add markets with the + buttons on match pages and the Top 50.</p> : (
              <ul className="divide-y divide-white/[0.05]">
                {slip.legs.map((l) => (
                  <li key={l.fixtureId} className="flex items-center gap-3 px-3 py-3">
                    <div className="min-w-0 flex-1">
                      <Link href={`/match/${l.fixtureId}`} className="block truncate text-sm text-slate-100 hover:text-edge">{l.match}</Link>
                      <div className="num text-[11px] text-slate-500">{fmt(l.kickoff)} {tzOffsetLabel(zone, new Date(l.kickoff))}{l.result ? ` · FT ${l.result}` : l.started ? " · started" : ""}</div>
                      <div className="mt-1 text-xs text-edge">{l.label}</div>
                    </div>
                    <div className="flex flex-col items-end gap-1">
                      <span className="num text-base text-slate-50">{pct(l.p)}</span>
                      <ConfidenceBadge band={l.band as never} />
                      {l.hit != null && <span className={cn("text-[10px]", l.hit ? "text-edge" : "text-miss")}>{l.hit ? "won" : "lost"}</span>}
                    </div>
                    <button aria-label="Remove leg" className="focus-ring rounded p-1 text-slate-500 hover:text-miss" disabled={pending} onClick={() => run(() => removeFromSlip(slip.id, l.fixtureId))}><X size={16} /></button>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <aside className="space-y-3">
            <Card>
              <input defaultValue={slip.name} aria-label="Slip name" onBlur={(e) => e.target.value !== slip.name && run(() => renameSlip(slip.id, e.target.value))}
                className="focus-ring mb-3 w-full rounded-lg border hairline bg-black/30 px-2 py-1.5 text-sm" />
              <dl className="num space-y-1 text-sm">
                <div className="flex justify-between"><dt className="font-sans text-slate-400">Legs</dt><dd>{slip.legs.length}</dd></div>
                <div className="flex justify-between"><dt className="font-sans text-slate-400">Combined model p</dt><dd className="text-edge">{(p * 100).toFixed(1)}%</dd></div>
                <div className="flex justify-between"><dt className="font-sans text-slate-400">Fair odds (1/p)</dt><dd>{slip.legs.length ? fairOdds(p).toFixed(2) : "–"}</dd></div>
              </dl>
              <p className={cn("mt-3 text-[11px] leading-relaxed", slip.legs.length >= 5 ? "text-amber" : "text-slate-500")}>
                Combined probability assumes the legs are independent.{slip.legs.length >= 5 ? ` With ${slip.legs.length} legs this slip is expected to lose most of the time.` : ""}
              </p>
            </Card>
            <Card>
              <div className="mb-2 text-xs text-slate-400">Optimise</div>
              <div className="flex flex-wrap gap-1.5">
                <button className={btn} disabled={pending || slip.legs.length < 2} onClick={() => run(() => optimiseSlip(slip.id, "weakest"))}><Wand2 size={14} />Drop weakest</button>
                <button className={btn} disabled={pending} onClick={() => run(() => optimiseSlip(slip.id, "low"))}><Wand2 size={14} />Drop Low confidence</button>
                <button className={btn} disabled={pending || slip.legs.length < 2} onClick={() => run(() => optimiseSlip(slip.id, "target", 0.25))}><Wand2 size={14} />Trim to 25%</button>
                <button className={btn} disabled={pending || slip.legs.length < 2} onClick={() => run(() => splitSlip(slip.id))}><Scissors size={14} />Split in two</button>
              </div>
              {slips.length > 1 && (
                <div className="mt-3 flex gap-1.5">
                  <select value={mergeFrom} onChange={(e) => setMergeFrom(e.target.value)} className="focus-ring min-w-0 flex-1 rounded-lg border hairline bg-black/30 px-2 text-xs">
                    <option value="">Merge another slip in…</option>
                    {slips.filter((s) => s.id !== slip.id).map((s) => <option key={s.id} value={s.id}>{s.name} ({s.legs.length})</option>)}
                  </select>
                  <button className={btn} disabled={pending || !mergeFrom} onClick={() => { const f = mergeFrom; setMergeFrom(""); run(() => mergeInto(slip.id, f)); }}><Merge size={14} />Merge</button>
                </div>
              )}
            </Card>
            <Card>
              <div className="mb-2 text-xs text-slate-400">Export</div>
              <div className="flex flex-wrap gap-1.5">
                {slip.legs.length > 0 && <CopyButton text={slipText(slip.name, slip.legs, fmt)} label="Copy text" />}
                <button className={btn} disabled={pending || !open.length} onClick={() => run(() => bookSportybet(slip.id))}><Ticket size={14} />{pending ? "Working…" : "Sportybet code"}</button>
              </div>
              {slip.bookingCode && (
                <div className="mt-3 rounded-lg border border-edge/40 bg-edge/10 p-3 text-center">
                  <div className="text-[11px] text-slate-400">Sportybet booking code</div>
                  <div className="num select-all text-2xl font-semibold tracking-widest text-edge">{slip.bookingCode}</div>
                  <div className="mt-2 flex flex-wrap items-center justify-center gap-2">
                    <CopyButton text={slip.bookingCode} label="Copy code" />
                    {slip.bookingUrl && <a href={slip.bookingUrl} target="_blank" rel="noreferrer" className="text-xs text-ice underline underline-offset-2">Open on Sportybet</a>}
                  </div>
                </div>
              )}
              {slip.bookingNote && <p className="mt-2 text-[11px] leading-relaxed text-amber">{slip.bookingNote}</p>}
              <p className="mt-3 text-[10px] leading-relaxed text-slate-500">Booking codes are best effort through Sportybet&apos;s website endpoints. PitchEdge never places bets. 18+ only.</p>
            </Card>
            <button className={cn(btn, "w-full justify-center text-miss")} disabled={pending} onClick={() => confirm(`Delete ${slip.name}?`) && run(() => deleteSlip(slip.id))}><Trash2 size={14} />Delete slip</button>
          </aside>
        </div>
      )}
    </div>
  );
}
