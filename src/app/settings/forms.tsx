"use client";
import { useActionState, useRef, useState, useTransition } from "react";
import { saveFloors, saveKeys, savePrefs, saveTimezone, testConnection, unlock, type ActionState } from "./actions";
import { cn } from "@/components/ui";
import { lockNow, saveAccessCode } from "@/app/unlock/actions";
import { TIMEZONE_GROUPS } from "@/lib/timezones";

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
  const labels: Record<string, string> = {
    safeP: "Safe list — minimum probability (High confidence only)", winMargin: "Win — lead over the next outcome",
    o15: "Over 1.5 goals", o25: "Over 2.5 goals", u25: "Under 2.5 goals", u35: "Under 3.5 goals", u45: "Under 4.5 goals",
    btts: "Both teams to score", bttsNo: "BTTS No", draw: "Draw", team2: "A team to score 2+", by2: "Win by 2+ (−1.5)",
    dc: "Double chance", winOver: "Win or Over 2.5",
    h1u15: "1st half Under 1.5", h1u25: "1st half Under 2.5", h2u25: "2nd half Under 2.5", htDraw: "Half-time draw",
    corners: "Corners (this fixture's line)", shots: "Total shots (this fixture's line)",
  };
  return (
    <form action={act} className="grid gap-3 sm:grid-cols-2">
      {Object.entries(floors).map(([k, v]) => (
        <label key={k} className="text-xs text-slate-400">{labels[k] ?? k}<input name={k} type="number" step="0.01" min="0.01" max="0.99" defaultValue={v} className={cn(input, "num")} /></label>
      ))}
      <p className="sm:col-span-2 text-xs leading-relaxed text-slate-400">A floor is the minimum model probability a pick needs before that scanner shows it. 0.60 = 60%. Raise a floor for fewer, stronger picks; lower it for more. Floors only filter the scanner lists — the Top 50 and each match page always show their strongest markets.</p>
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

export function AccessCodeForm({ isSet }: { isSet: boolean }) {
  const [code, setCode] = useState("");
  const [s, setS] = useState<{ ok: boolean; message: string } | null>(null);
  const [pending, start] = useTransition();
  const run = (fn: () => Promise<{ ok: boolean; message: string }>) => start(async () => { setS(await fn()); setCode(""); });
  return (
    <div className="space-y-3">
      <p className="text-xs text-slate-400">
        {isSet ? "An access code is set: everyone is asked for it before seeing predictions, and the app locks again after 30 minutes of inactivity. Settings always stays reachable with your PIN."
          : "No access code: anyone with the link can see the app. Set one to keep it private."}
      </p>
      <div className="flex flex-wrap gap-2">
        <input value={code} onChange={(e) => setCode(e.target.value)} type="text" autoComplete="off" placeholder={isSet ? "New code (4–32 characters)" : "Access code (4–32 characters)"}
          className="focus-ring min-w-0 flex-1 rounded-lg border hairline bg-black/30 px-3 py-2 text-sm text-slate-100" />
        <button className={btn} disabled={pending || code.trim().length < 4} onClick={() => run(() => saveAccessCode(code))}>{isSet ? "Change code" : "Set code"}</button>
        {isSet && <button className={btn} disabled={pending} onClick={() => run(() => saveAccessCode(null))}>Remove code</button>}
        {isSet && <button className={btn} disabled={pending} onClick={() => run(lockNow)}>Lock this device now</button>}
      </div>
      <Status s={s} />
    </div>
  );
}

/**
 * Kickoff timezone for this device. Not PIN-gated: it only touches this browser's cookie.
 * "Detect" reads the zone the browser already reports, which is right almost every time.
 */
export function TimezoneForm({ current, isDefault }: { current: string; isDefault: boolean }) {
  const [s, act, pending] = useActionState(saveTimezone, null);
  const form = useRef<HTMLFormElement>(null);
  const select = useRef<HTMLSelectElement>(null);
  const detect = () => {
    const guess = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const el = select.current;
    if (!el || !guess) return;
    // Offer the detected zone even when it is not one of the curated options.
    if (![...el.options].some((o) => o.value === guess)) {
      const o = document.createElement("option");
      o.value = guess; o.textContent = `${guess.replace(/_/g, " ")} (detected)`;
      el.add(o, 0);
    }
    el.value = guess;
    form.current?.requestSubmit();
  };
  return (
    <form ref={form} action={act} className="space-y-2">
      <label className="block text-xs text-slate-400">Kickoff timezone (this device)
        <select ref={select} name="zone" defaultValue={isDefault ? "__default__" : current} className={input}>
          <option value="__default__">Server default{isDefault ? ` — ${current.replace(/_/g, " ")}` : ""}</option>
          {TIMEZONE_GROUPS.map((g) => (
            <optgroup key={g.group} label={g.group}>
              {g.zones.map((z) => <option key={z} value={z}>{z.replace(/_/g, " ")}</option>)}
            </optgroup>
          ))}
        </select>
      </label>
      <div className="flex flex-wrap items-center gap-2">
        <button className={btn} disabled={pending}>{pending ? "Saving…" : "Save timezone"}</button>
        <button type="button" onClick={detect} disabled={pending} className={btn}>Detect from this device</button>
      </div>
      <p className="text-xs leading-relaxed text-slate-400">
        Changes only what this browser shows: kickoff times, the date strip and which matches count as
        &ldquo;today&rdquo;. UTC stays printed underneath every kickoff. Other devices keep their own choice.
      </p>
      <Status s={s} />
    </form>
  );
}
