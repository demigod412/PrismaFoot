import type { Markets } from "./dixonColes";

export interface RationaleFeatures {
  homeName: string; awayName: string;
  attackHome: number; defenceHome: number; attackAway: number; defenceAway: number;
  homeAdv: number; lambdaHome: number; lambdaAway: number;
  formHome: string; formAway: string; // e.g. "WWDLW" newest first
  markets: Markets;
  dataFlags: string[];
  inputKind: "xg" | "shots" | "goals";
}

const pct = (p: number) => `${Math.round(p * 100)}%`;
const f2 = (x: number) => x.toFixed(2);
const pts = (form: string) => [...form].reduce((s, r) => s + (r === "W" ? 3 : r === "D" ? 1 : 0), 0);

/** Exactly four bullets, every number taken from the structured features. */
export function buildRationale(f: RationaleFeatures): string[] {
  const src = f.inputKind === "xg" ? "xG" : f.inputKind === "shots" ? "shot volume" : "goals";
  const b1 = `${f.homeName} attack ${f2(f.attackHome)} meets ${f.awayName} defence ${f2(f.defenceAway)}; ${f.awayName} attack ${f2(f.attackAway)} meets ${f.homeName} defence ${f2(f.defenceHome)} (ratings from recency-weighted ${src}).`;
  const b2 = `League home factor ${f2(f.homeAdv)} puts expected goals at ${f2(f.lambdaHome)} – ${f2(f.lambdaAway)}.`;
  const b3 = f.formHome || f.formAway
    ? `Last 5: ${f.homeName} ${f.formHome || "n/a"} (${pts(f.formHome)} pts), ${f.awayName} ${f.formAway || "n/a"} (${pts(f.formAway)} pts). Form is context only; it is already inside the ratings.`
    : `No recent form available for one or both teams, so ratings lean on the league average.`;
  const total = f.lambdaHome + f.lambdaAway;
  const b4 = `Total expected goals ${f2(total)} → Over 2.5 ${pct(f.markets.over25)}, BTTS ${pct(f.markets.btts)}.` +
    (f.dataFlags.includes("missing_news") ? " Lineups/injuries not confirmed, so confidence is reduced." : "");
  return [b1, b2, b3, b4];
}

/**
 * Optional LLM polish (Phase 6). The LLM may reword, never change numbers:
 * any output whose multiset of numeric tokens differs from the input is discarded.
 */
export function numbersPreserved(before: string[], after: string[]): boolean {
  const nums = (xs: string[]) => xs.join(" ").match(/\d+(\.\d+)?/g)?.sort().join(",") ?? "";
  return after.length === 4 && nums(before) === nums(after);
}
