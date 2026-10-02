# PriceGuard — demo script (about 12 minutes)

**[ ]** = what to click · **SAY** = what to say. Numbers in *italics* change daily: read them off the screen.

---

## 0. Before you start (alone, 5 minutes earlier)

- Terminal 1: `python -m tracker.server`
- Terminal 2: `npm run dev --prefix frontend`
- Open http://localhost:5174 · open the Products page once and note today's verdicts
- Keep `demo/` open in File Explorer for uploads
- Internet on (for the agent and AI)

---

## 1. Opening — the problem (1 min)

**[ Landing page, top ]**

**SAY:**
"Good morning. Our project is PriceGuard — a tool that checks whether a seller's pricing software is colluding with competitors without the seller knowing.

Today most online sellers in India don't set prices by hand. Amazon.in gives every seller a free 'Automate Pricing' tool, and there are many paid repricers. These programs watch competitors and change prices automatically, many times a day.

Research has shown that such pricing algorithms can learn to keep prices high together, without anyone agreeing to it. Calvano and others showed this in the American Economic Review in 2020. In India, the Competition Commission's 2025 market study on AI raised this exact risk, and in 2026 the CCI asked companies to self-audit their pricing algorithms.

The problem: a seller is legally responsible for what its software does, but has no way to see what the software is doing. PriceGuard is that self-audit."

---

## 2. Check a product — the agent (2 min)

**[ Sidebar → Check a product ]**

**SAY:**
"Let me show how a seller uses it. The seller just pastes the link of their product."

**[ Paste the Sonata link from DEMO_GUIDE.md → Check ]**

**SAY (while the steps appear):**
"Now the agent works step by step.
It reads the product page — brand, price, platform.
It works out the category.
It finds competitors — on Myntra it searches live; for Flipkart and Amazon it uses our catalog of products we already track.
It reads every competitor's current price.
It attaches past prices we already hold.
And it registers the product so it is monitored from now on — every 6 hours."

**[ Result appears ]**

**SAY:**
"The result: status, how sure we are, and one line per competitor."

> If the link is new instead: "This product is new to us, so it says *Collecting*. The audit needs at least 14 days and 3 price changes before it gives a verdict — we don't guess."

---

## 3. A product report — Bosch (3 min)

**[ Products → Bosch · Drills ]**

**SAY:**
"Here is a product we have been monitoring — a Bosch angle grinder on Flipkart.
On the left, the seller's own product. On the right, the competitors being watched: *LEOFAST, INGCO, and Flipkart SmartBuy*.

Status: *Review*. Each competitor has one line. *Flipkart SmartBuy: you followed their price rises 2 of 3 times.*
Flipkart SmartBuy is Flipkart's own brand — so this is also the kind of case where a marketplace itself can become the hub of coordination."

**[ Details → Breakdown → Signals ]**

**SAY:**
"Why this status? We check three warning signs, for every competitor:
One — do you raise prices together? If 6 out of 10 price rises are matched within 2 days, that's a sign.
Two — do you match their discounts but never go lower? That says: I won't let you gain, but I won't fight either.
Three — does the price gap stay fixed while both prices change? Independent sellers drift; a fixed gap looks like a shared rule.

One sign means Review. Two or more with the same competitor means High risk. Every number is shown with its rule."

**[ Sale check tab ]**

**SAY:**
"A common objection: maybe everyone changed prices because of a sale. So we re-run the verdict six ways — with 1, 2 and 3-day windows, and with sale days removed. A sale day is when 30% or more of all products on the store move together.
*Here it says [read the line].* If the warning disappears when sale days are ignored, it was a sale, not coordination."

**[ Price changes tab ]**

**SAY:**
"And here is the evidence: every price change by the competitor, our response, how many days later, and where the data came from. A compliance officer can check every single flag by hand."

**[ Report button ]**

**SAY:**
"This is the report a company keeps on file."

**[ Ask AI → Explain ]**

**SAY:**
"For non-technical managers, an AI analyst explains the result in plain English or Hindi. It only sees this audit's numbers, so it cannot make things up."

---

## 4. Upload a pricing log (1.5 min)

**[ Sidebar → Audit a log → upload `simulated_cartel_bots.csv` ]**

**SAY:**
"Companies can also upload their repricer's own log. This file is simulated — two bots running a cartel strategy.
Result: *High risk* — they raise together, and match each other."

**[ Upload `kamiliant_suitcases_90days.csv` ]**

**SAY:**
"And this is real Flipkart data — six suitcase brands, 90 days. Result: Compliant. So the tool does not flag everything — it separates the two."

---

## 5. Alerts (30 s)

**[ Sidebar → Alerts ]**

**SAY:**
"Monitoring over time: every week the history is re-checked, and any change of status becomes an alert — for example a product going from Compliant to Review, with the reason."

---

## 6. Validation — does it actually work? (2.5 min)

