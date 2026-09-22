"use client";
import { useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { KeyRound, Loader2, ShieldCheck } from "lucide-react";
import { unlock } from "@/app/unlock/actions";
import { cn } from "./ui";

/** Full-screen gate shown until the access code is entered. Settings stays reachable (PIN-protected). */
export function UnlockScreen({ minutes }: { minutes: number }) {
  const [code, setCode] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => { input.current?.focus(); }, []);
  const submit = () => { if (!code.trim() || pending) return; start(async () => { const r = await unlock(code); if (!r.ok) { setMsg(r.message); setCode(""); input.current?.focus(); } }); };
  return (
    <div className="flex min-h-dvh items-center justify-center px-5 py-10">
      <div className="glass w-full max-w-sm p-6 text-center">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl border border-edge/40 bg-edge/10 text-edge"><KeyRound size={22} /></div>
        <h1 className="mt-4 text-xl font-semibold tracking-tight">PitchEdge</h1>
        <p className="mt-1 text-sm text-slate-400">Enter your access code to see the predictions.</p>
        <input
          ref={input} value={code} onChange={(e) => { setCode(e.target.value); setMsg(null); }} onKeyDown={(e) => e.key === "Enter" && submit()}
          type="password" inputMode="text" autoComplete="one-time-code" aria-label="Access code" placeholder="••••••"
          className="focus-ring num mt-5 w-full rounded-xl border hairline bg-black/30 px-4 py-3 text-center text-xl tracking-[0.4em] text-slate-50 placeholder:text-slate-600"
        />
        {msg && <p className="mt-2 text-sm text-miss">{msg}</p>}
        <button onClick={submit} disabled={pending || !code.trim()}
          className={cn("focus-ring mt-4 flex w-full items-center justify-center gap-2 rounded-xl bg-edge px-4 py-3 text-sm font-medium text-ink-950 transition-opacity duration-200", (pending || !code.trim()) && "opacity-50")}>
          {pending ? <Loader2 size={16} className="animate-spin" /> : <ShieldCheck size={16} />}{pending ? "Checking…" : "Unlock"}
        </button>
        <p className="mt-4 text-[11px] leading-relaxed text-slate-500">
          You stay unlocked on this device while you keep using the app, and it locks again after {minutes} minutes of inactivity.{" "}
          <Link href="/settings" className="underline underline-offset-2">Settings</Link> stays available with your PIN.
        </p>
      </div>
    </div>
  );
}
