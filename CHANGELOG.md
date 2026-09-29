# Changelog

## 0.16.1 — the real cause of the memory kills: no heap ceiling

**This corrects 0.16.0.** That release blamed four JSON columns on each prediction and made every list
query drop them. Measuring the columns afterwards showed they are tiny:

| Column | Average size |
| --- | --- |
| `matrix` (the 11x11 grid) | 322 bytes |
| `topScorelines` | 259 bytes |
| `rationale` | 463 bytes |
| `features` | 390 bytes |

About **1.4KB per prediction** — roughly 14MB across ten thousand fixtures, perhaps 100MB once Prisma
turns it into JavaScript objects. Nowhere near the 1.5GB that was being killed. The lean queries in 0.16.0
are worth keeping, and the pages are faster for them, but they were not the cause.

### What the cause was
**V8 had no heap ceiling.** It sizes its default old-space from total RAM, which on a 2GB machine lands
around 1.5GB — so Node grows to about 1.5GB before it feels any need to collect. On a box also running
Postgres and a second app, the kernel's OOM killer gets there first. The three kills were at 875MB, 1.46GB
and 1.6GB, which is that limit being approached rather than any single query being enormous.

A request that allocates a few hundred megabytes of short-lived objects is perfectly normal. It only
becomes fatal when nothing prompts a collection before the ceiling is reached.

### The fix
The service now runs with `NODE_OPTIONS=--max-old-space-size=640`. V8 collects as it approaches that
instead of growing until it is killed. Three consecutive passes over the four heaviest pages now sit at
**801MB, 773MB, 799MB resident** — flat, where before the same traffic climbed until the kernel intervened.

The installer writes the ceiling into the systemd unit, and `update` adds it to installs that predate it.
A unit already carrying a hand-tuned `NODE_OPTIONS` is left alone. Override with `HEAP_MB` on a larger
machine.

### On BOARD_LIMIT
Set to 1200 in `.env` during diagnosis. The code default is 2500 and, with the ceiling in place, that is
fine — remove the line from `.env` if you would rather the scanners see the full three-week window.

## 0.16.0 — lighter list queries

> The diagnosis below is wrong about the cause. The columns it blames are about 1.4KB per row in
> total, not enough to matter. See 0.16.1 for what was actually happening. The changes are still
> worth having — the pages do less work — but they are an optimisation, not the fix.

### What was thought to be happening
Not a leak, and not a cron job. `next-server` — the web server itself — was being **OOM-killed while
serving a single request**, three times, at 875MB, 1.46GB and 1.6GB. No sync or re-price was running at
the time, and the third app on the box was idle. One page view genuinely asked for a gigabyte and a half.

### Why one request could cost that much
A stored prediction carries four JSON columns: `matrix` (the 11x11 scoreline grid), `topScorelines`,
`rationale` and `features`. On a single match page they are the whole point. In a *list* they are dead
weight — and three pages were loading them for every fixture in a multi-week window:

| Page | What it loaded | At 263 competitions |
| --- | --- | --- |
| Scanner | every fixture in 21 days, full rows | ~10,000 rows x 4 blobs |
| Top 50 | up to 7 days upcoming + 7 days settled, full rows | thousands, twice over |
| Odds builder | up to 14 days, then ~20 candidate legs each | a quarter of a million objects |

This was survivable at twenty leagues. The allowlist is now 263, so the same code asks for fifty times as
much — the pages did not change, the amount of football behind them did.

### The fix
**Lists no longer load the blobs.** A new lean include drops all four columns; the single-match page still
gets them, because it is one row. Written as an exclusion rather than a list of the twenty-odd `cal*`
columns, so a market added later is carried automatically instead of silently missing everywhere.

**The two scanners that genuinely read the scoreline grid** ("1+ goals" and "Team 2+ goals") ask for it
explicitly, and a scanner handed rows without one now returns nothing rather than a wrong answer computed
from an empty grid.

