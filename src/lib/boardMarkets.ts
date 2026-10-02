import type { ScannerSlug } from "./scanners";

/*
 * Every scanner, so the board can highlight any market the model prices.
 *
 * This list used to carry twenty of the twenty-eight and had to be edited by hand whenever a scanner was
 * added, which is why the three shape markets, GG2+, Over 3.5 and the three matrix lists were all missing
 * from the board while being available in the Top 50 and on their own scanner pages.
 *
 * `blend` is the one deliberate omission: it is an interactive builder rather than a pick the board can
 * put against a fixture. There is a test asserting that this is the ONLY omission, so the next scanner
 * added cannot quietly fail to appear here.
 */
export const BOARD_MARKETS: { slug: ScannerSlug; label: string; group: string }[] = [
  { slug: "all", label: "All markets", group: "" },
  { slug: "win", label: "Win", group: "Result" }, { slug: "dc", label: "Double chance", group: "Result" }, { slug: "draw", label: "Draw", group: "Result" },
  { slug: "winover", label: "Win or Over 2.5", group: "Result" }, { slug: "by2", label: "Win by 2+", group: "Result" },
  { slug: "nowinby2", label: "No win by 2+", group: "Result" },
  { slug: "o15", label: "Over 1.5", group: "Goals" }, { slug: "o25", label: "Over 2.5", group: "Goals" },
  { slug: "o35", label: "Over 3.5", group: "Goals" },
  { slug: "u25", label: "Under 2.5", group: "Goals" },
  { slug: "u35", label: "Under 3.5", group: "Goals" }, { slug: "u45", label: "Under 4.5", group: "Goals" },
  { slug: "btts", label: "Both teams to score", group: "Goals" }, { slug: "bttsno", label: "BTTS No", group: "Goals" },
  { slug: "2plus", label: "2+ total goals", group: "Goals" },
  { slug: "1plus", label: "A team to score 1+", group: "Goals" }, { slug: "team2", label: "A team to score 2+", group: "Goals" },
  { slug: "gg2", label: "Both teams 2+ (GG2+)", group: "Goals" },
  { slug: "h1u15", label: "1st half Under 1.5", group: "Halves" }, { slug: "h1u25", label: "1st half Under 2.5", group: "Halves" },
  { slug: "h2u25", label: "2nd half Under 2.5", group: "Halves" }, { slug: "htdraw", label: "Half-time draw", group: "Halves" },
  { slug: "nobothhalves", label: "Not both halves O1.5", group: "Halves" },
  { slug: "norun3", label: "No 3 goals in a row", group: "Shape" },
  { slug: "corners", label: "Corners", group: "Stats" }, { slug: "shots", label: "Total shots", group: "Stats" },
  { slug: "safe", label: "Safe picks", group: "Other" },
];
/** Exported for the test that holds this list to the scanner list. */
export const BOARD_MARKET_SLUGS = BOARD_MARKETS.map((m) => m.slug);
