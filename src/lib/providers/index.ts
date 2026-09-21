import "server-only";
import { getSecret, getSetting } from "../secrets";
import { apiFootball } from "./apiFootball";
import { footballData } from "./footballData";
import { sportmonks } from "./sportmonks";
import type { FootballProvider, ProviderId } from "./types";

export type LiveProviderId = Exclude<ProviderId, "demo">;

export async function primaryProviderId(): Promise<LiveProviderId> {
  return getSetting<LiveProviderId>("primaryProvider", (process.env.PRIMARY_PROVIDER as LiveProviderId) ?? "api-football");
}

export async function buildProvider(id: LiveProviderId): Promise<FootballProvider | null> {
  if (id === "football-data") {
    const k = await getSecret("FOOTBALL_DATA_API_KEY");
    return k ? footballData(k) : null;
  }
  if (id === "api-football") {
    const k = await getSecret("API_SPORTS_KEY");
    const rk = await getSecret("RAPIDAPI_KEY");
    if (!k && !rk) return null;
    return apiFootball({ key: k ?? undefined, rapidKey: rk ?? undefined, rapidHost: process.env.RAPIDAPI_HOST });
  }
  const t = await getSecret("SPORTMONKS_TOKEN");
  return t ? sportmonks(t) : null;
}

/** null ⇒ DEMO MODE (no usable key for the primary provider). */
export async function getPrimaryProvider(): Promise<FootballProvider | null> {
  return buildProvider(await primaryProviderId());
}

export const PROVIDER_ENUM = { "football-data": "FOOTBALL_DATA", "api-football": "API_FOOTBALL", sportmonks: "SPORTMONKS", demo: "DEMO" } as const;
export const THROTTLE_MS: Record<ProviderId, number> = { "football-data": 6500, "api-football": 350, sportmonks: 400, demo: 0 };