**Every list query has a ceiling**, in kickoff order, so a long window trims the furthest-away fixtures
instead of failing: 2,500 fixtures for a scanner, 600 for the odds builder (which multiplies each one into
twenty-odd legs), 250 for the blend builder (which serialises every candidate into the HTML). All three are
overridable with `BOARD_LIMIT`, `BUILDER_LIMIT` and `BLEND_LIMIT` in `.env`.

Nothing visible changes. The same fixtures, the same probabilities, the same lists — the server simply
stops asking the database for four megabytes of scoreline grids it was never going to display.

### If you set FIXTURE_WINDOW_DAYS=7 as a stopgap
You can take it back out after deploying this. It was buying time by shrinking the window; the window is
no longer what costs the memory.

## 0.15.0 — hourly sync, the new markets in the scanners, and what Best value can actually show

### Every competition refreshed about every four hours
Thirteen hours was too long. Rather than raise the per-run cap — which is what stalled the machine — the
sync now runs **hourly** instead of every three hours, keeping 60 competitions per run. That is 1,440
league refreshes a day against 263 competitions: a full pass roughly every **four and a half hours**, and
every run stays small enough to be safe on 2GB.

Competitions kicking off within twelve hours still jump the queue, so the fixtures about to start are
refreshed hourly rather than every four.

Provider requests land around 4,900 a day against the 7,500 ceiling — comparable to before, because a run
of 60 costs a third of a run of 263 and there are three times as many of them.

### The three markets are in the scanners
**No win by 2+**, **Not both halves O1.5** and **No 3 in a row**, each with its own floor in Settings.
Floors are set where each market is actually selective: "not both halves" sits above 0.85 on most
fixtures and "no win by 2+" runs from 0.30 on a mismatch to 0.66 on an even game, so a floor borrowed
from the goals markets would pass everything or nothing.

The run market is listed here although it is kept out of the Top 50, and the distinction is deliberate: a
scanner is a way of browsing probabilities, while the Top 50 is a ranked list with a track record
attached. Its blurb says it can never be scored.

### New: `npm run oddscheck`
On Best value, the honest answer is that **the list can only rank a market the bookmaker prices**, and
nothing fetches a price for these three. Rather than guess at bet names, this prints every distinct bet
name in a real odds response, marks which ones `apiFootballKey` maps, and lists the rest.

That makes it a fact rather than a guess: if a bet name covering one of these exists, mapping it is one
line in `src/lib/odds.ts`; if it is absent, the feed does not price it and no code will produce a quote.
A synthesised price — deriving "no win by 2+" from the two handicap prices, say — was deliberately not
built: it would count the bookmaker's margin twice and then call the result an edge.

## 0.14.5 — the bounded run syncs what is about to kick off

Capping a run at 60 competitions made staleness the wrong queue. Nothing was being dropped — 263 over
four or five runs is a rotation, not a cap — but a league kicking off in two hours could wait behind one
whose next match is on Saturday, purely because the Saturday one happened to be synced slightly earlier.

Competitions with a fixture inside `URGENT_KICKOFF_HOURS` (default 12) now take priority, and the rest
rotate by staleness underneath them. A competition with no known fixture — never synced, or out of
season — has no urgency and sorts on staleness, which still puts a never-synced one near the front since
its `lastSyncAt` is zero.

The report says how many of the run's competitions were urgent, so a deferred remainder reads as a
rotation with the right things at the front rather than an arbitrary truncation.

## 0.14.4 — repredict could never reach zero

It counted every future fixture as outstanding, but `rateAndPredictLeague` prices only from the lock
boundary out to `FIXTURE_WINDOW_DAYS`. So fixtures beyond that window were counted as work and never
done: a single MLS fixture months ahead sat at "1 fixture(s) left" through run after run, and fixtures
inside the 15-minute lock window would have done the same until kickoff passed.

The count now uses the predictor's own window at both ends. A progress figure that cannot reach zero is
worse than no figure at all, because it reads as a failure when nothing is wrong.

## 0.14.3 — repredict counted its own work wrong and would never have finished

The filter picking competitions to re-price was `predictions: { some: { calNoRun3: null } }`. Predictions
are **append-only revisions**, so every earlier revision keeps that column null for good — which means a
fixture matched forever, the candidate list never shrank, and each run returned the same twenty
competitions. It correctly skipped almost everything the second time (`0 re-priced` against 40 upcoming),
so no harm was done; it simply could not have reached the end.

