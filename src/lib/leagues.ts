/**
 * Curated league allowlist per provider.
 *  focus   → optional scanner / Top 50 filter
 *  pool    → competitions rated together by team id (national teams; European club cups)
 *  feeds   → domestic league whose results also feed a pool (club strength across leagues); predicted with its own fit
 *  neutral → finals tournaments, where most matches are at neutral venues
 *  tier    → 1 = top flight, 2 = second tier (used for promoted / relegated team priors)
 * IDs that don't exist on your plan are simply skipped. Check IDs with the provider's /leagues or /competitions endpoint.
 */
export interface LeagueEntry { id?: string; match?: { country: string; name: RegExp }; focus: string | null; pool?: string; feeds?: string; neutral?: boolean; tier?: number }

const norm = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z]/g, "");
/** Strip accents from a league name too, so /Urvalsdeild/ matches the provider's "Úrvalsdeild". */
const deaccent = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "");

/**
 * Never synced, whatever an entry matches. Several entries are deliberately prefix matches, because
 * a third tier is often split into groups ("Serie C - Girone A", "Primera División RFEF - Group 2")
 * and each group is a real competition with its own table. That same looseness would otherwise drag
 * in the women's, youth, reserve and play-off competitions sitting next to them under the same name
 * ("Primera División Femenina", "Liga 1 Feminin", "Serie C - Promotion - Play-offs").
 */
const NEVER = /women|femen|femin|frauen|dames|\bu1[5-9]\b|\bu2[0-3]\b|youth|junior|primavera|reserve|academy|play-?offs?|promotion round|relegation round|super ?cup|supercoppa|supercopa|supercupa|\bcups?\b|coppa|\bcopa\b|\bcupa\b|\bkupa\b|pokal|trophy|shield|\bfinals?\b/i;

/** Match a provider league to an allowlist entry: by id, or by country + name (so plan-specific ids don't matter). */
export function entryFor(allow: LeagueEntry[], l: { externalId: string; name: string; country?: string | null }): LeagueEntry | undefined {
  const byId = allow.find((a) => a.id === l.externalId);
  if (byId) return byId;                       // an explicit id is always honoured
  if (NEVER.test(l.name)) return undefined;
  const name = deaccent(l.name.trim());
  return allow.find((a) => a.match && norm(a.match.country) === norm(l.country ?? "") && a.match.name.test(name));
}

