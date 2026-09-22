# Changelog

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
