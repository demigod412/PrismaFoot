/**
 * Curated league allowlist per provider.
 *  focus   → optional scanner / Top 20 filter
 *  pool    → competitions rated together by team id (national teams; European club cups)
 *  feeds   → domestic league whose results also feed a pool (club strength across leagues); predicted with its own fit
 *  neutral → finals tournaments, where most matches are at neutral venues
 *  tier    → 1 = top flight, 2 = second tier (used for promoted / relegated team priors)
 * IDs that don't exist on your plan are simply skipped. Check IDs with the provider's /leagues or /competitions endpoint.
 */
export interface LeagueEntry { id: string; focus: string | null; pool?: string; feeds?: string; neutral?: boolean; tier?: number }

export const LEAGUE_ALLOWLIST: Record<string, LeagueEntry[]> = {
  "football-data": [
    { id: "PL", focus: "england", feeds: "europe" }, { id: "ELC", focus: "england", feeds: "europe", tier: 2 },
    { id: "PD", focus: "europe-strong", feeds: "europe" }, { id: "SA", focus: "europe-strong", feeds: "europe" }, { id: "BL1", focus: "europe-strong", feeds: "europe" },
    { id: "FL1", focus: "europe-strong", feeds: "europe" }, { id: "DED", focus: null, feeds: "europe" }, { id: "PPL", focus: null, feeds: "europe" },
    { id: "BSA", focus: "americas" }, // Brazil Série A (on the free plan)
    { id: "CL", focus: "europe-strong", pool: "europe" }, // rated with every club's domestic results too
    // National teams (free tier lists these only while the tournament is on)
    { id: "WC", focus: "international", pool: "intl", neutral: true }, { id: "EC", focus: "international", pool: "intl", neutral: true },
  ],
  "api-football": [
    { id: "39", focus: "england", feeds: "europe" }, { id: "40", focus: "england", feeds: "europe", tier: 2 },
    { id: "140", focus: "europe-strong", feeds: "europe" }, { id: "135", focus: "europe-strong", feeds: "europe" }, { id: "78", focus: "europe-strong", feeds: "europe" },
    { id: "61", focus: "europe-strong", feeds: "europe" }, { id: "88", focus: null, feeds: "europe" }, { id: "94", focus: null, feeds: "europe" },
    { id: "2", focus: "europe-strong", pool: "europe" },   // Champions League
    { id: "3", focus: "europe-strong", pool: "europe" },   // Europa League
    { id: "848", focus: "europe-strong", pool: "europe" }, // Conference League
    { id: "399", focus: "africa" }, // Nigeria NPFL
    // More top flights and second tiers (used when your API-Football plan includes them)
    { id: "41", focus: "england", tier: 2 }, { id: "42", focus: "england", tier: 2 },            // League One, League Two
    { id: "141", focus: null, feeds: "europe", tier: 2 }, { id: "136", focus: null, feeds: "europe", tier: 2 }, // LaLiga 2, Serie B
    { id: "79", focus: null, feeds: "europe", tier: 2 }, { id: "62", focus: null, feeds: "europe", tier: 2 },   // 2. Bundesliga, Ligue 2
    { id: "179", focus: "europe-other", feeds: "europe" }, { id: "144", focus: "europe-other", feeds: "europe" }, // Scotland, Belgium
    { id: "203", focus: "europe-other", feeds: "europe" }, { id: "197", focus: "europe-other", feeds: "europe" }, // Turkey, Greece
    { id: "218", focus: "europe-other", feeds: "europe" }, { id: "207", focus: "europe-other", feeds: "europe" }, // Austria, Switzerland
    { id: "119", focus: "europe-other", feeds: "europe" }, { id: "103", focus: "europe-other", feeds: "europe" }, { id: "113", focus: "europe-other", feeds: "europe" }, // Denmark, Norway, Sweden
    { id: "71", focus: "americas" }, { id: "128", focus: "americas" }, { id: "262", focus: "americas" }, { id: "253", focus: "americas" }, // Brazil, Argentina, Mexico, MLS
    { id: "13", focus: "americas" }, { id: "11", focus: "americas" },                              // Copa Libertadores, Sudamericana
    { id: "307", focus: "asia" }, { id: "98", focus: "asia" },                                     // Saudi Pro League, J1 League
    { id: "233", focus: "africa" }, { id: "288", focus: "africa" }, { id: "12", focus: "africa" }, // Egypt, South Africa, CAF Champions League
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
  // European club competitions: every club rated on domestic + European results together
  europe: { halfLifeDays: 90, historyDays: 450, seasons: 2 },
};
