# PriceGuard — demo guide

About 10 minutes. Every file in this folder is real data, except `simulated_cartel_bots.csv`, which is labelled as simulated.

## Before the demo (5 min, same day)

1. Terminal 1, in the `Major Project` folder: `python -m tracker.server`
2. Terminal 2, in the `Major Project` folder: `npm run dev --prefix frontend`
3. Open http://localhost:5174/#/app/products and note today's verdicts. They are computed from the last 30 days, so they can change from day to day.
4. Keep the laptop awake. Prices are only collected while it is on.

## Files in this folder

| File | What it is | Upload result (Audit a log) |
|---|---|---|
| `bosch_drills_90days.csv` | Real Flipkart prices · Bosch vs 3 competitors · 90 days | **Review** · Flipkart SmartBuy |
| `wrogn_watches_90days.csv` | Real Myntra prices · Wrogn vs Titan, Timex, Daniel Hechter | Compliant |
| `kamiliant_suitcases_90days.csv` | Real Flipkart prices · 6 suitcase brands | Compliant |
| `beardo_perfumes_90days.csv` | Real Flipkart prices · 6 perfume brands | Compliant |
| `allen_solly_watches_90days.csv` | Real Flipkart prices · 6 watch brands | Compliant |
| `ajmal_perfumes_90days.csv` | Real Myntra prices · Ajmal vs SKINN, Giorgio Armani | Compliant |
| `simulated_cartel_bots.csv` | **Simulated** · two bots running a cartel strategy (collusion index 0.79) | **High risk** |
| `model_sample_bosch.csv` | Real Bosch prices, 3 Jul – 30 Sep, for the Python model | **High risk** · Flipkart SmartBuy (2 signs) |

The two Bosch files cover different 90-day windows, so their verdicts differ: the result depends on the period audited.

Format: `date, your product, competitor 1, competitor 2, …`. The first price column is "your product".

## Demo flow

| # | Page | Do | Say (one line) |
|---|---|---|---|
| 1 | Landing `#/` | Scroll once | "A compliance tool for sellers who use automatic repricing." |
| 2 | Check a product | Paste the Sonata link below → **Check** | "Paste a link. The agent finds competitors, reads prices, and audits." |
| 3 | Products | Open **Bosch · Drills** | "Verdict, competitors, one line each." |
| 4 | Bosch → Details → Breakdown | **Signals**, **Sale check**, **Price changes** | "Every flag shows its numbers, rule and evidence." |
| 5 | Bosch → Report | Download the PDF | "The record a compliance team keeps." |
| 6 | Bosch → Ask AI → Explain | (needs internet) | "Gemini explains the audit in plain English or Hindi." |
| 7 | Audit a log | Upload `simulated_cartel_bots.csv`, then `kamiliant_suitcases_90days.csv` | "High risk on a cartel; Compliant on real suitcases." |
| 8 | Alerts | Scroll | "Status changes over 6 months, re-checked weekly." |
| 9 | Validation | Tyre cartel, German fuel, CCI cases | "Tested on proven cases before real products." |
| 10 | Terminal | `python model/priceguard_model.py demo/model_sample_bosch.csv` | "Same model in Python: AUC 0.987, same verdicts as the app." |

Links for step 2:
- Already monitored, opens the full report instantly: `https://www.myntra.com/watches/sonata/sonata-unisex-northern-lights-inspired-poze-quartz-analog-blue-dial-watch---sp80140sm01w/39657504/buy`
- A new product (registers it; shows **Collecting**): any Myntra product link

Parity proof (optional, needs about 2 minutes): `python model/parity_check.py`, which gives 45/45 product verdicts and 201/201 competitor verdicts identical between the Python model and the app.

## What the results mean

### Status

