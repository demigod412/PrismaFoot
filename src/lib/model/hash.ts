import { createHash } from "node:crypto";
/** Stable hash of prediction inputs (key-sorted JSON). */
export function inputsHash(obj: unknown): string {
  const stable = (v: unknown): unknown =>
    Array.isArray(v) ? v.map(stable)
    : v && typeof v === "object" ? Object.fromEntries(Object.keys(v as object).sort().map((k) => [k, stable((v as Record<string, unknown>)[k])]))
    : typeof v === "number" ? Math.round(v * 1e3) / 1e3 : v;
  return createHash("sha256").update(JSON.stringify(stable(obj))).digest("hex").slice(0, 32);
}
