# Changelog

## 0.10.3 — fix: the builder was choosing the LEAST likely legs
- **"Safest" systematically preferred the less likely of two equally priced legs.** The candidate
  ranking divided log(p) by *minus* the price, which inverts it: both terms are negative, so the score
  fell as probability rose. Worse, equally priced candidates share a price bucket and only one survives
  the pool cut, so the better leg was discarded before the search ever saw it. Given a choice between
  p=0.82 and p=0.66 at the same 1.30, the builder returned five legs of 0.66 — a **12.5%** slip where
  **37.1%** was available on the same matches at the same price. It now divides by the price, so the
  metric rises with probability. Tested both directions.
  (Reaching a target is a knapsack: maximise the sum of log(p) subject to the sum of log(odds) clearing
  log(target), which makes log(p) per unit of log(odds) the right greedy ratio. With fair odds it is
  −1 for every leg — correct, not broken: every leg is then equally efficient and the target alone
  sets the chance, which is why this went unnoticed until bookmaker prices were in play.)

## 0.10.2 — Min legs reaches the max-legs setting
- The **Min legs** picker stopped at 8, so the leg counts that make a long target even were
  unreachable: 19.00 over 12 legs is about 1.28 a leg, but 12 could not be asked for. It now offers
  every step up to whatever **Max legs** is set to (10, 12 and 15 included).
  Measured on a test pool, 19.00 with a minimum of 12: twelve legs averaging 1.28, spread 1.19×,
  total 19.68. With no minimum the same target gives six legs at about 1.63 — both are even, they are
  just even at different leg counts, which is what the minimum is for.

## 0.10.1 — even leg prices in the Odds builder
- **Legs are now kept to a similar price.** A target of 3.00 with a minimum of 6 legs gives legs of
  about 3^(1/6) = **1.20 each**, instead of a 1.60 propped up by a 1.03 and four other near-certainties.
  On a test pool: seven legs all at 1.18 reaching 3.12, against the old search's mix of
  1.05, 1.05, 1.11, 1.11, 1.11, 1.18, 1.18, 1.43 reaching 3.01.
- **Evenness is measured on each leg's share of the price, not on the odds**, which matters more than it
  sounds. At a 1.20 ideal, a "within 25%" band on the odds runs from 0.96 to 1.50 and lets a 1.03 leg
  straight through — yet 1.03 carries 0.03 of the total price where an equal share is 0.18. Working in
  log odds makes "an equal share" the thing actually bounded, and excludes it.
- **New "Leg prices" control: Even (default) or Any mix.** Even is the default because six similar
  prices is what a six-fold is usually meant to be; Any mix restores the previous behaviour, which is
  still useful for reaching an awkward target on a quiet day.
- The band widens through the existing attempt ladder, so an even slip is preferred but never at the
  cost of failing to reach the target at all.
- Each combination now shows **legs average** and, where they differ, the **range**, so the mix is
  visible rather than something to be inferred by reading down the list.
- Note a minimum of 6 legs can still produce 7: if the available prices around 1.20 do not multiply to
  the target in exactly six, one more leg is how it gets there.

