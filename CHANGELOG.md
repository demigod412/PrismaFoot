# Changelog

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
