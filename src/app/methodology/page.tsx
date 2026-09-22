import { Card, SectionTitle } from "@/components/ui";
import { MODEL_VERSION, HALF_LIFE_DAYS, DEFAULT_RHO, CALIBRATION_MIN_N, ISOTONIC_MIN_N } from "@/lib/model/constants";
import { dataMode } from "@/lib/mode";

export const metadata = { title: "Methodology" };
const F = ({ children }: { children: React.ReactNode }) => <pre className="num my-2 overflow-x-auto rounded-lg bg-black/30 p-3 text-[12px] leading-relaxed text-slate-200">{children}</pre>;

export default async function Methodology() {
  const mode = await dataMode();
  return (
    <div className="max-w-3xl space-y-4 text-sm leading-relaxed text-slate-300">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-50">How the numbers are made</h1>
        <p className="mt-1 text-slate-400">Model <span className="num text-edge">{MODEL_VERSION}</span>. Every user sees the same output. Data source: {mode.demo ? "demo (simulated)" : mode.provider.toLowerCase().replace("_", "-")}.</p>
      </header>
      <Card>
        <SectionTitle>What we optimise</SectionTitle>
        <p>Probability quality, scored by Brier and log loss on 1X2. Not raw hit-rate. A model that says 55% should win about 55% of the time.</p>
        <F>{`Brier = mean over matches of Σ_k (p_k − o_k)²,  k ∈ {home, draw, away}
LogLoss = mean of −ln p_outcome`}</F>
        <p>Baselines on the Accuracy page: always-home, league-table favourite, and de-vigged closing odds when an odds feed exists.</p>
      </Card>
      <Card>
        <SectionTitle>1. Team ratings</SectionTitle>
        <p>Each team gets attack α and defence β per league-season from recency-weighted history, preferring xG, then shots, then goals.</p>
        <F>{`w = exp(−ln2 · days_ago / ${HALF_LIFE_DAYS})
E[home goals] = c · a_H · d_A · γ     E[away goals] = c · a_A · d_H
fit by weighted iterative scaling, mean(a) = mean(d) = 1
α = c · a,  β = d,  γ = league home advantage (fit per league)
shrinkage: 4 pseudo-matches at league average per team`}</F>
      </Card>
      <Card>
        <SectionTitle>2. Expected goals for a fixture</SectionTitle>
        <F>{`λ_H = α_H · β_A · γ_league · φ_rest_H · φ_news_H
λ_A = α_A · β_H · φ_rest_A · φ_news_A
φ_rest = clamp(1 + 0.012 · (rest_days − 4), 0.95, 1.03), 1 if unknown
φ_news = max(0.88, 1 − 0.04 · confirmed starter absences), 1 if unknown`}</F>
        <p>Injuries are never guessed. Missing lineups set φ_news = 1 and add the flag missing_news, which lowers confidence.</p>
      </Card>
      <Card>
        <SectionTitle>3. Scorelines (Dixon–Coles)</SectionTitle>
        <F>{`P(i, j) ∝ Pois(i; λ_H) · Pois(j; λ_A) · τ(i, j)
τ(0,0) = 1 − λ_H λ_A ρ     τ(0,1) = 1 + λ_H ρ
τ(1,0) = 1 + λ_A ρ         τ(1,1) = 1 − ρ      τ = 1 elsewhere
matrix 0..10 × 0..10, renormalised to sum to 1
ρ per league: weighted ML grid search on [−0.25, 0.10],
shrunk toward ${DEFAULT_RHO} with 200 prior matches`}</F>
        <p>1X2, double chance, Over/Under 1.5–4.5, both teams to score (yes/no), win by 2+ goals and the European handicap table are all sums over this one matrix, so they are always consistent with each other. PitchEdge does not publish a correct-score call: even the most likely scoreline (often 1–1 or 1–0) happens only about 10–13% of the time.</p>
      </Card>
      <Card>
        <SectionTitle>Corners and total shots</SectionTitle>
        <F>{`separate count model per league (same form as goals):
E[home] = c · a_H · d_A · γ      E[away] = c · a_A · d_H     (half-life 120 days, 6 pseudo-matches shrinkage)
total ~ negative binomial with matching mean and variance
P(over 8.5 corners), P(over 24.5 shots) = 1 − CDF(8), 1 − CDF(24)`}</F>
        <p>Needs per-match statistics, which only API-Football supplies here. They are collected a few dozen matches per sync; predictions appear once a league has 80 matches with stats. Not yet calibrated.</p>
      </Card>
      <Card>
        <SectionTitle>4. Calibration</SectionTitle>
        <p>Fitted separately for 1X2 (one-vs-rest, then renormalised), O/U lines and BTTS, from locked predictions that have settled.</p>
        <F>{`n < ${CALIBRATION_MIN_N}          identity (raw probabilities shown)
${CALIBRATION_MIN_N} ≤ n < ${ISOTONIC_MIN_N}    10 equal-count buckets, shrunk toward the diagonal, made monotone
n ≥ ${ISOTONIC_MIN_N}          isotonic regression (pool-adjacent-violators), lightly shrunk`}</F>
        <p>Both raw and calibrated probabilities are stored with the model version. Unders are shown as 1 − calibrated over for the same line, so over and under always add to 100%.</p>
      </Card>
      <Card>
        <SectionTitle>5. Confidence</SectionTitle>
        <F>{`100 − sample penalty (≤30) − 15 if news missing − 20·league volatility
    − 5 if rest gap ≥ 3 days − min(15, 100·calibration residual)
High: ≥ 70, both sides ≥ 8 effective matches, 1X2 margin ≥ 0.15, news complete
Medium: ≥ 45     Low: below. Low calls never display 90% or more.`}</F>
      </Card>
      <Card>
        <SectionTitle>6. Lock, settle, score</SectionTitle>
        <p>Every call is locked at <b>kickoff − 15 minutes</b>: the latest prediction made before that moment is stamped and can never be edited. Nothing is re-predicted inside the lock window. After full time the score is appended as a result; a later correction is appended too, never overwritten. The Accuracy page and every track record use locked calls only.</p>
        <F>{`jobs: fixtures/stats/odds/predict every 3 h · lock every 5 min · results every 15 min (only when a match should have ended)
baselines: always-home (p = 1,0,0) · league-table favourite (0.50 / 0.27 / 0.23) · bookmaker closing odds with the margin removed
calibration refit after each sync from locked + settled calls (identity until 50)`}</F>
      </Card>
      <Card>
        <SectionTitle>Club strength across leagues</SectionTitle>
        <p>Champions League, Europa League and Conference League matches are rated in one pool with every domestic league result (matched by club id), so a club&apos;s cup rating reflects its whole season. Links between leagues come from the European matches themselves. Domestic matches are still predicted with each league&apos;s own fit and home advantage.</p>
      </Card>
      <Card>
        <SectionTitle>Promoted teams and the early season</SectionTitle>
        <F>{`team with < 6 matches in this league → prior from its record in the league it came from:
  came up a tier    a = 0.85·√a_prev   d = 1.15·√d_prev
  came down a tier  a = 1.12·√a_prev   d = 0.90·√d_prev
  no record found   top flight: a = 0.85, d = 1.15 (typical promoted side)
prior weight = 8 pseudo-matches, so real results take over within ~8–10 games
last season's matches keep 85% weight; "early season" flag and −8 confidence until both sides have 6 matches`}</F>
      </Card>
      <Card>
        <SectionTitle>Value list</SectionTitle>
        <F>{`edge = model probability × median bookmaker odds − 1
qualifies: Medium/High confidence, p ≥ 35%, odds 1.40–6.00, edge ≥ 3%; one tip per match, ranked by edge
track record: flat 1-unit stakes at the odds available before the lock`}</F>
        <p>Edges are estimates: if the model is miscalibrated, edges are overstated. Watch the value track record and the bookmaker baseline on the Accuracy page.</p>
      </Card>
      <Card>
        <SectionTitle>Slips and booking codes</SectionTitle>
        <p>Slips multiply leg probabilities as if independent (they rarely are) and show fair odds 1/p. Sportybet codes are requested through the endpoints Sportybet&apos;s own website uses; there is no official API, so a leg that can&apos;t be mapped is listed as unbookable, never dropped silently. PitchEdge never places bets.</p>
      </Card>
      <Card>
        <SectionTitle>What the language model does</SectionTitle>
        <p>Nothing numeric. It may reword the four “why this call” bullets built from the features above; any rewrite that changes a number is discarded.</p>
      </Card>
    </div>
  );
}