## 0.10.0 — Upcoming / Live / Finished on the fixtures board
- **Three tabs on the board**, with a count on each: **Upcoming** (not kicked off — the default, since
  the board's job is the matches you can still bet on), **Live** (being played now, with a pulsing dot)
  and **Finished** (played). The date strip, league filter and market filter all still apply, and the
  tab is carried in the URL (`?show=live`) so a link keeps it.
- **A tab does not rely on the stored status alone, because it cannot.** A provider status of LIVE is
  only written when a job happens to run while a match is in progress, and the full sync runs every
  three hours — so a 15:00 kickoff typically still reads SCHEDULED until 18:00, long after it ended. A
  Live tab built on the raw status would sit empty through most of a Saturday. Kickoff time decides
  instead: not started → upcoming, within 105 minutes of kickoff → live, beyond that → finished. A
  fixture the provider *has* reported as LIVE gets 180 minutes, so a cup tie through extra time and
  penalties is not filed as finished while it is still being played.
- **A row shows a score whenever one exists**, not only after full time, so a match caught in progress
  shows its running score. Finished matches read `FT`; one that has been played but whose score has not
  arrived reads `result pending` (the results job runs every 15 minutes).
- **Postponed and cancelled matches appear in no tab** — they have not been played and cannot be bet —
  but they are counted in a line under the tabs rather than disappearing silently.
- Empty states know which tab you are on: asking for Live on a date with none says what the date *does*
  have and offers a button straight to it.

## 0.9.12 — say which competition is being worked on
- The progress line is now printed **before** a competition is processed as well as after it. A sync
  that stalls or is killed previously left no record of which competition it died on — which is the one
  thing worth knowing. Each line carries the season being requested, so a provider call that never
  returns is attributable immediately.

## 0.9.11 — the capped budget goes to the leagues you bet on
- **Fix: match statistics, bookmaker odds and injuries were being spent on the wrong leagues.** Those
  three are capped **per sync** (30 / 30 / 25), not per league, so whichever competitions run first
  spend the lot. Ordering by staleness in 0.9.9 made that order effectively arbitrary, and a real run
  gave 30 of 30 stats calls to Kenya's second tier — 66 provider requests for one competition — before
  reaching anything anyone bets on. The budget is now reserved for the strong European leagues, England
  and other top flights; lower tiers still get their fixtures and predictions every sync, just not
  corners, shots, odds or injury checks, which are worth little there and cost the same.
- The progress line marks which competitions draw on that budget with a `*`, so the effect is visible
  while a sync runs.

## 0.9.10 — a long sync now shows progress
- **The sync logs a line per competition to stderr as it goes.** The report was a single blob printed
  at the end, so a run covering 265 competitions looked hung for its whole duration and told you
  nothing at all if it was killed. Each competition now prints its position, fixtures, upcoming games,
  predictions and the running provider-request count — so `tail -f` is useful, and a killed run leaves
  a record of exactly where it stopped. stdout keeps the single parseable JSON report; cron captures both.
- **Fix: the sync report collapsed same-named leagues.** It was keyed by bare league name, and a great
  many countries run a "Premier League", a "Super Liga", a "First League" or a "Primera División" — so
  at 265 competitions most of the report overwrote itself and a league returning nothing could hide
  behind a healthy namesake. Keys are now "Country · League", with the provider id appended only where
  even that repeats.
- Renamed an inner variable that shadowed the new least-recently-synced map, which read like a bug.

## 0.9.9 — fix the sync being killed part-way through
- **Fix: the European rating pool swallowed every lower tier.** The `EU()` helper marked every European
  entry as feeding the shared "europe" pool, second and third tiers included. That pool is assembled by
  loading every finished fixture from the last 450 days across every feeding league, with both teams,
  **once per European cup** — so 0.9.6 took it from about 20 competitions to about 150, tens of
  thousands of fixtures in memory three times over, and the sync was killed for running out of memory
  before it could finish. Only top flights feed it now (35 competitions), which is what it was for: a
  third-tier club never plays in the Champions League. Lower tiers are still rated on their own
  league's fit, and a promoted club's prior still comes from `tier`.
  Tests now assert that no lower tier feeds the pool and that the pool stays under 60 competitions.
- **An interrupted sync resumes instead of restarting.** Leagues are now taken least-recently-synced
  first (pooled competitions still last), so a run cut short by a long first sync, a dropped session or
  a kill picks up the leagues it never reached. Before, every run redid the same head of the list and
  the tail was never synced at all.

## 0.9.8 — fits 265 leagues into a 7500/day quota
- **Finished seasons are no longer re-downloaded every three hours.** Each sync asked the provider for
  every league's previous season(s) as well as its current one — three requests per league where two
  would do, and the extra one fetched fixtures that finished months ago and can never change. At 265
  competitions that was about 7,100 requests a day against a 7,500 ceiling. Previous seasons now
  refresh once a day (`HISTORY_REFRESH_HOURS`, default 24); the current season is still re-read every
  sync, because its results do change.
  Measured effect: roughly **7,100 → 5,300 requests a day**, about 70% of the quota, with the 3-hourly
  sync unchanged.
- **Every sync report now carries `providerRequests`**, the actual number of provider calls that run
  made, counting the retry after a rate-limit because the provider counts those too. Quota planning
  stops being arithmetic and becomes something you can read off the last sync.
- New `historyAt` per league records when its finished seasons were last re-read (`prisma db push`
  applies it; the deploy script does that for you).

## 0.9.7 — fixes found by auditing the 265 leagues that now sync
- **Fix: South Korea's top flight was missing.** The 0.9.6 rewrite kept K League 2 and K3 League and
  dropped K League 1, so the second and third tiers synced while the first did not. A test now checks
  that every country with a lower tier also has its top flight, either here or under an explicit id.
- **Fix: cups and one-off finals slipped through the prefix matches.** `/^Serie C/` also caught
  "Serie C - Supercoppa Lega Finals". Cups, super cups, trophies, shields and finals are refused
  outright — a knockout has no league table, so the ratings model has nothing to fit. The curated
  international competitions (World Cup, Libertadores, the UEFA cups) come in by id and are unaffected.
- **Fix: England's League One and League Two were both marked tier 2.** The pyramid is Premier League 1,
  Championship 2, League One 3, League Two 4, National League 5, and `tier` is what gives a promoted or
  relegated club its prior, so both were feeding the wrong prior. Pre-existing, not from 0.9.6.
- Dropped two leagues whose newest season on this plan is long dead: Namibia's Premier League (nothing
  after 2018) and Malaysia's Premier League (nothing after 2022). They cost requests on every sync and
  showed up as empty leagues in the filter.

