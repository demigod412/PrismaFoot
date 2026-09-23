# PitchEdge

Calibrated football probabilities with a public, append-only accuracy ledger. Same model output for every user. Not a bookmaker, not a tipster club, and it does not guarantee outcomes.

Model: **dc-xg-cal-v1** — recency-weighted team ratings → Dixon–Coles scoreline matrix → per-market calibration. The language model never produces numbers.

## Quick start (demo mode)

```bash
cp .env.example .env.local        # leave provider keys empty for demo
npm install
npm run db:up                     # Postgres 16 via docker compose
npx prisma db push
npm run db:seed                   # fictional clubs, simulated results, real engine output
npm run dev
```

## Live data

1. Set `FOOTBALL_DATA_API_KEY`, `API_SPORTS_KEY` (or `RAPIDAPI_KEY`), or `SPORTMONKS_TOKEN` in env, **or** save them from **Settings → Data sources** (needs `SETTINGS_PIN` and `SETTINGS_ENCRYPTION_KEY`; keys are AES-256-GCM encrypted in `AppSetting`). Env always wins.
2. Pick the primary provider (`PRIMARY_PROVIDER` or the Settings select). Use **Test connection**.
3. `npm run ingest` (or the Vercel cron `GET /api/cron/ingest` with `Authorization: Bearer $CRON_SECRET`, every 3h). It syncs the allowlisted leagues in `src/lib/leagues.ts`, 365 days of history + 14 days ahead, then rates and predicts.

Pages only read Postgres. Vendor APIs are called only from the ingest pipeline on the server.

## Layout

```
prisma/schema.prisma              data model (append-only predictions/results)
src/lib/model/                    the engine — pure TS, no I/O
  ratings.ts                      α/β/γ fit, recency weights, shrinkage, ρ fit, volatility
  dixonColes.ts                   τ, matrix, markets, top scorelines
  calibration.ts                  identity / bucket / isotonic (PAV)
  confidence.ts                   0–100 score and High/Medium/Low
  predict.ts                      λ with φ_rest/φ_news, flags, Low-band cap, rationale, inputs hash
  rationale.ts                    4 bullets from features (+ number-preservation guard for LLM polish)
src/lib/providers/                football-data, api-football, sportmonks adapters (+ types, http)
src/lib/pipeline/                 ingest → rate → predict
src/lib/demo/                     deterministic demo generator
src/app/                          App Router pages, manifest.ts, sw.ts (Serwist)
tests/                            vitest — engine invariants
scripts/backtest-synthetic.ts     walk-forward Brier/log loss vs baselines on simulated leagues
```

## Phase status

| Phase | Scope | Status |
|---|---|---|
| 0–2 | Prisma, PWA, Settings, demo, date board, match page, scanners, methodology | done |
| 3 | T-15 lock, results + settle (append-only), calibration refit, Accuracy page with baselines | done (0.5.0) |
| 4 | Slip workshop: save, optimise, split, merge, copy | done (0.5.0) |
| 5 | Sportybet booking codes (best effort, unofficial endpoints) | done (0.5.0) |
| — | Top 20 (most likely / best value), cross-league club ratings, promoted-team priors | done (0.5.0) |
| 6 | xG ratings, 1X2 blend, Ask page | not started |

## Odds builder

`/builder` — choose a target price and a window; the app assembles the best combination, with two alternatives, a 14-day track record at that target, and Save as slip / Copy / Sportybet code. Legs: one per match, ≤ 2 per competition, ≤ 2 per market type. With no bookmaker odds the fair odds are used, so the target sets the chance (3.0 ≈ 1 in 3, 100 ≈ 1 in 100).

## Operations (Lightsail)

App folder `/var/www/pitchedge` · repo `~/PrismaFoot` · site `https://pitch.<your-domain>`

### Everyday commands
```bash
# Sync now (own process, site stays fast; 5–8 min on football-data.org)
cd /var/www/pitchedge && sudo -u ubuntu npm run -s ingest

# Ledger checks (locks, results, accuracy). Add -- --demo for a full pipeline test on demo data.
cd /var/www/pitchedge && sudo -u ubuntu npm run selfcheck

# Service and logs
sudo systemctl status pitchedge
sudo journalctl -u pitchedge -f          # app log
tail -f /var/log/pitchedge-cron.log      # scheduled jobs
cat /etc/cron.d/pitchedge                # the schedule itself
```
Scheduled automatically: full sync every 3 hours, lock every 5 minutes, results every 15 minutes.

### Adding or changing keys
**Easiest: Settings → unlock with your PIN** (`/settings`) — provider keys, primary provider, scanner floors, access code. Save, then run a sync.

**A key in `.env` always wins over Settings**, and the installer writes the provider key there:
```bash
sudo nano /var/www/pitchedge/.env        # edit, Ctrl+O, Enter, Ctrl+X
sudo systemctl restart pitchedge
cd /var/www/pitchedge && sudo -u ubuntu npm run -s ingest
```
Or in one line:
```bash
sudo sed -i "s|^FOOTBALL_DATA_KEY=.*|FOOTBALL_DATA_KEY=your_new_key|" /var/www/pitchedge/.env && sudo systemctl restart pitchedge
```

| `.env` line | What it does |
|---|---|
| `FOOTBALL_DATA_KEY=` | football-data.org key (free plan: 12 competitions, 10 requests/minute, no odds or match stats) |
| `API_FOOTBALL_KEY=` | API-Football key (paid: odds, corners/shots, ~60 extra leagues) |
| `PRIMARY_PROVIDER=` | `football-data`, `api-football` or `sportmonks` — only this one is used |
| `FIXTURE_WINDOW_DAYS=21` | how far ahead fixtures are fetched and predicted |
| `PREDICTION_LOCK_MINUTES=15` | when a call locks before kick-off |
| `SPORTYBET_ENABLED=false` | switch off booking codes |
| `SETTINGS_PIN=` / `CRON_SECRET=` | Settings PIN · protects the scheduled-job URLs |

Switching provider: set it in Settings (or `PRIMARY_PROVIDER`), restart, then sync. The site keeps showing the current data until the new provider's first sync succeeds.

### Updating the code
```bash
cd ~/PrismaFoot && git pull
sudo bash ./setup-lightsail.sh update pitchedge
```
From a zip: unzip to `/tmp/pe`, `rsync -a --delete --exclude .git --exclude node_modules --exclude .env /tmp/pe/pitchedge/ ~/PrismaFoot/`, commit, push, then the update command above.

### Access code
Set, change or remove it in **Settings → Access code** (PIN-protected, always reachable). It covers every page, locks again after 30 minutes of inactivity, and locks the form for 5 minutes after 5 wrong tries.

### When something looks wrong
| What you see | What it means |
|---|---|
| `football-data 429` | free tier allows 10 requests/minute; the sync waits and reloads those seasons next run |
| `"predictions":0` | nothing scheduled within the fixture window (international break, off-season) |
| empty corners / shots | needs match statistics: API-Football only |
| empty value list | needs bookmaker odds: API-Football only |
| `"newcomers":n` | promoted/relegated teams starting from their previous league's record |
| demo banner showing | no successful live sync yet — run the sync |

## Checks

```bash
npm test                               # engine invariants
npx tsx scripts/backtest-synthetic.ts  # model vs always-home vs table favourite
npm run typecheck
```

Known limits in v1: football-data.org free tier has no lineups/injuries/xG, so every call carries `missing_news` and can reach at most Medium confidence. API-Football injury lists mark news as checked, but φ_news stays 1 until starter-level players can be identified from lineup history (Phase 3) — the model never guesses who is a starter.
