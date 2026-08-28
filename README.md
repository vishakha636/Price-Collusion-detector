# Detecting Algorithmic Collusion — Stage 1: Simulation & Labelled Dataset

Independent reinforcement-learning pricing agents, with no communication and no
instruction to cooperate, are simulated to convergence. Patient agents reliably
settle above the competitive price and defend that level by punishing defection.

This stage produces the **labelled training set** for a collusion detector —
built by simulation because no ground-truth dataset of algorithmic collusion
exists. The method (simulate to generate labels, then learn from the simulation)
follows Calvano, Calzolari, Denicolò & Pastorello, *Artificial Intelligence,
Algorithmic Pricing, and Collusion*, American Economic Review 110(10), 2020.

---

## Quick start

```bash
pip install -r requirements.txt
python -m sim.generate_dataset      # ~8 min, writes data/
python -m sim.train_baseline        # ~30 s, writes data/model_report.json

# optional: pull the real scraped data through the same feature extractor
git clone https://github.com/vishakha636/Price-Collusion-detector.git \
    external/price-collusion-detector
python -m sim.real_data             # writes data/real_data.json

npm install --prefix frontend
npm run dev --prefix frontend       # dashboard at http://localhost:5174
```

`--quick` gives a fast pipeline smoke test (won't converge; for wiring only):

```bash
python -m sim.generate_dataset --quick
```

---

## Review of the original prototype

The prototype had the right shape — logit demand, tabular Q-learning, memory-1
joint state, epsilon-greedy — and the demand and profit functions were correct.
Seven issues mattered enough to change results:

| # | Issue | Why it mattered | Fix |
|---|---|---|---|
| 1 | **Price grid `[1.0, 2.0]`** hard-coded | With c=1, marginal cost was *in* the action set and most of the grid sat below the Nash price (1.4729), wasting resolution on prices no firm would set | Grid spans `[p_N − ξ(p_M − p_N), p_M + ξ(p_M − p_N)]`, computed per market (`market.price_grid`) |
| 2 | **Q-tables initialised to zeros** | All profits are positive, so any action tried early looks good and untried actions look bad — biases against exploration | Calvano's init: discounted value of uniformly random play |
| 3 | **Measuring the tail of the learning trace** | At 200k periods with β=2e-5, ε is still ~13%. The "converged" prices were mostly exploration noise, which pushed *myopic* Δ up to 0.24 and hid what the patient bots learned | Train → freeze Q-tables → separate evaluation rollout (`eval_rollout_batch`) |
| 4 | **No convergence criterion** | No way to know whether a run had actually settled | Greedy policy unchanged for 25,000 consecutive periods; now 100% of runs converge |
| 5 | **No collusion index** | `avg_price` alone is not interpretable across calibrations | Δ = (π − π_Nash)/(π_monopoly − π_Nash), against analytically solved anchors |
| 6 | **Only 40 runs, 12M rows** | 40 samples cannot train a classifier, while 12M rows of raw price data (~1 GB) is mostly redundant | 200 runs; only the converged window is kept (200k rows) |
| 7 | **`epsilon_min`/decay coupling** | `epsilon *= exp(-decay)` is equivalent to `exp(-βt)` and is fine, but β was not matched to run length, so ε never reached ~0 | β ∈ [1.8e-5, 2.4e-5] at 600k periods → ε_final ≈ 1e-6 |

Also: the pure-Python loop would have taken hours. The engine now vectorises
across **runs** (both firms stacked on one length-2R axis, chunked RNG, flat
fancy-indexing), reaching ~4.6 µs per run-period without any compiled
dependency. `numba` was tried first but its 42 MB `llvmlite` wheel could not be
downloaded in this environment.

**Validation:** on the published baseline calibration the solver returns
p_Nash = 1.4729 and p_monopoly = 1.9250, matching the AER paper to four
decimals, and patient agents reach Δ ≈ 0.69–0.80 against their reported ≈0.85.

---

## Design decisions that carry the project

### Four mechanisms, two labels

|  | competitive | collusive |
|---|---|---|
| **learned** | `q_myopic` — γ=0 Q-learners | `q_patient` — γ≈0.95 Q-learners |
| **scripted** | `br_noisy` — static best response + noise | `grim_cartel` — grim-trigger cartel |

Two mechanisms per label stops a classifier from succeeding by recognising "a
Q-learning artefact" instead of collusion. The scripted pair is the control
group.

### Learn, then measure

Learning and measurement are separated. The kept price series comes from frozen
policies executing with a small **tremble** rate (1–6% off-policy moves per firm
per period). Real pricing bots tremble constantly — stock-outs, promos, stale
competitor feeds — and without trembles a converged deterministic policy
collapses to a fixed point whose price series carries no information. With them,
the reward-punishment machinery becomes *visible*: the market gets knocked off
its cycle and has to climb back.

### Features must be computable without marginal cost

Every one of the 19 detector features comes from a two-seller price series
alone. In simulation, "is the price above Nash?" separates the classes almost
perfectly (AUC 0.999) — and is worthless, because on Amazon.in you never observe
a seller's marginal cost. A detector that needs cost can never be deployed,
which is precisely the gap the CCI flagged. Δ is therefore a **label**, never an
input.

---

## Findings

**1. Patient bots collude; myopic bots do not.** Δ = 0.688 vs 0.196 (n=60 each),
100% converged. The gap is learned purely from experience — the agents never
communicate and observe only last period's prices.

**2. Myopic Q-learners do not sit at Δ=0, and this is not a bug.** They average
0.196 because memory-1 agents converge to price *cycles* rather than fixed
points: at 1.2M periods only 5% reach a fixed point and 80% land in cycles of
length ≥3, and doubling run length does not move Δ (0.190 at 1.2M vs 0.196 at
600k). The one run that reaches the discrete-grid Nash has Δ = −0.024, the
theoretical floor. This is the Edgeworth-cycle behaviour reported by Klein
(2021). **Consequence: competitive bots also price above cost, so price level
alone cannot separate the classes.**

**3. One feature had to be discarded as a simulation artefact.**
`level_over_min` (typical price ÷ cheapest price observed) scores AUC 0.994 —
but only because the price grid is constructed to span exactly
[Nash, monopoly], so a collusive run sits at the top of its grid while its
trembles reach down to the competitive price, recovering p_monopoly/p_Nash
almost by definition. Real prices come from no such grid. It is excluded from
all headline numbers and from training, and shown greyed-out in the dashboard
rather than deleted.

**4. A cost-free detector works in-distribution.** Logistic regression on
dynamics-only features: AUC 0.987 (5-fold CV, 200 markets). On the hardest split
— myopic vs patient Q-learners only, where price level is deliberately
confounded — AUC 0.973.

**5. Negative result: transfer across mechanisms fails in one direction.**
Training on the scripted controls and testing on the learned markets collapses
to **AUC 0.430**, at or below chance. A hand-written grim-trigger cartel and an
autonomously learned one do not share a signature: the scripted cartel is
identifiable mainly because both sellers post *identical* prices, which is not
how the Q-learners sustain their outcome. The reverse direction (train on
learned, test on scripted) reaches 1.000 for logistic regression but only 0.752
for gradient boosting.

**6. Caveat on the boosted model.** Permutation importance concentrates almost
entirely in the between-seller price gap (`rel_gap_max`, +0.066); shuffling any
other feature barely moves AUC. The model found one shortcut that works on this
dataset. Because the gap between sellers is partly a function of simulated grid
width, this needs stress-testing against grid width and seller count before the
method is pointed at real data.

---

## Real scraped data (section 08)

`sim/real_data.py` consumes `combined_prices.csv` from the collection repo
([vishakha636/Price-Collusion-detector](https://github.com/vishakha636/Price-Collusion-detector),
cloned into `external/`) and pushes it through the *same* feature extractor the
model was trained on. The pipeline connects end to end — but **0 of 5 candidate
markets are usable**, for two different reasons that need two different fixes.

**7. The fuel "price parallelism" is an artefact of data construction.**
`fuel_scraper.parse_prices` reads one city price off an aggregator page and then
writes it three times, once per PSU label:

```python
if price is not None:
    for seller in FUEL_SELLERS:      # IOCL, BPCL, HPCL
        ... "seller": seller, "price": price
```

So IOCL/BPCL/HPCL are three copies of one number. Price correlation 1.000 and
exact-matching 1.000 on those pairs are **arithmetic identities** — a column
compared with itself — and would appear regardless of what the real market did.
`real_data.py` now detects series that are identical at every observation and
refuses to count them as comparable markets. Reporting that as detected
collusion between three named state-owned companies would be statistically void
and defamatory. More days cannot fix it; the scraper needs a source that lists
each PSU separately, or the per-seller split should be dropped and fuel kept as
a city-level series only.

**8. E-commerce needs a scraper redesign, not more days.** On an Amazon product
page the recorded seller is whoever holds the Buy Box, so each ASIN yields
exactly one seller per day. Of 216 products, 8 ever show a second seller — and
those appear on *different* days, because the Buy Box changed hands rather than
because two rivals were observed at once. Best same-date overlap across all 216
products is **1 day**, so no simultaneous price pair exists. Fix: scrape the
all-offers listing per ASIN (the "Other sellers on Amazon" panel).

**9. Secondary data-quality flag.** Bengaluru, Delhi and Mumbai return
byte-identical petrol series on all five days, though their debug HTML differs.
Indian retail fuel prices vary by city because state VAT does, so the city
parameter is likely not reaching the parsed value — only 3 of 5 cities carry
independent information.

The dashboard reports **no risk scores** for real data, deliberately: at 5
observed periods against the 1,000 the model trained on, and with no valid
seller pair, any number would be indistinguishable from noise. Two gates are
shown explicitly (valid multi-seller panel; sufficient series length), both
currently failing.

Note that `run_pipeline.py` in the cloned repo drives live scrapers against
Amazon and an aggregator site and needs Selenium/chromedriver. This project only
reads the committed `combined_prices.csv`; it never runs those scrapers.

---

## Layout

```
sim/
  market.py             logit demand; Nash & monopoly solvers; price grid
  engine.py             Q-learning (vectorised over runs), rollouts, controls
  features.py           19 cost-free features + diagnostics; feature tiers
  generate_dataset.py   train -> deploy -> probe; writes data/
  train_baseline.py     3-way evaluation + permutation importance
  real_data.py          real scraped data -> same features; readiness gates
data/
  run_summary.csv       200 markets x 41 columns (the dataset)
  price_series.csv      200,000 observed price observations
  dashboard.json        frontend payload
  model_report.json     detector evaluation
  real_data.json        real-data panel, diagnostics, readiness
external/
  price-collusion-detector/   cloned scraping repo (data source, not run here)
frontend/               Vite + React dashboard (9 sections)
```

### Method notes

- **Anchors.** Nash by bisection on `c + μ/(1−q(p)) − p`; monopoly by
  golden-section search on joint profit. The fixed-point iterations in the
  prototype diverge for some randomised (a, μ) draws — verified stable across
  400 random calibrations.
- **Randomisation.** Each market draws μ ∈ [0.20, 0.30], a ∈ [1.9, 2.1],
  grid size k ∈ {9, 11, 15}, α ∈ [0.08, 0.22], and (for patient agents)
  γ ∈ [0.90, 0.97], so the detector cannot latch onto one calibration.
- **Probe.** After convergence, one firm is forced to the competitive price for
  a single period; both then revert to policy. Punishment depth and recovery
  time are recorded. This is a simulation-only diagnostic, not a feature.

---

## Stage 2 and 3

Stage 2 must train on *learned* collusion rather than scripted cartels (finding
5), widen the mechanism pool, and add SHAP explanations. Grid width and seller
count need ablations before finding 6 can be trusted.

Stage 3 is blocked on data collection, in this order:

1. Fix the fuel scraper to parse each PSU's price separately, or drop the
   per-seller split (finding 7).
2. Switch the e-commerce scraper to the all-offers listing so rival sellers land
   in one snapshot (finding 8).
3. Verify city-level differentiation (finding 9).
4. Only then does running the collector longer buy anything — roughly 60
   periods, i.e. 15 days at four snapshots a day.

### Known limitations

- Two sellers only; real marketplaces have many.
- Prices are drawn from a discrete grid; real prices are near-continuous.
- No demand or cost shocks in the Q-learning runs, so observed volatility comes
  only from trembles. Real series carry seasonality and cost pass-through.
- Both agents share an algorithm family within a run; real markets mix them.