## 0.9.6 — the extra leagues were never wired in
- **Fix: `MORE_API_FOOTBALL` was dead code.** The country + name league list was written in 0.7.1,
  extended to 166 entries in 0.9.0 — and never referenced by anything. `LEAGUE_ALLOWLIST` only ever
  contained the 50 hand-written ids, so every competition that list was supposed to add (Finland,
  Czechia, Romania, Poland, Croatia, Serbia, Ukraine, Russia, Israel, Ireland, Uruguay, Ecuador, Chile,
  Colombia, Peru and the rest) has never synced on any version. It is spread in now, and a test
  asserts every entry reaches the allowlist so this cannot recur.
- **Names corrected against a live plan's own competition list**, which `leaguecheck` prints. Many
  guesses were simply wrong and were being skipped in silence: Serbia's second tier is *Prva Liga* not
  "First League"; Peru runs *Primera/Segunda División* not "Liga 1"; Panama is *Liga Penameña de
  Fútbol* not "LPF"; Azerbaijan is *Premyer Liqa*; Iraq is *Iraqi League*; Jordan is just *League*;
  Egypt's second tier is *Second League*; South Africa's is *1st Division*; Kenya is *FKF Premier
  League*; France's third tier is *Ligue 3*; Sweden's is *Ettan*. API-Football also files Bosnia under
  "Bosnia" and North Macedonia under "Macedonia", so both were unmatchable.
- **Grouped tiers now match as a set.** A third tier is often several parallel divisions
  ("Serie C - Girone A/B/C", "Kakkonen - Lohko A/B/C", "II Liga - East"), each a real competition with
  its own table, so those entries match by prefix and take them all.
- **Guard against the collateral of that.** Women's, youth, reserve and play-off competitions sit
  beside their namesakes under the same prefix, so they are now refused outright — no
  "Primera División Femenina", "Brasileiro U20", "Campionato Primavera" or
  "Serie C - Promotion - Play-offs". An explicit id still bypasses the guard.
- **League names are matched without accents**, so the entry for Iceland's *Urvalsdeild* matches the
  provider's *Úrvalsdeild*.
- New tiers and countries throughout: 201 entries, tiers 1–3. Deliberately excluded are the third
  tiers split ten ways — Spain's Primera División RFEF, Greece's Gamma Ethniki, Romania's Liga III,
  Hungary's NB III, Bulgaria's Third League, Italy's Serie D, Germany's Regionalliga and Oberliga.
  Each would add ten or more competitions to every sync for very thin interest.
