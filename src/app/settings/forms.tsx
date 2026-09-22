"use client";
import { useActionState } from "react";
import { saveFloors, saveKeys, savePrefs, testConnection, unlock, type ActionState } from "./actions";
import { cn } from "@/components/ui";

const input = "focus-ring w-full rounded-lg border hairline bg-black/30 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-600";
const btn = "focus-ring rounded-lg border border-edge/40 px-3 py-1.5 text-sm text-edge hover:bg-edge/10 disabled:opacity-50";

function Status({ s }: { s: ActionState }) {
  if (!s) return null;
  return <p role="status" className={cn("mt-2 text-xs", s.ok ? "text-edge" : "text-miss")}>{s.message}</p>;
}

export function UnlockForm() {
  const [s, act, pending] = useActionState(unlock, null);
  return (
    <form action={act} className="flex flex-wrap items-end gap-2">
      <label className="flex-1 text-xs text-slate-400">Settings PIN<input name="pin" type="password" inputMode="numeric" autoComplete="off" className={input} /></label>
      <button className={btn} disabled={pending}>Unlock</button>
      <div className="w-full"><Status s={s} /></div>
    </form>
  );
}

const KEYS = [
  { name: "FOOTBALL_DATA_API_KEY", label: "football-data.org key", provider: "football-data" },
  { name: "API_SPORTS_KEY", label: "API-Football key (direct)", provider: "api-football" },
  { name: "RAPIDAPI_KEY", label: "API-Football via RapidAPI key", provider: "api-football" },
  { name: "SPORTMONKS_TOKEN", label: "Sportmonks token", provider: "sportmonks" },
  { name: "OPENAI_API_KEY", label: "OpenAI key (rationale wording only)", provider: null },
] as const;

export function KeysForm({ sources, primary }: { sources: Record<string, "env" | "settings" | "none">; primary: string }) {
  const [s, act, pending] = useActionState(saveKeys, null);
  const [t, test, testing] = useActionState(testConnection, null);
  return (
    <div className="space-y-4">
      <form action={act} className="space-y-3">
        <label className="block text-xs text-slate-400">Primary provider
          <select name="primary" defaultValue={primary} className={input}>
            <option value="api-football">API-Football</option><option value="football-data">football-data.org</option><option value="sportmonks">Sportmonks</option>
          </select>
        </label>
        {KEYS.map((k) => (
          <label key={k.name} className="block text-xs text-slate-400">
            <span className="flex justify-between">{k.label}<span className={sources[k.name] === "none" ? "text-slate-600" : "text-edge"}>{sources[k.name] === "env" ? "set in env (wins)" : sources[k.name] === "settings" ? "saved" : "not set"}</span></span>
            <input name={k.name} type="password" autoComplete="off" placeholder={sources[k.name] !== "none" ? "•••••••• (leave blank to keep)" : "Paste key"} className={input} disabled={sources[k.name] === "env"} />
          </label>
        ))}
        <button className={btn} disabled={pending}>Save keys</button>
        <Status s={s} />
      </form>
      <form action={test} className="flex flex-wrap items-end gap-2 border-t hairline pt-4">
        <label className="flex-1 text-xs text-slate-400">Test connection
          <select name="provider" defaultValue={primary} className={input}>
            <option value="api-football">API-Football</option><option value="football-data">football-data.org</option><option value="sportmonks">Sportmonks</option>
          </select>
        </label>
        <button className={btn} disabled={testing}>{testing ? "Testing…" : "Test connection"}</button>
        <div className="w-full"><Status s={t} /></div>
      </form>
    </div>
  );
}

export function FloorsForm({ floors }: { floors: Record<string, number> }) {
  const [s, act, pending] = useActionState(saveFloors, null);
  const labels: Record<string, string> = { safeP: "Safe: minimum p (High confidence only)", winMargin: "Win: margin over 2nd outcome", o15: "Over 1.5 floor", o25: "Over 2.5 floor", btts: "BTTS floor", draw: "Draw floor", team2: "Team 2+ goals floor", u25: "Under 2.5 floor", u35: "Under 3.5 floor", u45: "Under 4.5 floor", dc: "Double chance floor", bttsNo: "BTTS No floor", by2: "Win by 2+ floor", corners: "Corners 8.5 floor", shots: "Shots 24.5 floor" };
  return (
    <form action={act} className="grid gap-3 sm:grid-cols-2">
      {Object.entries(floors).map(([k, v]) => (
        <label key={k} className="text-xs text-slate-400">{labels[k] ?? k}<input name={k} type="number" step="0.01" min="0.01" max="0.99" defaultValue={v} className={cn(input, "num")} /></label>
      ))}
      <div className="sm:col-span-2"><button className={btn} disabled={pending}>Save floors</button><Status s={s} /></div>
    </form>
  );
}

export function PrefsForm({ bookie }: { bookie: string }) {
  const [s, act, pending] = useActionState(savePrefs, null);
  return (
    <form action={act} className="flex flex-wrap items-end gap-2">
      <label className="flex-1 text-xs text-slate-400">Default bookie for booking codes
        <select name="bookie" defaultValue={bookie} className={input}>
          <option value="sportybet">Sportybet</option><option value="bet9ja">Bet9ja</option><option value="1xbet">1xBet</option><option value="betpawa">BetPawa</option>
        </select>
      </label>
      <button className={btn} disabled={pending}>Save</button>
      <div className="w-full"><Status s={s} /></div>
    </form>
  );
}
