/**
 * Curated league allowlist per provider.
 *  focus   → optional scanner / Top 20 filter
 *  pool    → competitions rated together (national teams play across qualifiers, friendlies and tournaments)
 *  neutral → finals tournaments, where most matches are at neutral venues
 * IDs that don't exist on your plan are simply skipped. Check IDs with the provider's /leagues or /competitions endpoint.
 */
export interface LeagueEntry { id: string; focus: string | null; pool?: string; neutral?: boolean }

export const LEAGUE_ALLOWLIST: Record<string, LeagueEntry[]> = {
  "football-data": [
    { id: "PL", focus: "england" }, { id: "ELC", focus: "england" },
    { id: "PD", focus: "europe-strong" }, { id: "SA", focus: "europe-strong" }, { id: "BL1", focus: "europe-strong" },
    { id: "FL1", focus: "europe-strong" }, { id: "DED", focus: null }, { id: "PPL", focus: null }, { id: "CL", focus: "europe-strong" },
    // National teams (free tier lists these only while the tournament is on)
    { id: "WC", focus: "international", pool: "intl", neutral: true }, { id: "EC", focus: "international", pool: "intl", neutral: true },
  ],
  "api-football": [
    { id: "39", focus: "england" }, { id: "40", focus: "england" },
    { id: "140", focus: "europe-strong" }, { id: "135", focus: "europe-strong" }, { id: "78", focus: "europe-strong" },
    { id: "61", focus: "europe-strong" }, { id: "88", focus: null }, { id: "94", focus: null }, { id: "2", focus: "europe-strong" },
    { id: "399", focus: null }, // Nigeria NPFL
    // National teams — one shared rating pool
    { id: "10", focus: "international", pool: "intl" },               // International friendlies
    { id: "5", focus: "international", pool: "intl" },                // UEFA Nations League
    { id: "32", focus: "international", pool: "intl" },               // World Cup qualifying – Europe
    { id: "29", focus: "international", pool: "intl" },               // World Cup qualifying – Africa
    { id: "34", focus: "international", pool: "intl" },               // World Cup qualifying – South America
    { id: "30", focus: "international", pool: "intl" },               // World Cup qualifying – Asia
    { id: "31", focus: "international", pool: "intl" },               // World Cup qualifying – CONCACAF
    { id: "36", focus: "international", pool: "intl" },               // Africa Cup of Nations qualifying
    { id: "1", focus: "international", pool: "intl", neutral: true }, // World Cup
    { id: "4", focus: "international", pool: "intl", neutral: true }, // Euro Championship
    { id: "6", focus: "international", pool: "intl", neutral: true }, // Africa Cup of Nations
    { id: "9", focus: "international", pool: "intl", neutral: true }, // Copa America
  ],
  sportmonks: [
    { id: "8", focus: "england" }, { id: "564", focus: "europe-strong" }, { id: "384", focus: "europe-strong" },
    { id: "82", focus: "europe-strong" }, { id: "301", focus: "europe-strong" },
  ],
};

/** National teams play ~10 times a year, so their ratings need a much longer memory. */
export const POOL_SETTINGS: Record<string, { halfLifeDays: number; historyDays: number; seasons: number }> = {
  intl: { halfLifeDays: 365, historyDays: 1100, seasons: 3 },
};