- **Run `npm run leaguecheck` after this update.** It reports how many competitions now match, and the
  first sync afterwards will run long while their history loads.

## 0.9.0 — fixtures as the home page, Top 50, safer Builder, many more leagues, your own timezone
- **The fixtures board is now the landing page.** The separate "Today" screen is gone: opening the app
  puts you straight on the date strip with the league and market filters. `/fixtures` still works and
  redirects, so old links, shared day links and an installed PWA all keep working. The scanner
  shortcut row and the accuracy tile that used to sit above the list were dropped — both are one tap
  away in the nav and under More.
- **The 1 X 2 percentages now show on phones.** The stacked home/draw/away bar was desktop-only because
  the mobile row had no column for it; it now gets its own full-width line under the team names, from
  the same component as the desktop one, so the two can never drift apart.
- **Top 20 is now Top 50**, still one tip per match and still ranked by probability with the small
  confidence boost. The per-market caps scale with the longer list — at most 5 double chance, 5 Under 4.5,
  5 win-by-2 and 2 half Under 2.5 (they were 2/2/2/1 for 20 slots) — so the extra 30 places stay varied
  instead of filling with the markets that naturally price highest. The "Best value" list keeps its own
  length and is now titled as itself rather than borrowing the Top 50 heading.
- **Builder → Safest never uses a leg priced above 1.60.** A long target is reached with more, shorter
  picks rather than a few risky ones. The cap is absolute: when a target cannot be reached under it, the
  page says so and points at a longer window, a lower target, more legs or Best value, rather than
  quietly slipping a 3.00 leg into a slip labelled "safest". The 14-day track record on that tab is
  rebuilt under the same cap. Best value is unchanged.
- **Second and third tiers, and about 40 more countries** (API-Football, matched by country + name, so
  they work on any plan that includes them):
  · new second tiers — Scotland, Belgium, Turkey, Greece, Switzerland, Austria, Denmark, **Norway**,
    Sweden, **Finland**, Iceland, Poland, **Czechia**, Slovakia, Hungary, **Romania**, Bulgaria, Croatia,
    Serbia, Slovenia, Ukraine, Russia, Cyprus, Israel, Ireland, Bosnia, Estonia, **Argentina**,
    **Uruguay**, **Ecuador**, Chile, Colombia, Peru, Paraguay, Mexico, USA, Brazil, Japan, South Korea,
    China, India, Thailand, Saudi Arabia, Egypt, Morocco, Algeria, Tunisia, South Africa
  · new third tiers — Spain, Italy, Germany, France, Netherlands, Portugal, Scotland, Turkey, Denmark,
    Norway, Sweden, Poland, Romania, Argentina, Brazil, USA, Japan; England's National League
  · new countries — Latvia, Lithuania, Albania, North Macedonia, Montenegro, Malta, Luxembourg, Wales,
    Northern Ireland, Georgia, Armenia, Azerbaijan, Belarus, Moldova, Kazakhstan, Canada, Bolivia,
    Venezuela, Paraguay, Costa Rica, Honduras, Guatemala, Panama, Bahrain, Kuwait, Oman, Jordan, Iran,
    Iraq, Uzbekistan, New Zealand, Vietnam, Thailand, Indonesia, Malaysia, Zambia, Tanzania, Uganda,
    Cameroon, Ivory Coast, Senegal, Angola
  Lower tiers feed the same cross-league club-strength pool, and a promoted or relegated club now
  carries a prior from the division it actually came from.
- **`npm run leaguecheck`** — new script that lists what your plan offers and how the allowlist maps onto
  it: every competition being synced with its tier and filter, every competition your plan includes that
  is *not* synced, and every allowlist entry that matched nothing. Because leagues are matched by name, a
  provider that spells one differently is skipped silently; this is how you find those. Worth running
  once after this update.
