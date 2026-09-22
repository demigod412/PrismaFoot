import type { ProviderId } from "./types";
/** Plain constants (no database or secrets) so pipeline code can import them anywhere. */
export const PROVIDER_ENUM = { "football-data": "FOOTBALL_DATA", "api-football": "API_FOOTBALL", sportmonks: "SPORTMONKS", demo: "DEMO" } as const;
export const THROTTLE_MS: Record<ProviderId, number> = { "football-data": 6500, "api-football": 350, sportmonks: 400, demo: 0 };