| Status | Rule | Meaning |
|---|---|---|
| **Compliant** | 0 warning signs with every competitor | Prices move independently. Nothing to fix. |
| **Review** | 1 warning sign with at least one competitor | One coordination pattern. Check the repricer rules for that competitor. |
| **High risk** | 2 or 3 warning signs with the same competitor | Several patterns together. Change the rules and keep the report on file. |
| **Collecting** | Under 14 days of prices, or under 3 price changes | Not enough data to judge. |

### The 3 warning signs

| Sign | Measured as | Why it matters |
|---|---|---|
| **Raise prices together** | 60%+ of price rises matched by the other within 2 days | Competition rewards staying cheaper; following a rise gives that up. |
| **Match discounts, never lower** | 60%+ of answered cuts matched in size, none undercut | "I won't let you gain, but I won't start a price war." |
| **Fixed price gap** | Price ratio varies under 2% while both prices change | Independent sellers drift; a fixed gap looks like a shared rule. |

### Other numbers on the page

| Item | Meaning |
|---|---|
| **Score /100** (per competitor) | Followed their rises (45) + they followed yours (20) + fixed gap (20) + match discounts (15). Ranks competitors; the status comes from the signs. |
| **How sure** | Sure: 60+ days, 20+ price changes · Fairly sure: 21+ days, 8+ changes · Not sure yet: less |
| **Sale check** | Verdict re-run with 1/2/3-day windows, with and without sale days. "6/6 checks" = solid result. "Clears when sale days are ignored" = a sale, not coordination. |
| **Sale day** | 30%+ of a store's tracked listings moved price the same way that day |
| **Price changes** | Every rival move, your response, the delay, and the data source |

## Why these products — and why it matters

**Who uses repricing software:** Indian marketplace sellers, at scale. Amazon.in offers every seller a free "Automate Pricing" bot. Third-party repricers set prices for thousands of listings a day. Everyday categories (perfume, watches, power banks, luggage) are exactly where these bots run: many sellers, many SKUs, daily price changes.

**Why everyday products:**
- Algorithmic collusion is not about one expensive product. It is a few percent extra on millions of small orders, spread across consumers who never notice.
- Public daily price histories exist for these products, and no paid data or logins were needed.
- The method doesn't depend on the category. The same engine was tested on proven cartels: the Indian tyre cartel (CCI) and German fuel brands.

**Who needs PriceGuard:**

| User | Problem | What PriceGuard gives |
|---|---|---|
| Seller / brand | Liable under Competition Act s.3 for what its repricer does, but cannot see inside it | Self-audit, evidence, fixes, a dated report |
| Marketplace | Platform-run pricing tools and own brands (e.g. Flipkart SmartBuy) can become the "hub" in hub-and-spoke collusion | Screening across all sellers in a category |
| Regulator (CCI) | Its 2025 AI market study and 2026 self-audit guidance ask firms to audit their algorithms, but there is no standard tool | A transparent, testable screen |
| Consumers | Pay higher prices without knowing why | Indirectly, through the above |

**What it does not claim:** a flag is a reason to review, not proof of collusion. No product here is proven to collude. The tool screens. Investigations decide.

## Likely questions

| Question | Answer |
|---|---|
| "Did you find collusion?" | Not proven. 4 products on review in the last 30 days; Bosch vs Flipkart SmartBuy holds in 6/6 checks. On proven cases (tyre cartel, German fuel) the screens catch the pattern. |
| "Is the ML model real?" | Yes: AUC 0.987 in 5-fold cross-validation on 200 simulated markets. On real shop prices it is outside its training range (real prices change far less often), so the app uses the transparent rules, and the script says so itself. |
| "Why not just compare prices?" | Equal prices can be innocent (government fare floors; costs). The screens look at *responses over time*, not price levels. |
| "Why rules, not a black box?" | A compliance verdict must be explainable. Every flag shows its numbers and evidence. |
| "Where does the data come from?" | Flipkart and Myntra product pages (live), past daily prices from pricehistoryapp.com public pages, Internet Archive snapshots. No logins, no CAPTCHA bypass. |