What identifies work remaining is a fixture with **no** revision carrying the markets:
`predictions: { none: { calNoRun3: { not: null } } }`.

Progress is now reported in fixtures rather than competitions, counted from the database before and after
each batch rather than subtracted from a list — the query is the only honest measure of what is left. The
figure beside each competition is the fixtures still missing the markets, not its total size.

## 0.14.2 — a sync that cannot take the machine down with it

The box is 1.9GB of RAM shared between three Next apps and Postgres. One process fitting 263 leagues
holds all of that match history at once, so it grew past the available memory and into swap — and once a
machine is thrashing, sshd cannot get scheduled either, which is why it became impossible even to log in
and stop the thing. A reboot did not help, because nothing was wrong with the machine.

Two changes, because the cap alone only makes the common case safe:

- **`MAX_LEAGUES_PER_SYNC` default 60**, down from the 80 shipped an hour ago. The run that stalled
  degraded badly somewhere past league 120 on this hardware — two to three seconds per league early on,
  twenty-nine by the hundred-and-twenty-eighth — so 60 leaves real margin. A full cycle takes four or
  five runs, half a day, which is ample for fixtures a week out.
- **`--max-old-space-size=640` on `ingest` and `repredict`.** A runaway fit now dies with a heap error
  instead of dragging everything into swap. That is a much better failure: the stalest-first ordering
  means the next run simply picks up the leagues it never reached, so a crash is self-healing, whereas a
  thrashing machine locks you out of fixing it.

## 0.14.1 — a sync that finishes, and filling new columns without one

### Fix: nothing bounded a sync run
Every three-hourly sync attempted **all 263 competitions**, and the least-recently-synced ordering was
only ever a recovery aid for a run that died partway. On a small box that is what made it crawl: in the
last run, leagues taking two to three seconds each early on were taking **twenty-nine seconds** by the
hundred-and-twenty-eighth, and the pass never finished — taking the site down with it.

`MAX_LEAGUES_PER_SYNC` (default **80**) turns that into a rotation. A full cycle completes over three or
four runs, roughly half a day, which is ample for fixtures a week out — and it cuts provider requests per
run in the same proportion. The report says how many were deferred, so a partial pass reads as a
rotation rather than a failure.

### New: `npm run repredict`
A new market means new columns, and existing predictions have them empty. `npm run ingest` fills them —
but it also re-sweeps every competition from the provider, hundreds of requests to re-download fixtures
that were already there, which is what stalled the box.

Nothing about a new market needs the provider. The probabilities come from stored ratings and stored
fixtures, so this refits each league **from the database** and rewrites only the predictions for its
upcoming fixtures. No network calls at all.

It works in batches of 20 by default, because fitting a league holds its history in memory and 263 in one
process is the problem described above. Run it until it reports nothing left; it is idempotent, since a
prediction already carrying the new markets is skipped by the revision check. Busiest competitions first,
so the leagues people actually look at fill in on the earliest batch.

## 0.14.0 — three markets read off the shape of the scoreline

All three are exact given the model: sums over cells of the matrix it already produces, with no new
parameter and no fitted coefficient, which is why they could be added without disturbing anything
already calibrated. They are deliberately **not** passed through the 1X2 calibrators either — those are
fitted on win/draw/away frequencies, and scaling a different quantity by them would be worse than
stating the model's own number.

- **No team to win by 2 or more** — `P(|home − away| ≤ 1)`, straight off the matrix. The exact complement
  of the two existing win-by-2 markets, and a test asserts it.
- **Not both halves over 1.5 goals** — uses the same half split as the existing half markets: given a
  total of n, the first half holds Binomial(n, s) of them. Both halves clear 1.5 only when between 2 and
  n−2 goals fall in the first, which needs n ≥ 4 — so low-scoring games satisfy it almost by construction
  (0.97 at 0.8/0.7 goals, 0.58 at 2.5/2.0).
- **Neither team scores 3 goals in a row** — see below.