- **Kickoff timezone is now yours to choose, per device** (Settings → Display). Around 135 zones across
  Africa, Europe, North America, Central and South America, the Middle East, Asia and the Pacific, plus
  "Detect from this device". It changes kickoff times, the date strip and which matches count as "today",
  for that browser only — no accounts, nothing shared, and every other device keeps its own choice. UTC
  stays printed underneath every kickoff. `DEFAULT_TIMEZONE` is now only the fallback for a device that
  has not chosen.
  - Fix along the way: day boundaries used a hardcoded +1 hour for Lagos and 0 for everywhere else, so
    any other zone put late-night and early-morning kickoffs on the wrong calendar day. They now use the
    zone's real rules, including daylight saving and half-hour offsets.
  - The "WAT" label next to kickoff times is gone, replaced by the actual offset of the chosen zone
    (UTC+1, UTC-5, UTC+5:30). It was wrong for anyone not in West Africa.

## 0.8.1
- **Value list odds ceiling**: the Best value list can be capped at shorter prices (2, 3 or 6), since
  shorter legs mean a steadier record.
- **★ marks standout value** — High confidence, 50% or better, and an edge of 8% or more — rather than
  just a tip that clears the qualifying bar.
- **Minimum leg count in the Builder**: spreads the same target price over more, shorter-priced legs.
  Each leg is individually safer, though the combined chance still follows the price you aim at.
- Fix: the builder's beam search could extend a partial slip past the maximum leg count before checking it.
- (This release shipped without a changelog entry or a version bump at the time; recorded here for the record.)

