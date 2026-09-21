/** Curated league allowlist per provider. Focus groups drive the optional scanner lists. */
export const LEAGUE_ALLOWLIST = {
  "football-data": [
    { id: "PL", focus: "england" }, { id: "ELC", focus: "england" },
    { id: "PD", focus: "europe-strong" }, { id: "SA", focus: "europe-strong" }, { id: "BL1", focus: "europe-strong" },
    { id: "FL1", focus: "europe-strong" }, { id: "DED", focus: null }, { id: "PPL", focus: null }, { id: "CL", focus: "europe-strong" },
  ],
  "api-football": [
    { id: "39", focus: "england" }, { id: "40", focus: "england" },
    { id: "140", focus: "europe-strong" }, { id: "135", focus: "europe-strong" }, { id: "78", focus: "europe-strong" },
    { id: "61", focus: "europe-strong" }, { id: "88", focus: null }, { id: "94", focus: null }, { id: "2", focus: "europe-strong" },
    { id: "399", focus: null }, // Nigeria NPFL
  ],
  sportmonks: [
    { id: "8", focus: "england" }, { id: "564", focus: "europe-strong" }, { id: "384", focus: "europe-strong" },
    { id: "82", focus: "europe-strong" }, { id: "301", focus: "europe-strong" },
  ],
} as const;