Both of the first two are fully scoreable, ranked in the Top 50, filterable by name, usable in the odds
builder, and scored in the accuracy ledger like everything else.

### The run market is exact, and can never be scored
Conditional on the final score, every interleaving of the goals is equally likely — the standard result
that event times are i.i.d. uniform given the count, with the scoring team independent of the times. So
the probability is a counting problem, not a simulation: `Σ P(h,a) × f(h,a)`, where `f` is the share of
the `C(h+a,h)` arrangements with no run of three. `f` comes from a dynamic program **verified against
brute-force enumeration for every score up to 8–8**.

Settling it is the part that cannot be done. It needs the order the goals arrived in, and only the final
and half-time scores are stored. So it ships display-only:

- Visible on the match page and usable in the odds builder, as asked.
- `marketHit` returns null for it — always, on any result — so the accuracy ledger counts it as
  unscoreable rather than silently as a miss.
- Excluded from the Top 50 **even when selected by name**, unlike the draw. A ranked list whose entries
  can never be scored would dilute the track record beneath it, and that record is the one number here
  that has to mean something.
- The match page says so plainly, each cell is marked "unscored" where a hit or miss would go, and a leg
  of it in the builder warns that the slip will show it as unknown.

One thing worth recording: while checking the dynamic program, my own hand-worked expectation for a 4–1
scoreline was wrong and the code was right — `HHAHH` has no run longer than two, so 1 of the 5
arrangements survives, not 0. The brute-force comparison is what is being trusted here, not intuition.

## 0.13.0 — `npm run diagnose`, and the blank-site-after-install gap

A fresh install with the key added afterwards came up completely blank, with nothing anywhere saying why.
Two causes, both now addressed.

### Fix: adding the key after install started nothing
The installer only fires the first sync when a key was given **at install time**
(`if [[ -n "$API_KEY" ]]`). Adding one in Settings afterwards — the sensible order, and the one the
install prompt itself suggests — started nothing, so the site sat empty until the next three-hourly cron
tick with no indication that it was merely waiting. The installer now says so explicitly when no key was
given, and prints the two commands that follow.

### New: `npm run diagnose`
Every page here is downstream of the one before it: a provider key → leagues → fixtures → predictions →
tips. An empty board is almost never a broken board; it is the first missing link. This walks the chain
in order, names where it stops, and prints the command that fills it.

It also names the mismatch that is otherwise invisible: **`primaryProvider` defaults to `api-football`**,
so a football-data.org key saved on its own leaves the app in demo mode and no page says a word about it.
The diagnostic reports which provider is selected, which keys are saved and where from, and whether the
key that provider actually needs is among them.

And it asks the provider to prove itself **from that machine**, because a valid key on a server that
cannot reach the API produces symptoms identical to no key at all.

## 0.12.1 — stop reporting success after a failed pull

The rsync deploy path ran `git pull --ff-only || true`, so a pull that could not merge was swallowed:
rsync then copied the *unchanged* tree, the build and restart went ahead, and the script printed
"Updated and restarted" while the running app stayed on the previous version. It now stops, says nothing
was deployed, and names the two usual causes.

(Found and fixed in EdgeQuant first, where it cost a round trip of debugging a fix that was never
running. Same line, same file, same failure.)

## 0.12.0 — every market selectable, and corner odds that could never match

### The Top 50 offered nine groups, not the markets
Picking "Goals O/U" returns whichever of six goals markets is strongest per match, which is almost always
Under 4.5 — so the commonest request there is, *"show me the strongest Over 2.5 tips"*, could not be made
at all. The filter now lists **every market individually** as well as the groups: 26 markets across nine
groups, in labelled sections.

Two things the market-level filter changes beyond narrowing:

- **Asking for a market by name overrides the standing exclusion.** Draws are kept out of the mixed list
  because they would never be anyone's strongest tip — but someone selecting "Draw" is not asking for the
  mixed list, and an option that is always empty is worse than no option.
- **Asking for corners or shots shows every line.** Alternative lines are normally suppressed so one
  fixture cannot contribute a wall of near-identical tips; the whole point of selecting corners is to see
  the ladder.