**[ Sidebar → Validation ]**

**SAY:**
"The most important question: how do we know this works? We tested it on cases where the answer is already known."

**[ Tyre cartel card ]**

**SAY:**
"The Indian tyre cartel — CCI found Apollo, MRF, CEAT, JK and Birla guilty, with a penalty of 1,788 crore. Using the price rises from the CCI's own order, our screen flags FY2012: all five raised prices within 0.46 percentage points of each other. That is the year the CCI found the increase was planned by email."

**[ Fuel brands card ]**

**SAY:**
"German fuel — the real data behind a 2024 Journal of Political Economy paper on pricing algorithms. Between rival stations within 1 km, 73% of price rises were matched within an hour, against 28% expected by chance. And without being told the date, our method found the point in 2017 when stations switched to algorithmic pricing — the same period the paper reports."

**[ Airline fares card ]**

**SAY:**
"And a false alarm we avoid: six airlines with identical fares — explained by a government minimum fare, not collusion. A naive 'same price' check would wrongly flag this."

**[ Top numbers / regret charts ]**

**SAY:**
"We also built a simulator of AI pricing bots, following the 2020 paper. On 200 simulated markets our regret test is 97% accurate."

**[ Rival co-movement · India card ]**

**SAY:**
"Finally, real Indian data — 480 listings on Flipkart, Amazon and Myntra. Rival brands matched each other's price rises 29% of the time, unrelated products only 21%. Removing sale days barely changes this. That's a screening signal — not proof of collusion."

---

## 7. The model in Python (1 min)

**[ Terminal: `python model/priceguard_model.py demo/model_sample_bosch.csv` ]**

**SAY:**
"This is the same model outside the app, as a standalone Python script.
At the top, the machine-learning work. A: the detector trained on 200 simulated markets — cross-validated AUC 0.987, 96% accuracy. But real shop prices are outside its training range.
So we tried two ways to make it work on real data. C1: we re-ran the simulation so bots reprice like real shops — AUC 0.91 on simulations, but on real prices different model types disagree. C2: a model trained on 2,740 real product pairs — but there are no real labelled collusion cases, and rivals barely differ from unrelated products, AUC 0.63.
So the script says it itself: verdicts come from the screening rules.
Then the rules on real Bosch prices — the same verdicts as the app. We verified this: every verdict matches between Python and the app, 45 of 45 products and 201 of 201 competitors."

---

## 8. Closing (30 s)

**SAY:**
"To summarise: PriceGuard lets a seller paste a link and get a self-audit of its pricing — with the evidence behind every flag, a check for sales, and a report to keep.
It is tested on real cartels before being used on real products.
A flag means 'review', not 'guilty' — PriceGuard screens; investigations decide.
Thank you."

---

## Questions — short answers

**"Did you find collusion?"**
"Not proven, and we don't claim it. *Four* products are on review now. Our strongest real signal is Bosch against Flipkart SmartBuy. On proven cases — the tyre cartel and German fuel — the screens catch the pattern."

**"Why perfumes and suitcases? Nobody cares."**
"That's where pricing bots run — thousands of everyday listings, changing daily. Collusion here isn't one big price; it's a few percent on millions of orders that nobody notices. And the method doesn't depend on the category — it caught the tyre cartel too."

**"Who would pay for this?"**
"Sellers — they are liable for their software. Marketplaces — their own tools and own brands can be the hub. And it supports the CCI's call for algorithm self-audits."

**"Is the data real?"**
"Yes. Live Flipkart and Myntra product pages, past daily prices from public price-history pages, and Internet Archive snapshots. No logins, nothing bought, no CAPTCHA bypassing. Only the cartel bots file is simulated, and it's labelled."

**"Why not just use machine learning?"**
"We did build it — AUC 0.987 on simulations. But real prices are outside its training range, which we measured. A compliance verdict must be explainable, so on real data we use rules where every flag shows its evidence."

**"Why not train the model on real data?"**
"We did, two ways. First, on 2,740 real product pairs — rival brands versus unrelated products, where the labels are certain. Rivals turned out to barely differ from unrelated products, AUC 0.63, and there are no real labelled collusion cases to learn 'colluding' from. Second, we re-ran our simulation so the bots reprice like real shops; it reaches AUC 0.91 on simulations, but on real prices different model types disagree with each other. So machine learning can't give a reliable verdict on real prices yet — the transparent rules do, and the ML stays as a research result."

**"Why Flipkart search from a catalog and not live?"**
"Flipkart now loads search results inside its app, not in the page. Reading their private interface would mean reverse-engineering it, which we chose not to do. Myntra search is live; Flipkart product pages are read live."

**"What if prices are the same because costs went up?"**
"That's why we check responses over time, not price levels, and why there's a sale check. A cost rise moves everyone at once; following a specific rival's moves, again and again, is what we flag."