/** Top flights matched by country + name on API-Football (any plan that includes them). Europe feeds the club-strength pool. */
const EU = (country: string, name: RegExp, focus: string | null = "europe-other", extra: Partial<LeagueEntry> = {}): LeagueEntry => ({ match: { country, name }, focus, feeds: "europe", ...extra });
const WORLD = (country: string, name: RegExp, focus: string | null, extra: Partial<LeagueEntry> = {}): LeagueEntry => ({ match: { country, name }, focus, ...extra });
export const MORE_API_FOOTBALL: LeagueEntry[] = [
  /*
   * Every name below is the spelling API-Football actually returns, taken from a live plan's
   * competition list (`npm run leaguecheck` prints it). Entries without a trailing `$` are prefix
   * matches, used where a tier is split into groups that are each a real competition with its own
   * table; the NEVER guard above keeps the women's, youth and play-off namesakes out.
   *
   * Grouped third tiers with many parallel divisions are deliberately left out — Spain's Primera
   * División RFEF (5 groups), Greece's Gamma Ethniki (10), Romania's Liga III (10), Hungary's NB III,
   * Bulgaria's Third League, Italy's Serie D and Germany's Regionalliga/Oberliga. Each would add ten
   * or more competitions to every sync for very thin betting interest. Say the word and they go in.
   */

  // ─── England ───
  EU("England", /^National League$/i, "england", { tier: 5 }),

  // ─── Big five: third tiers ───
  EU("Italy", /^Serie C/i, null, { tier: 3 }),          // three girones
  EU("Germany", /^3\. Liga$/i, null, { tier: 3 }),
  EU("France", /^Ligue 3$/i, null, { tier: 3 }),
  EU("Netherlands", /^Eerste Divisie$/i, "europe-other", { tier: 2 }),
  EU("Netherlands", /^Tweede Divisie$/i, "europe-other", { tier: 3 }),
  EU("Portugal", /^(Liga Portugal 2|Segunda Liga)$/i, "europe-other", { tier: 2 }),
  EU("Portugal", /^Liga 3$/i, "europe-other", { tier: 3 }),

  // ─── Europe: top flights, second tiers, and third tiers where they are not split ten ways ───
  EU("Scotland", /^Championship$/i, "europe-other", { tier: 2 }),
  EU("Scotland", /^League One$/i, "europe-other", { tier: 3 }),
  EU("Scotland", /^League Two$/i, "europe-other", { tier: 4 }),
  EU("Belgium", /^Challenger Pro League$/i, "europe-other", { tier: 2 }),
  EU("Turkey", /^1\. Lig$/i, "europe-other", { tier: 2 }), EU("Turkey", /^2\. Lig$/i, "europe-other", { tier: 3 }),
  EU("Greece", /^Super League 2$/i, "europe-other", { tier: 2 }),
  EU("Switzerland", /^Challenge League$/i, "europe-other", { tier: 2 }),
  EU("Austria", /^2\. Liga$/i, "europe-other", { tier: 2 }),
  EU("Denmark", /^1\. Division$/i, "europe-other", { tier: 2 }), EU("Denmark", /^2\. Division$/i, "europe-other", { tier: 3 }),
  EU("Norway", /^1\. Division$/i, "europe-other", { tier: 2 }), EU("Norway", /^2\. Division/i, "europe-other", { tier: 3 }),
  EU("Sweden", /^Superettan$/i, "europe-other", { tier: 2 }), EU("Sweden", /^Ettan/i, "europe-other", { tier: 3 }),
  EU("Finland", /^Veikkausliiga$/i), EU("Finland", /^Ykk(o|ö)sliiga$|^Ykk(o|ö)nen$/i, "europe-other", { tier: 2 }),
  EU("Finland", /^Kakkonen/i, "europe-other", { tier: 3 }),
  EU("Iceland", /^(Besta deild karla|Urvalsdeild)$/i), EU("Iceland", /^1\. Deild$/i, "europe-other", { tier: 2 }),
  EU("Poland", /^Ekstraklasa$/i), EU("Poland", /^I Liga$/i, "europe-other", { tier: 2 }), EU("Poland", /^II Liga/i, "europe-other", { tier: 3 }),
  EU("Czech-Republic", /^(Czech Liga|1\. Liga|Fortuna Liga)$/i), EU("Czech-Republic", /^FNL$/i, "europe-other", { tier: 2 }),
  EU("Czech-Republic", /^3\. liga/i, "europe-other", { tier: 3 }),
  EU("Slovakia", /^(Super Liga|Nike Liga)$/i), EU("Slovakia", /^2\. liga$/i, "europe-other", { tier: 2 }),
  EU("Hungary", /^NB I$/i), EU("Hungary", /^NB II$/i, "europe-other", { tier: 2 }),
  EU("Romania", /^Liga I$/i), EU("Romania", /^Liga II$/i, "europe-other", { tier: 2 }),
  EU("Bulgaria", /^First League$/i), EU("Bulgaria", /^Second League$/i, "europe-other", { tier: 2 }),
  EU("Croatia", /^HNL$/i), EU("Croatia", /^First NL$/i, "europe-other", { tier: 2 }), EU("Croatia", /^Second NL$/i, "europe-other", { tier: 3 }),
  EU("Serbia", /^Super Liga$/i), EU("Serbia", /^Prva Liga$/i, "europe-other", { tier: 2 }),
  EU("Slovenia", /^1\. SNL$/i), EU("Slovenia", /^2\. SNL$/i, "europe-other", { tier: 2 }),
  EU("Ukraine", /^Premier League$/i), EU("Ukraine", /^Persha Liga$/i, "europe-other", { tier: 2 }),
  EU("Russia", /^Premier League$/i), EU("Russia", /^First League$/i, "europe-other", { tier: 2 }),
  EU("Cyprus", /^1\. Division$/i), EU("Cyprus", /^2\. Division$/i, "europe-other", { tier: 2 }),
  EU("Israel", /^Ligat Ha'?al$/i), EU("Israel", /^Liga Leumit$/i, "europe-other", { tier: 2 }),
  EU("Ireland", /^Premier Division$/i), EU("Ireland", /^First Division$/i, "europe-other", { tier: 2 }),
  EU("Bosnia", /^Premijer Liga$/i), EU("Bosnia", /^1st League/i, "europe-other", { tier: 2 }),
  EU("Estonia", /^Meistriliiga$/i), EU("Estonia", /^Esiliiga/i, "europe-other", { tier: 2 }),
  EU("Latvia", /^Virsliga$/i), EU("Latvia", /^1\. Liga$/i, "europe-other", { tier: 2 }),
  EU("Lithuania", /^A Lyga$/i), EU("Lithuania", /^1 Lyga$/i, "europe-other", { tier: 2 }),
  EU("Albania", /^Superliga$/i), EU("Albania", /^1st Division$/i, "europe-other", { tier: 2 }),
  EU("Macedonia", /^First League$/i), EU("Macedonia", /^Second League$/i, "europe-other", { tier: 2 }),
  EU("Montenegro", /^First League$/i), EU("Montenegro", /^Second League$/i, "europe-other", { tier: 2 }),
  EU("Kosovo", /^Superliga$/i), EU("Kosovo", /^Liga E Pare$/i, "europe-other", { tier: 2 }),
  EU("Malta", /^Premier League$/i), EU("Malta", /^Challenge League$/i, "europe-other", { tier: 2 }),
  EU("Luxembourg", /^National Division$/i),
  EU("Wales", /^Premier League$/i), EU("Wales", /^FAW Championship$/i, "europe-other", { tier: 2 }),
  EU("Northern-Ireland", /^Premiership$/i), EU("Northern-Ireland", /^Championship$/i, "europe-other", { tier: 2 }),
  EU("Faroe-Islands", /^Meistaradeildin$/i), EU("Faroe-Islands", /^1\. Deild$/i, "europe-other", { tier: 2 }),
  EU("Georgia", /^Erovnuli Liga$/i), EU("Georgia", /^Erovnuli Liga 2$/i, "europe-other", { tier: 2 }),
  EU("Armenia", /^Premier League$/i), EU("Armenia", /^First League$/i, "europe-other", { tier: 2 }),
  EU("Azerbaijan", /^Premyer Liqa$/i), EU("Belarus", /^Premier League$/i), EU("Belarus", /^1\. Division$/i, "europe-other", { tier: 2 }),
  EU("Moldova", /^Super Liga$/i), EU("Moldova", /^Liga 1$/i, "europe-other", { tier: 2 }),
  EU("Kazakhstan", /^Premier League$/i), EU("Kazakhstan", /^1\. Division$/i, "europe-other", { tier: 2 }),

  // ─── Americas ───
  WORLD("Brazil", /^Serie B$/i, "americas", { tier: 2 }), WORLD("Brazil", /^Serie C$/i, "americas", { tier: 3 }),
  WORLD("Argentina", /^Primera Nacional$/i, "americas", { tier: 2 }),
  WORLD("Argentina", /^Primera B Metropolitana$/i, "americas", { tier: 3 }),
  WORLD("Uruguay", /^Primera Division$/i, "americas"), WORLD("Uruguay", /^Segunda Division$/i, "americas", { tier: 2 }),
  WORLD("Ecuador", /^Liga Pro$/i, "americas"), WORLD("Ecuador", /^Liga Pro Serie B$/i, "americas", { tier: 2 }),
  WORLD("Chile", /^Primera Division$/i, "americas"), WORLD("Chile", /^Primera B$/i, "americas", { tier: 2 }),
  WORLD("Colombia", /^Primera A$/i, "americas"), WORLD("Colombia", /^Primera B$/i, "americas", { tier: 2 }),
  WORLD("Peru", /^Primera Division$/i, "americas"), WORLD("Peru", /^Segunda Division$/i, "americas", { tier: 2 }),
  WORLD("Paraguay", /^Division Profesional/i, "americas"), WORLD("Paraguay", /^Division Intermedia$/i, "americas", { tier: 2 }),
  WORLD("Bolivia", /^Primera Division$/i, "americas"), WORLD("Bolivia", /^Nacional B$/i, "americas", { tier: 2 }),
  WORLD("Venezuela", /^Primera Division$/i, "americas"), WORLD("Venezuela", /^Segunda Division$/i, "americas", { tier: 2 }),
  WORLD("Mexico", /^Liga de Expansion MX$/i, "americas", { tier: 2 }),
  WORLD("USA", /^USL Championship$/i, "americas", { tier: 2 }), WORLD("USA", /^(MLS Next Pro|USL League One)$/i, "americas", { tier: 3 }),
  WORLD("Canada", /^Canadian Premier League$/i, "americas"),
  WORLD("Costa-Rica", /^Primera Division$/i, "americas"), WORLD("Costa-Rica", /^Liga de Ascenso$/i, "americas", { tier: 2 }),
  WORLD("Honduras", /^Liga Nacional$/i, "americas"), WORLD("Guatemala", /^Liga Nacional$/i, "americas"),
  WORLD("Panama", /^Liga Panamena de Futbol$/i, "americas"),
  WORLD("El-Salvador", /^Primera Division$/i, "americas"), WORLD("Nicaragua", /^Primera Division$/i, "americas"),
  WORLD("Dominican-Republic", /^Liga Mayor$/i, "americas"), WORLD("Jamaica", /^Premier League$/i, "americas"),
  WORLD("Trinidad-And-Tobago", /^Pro League$/i, "americas"),

  // ─── Asia & Oceania ───
  WORLD("Saudi-Arabia", /^Division 1$/i, "asia", { tier: 2 }),
  WORLD("United-Arab-Emirates", /^Pro League$/i, "asia"), WORLD("United-Arab-Emirates", /^Division 1$/i, "asia", { tier: 2 }),
  WORLD("Qatar", /^Stars League$/i, "asia"), WORLD("Qatar", /^Second Division$/i, "asia", { tier: 2 }),
  WORLD("Bahrain", /^Premier League$/i, "asia"), WORLD("Kuwait", /^Premier League$/i, "asia"), WORLD("Kuwait", /^Division 1$/i, "asia", { tier: 2 }),
  WORLD("Oman", /^Professional League$/i, "asia"), WORLD("Jordan", /^League$/i, "asia"),
  WORLD("Iran", /^Persian Gulf Pro League$/i, "asia"), WORLD("Iran", /^Azadegan League$/i, "asia", { tier: 2 }),
  WORLD("Iraq", /^Iraqi League$/i, "asia"), WORLD("Uzbekistan", /^Super League$/i, "asia"), WORLD("Uzbekistan", /^Pro League A$/i, "asia", { tier: 2 }),
  WORLD("Japan", /^J2 League$/i, "asia", { tier: 2 }), WORLD("Japan", /^J3 League$/i, "asia", { tier: 3 }),
  WORLD("South-Korea", /^K League 1$/i, "asia"), WORLD("South-Korea", /^K League 2$/i, "asia", { tier: 2 }),
  WORLD("South-Korea", /^K3 League$/i, "asia", { tier: 3 }),
  WORLD("China", /^Super League$/i, "asia"), WORLD("China", /^League One$/i, "asia", { tier: 2 }), WORLD("China", /^League Two$/i, "asia", { tier: 3 }),
  WORLD("Australia", /^A-League$/i, "asia"), WORLD("New-Zealand", /^National League - National$/i, "asia"),
  WORLD("India", /^Indian Super League$/i, "asia"), WORLD("India", /^I-League$/i, "asia", { tier: 2 }),
  WORLD("Thailand", /^Thai League 1$/i, "asia"), WORLD("Thailand", /^Thai League 2$/i, "asia", { tier: 2 }),
  WORLD("Vietnam", /^V\.League 1$/i, "asia"), WORLD("Vietnam", /^V\.League 2$/i, "asia", { tier: 2 }),
  WORLD("Indonesia", /^Liga 1$/i, "asia"), WORLD("Indonesia", /^Liga 2$/i, "asia", { tier: 2 }),
  WORLD("Malaysia", /^Super League$/i, "asia"), // Premier League left out: this plan has nothing newer than 2022
  WORLD("Singapore", /^Premier League$/i, "asia"), WORLD("Hong-Kong", /^Premier League$/i, "asia"),
  WORLD("Chinese-Taipei", /^Taiwan Football Premier League$/i, "asia"),

  // ─── Africa ───
  WORLD("Egypt", /^Second League$/i, "africa", { tier: 2 }),
  WORLD("Morocco", /^Botola Pro$/i, "africa"), WORLD("Morocco", /^Botola 2$/i, "africa", { tier: 2 }),
  WORLD("Algeria", /^Ligue 1$/i, "africa"), WORLD("Algeria", /^Ligue 2$/i, "africa", { tier: 2 }),
  WORLD("Tunisia", /^Ligue 1$/i, "africa"), WORLD("Tunisia", /^Ligue 2$/i, "africa", { tier: 2 }),
  WORLD("South-Africa", /^1st Division$/i, "africa", { tier: 2 }),
  WORLD("Ghana", /^Premier League$/i, "africa"), WORLD("Ghana", /^Division One League$/i, "africa", { tier: 2 }),
  WORLD("Kenya", /^FKF Premier League$/i, "africa"), WORLD("Kenya", /^Super League$/i, "africa", { tier: 2 }),
  WORLD("Zambia", /^Super League$/i, "africa"), WORLD("Tanzania", /^Ligi kuu Bara$/i, "africa"),
  WORLD("Uganda", /^Premier League$/i, "africa"), WORLD("Cameroon", /^Elite One$/i, "africa"), WORLD("Cameroon", /^Elite Two$/i, "africa", { tier: 2 }),
  WORLD("Ivory-Coast", /^Ligue 1$/i, "africa"), WORLD("Senegal", /^Ligue 1$/i, "africa"),
  WORLD("Angola", /^Girabola$/i, "africa"), WORLD("Burkina-Faso", /^Ligue 1$/i, "africa"),
  WORLD("Mali", /^Premiere Division$/i, "africa"), WORLD("Guinea", /^Ligue 1$/i, "africa"),
  WORLD("Libya", /^Premier League$/i, "africa"), WORLD("Sudan", /^Sudani Premier League$/i, "africa"),
  WORLD("Ethiopia", /^Premier League$/i, "africa"), WORLD("Rwanda", /^National Soccer League$/i, "africa"),
  WORLD("Zimbabwe", /^Premier Soccer League$/i, "africa"), WORLD("Botswana", /^Premier League$/i, "africa"),
  WORLD("Malawi", /^Super League$/i, "africa"), // Namibia left out: nothing newer than 2018 on this plan
  WORLD("Congo-DR", /^Ligue 1$/i, "africa"), WORLD("Togo", /^Championnat National$/i, "africa"),
  WORLD("Benin", /^Championnat National$/i, "africa"), WORLD("Gabon", /^Championnat D1$/i, "africa"),
];

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
    // Matched by country + name, so they work on any plan that includes them. This spread was
    // missing: the list was built in 0.7.1, extended in 0.9.0 and never actually read, so none of
    // it ever synced and only the explicit ids below did.
    ...MORE_API_FOOTBALL,
    { id: "39", focus: "england", feeds: "europe" }, { id: "40", focus: "england", feeds: "europe", tier: 2 },
    { id: "140", focus: "europe-strong", feeds: "europe" }, { id: "135", focus: "europe-strong", feeds: "europe" }, { id: "78", focus: "europe-strong", feeds: "europe" },
    { id: "61", focus: "europe-strong", feeds: "europe" }, { id: "88", focus: null, feeds: "europe" }, { id: "94", focus: null, feeds: "europe" },
    { id: "2", focus: "europe-strong", pool: "europe" },   // Champions League
    { id: "3", focus: "europe-strong", pool: "europe" },   // Europa League
    { id: "848", focus: "europe-strong", pool: "europe" }, // Conference League
    { id: "399", focus: "africa" }, // Nigeria NPFL
    // More top flights and second tiers (used when your API-Football plan includes them)
    { id: "41", focus: "england", tier: 3 }, { id: "42", focus: "england", tier: 4 },            // League One, League Two
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