## 0.8.0 — Odds builder
- New **Builder** page: pick a target price (3, 5, 10, 30, 100 or your own) and a window (today, 2 days, 3 days, this week, 14 days) and get the combination that reaches it with the best chance, plus two alternatives.
- Legs come from every market, alternative lines and specials included. One leg per match, at most 2 per competition and 2 of the same market type; the spread rules relax only if the target is otherwise unreachable.
- Bookmaker prices are used where stored (value legs preferred, **Best value / Safest** switch); otherwise the model's fair odds, and the page says plainly that the target then sets the chance.
- Each combination shows its price, honest chance ("about 1 in 12", with a small haircut because legs aren't independent) and has **Save as slip**, **Copy** and **Sportybet code**.
- **Track record**: the same target rebuilt from locked calls on each of the last 14 days, with how many would have won.

## 0.7.2
- Fix: football-data.org "429" errors during a sync (its free tier allows 10 requests per minute, and the extra league pushed past it). A rate-limited request now waits for the provider's own window — `Retry-After`, or a full minute — instead of retrying after one second, and requests are spaced 7.2s apart. Seasons that were skipped with a 429 load on the next sync.

## 0.7.1 — many more leagues, calmer screens
- **~50 more competitions** are synced when your plan includes them (API-Football): Scotland, Belgium, Turkey, Greece, Switzerland, Austria, Denmark, Norway, Sweden, Finland, Iceland, Poland, Czechia, Slovakia, Hungary, Romania, Bulgaria, Croatia, Serbia, Slovenia, Ukraine, Russia, Cyprus, Israel, Ireland, Bosnia, plus Saudi Arabia, UAE, Qatar, Japan, South Korea, China, Australia, India, Brazil (A and B), Argentina, Mexico, MLS, Chile, Colombia, Uruguay, Peru, Ecuador, Egypt, Morocco, Algeria, Tunisia, South Africa, Ghana, Kenya, CAF Champions League, Copa Libertadores and Sudamericana.
  Leagues are matched by **country + name** rather than a fixed id, so they work on any plan without hunting for league numbers, and European leagues feed the shared club-strength pool.
- **Calmer screens:** long chip rows replaced by compact dropdowns — Fixtures (league, market), Top 20 (competitions, market), Scanners (competitions). Markets on a match page are grouped into collapsible sections (Win and Goals open by default) with the best probability shown on each closed section. The Leagues page groups by country with a letter jump, and the sidebar lists 12 leagues with an "all" link.

## 0.7.0 — per-fixture corner / shot lines, half-time draw, access code
- **Corners and shots now use each fixture's own lines.** The main line is the .5 line closest to a 50/50 split for that match (bookmaker style) instead of a fixed 8.5 / 24.5; alternatives are offered at ±1, ±2, ±3 corners and ±2, ±4, ±6 shots, **with Over and Under on every line**. The best corner/shot pick is the most aggressive offered line that still clears your floor. Older predictions keep their 8.5 / 24.5 lines and stay scored correctly.
- **Half-time draw** market (from each league's fitted first-half scoring share), with its own scanner and floor; scored from the stored half-time result.
- **Access code:** a full-screen code prompt covers the app until the code is entered. Set, change or remove it in Settings (PIN-protected), which always stays reachable. It locks again after 30 minutes of inactivity, each page view extends the window, and "Lock this device now" is available. The code is stored hashed; changing it signs every device out. After 5 wrong codes the form is locked for 5 minutes (tracked on the server, so clearing the phone doesn't reset it).
- Results job also re-reads the last 12 hours of finished matches, so a score the provider corrects after full time is picked up.
- Sportybet export handles the new corner lines and the half-time draw.

## 0.6.0 — halves, win or over, more leagues
- **New markets:** 1st half Under 1.5, 1st half Under 2.5, 2nd half Under 2.5, Home win or Over 2.5, Away win or Over 2.5 — on match pages (All markets), scanners, fixtures filter, Top 20 (new "Halves" and "Win or Over 2.5" filters), Blend and slips.
  Halves use each league's fitted share of first-half goals (from half-time scores, shrunk to 45%); half markets are scored from the stored half-time result.
- **Headline pick** never shows 1st-half or 2nd-half Under 2.5 (they would top most matches). **Top 20** mixed list allows at most one of them.
- **Half-time scores** stored for every match (football-data.org and API-Football) and on the results ledger.
- **More leagues:** Brazil Série A added on football-data.org's free plan. For API-Football plans: League One/Two, LaLiga 2, Serie B, 2. Bundesliga, Ligue 2, Scotland, Belgium, Turkey, Greece, Austria, Switzerland, Denmark, Norway, Sweden, Brazil, Argentina, Mexico, MLS, Libertadores, Sudamericana, Saudi Pro League, J1, Egypt, South Africa, CAF Champions League. New region filters: Europe other, Americas, Africa, Asia.
- **Sportybet codes** map 1st-half / 2nd-half totals; "win or over" isn't a single Sportybet selection and is listed as not booked.

## 0.5.2
- **Blend builder:** new **Sportybet code** button books the selected legs directly (unmapped legs listed), with **Copy code** and Open on Sportybet. Blend now offers every market (win, double chance, goals, BTTS yes/no, win by 2+, corners, shots).
- **Copy to clipboard everywhere:** Copy code on slips and blends, Copy text on slips and blends — works on phones (fallback when the clipboard API is blocked) and confirms "Copied".

## 0.5.1
- Fix: pages could hang ("loading" forever) while a full sync was running, because the sync fitted ratings inside the web-server process. The 3-hourly sync now runs as its own low-priority process (`npm run ingest`, via cron with `flock` so runs never overlap); lock and results jobs stay as light HTTP calls.
- `npm run ingest` / `npm run selfcheck` load `.env` themselves.
- Inputs hash rounded to 3 decimals: fewer needless prediction revisions.
- Match page and board rows: the "best tip" is never double chance or Under 4.5 (still listed under All markets, and capped in the Top 20).
- Fixtures: every date in the window verified against a real database (all return in < 0.3 s). Invalid dates fall back to today; empty days link to the next match day; the date bar falls back to a normal page load if an in-app navigation takes > 6 s, and pre-loads neighbouring days.
- Match page: new **Best value** card — up to 3 markets where the model probability beats the bookmaker price (edge, odds, fair odds, add to slip).

## 0.5.0 — ledger, value, cross-league ratings, promoted teams, slips
- **Scoring ledger (Phase 3):** calls lock at kickoff − 15 min (latest call made before that moment); nothing is re-predicted inside the window; results appended after FT, corrections appended with `supersedesId`; calibration refit from locked + settled calls; daily `AccuracyDaily` rows.
- **Jobs:** sync every 3 h, lock every 5 min, results every 15 min (provider called only when a match should have ended). `setup-lightsail.sh update` now refreshes cron from `vercel.json` and adds log rotation.
- **Accuracy page:** model vs always-home, league-table favourite and bookmaker closing odds (de-vigged); Brier chart; calibration buckets; confidence bands; every market's hit rate.
- **Top 20:** "Most likely" / "Best value" switch. Value = model p × median odds − 1 (Medium/High, p ≥ 35%, odds 1.40–6.00, edge ≥ 3%). Track records use locked calls only; value record shows flat-stake profit/ROI.
- **Odds:** API-Football league odds stored as `OddsQuote` (median + best); shown on match pages.
- **Club strength across leagues:** Champions / Europa / Conference League rated in one pool with all domestic results.
- **Promoted/relegated teams:** prior from the previous league adjusted for tier; last season's matches weighted 0.85; early-season flag and confidence penalty.
- **Slip workshop:** + buttons on match pages and Top 20; multiple slips per device; drop weakest / drop Low / trim to 25%; split; merge with duplicate detection; copy text.
- **Sportybet booking codes (best effort):** via Sportybet's website endpoints; unmapped legs are listed, never dropped.
- `npm run selfcheck` (and `-- --demo`) verifies the ledger on the server.

## 0.4.1
- Top 20 (All markets) caps: max 2 double chance, 2 Under 4.5 and 2 win-by-2 tips; a blocked match falls back to its next-strongest market. Filtering by one market removes the caps.
- Under 4.5 and Over 3.5 are back as candidates (capped / naturally rare).
- Track record uses the same capped selection.

## 0.4.0
- Correct-score call removed everywhere (board rows, match page headline, heatmap, top-5 scorelines). The engine still uses the scoreline matrix internally to price every market.
- Match page headline is now the **best tip** (market, probability, fair odds) plus an **All markets** card.
- New markets: **double chance** (1X / X2 / 12), **BTTS No**, **win by 2+ goals** (−1.5) with a European handicap table (±1, ±2), **corners O/U 8.5**, **total shots O/U 24.5**.
- Corners and shots: separate count models; stats backfilled from API-Football `/fixtures/statistics` (`MAX_STATS_CALLS`, default 30 per sync); shown once a league has 80 matches with stats.
- New scanners: Double chance, BTTS No, Win by 2+, Corners 8.5, Shots 24.5. Top 20 gets a market filter.
- Sync no longer wipes stored shots; `upcoming` count de-duplicated.

## 0.3.2
- Fixture window extended from 14 to 21 days (env `FIXTURE_WINDOW_DAYS`, 7–45) so matches after an international break are fetched, predicted and shown.
- Home and Top 20 empty states name the next scheduled match and date.

## 0.3.1
- Fix: upcoming fixtures are now fetched explicitly for the next 14 days (football-data season lists could omit them → 0 predictions).
- Fix: scheduled sync kept only 120 days of history, dropping last season; now 450 days (3 years for national teams).
- Tournaments (World Cup, Euro…) no longer request non-existent earlier seasons (harmless 404s).
- Sync report shows `upcoming` per competition.

## 0.3.0 — combined update
- **Top 20 tips** page (`/top`): strongest single tip per match, Today → Next 7 days, ranked by probability with a small confidence boost; competition filter; 7-day track record.
- **Mobile date bar** rebuilt: instant highlight + loading spinner, selected day kept centred, ‹ › day buttons, native calendar picker; swipes no longer trigger pull-to-refresh.
- **International football**: friendlies, Nations League, World Cup & AFCON qualifiers, World Cup / Euro / AFCON / Copa América. National teams rated together across competitions (3 years of history, 365-day half-life); no home advantage at tournament finals. "International" filter in scanners and Top 20.
- **Fix**: API-Football cup competitions (Champions League, internationals) were skipped.
- **Lighter sync**: one request per season per competition (was ~26), capped injury calls — fits free plans.
- **Over 4.5 / Under 2.5 / 3.5 / 4.5** markets and scanners.
- `setup-lightsail.sh`: repo-folder installs, multi-app, dash-safe DB names, 60-minute sync timeout.

After deploying: `npx prisma db push` runs automatically in `setup-lightsail.sh update` (adds new columns).
