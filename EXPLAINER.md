# What this project actually is — explained from zero

Written to be read start to finish, assuming you know nothing about game theory
or reinforcement learning. Every term is defined where it first appears.

**Contents**

1. [The one-paragraph version](#1-the-one-paragraph-version)
2. [The real-world problem](#2-the-real-world-problem)
3. [Why the law struggles with this](#3-why-the-law-struggles-with-this)
4. [The central obstacle: no labelled data exists](#4-the-central-obstacle-no-labelled-data-exists)
5. [The simulated market, from scratch](#5-the-simulated-market-from-scratch)
6. [The two reference prices that make everything measurable](#6-the-two-reference-prices-that-make-everything-measurable)
7. [Delta: collusion as a single number](#7-delta-collusion-as-a-single-number)
8. [The bots: Q-learning from scratch](#8-the-bots-q-learning-from-scratch)
9. [Why patience causes collusion](#9-why-patience-causes-collusion)
10. [How one simulated market runs: train, deploy, probe](#10-how-one-simulated-market-runs-train-deploy-probe)
11. [The four mechanisms and why there are four](#11-the-four-mechanisms-and-why-there-are-four)
12. [The features: the real research contribution](#12-the-features-the-real-research-contribution)
13. [Results, including the ones that went badly](#13-results-including-the-ones-that-went-badly)
14. [The real scraped data](#14-the-real-scraped-data)
15. [File-by-file code walkthrough](#15-file-by-file-code-walkthrough)
16. [Glossary](#16-glossary)
17. [Viva questions you should be able to answer](#17-viva-questions-you-should-be-able-to-answer)

---

## 1. The one-paragraph version

Online sellers increasingly set prices with software rather than by hand. Recent
economics research showed something alarming: if two such programs are simple
reinforcement learners and they repeatedly price against each other, they can
*learn on their own* to keep prices high — behaving like a cartel — without ever
communicating and without anyone programming them to do it. India's competition
regulator flagged this in 2025 and admitted it has no technical tool to detect
it. This project builds the missing detector. Because nobody knows which real
markets actually contain colluding bots, there is no labelled data to learn
from, so stage 1 (what we have built) **manufactures** the labelled data by
simulating pricing bots whose collusiveness we control, extracts statistical
fingerprints from their price histories, and trains a classifier to tell
collusive price patterns from competitive ones. Critically, the fingerprints use
*only* observable prices — never production cost — because on a real e-commerce
site you can never see a seller's cost.

---

## 2. The real-world problem

Imagine two shops selling the same phone charger on Amazon. Each uses a pricing
program that checks the rival's price and adjusts its own, many times a day. No
human is involved in the individual decisions.

Normal competition would push prices down. If I charge ₹700 and you charge ₹650,
customers drift to you, so I cut to ₹640, you cut to ₹630, and so on until
neither of us can profitably go lower. That downward pressure is the entire
benefit consumers get from competition.

But a program that *learns from experience* can discover a different strategy.
Suppose it notices, over thousands of rounds, that every time it cuts its price,
the rival's price drops too, and both end up earning less for a long stretch
afterwards. A learning program will eventually stop cutting. And if both programs
independently learn that lesson, prices stay high permanently — the same outcome
as an illegal price-fixing cartel, reached with no meeting, no email, no
agreement, and no intent.

This is called **algorithmic collusion** or **tacit algorithmic collusion**. The
landmark demonstration is Calvano, Calzolari, Denicolò and Pastorello,
*"Artificial Intelligence, Algorithmic Pricing, and Collusion"*, American
Economic Review, 2020. They showed standard Q-learning agents reliably reach
supra-competitive prices and, more strikingly, that they develop
**reward–punishment strategies**: if one deviates by cutting price, the other
punishes with its own price cut for a few rounds, then both return to the high
price. Nobody wrote that behaviour. It was learned.

---

## 3. Why the law struggles with this

Competition law in most countries, India included, prohibits *agreements* that
fix prices. Section 3 of India's Competition Act targets agreements and concerted
practices. The legal test asks: was there a meeting of minds?

With algorithmic collusion there is no agreement to find. There is no
communication to subpoena. Each firm can honestly say "I bought pricing software,
I never instructed it to coordinate, and I don't know why it does what it does."
The harm to consumers is identical to a cartel's, but the legal hook is missing.

The Competition Commission of India (CCI) has publicly acknowledged this gap and
noted it lacks the technical means to detect the behaviour. That is the practical
motivation: if you cannot prove an agreement, the only remaining route is to
detect the *behavioural signature* in the price data itself. That signature is
what this project tries to learn.

---

## 4. The central obstacle: no labelled data exists

To train any classifier you need examples with known answers — "this market was
colluding", "this one was competing". This is called **labelled data**.

For algorithmic collusion, that dataset does not exist anywhere on Earth. If you
scrape a million Amazon listings, you have prices but no labels: nobody knows
which of those sellers' algorithms had tacitly learned to collude. And you can't
ask, because the sellers themselves don't know.

So the project does what the economics literature does: **generate the labelled
data by simulation**. We build a small artificial market, put pricing bots in it,
and control the one setting that determines whether they collude. Because we set
that dial ourselves, we know the true label for every simulated market with
certainty. Then we learn the statistical fingerprint from the simulation and,
later, carry that fingerprint to real data.

This is the same logic as training a medical image classifier partly on
synthetic images: you accept a reality gap in exchange for perfect labels. The
reality gap is the project's main scientific risk, and much of the care in the
design goes into narrowing it.

---

## 5. The simulated market, from scratch

The artificial market has **two sellers** and **one product**, repeated for
hundreds of thousands of rounds. Each round, both sellers simultaneously pick a
price, then customers split between them, then each earns a profit.

We need a rule saying how many customers each seller gets given the two prices.
The project uses **logit demand**, standard in economics:

```
q_i  =        exp( (a − p_i) / μ )
       ─────────────────────────────────────────────
       exp((a − p_0)/μ) + exp((a − p_1)/μ) + exp(a₀/μ)
```

That looks intimidating; the intuition is simple. Read it as: **each seller's
share of customers depends on how attractive its price is compared to the
alternatives** — the rival, and the option of buying nothing.

The parameters:

| Symbol | Name | Meaning in plain words |
|---|---|---|
| `a` | quality index | How much people want this product. Higher `a` = more demand at any price. Set to 2. |
| `a₀` | outside option | Attractiveness of buying nothing at all. Set to 0. |
| `μ` (mu) | differentiation | How *interchangeable* the two sellers are. |
| `c` | marginal cost | What it costs to supply one unit. Set to 1. |

`μ` is the important one. If `μ` were near zero, the products would be perfect
substitutes: the cheaper seller takes literally every customer, and a ₹1
difference is fatal. As `μ` grows, customers care less about price differences —
brand loyalty, delivery speed, trust — so being slightly more expensive costs you
only some customers, not all. The project uses μ = 0.25, so the sellers are
similar but not identical. That matters because with perfect substitutes there
is no interesting pricing behaviour to learn.

Profit for a seller is then just:

```
profit_i = (p_i − c) × q_i
```

margin per unit × number of units. If you price at cost, you earn nothing. If you
price extremely high, your margin is big but `q_i` collapses toward zero. So
there is a best price somewhere in the middle — and where exactly it is depends
on what your rival does. That interdependence is the whole game.

---

## 6. The two reference prices that make everything measurable

Before we can say a market is "colluding", we need to know what competition and
what perfect collusion would look like *in this exact market*. Both are computed
mathematically, not guessed.

### The competitive price (Bertrand-Nash)

A **Nash equilibrium** is a situation where neither player wants to change their
choice given what the other is doing. For prices, this is the **Bertrand-Nash
price**: each seller is already charging its best possible price given the
rival's price, so nobody has any reason to move.

You find it from the first-order condition (set the derivative of profit to zero):

```
p = c + μ / (1 − q)
```

Solving this gives **p_Nash = 1.4729**, with each firm earning **0.2229** per
round. This is the honest-competition benchmark.

### The perfect-cartel price (monopoly)

Now suppose the two sellers merged, or formed a perfect cartel, and jointly chose
one price to maximise their *combined* profit. They would raise the price,
because neither is now trying to steal customers from the other.

Maximising total profit `2 × (p − c) × q(p)` gives **p_monopoly = 1.9250**, with
each firm earning **0.3375** — about 51% more than under competition.

### Why this matters enormously

These two numbers, 1.4729 and 1.9250, are the entire measurement apparatus. They
are exact, derived from the demand model, and they reproduce the values published
in Calvano et al. (2020) to four decimal places — which is how we know the
implementation is correct. Run `python sim/market.py` and you will see them.

A technical note worth knowing for the viva: the original code solved these by
"fixed-point iteration" (repeatedly plugging the answer back into the formula),
which **diverges** for some parameter values. They are now solved by bisection
(for Nash) and golden-section search (for monopoly), which are guaranteed to
converge. This was verified across 400 random parameter settings.

---

## 7. Delta: collusion as a single number

With two anchors we can place any market on a scale. The **collusion index**,
written Δ (delta), is:

```
Δ  =    (actual profit − profit at Nash)
      ──────────────────────────────────────
      (profit at monopoly − profit at Nash)
```

- **Δ = 0** → the market earns exactly what competition predicts. Competitive.
- **Δ = 1** → the market earns exactly what a perfect cartel would. Fully collusive.
- **Δ = 0.7** → the market captured 70% of the way from competition to cartel.

This single number lets us compare markets with different demand parameters on
one common scale, and it is the standard measure in this literature. Calvano et
al. report Δ ≈ 0.85 for their patient bots; ours reach 0.688–0.80, which is the
same phenomenon at similar magnitude.

**Δ is a label, never an input to the detector.** Remember this — it is the
single most important design decision in the project, and section 12 explains
why.

---

## 8. The bots: Q-learning from scratch

**Q-learning** is one of the oldest and simplest reinforcement learning methods.
No neural networks are involved. It is a lookup table.

### The table

The bot keeps a table called Q with one number for every (situation, action)
pair. `Q[situation, action]` is the bot's current estimate of *"how much total
future profit do I get if I'm in this situation and take this action?"*

For our pricing bot:

- **Situation** (called the **state**): the pair of prices both sellers posted
  *last round*. That's all the memory it has — one round. If prices come from a
  grid of 15 options, there are 15 × 15 = 225 possible states.
- **Action**: which of the 15 prices to post now.
- **Reward**: the profit earned this round.

So the table has 225 × 15 = 3,375 entries per bot. Both bots have their own
table and cannot see the other's.

### The learning rule

After each round the bot nudges one entry of its table:

```
Q[s, a]  ←  Q[s, a]  +  α × [  r  +  γ × max Q[s', ·]  −  Q[s, a]  ]
                            └────────────────────────┘   └───────┘
                             what I now think it's worth   what I
                                                           thought
```

Term by term:

- `s` = the state I was in, `a` = the action I took, `r` = the profit I got.
- `s'` = the state I ended up in (i.e. the prices we both just posted).
- `max Q[s', ·]` = the best I think I can do from that new state onward.
- **`α` (alpha, learning rate, 0.08–0.22 here)** = how big a step to take. Near
  0 means barely learn; near 1 means overwrite the old estimate entirely.
- **`γ` (gamma, discount factor)** = how much I value future profit versus
  profit right now. **This is the dial that controls collusion.**

The bracketed part is the **prediction error**: the difference between what the
bot now believes the action was worth and what it previously believed. Learning
is just repeatedly shrinking that error.

### Exploration: epsilon-greedy

If the bot always picked the action its table currently rates highest, it would
lock onto whatever it tried first and never discover better options. So it
explores:

- With probability **ε (epsilon)**, pick a completely random price.
- Otherwise, pick the price with the highest Q value.

ε starts at 1 (all random) and decays as `ε = exp(−β·t)` where t is the round
number. With β ≈ 2×10⁻⁵ and 600,000 rounds, ε ends around 0.000001 — effectively
zero. Early on the bot is wildly experimental; by the end it is exploiting what
it learned. This decay schedule matters a lot, as section 13 explains.

---

## 9. Why patience causes collusion

This is the conceptual heart of the project. Understand this and you understand
the result.

Recall the real anchors: at the cartel price each firm earns **0.3375** per
round; at the competitive price each earns **0.2229**.

Now suppose both bots have been posting the high cartel price, and one bot
considers **undercutting** — dropping its price to steal the rival's customers.

**What it gains:** a one-off spike. For a single round it captures most of the
market and earns well above 0.3375.

**What it costs:** the rival's learned policy reacts. Its price drops too. They
spend several rounds in a price war earning about 0.2229 each before drifting
back up.

Now the decision depends entirely on γ:

**Myopic bot (γ = 0).** The `γ × max Q[s', ·]` term vanishes. The bot literally
cannot represent future consequences — its table only ever learns immediate
profit. It compares the one-round spike against 0.3375 and undercuts. Every
time. So myopic bots compete.

**Patient bot (γ = 0.95).** Future profit is discounted but not ignored. A useful
way to see the weight of the future: an infinite stream of profit `x` per round
is worth `x / (1 − γ)` in total, and `1 / (1 − 0.95) = 20`. So the bot is
effectively weighing the next ~20 rounds.

- Keep cooperating: roughly `0.3375 × 20 = 6.75`
- Undercut, trigger a war: one big round, then roughly `0.2229 × 20 = 4.46`

The war costs about 2.3 in future profit. No one-round spike is worth that. So
the patient bot does **not** undercut — and because both bots reason this way
from their own tables, the high price sustains itself.

Two things to be crystal clear about:

1. **They never communicate.** Each bot sees only prices. There is no channel
   between them, no shared table, no message.
2. **Nobody programmed cooperation.** The code contains no instruction to keep
   prices high, no cartel logic, no notion of "punishment". The reward-punishment
   behaviour is an emergent consequence of γ > 0 plus repeated interaction.

That is exactly what makes it a legal nightmare and a detection problem.

---

## 10. How one simulated market runs: train, deploy, probe

Each of the 200 simulated markets goes through three distinct phases. The
separation between phases is important and was one of the significant fixes to
the original prototype.

### Phase 1 — TRAIN (600,000 rounds)

The two bots interact and learn. ε decays from 1 to ~0. We check for
**convergence**: the market counts as converged when each bot's greedy policy
(the action its table rates highest, for every state) stops changing for 25,000
consecutive rounds. All 200 markets converged.

### Phase 2 — DEPLOY (1,000 rounds, the observed data)

Learning is switched off. The Q-tables are frozen and the bots simply execute
their learned policies. **This 1,000-round window is the only data the detector
ever sees** — it is the analogue of a regulator scraping prices from a live
market.

Why separate this from training? Because during training the bots are still
exploring randomly, so a price series taken from the end of training is
substantially exploration noise, not learned behaviour. In the original prototype
the measurement window came from the learning trace, and at that point ε was
still around 13% — which inflated the *competitive* bots' Δ to 0.24 and obscured
what the patient bots had actually learned. Training and measuring are now
strictly separated.

**Trembles.** During deployment each bot has a small probability (1–6%) per round
of making an off-policy move — posting a random price instead of its chosen one.
This models the reality of pricing software: stock-outs, promotions, stale
competitor feeds, A/B tests. It is not decoration. A frozen deterministic policy
would settle into a fixed repeating cycle whose price series carries almost no
information. Trembles knock the market off its cycle, and *watching it climb back*
is precisely what reveals the reward-punishment machinery.

### Phase 3 — PROBE (30 rounds, the defection experiment)

This is the most diagnostic thing in the project. We artificially force seller A
to drop to the competitive price for exactly one round, then let both bots revert
to their own policies, and record what happens.

For a collusive market the response is unmistakable:

1. A undercuts (forced).
2. **B punishes** — its price drops too, even though nobody told it to retaliate.
3. Both **climb back** to the high price over a few rounds.

A genuinely competitive market shows nothing of the sort — there is no high price
to return to and no cooperation to punish. From this we record **punishment
depth** (how far the rival cut, as a fraction of the pre-shock level) and
**recovery time** (rounds to return).

This is a simulation-only diagnostic — you cannot force a real Amazon seller to
undercut — so it is *not* used as a detector feature. It is evidence that the
collusive label means what we claim.

---

## 11. The four mechanisms and why there are four

There are two labels, competitive and collusive, but **four** ways of generating
markets — two per label:

| | Competitive | Collusive |
|---|---|---|
| **Learned** | `q_myopic` — Q-learners, γ = 0 | `q_patient` — Q-learners, γ ≈ 0.95 |
| **Scripted** | `br_noisy` — best-response + noise | `grim_cartel` — grim-trigger cartel |

- **`q_myopic`** (60 markets): γ = 0. The competitive learned control.
- **`q_patient`** (60 markets): γ drawn from 0.90–0.97. The phenomenon of interest.
- **`br_noisy`** (40 markets): not learning at all. Each round it simply plays the
  best reply to the rival's last price, with occasional random mistakes. A
  non-learning competitive control.
- **`grim_cartel`** (40 markets): a hand-written cartel. Both hold the monopoly
  price; if either defects, both drop to the competitive price for a few rounds
  as punishment, then the cartel re-forms. An *explicit*-collusion positive
  control.

**Why bother with the scripted pair?** Because with only `q_myopic` versus
`q_patient`, a classifier could get a great score by learning to recognise "the
fingerprint of a Q-learning algorithm" rather than "the fingerprint of
collusion". The scripted mechanisms don't share any of Q-learning's quirks, so
they force the model to key on interaction *dynamics*. As section 13 shows, this
control is what exposed the project's most important negative result.

Every market also randomises its own parameters — μ ∈ [0.20, 0.30], a ∈ [1.9,
2.1], grid size k ∈ {9, 11, 15}, α ∈ [0.08, 0.22], tremble ∈ [1%, 6%] — so the
detector cannot latch onto one specific calibration.

---

## 12. The features: the real research contribution

A **feature** is a single number computed from a price history, used as input to
the classifier. This section is where the actual novelty is, so it's worth slow
reading.

### The trap

In the simulation, detecting collusion is trivially easy. Just compute "is the
price above the competitive level?" — that scores an AUC of **0.999**, near
perfect.

It is also completely useless.

To compute it you need `p_Nash`, and to compute `p_Nash` you need the seller's
**marginal cost**. On Amazon.in you can never observe what it costs a seller to
supply a phone charger. You cannot subpoena it, you cannot scrape it, you cannot
infer it reliably. A detector that requires cost is a detector that can never be
deployed — which is exactly the gap the CCI complained about.

So the entire feature set obeys one rule:

> **Every feature must be computable from a scraped price series alone** — two
> sellers, one product, prices over time. No cost, no profit, no equilibrium
> anchors.

Δ therefore serves only as the training label and evaluation target. It is never
an input.

### The 19 features, grouped

**Co-movement — do the two sellers move as one?**
- `price_corr` — correlation between the two price levels.
- `diff_corr` — correlation between their round-to-round *changes*.
- `sync_change_rate` — of the rounds where anyone changed price, what fraction had both changing.

**Dispersion — how far apart do they sit, relative to the price level?**
- `rel_gap_mean`, `rel_gap_max` — average and largest gap, divided by the price level so units cancel.
- `gap_zero_frac` — fraction of rounds with *identical* prices.

**Volatility, scale-free**
- `cv_mean` — coefficient of variation (standard deviation ÷ mean).
- `rel_step_mean` — typical size of a price move relative to level.
- `change_freq` — how often a seller changes price at all.

**Persistence and lock-in**
- `autocorr1` — how strongly a seller's price predicts its own next price.
- `entropy` — how many distinct price points get used (low = stuck on a few).
- `state_hhi` — concentration of the joint (p₀, p₁) pairs visited. Near 1 means the market is locked into a tiny repeating cycle.
- `n_states_frac` — variety of price pairs visited.

**Retaliation structure — the actual signature of a punishment scheme**
- `retaliation_rate` — when one seller undercuts, how often does the rival cut back next round?
- `undercut_frac` — how often one sits below the other.
- `rebound_after_low` — after the market's cheapest moments, does the price snap back up?

**Level without cost, and leadership**
- `level_over_min` — typical price ÷ cheapest price ever seen. *This one was discarded — see below.*
- `level_over_median_gap` — the P90−P10 spread relative to level.
- `lead_lag_strength` — does one seller systematically move first?

### One feature was thrown out, and you should mention this in the viva

`level_over_min` scored AUC **0.994** — nearly as good as the cost-based
benchmark, and it needs no cost. It looked like the star result.

It is an artefact. The bots choose from a price grid that is *constructed* to
span exactly `[p_Nash, p_monopoly]`. A collusive market therefore sits near the
top of its own grid, while its occasional trembles reach right down to the
bottom — the competitive price. So "typical ÷ cheapest" recovers
`p_monopoly / p_Nash` almost by definition. Real scraped prices do not come from
a grid anchored on the two equilibria, so that signal would evaporate on
deployment.

It is excluded from every headline number and from model training, but shown
greyed out and struck through in the dashboard rather than quietly deleted. A
discarded feature is part of the method, not an embarrassment — and being able to
explain *why* you discarded it is worth more than the 0.994.

---

## 13. Results, including the ones that went badly

### Result 1 — patient bots collude, myopic bots don't

Mean Δ over 60 markets each, all converged:

| Mechanism | Label | Mean Δ | Punishment depth |
|---|---|---|---|
| `grim_cartel` | collusive | 0.800 | 0.232 |
| `q_patient` | collusive | **0.688** | 0.146 |
| `q_myopic` | competitive | **0.196** | 0.040 |
| `br_noisy` | competitive | 0.090 | 0.009 |

The only difference between rows 2 and 3 is γ. Same code, same market, same
learning rule — one values the future and one doesn't. That gap is the
phenomenon the whole project is about, and the dashboard's learning-curve chart
shows both starting from identical random play and separating over 600,000
rounds.

### Result 2 — myopic bots do NOT sit at Δ = 0, and this is not a bug

You would expect competitive bots at Δ ≈ 0. They average 0.196. I initially
assumed under-training, so I ran them for 1.2 million rounds — twice as long.
Δ went from 0.196 to **0.190**. Unchanged.

The explanation is in the cycle structure. At 1.2M rounds:

- only **5%** of markets converge to a fixed price pair,
- **15%** land in a 2-round cycle,
- **80%** land in cycles of length 3 or more.

Memory-1 Q-learners converge to price *cycles*, not to a resting point, and the
average price over a cycle sits above Nash. The single market that did reach the
grid's competitive price had Δ = **−0.024**, exactly the theoretical floor. This
is a documented phenomenon (Edgeworth price cycles; see Klein 2021).

**Why this matters more than it looks:** competitive bots also price above cost.
So **price level alone cannot separate collusion from competition** — and on real
data you can't even measure the price level relative to cost. This finding is the
strongest justification for the entire cost-free feature design. It turns a
"disappointing" number into the argument for the method.

### Result 3 — the detector works in-distribution

First, what **AUC** means. Area Under the ROC Curve is the probability that the
model gives a higher collusion score to a randomly chosen collusive market than
to a randomly chosen competitive one. AUC 0.5 = coin flip. AUC 1.0 = perfect.
AUC 0.987 = it gets the ordering right 98.7% of the time.

Using only the cost-free dynamics features, 5-fold cross-validation over all 200
markets:

| Evaluation | Logistic regression | Gradient boosting |
|---|---|---|
| All 200 markets | **0.987** | 0.977 |
| Myopic vs patient Q-learners only (hardest) | **0.973** | 0.959 |
| Including the flagged `level_over_min` | 0.994 | 0.992 |

The middle row is the one to quote. It removes the scripted controls and pits
myopic against patient — the split where price level is deliberately confounded
(0.196 vs 0.688 overlap substantially) and where the classifier must use dynamics.
0.973 there is a genuine result.

For reference, the cost-based measure scores 0.999 — but is unusable in practice.
Getting to 0.987 from price patterns alone is the point of the exercise.

### Result 4 — the negative result: transfer fails in one direction

Train on one pair of mechanisms, test on the *other* pair, so the test markets
were generated by a process the model has never seen:

| Direction | Logistic | Gradient boosting |
|---|---|---|
| Train Q-learning → test scripted | 1.000 | 0.752 |
| **Train scripted → test Q-learning** | **0.430** | 0.442 |

0.430 is **below 0.5** — worse than guessing. The model isn't merely failing; it
is systematically *inverted*, meaning the signature it learned is backwards for
learned collusion.

The reason: the scripted `grim_cartel` is recognisable mainly because both
sellers post *identical* prices (`gap_zero_frac` near 1). That is not how the
Q-learners sustain high prices — they run asymmetric cycles where the two sellers
sit at *different* prices. So a model trained on scripted cartels learns
"identical prices = collusion" and then confidently mislabels the real
phenomenon.

This is the most valuable output of stage 1 and it directly constrains stage 2:
**you must train on learned collusion, not on a hand-written cartel model.** Had
we only run `q_myopic` vs `q_patient`, we would never have discovered this.

### Result 5 — a caveat on the boosted model

Permutation importance (how much AUC drops when you shuffle one feature) for
gradient boosting:

```
rel_gap_max            +0.066
rel_gap_mean           +0.015
everything else        ≈ 0
```

Almost all the model's power sits in the between-seller price gap. Shuffling any
other feature barely matters. The model found one shortcut that happens to work
here. And because the gap between sellers is partly a function of how wide the
simulated price grid is, this needs stress-testing against grid width and seller
count before anyone trusts it on real data. Reported as a caveat, not a triumph.

---

## 14. The real scraped data

A separate repository ([vishakha636/Price-Collusion-detector](https://github.com/vishakha636/Price-Collusion-detector))
collects real Indian price data: petrol prices for IOCL/BPCL/HPCL across five
cities, and Amazon.in product prices. `sim/real_data.py` pushes that data through
the *exact same* feature extractor the model was trained on.

The pipeline connects end to end. But **0 of 5 candidate markets are usable**,
for two different reasons that need two different fixes — and establishing that
precisely is the useful output.

### Problem 1 — the fuel "finding" is an artefact of the scraper

The fuel data shows all three PSUs posting *identical* prices on 100% of days.
That looks like a spectacular result: perfect price parallelism between three
competitors.

It isn't a result at all. In `fuel_scraper.py`:

```python
if price is not None:
    for seller in FUEL_SELLERS:      # IOCL, BPCL, HPCL
        ... "seller": seller, "price": price
```

The scraper reads **one** price per city off an aggregator page and writes it
three times, once per PSU label. IOCL, BPCL and HPCL are three copies of the same
number. They were never independently observed.

So `price_corr = 1.000` and `gap_zero_frac = 1.000` on those pairs are
**arithmetic identities** — a column compared with a copy of itself. They would
appear no matter what the real market did. Collecting more days cannot fix it.

`sim/real_data.py` now detects series that are identical at every observation and
refuses to count them as comparable markets. This is worth stating plainly:
publishing that as "detected collusion between three named state-owned
companies" would be both statistically void and defamatory.

### Problem 2 — e-commerce needs a scraper redesign, not more days

On an Amazon product page, the recorded seller is whoever currently holds the
**Buy Box** (the default "Add to Cart" seller). So each product yields exactly
*one* seller per day.

Of 216 products scraped, 8 ever show a second seller — and those appear on
**different days**, because the Buy Box changed hands, not because two rivals
were observed simultaneously. The best same-date overlap across all 216 products
is **1 day**. There is no simultaneous price pair anywhere in the dataset.

The fix is to scrape the all-offers listing per product (the "Other sellers on
Amazon" panel), which lists every seller's price in one snapshot.

### Problem 3 — a data-quality flag

Bengaluru, Delhi and Mumbai return byte-identical petrol series on all five days,
though their saved debug HTML files differ. Indian retail fuel prices vary by
city because state VAT varies, so the city parameter is probably not reaching the
parsed value. Only 3 of 5 cities carry independent information.

### Why the dashboard reports no risk score

Two gates must pass before the trained model can legitimately run:

1. **A valid multi-seller panel exists** — currently FAILS (0 markets).
2. **Series reach ~60 rounds** — currently FAILS (5 daily observations, against
   the 1,000 the model trained on). Even if gate 1 passed, only 14 of 18 features
   would be mathematically defined at 5 observations.

So the dashboard deliberately shows **zero** risk scores. Any number produced
from five daily observations of a duplicated column would be indistinguishable
from noise, and presenting one would be the single worst thing this project could
do.

---

## 15. File-by-file code walkthrough

```
sim/market.py             The economics. Logit demand, profit, and the two
                          anchors (Nash by bisection, monopoly by golden-section
                          search). Also builds the discrete price grid the bots
                          choose from. Run it directly to verify 1.4729/1.9250.

sim/engine.py             The bots. Q-learning training loop, the frozen-policy
                          deployment rollout with trembles, the defection probe,
                          and the two scripted control mechanisms.

sim/features.py           The 19 cost-free features, plus the diagnostics (Δ,
                          punishment depth) that are labels rather than inputs.
                          Also defines the feature tiers that exclude
                          level_over_min.

sim/generate_dataset.py   Orchestrates train → deploy → probe for 200 markets,
                          randomises each market's parameters, and writes
                          run_summary.csv, price_series.csv and dashboard.json.

sim/train_baseline.py     Trains logistic regression and gradient boosting,
                          runs the three evaluations (in-distribution,
                          cross-mechanism transfer, hardest split) plus
                          permutation importance.

sim/real_data.py          Applies the same features to the real scraped CSV,
                          detects duplicated seller series, and produces the
                          readiness gates.

frontend/                 React + Vite dashboard, nine sections, one per stage
                          of the argument above.
```

### A performance note worth knowing

A Q-learning market is inherently **sequential** — round t+1 depends on round t,
so you cannot vectorise across time. Running 200 markets × 600,000 rounds in
plain Python would take hours.

The trick used: **vectorise across markets instead.** All markets sharing a grid
size advance one round together as NumPy array operations, both sellers stacked
onto a single length-2R axis so each round costs one set of NumPy calls rather
than two. Random numbers are drawn in chunks, and the Q-table is indexed through
a flattened 2-D view because NumPy's multi-dimensional fancy indexing has several
microseconds of per-call overhead. Result: ~4.6 microseconds per market-round,
comparable to compiled code, with no compiled dependency.

(`numba` was the first choice but its 42 MB `llvmlite` wheel could not be
downloaded in this environment — the download kept truncating and failing its
hash check. The NumPy approach turned out just as fast.)

---

## 16. Glossary

| Term | Meaning |
|---|---|
| **Algorithmic collusion** | Independent pricing programs learning to keep prices high with no agreement between their owners. |
| **Tacit collusion** | Coordination without explicit agreement. |
| **Bertrand-Nash price** | The competitive price: each seller is already doing its best given the rival. Here 1.4729. |
| **Monopoly price** | The joint-profit-maximising price a perfect cartel would set. Here 1.9250. |
| **Δ (delta)** | Collusion index. 0 = competitive, 1 = perfect cartel. |
| **Logit demand** | Demand model where each seller's share depends on its price relative to alternatives. |
| **μ (mu)** | Product differentiation. Small μ = near-identical products, price-sensitive customers. |
| **Marginal cost (c)** | Cost of supplying one more unit. Observable in simulation, never on Amazon. |
| **Q-learning** | Reinforcement learning by lookup table of (state, action) → expected future value. |
| **State** | What the bot knows: the price pair from last round. |
| **α (alpha)** | Learning rate — how fast the table updates. |
| **γ (gamma)** | Discount factor — how much the bot values future profit. **The collusion dial.** |
| **ε (epsilon)** | Exploration rate — probability of picking a random price. Decays to ~0. |
| **Epsilon-greedy** | Explore randomly with probability ε, otherwise take the best known action. |
| **Convergence** | Greedy policy unchanged for 25,000 consecutive rounds. |
| **Tremble** | Small chance of an off-policy move during deployment; models real pricing noise. |
| **Impulse response / defection probe** | Forcing one seller to undercut once and observing retaliation and recovery. |
| **Reward-punishment strategy** | Keep prices high; punish a defector with a price war; then forgive. Learned, not programmed. |
| **Edgeworth cycle** | Repeating sawtooth price pattern — why myopic bots average above Nash. |
| **Feature** | A number computed from a price history, fed to the classifier. |
| **Scale-free** | Feature whose value doesn't depend on the currency or price level. |
| **AUC** | Probability the model ranks a random collusive market above a random competitive one. 0.5 = chance. |
| **Cross-mechanism transfer** | Train on one generating process, test on a different one. Predicts real-world behaviour. |
| **Permutation importance** | Drop in AUC when one feature is randomly shuffled. Measures reliance. |
| **Buy Box** | Amazon's default seller for a product. Why only one seller per product per day gets scraped. |
| **Degenerate pair** | Two "sellers" whose prices are identical at every observation — one value duplicated, not two measurements. |

---

## 17. Viva questions you should be able to answer

**"Why simulate instead of using real data?"**
Because no labelled data exists — nobody knows which real markets contain
colluding algorithms, so there is nothing to learn from. Simulation gives perfect
labels at the cost of a reality gap, which is why the features are deliberately
restricted to things measurable on real data.

**"What makes the bots collude?"**
One parameter: γ, the discount factor. γ = 0 bots undercut every time and compete.
γ ≈ 0.95 bots weigh roughly the next 20 rounds, so the price war triggered by
undercutting costs more than the one-round gain. They never communicate.

**"Why is your competitive baseline at Δ = 0.196 instead of 0?"**
Because memory-1 Q-learners converge to price cycles rather than a fixed point —
80% land in cycles of length 3 or more — and a cycle's average price sits above
Nash. Verified as not under-training: doubling to 1.2M rounds moved Δ only from
0.196 to 0.190. This is the documented Edgeworth-cycle result, and it is the
main reason price level alone cannot be the detector.

**"Why not just check whether prices are above cost?"**
That scores AUC 0.999 in simulation and is worthless in practice, because a
regulator cannot observe an Amazon seller's marginal cost. Every feature is
therefore computable from prices alone.

**"How well does it work?"**
AUC 0.987 across 200 markets, 0.973 on the hardest split (myopic vs patient
Q-learners, where price level is confounded), using only cost-free features.

**"What doesn't work?"**
Cross-mechanism transfer in one direction: training on the scripted cartel and
testing on learned collusion gives AUC 0.430, below chance. The scripted cartel
is identified by identical prices, which is not how Q-learners sustain high
prices. Stage 2 must train on learned collusion.

**"What did you find in the real data?"**
That it cannot yet support the detector, for two separable reasons. The fuel
scraper writes one parsed price three times under three PSU labels, so its
"perfect parallelism" is an arithmetic identity rather than an observation. And
Amazon's Buy Box yields one seller per product per day, so no simultaneous rival
pair exists — best same-date overlap across 216 products is 1 day. Reporting a
risk score from that would be indefensible, so the dashboard reports none.

**"What would you do next?"**
In order: fix the fuel scraper to parse each PSU separately (or drop the
per-seller split); switch the e-commerce scraper to the all-offers listing;
verify city-level differentiation; retrain on learned collusion only; ablate grid
width and seller count to test whether `rel_gap_max` is a real signal or a grid
artefact; add SHAP explanations per flagged market. Only after the first two does
collecting more data buy anything.
