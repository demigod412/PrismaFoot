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
| 0 | Prisma, PWA shell, Settings key form, DEMO seed | done |
| 1 | Date board, match page, dc-xg-cal-v1 on goals | done |
| 2 | Scanners, 14-day window, methodology | done |
| 3 | Scheduled ingest, T-15 lock, settle, Accuracy page | schema + cron route + calibration fitter ready; lock/settle jobs next |
| 4 | Slip workshop | Blend builder with combined p, fair odds and copy text is live; saved slips next |
| 5 | Booking-code adapters | not started |
| 6 | xG ratings (Sportmonks adapter already maps xG), 1X2 blend, Ask page | not started |

## Checks

```bash
npm test                               # engine invariants
npx tsx scripts/backtest-synthetic.ts  # model vs always-home vs table favourite
npm run typecheck
```

Known limits in v1: football-data.org free tier has no lineups/injuries/xG, so every call carries `missing_news` and can reach at most Medium confidence. API-Football injury lists mark news as checked, but φ_news stays 1 until starter-level players can be identified from lineup history (Phase 3) — the model never guesses who is a starter.