Corner and shot lines are chosen per fixture, so their keys carry the line (`corners_over@10.5`) and no
fixed key would match one. A line selector therefore matches its base and side at **any** line, which is
what "corners over" means when someone asks for it.

A test asserts that every market `allMarkets` can produce has a filter option, so a market added later
cannot quietly become unreachable.

### Fix: corner odds could never match a corner tip
The model moved to a per-fixture ladder whose keys carry the line, while the odds parser still filed
corner prices under the legacy fixed key `corners_over` (8.5 by definition). A quote under that key could
never be found for a tip on `corners_over@10.5`, so **corners never appeared in the value list at all** —
not an empty market, an unmatchable one.

The line now travels in the quote key too, at whatever line the book prices, so a tip and a price meet
only when they are on the same line — the only time they are comparable. Quotes stored under the old key
are still read back, but **only** for the 8.5 line; using them for any other would be pricing the wrong
market.

Total shots stays unpriced: API-Football does not offer it prematch, so shot tips have a model probability
and no price. That is a fact about the feed, and the path is there if a quote ever arrives.

### Also
- **The value list shows up to 50**, matching the likely list. Stopping at 20 while the other showed 50
  was an inconsistency with no reason behind it.
- **An empty corners or shots list now says why.** Those lines are modelled from each team's
  match-by-match history, which is only collected for competitions inside the statistics budget. "No
  qualifying tips" was the wrong explanation for missing data, and the empty state now distinguishes them.
- The empty state names the market you selected rather than saying "tips" generically.

## 0.11.1 — a competition whose season has ended is reachable again
- **Fix: picking a league between seasons showed an empty board with nothing to click.** The "no
  fixtures on this date" helper only ever looked **forward** for the next match day, so a competition
  with nothing ahead produced no suggestion at all — and 0.10.0 made **Upcoming** the default tab, which
  a finished season can never fill. With ~265 competitions on all sorts of calendars, plenty are between
  seasons at any moment and every one of them looked broken. Found on EdgeBoard's WNBA; the same flaw
  was here.
- The board now finds the nearest day with fixtures **in either direction**, and jumping backwards
  switches to the **Finished** tab, since every match on a past day is finished.
- **The league filter now takes you somewhere with fixtures**: a competition still playing keeps the
  selected date, one whose season is over jumps to its own last match day on the Finished tab.
- **Competitions between seasons are labelled `· ended` in the filter**, so a quiet board reads as a
  finished season rather than a fault. Two grouped queries for the whole provider, not one per league.

## 0.11.0 — markets earn their place; a loading bar
- **Legs are now weighted by how well each market has actually delivered.** `Candidate.trust` existed,
  was used in the ranking and was **never once set** — always 1, so the field did nothing. The ledger
  already records each market's realised hit rate against the average probability the model put on it,
  so that ratio now becomes the weighting: a market landing 71% on calls that claimed 78% runs at 0.91
  and gets ranked behind one that keeps its promises. Markets that look good on paper no longer beat
  markets that actually deliver.
  Guarded against chasing noise: under 25 settled calls a market is ignored entirely, the ratio is
  shrunk toward neutral by sample size (half weight at 60 calls), and it is clamped to 0.75–1.08 — a
  market can be marked down hard but never promoted much, because being lucky is not being good.
  Computed over six months during the sync and stored, so the builder reads one small row instead of
  re-reading the ledger every time you change the target.
- **New Confidence control: Medium and High, or High only.** Fewer candidates, but every leg is one
  the model is most sure of.
- **A loading bar across the top of the app whenever a page is loading.** `loading.tsx` only covers a
  move to a different route, and most waiting here is the *same* route with different search params —
  switching the Upcoming/Live/Finished tab, changing the date, picking a league, moving the builder's
  target. Every page is rendered against the database, so those took a second or two with nothing on
  screen, which reads as the app having hung. Clicks are caught app-wide from one place rather than by
  wrapping every link, it clears when the page actually changes, and it times out so a cancelled
  navigation cannot leave it stuck on. Respects `prefers-reduced-motion`.

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
