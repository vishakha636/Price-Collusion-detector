# PriceGuard — project context (for brainstorming)

## What it is
Final-year engineering major project on **detecting algorithmic price collusion**. It's built as a product called **PriceGuard**: a compliance tool for Indian e-commerce sellers who use automatic repricing software. It answers one question: *"Is my pricing algorithm moving in step with rival brands in a way the Competition Commission of India (CCI) could see as tacit collusion?"*

Background:
- Calvano et al. (AER 2020) showed Q-learning pricing bots can learn to collude without talking to each other.
- CCI published a 2025 market study on AI and competition and a March 2026 AI self-audit guidance note.
- PriceGuard is a **self-audit** tool. A flag means "review this", not proof of collusion.

## Tech stack
- **Frontend:** React + Vite + Recharts, hash-routed single-page app with a blue/white "SaaS" design (sidebar app plus a landing page with pricing tiers).
- **Backend:** Python standard-library HTTP server (`tracker/server.py`, port 8765), SQLite (`data/price_watch.db`), and a scheduler thread that collects prices every 6 hours.
- **Scrapers:** Flipkart and Myntra (public pages, polite 2.5 s pauses). Amazon.in is excluded because it uses a CAPTCHA, and we don't bypass it.
- **AI:** Google Gemini (REST, key kept server-side in `.env`), with a built-in rule-based fallback when no key is set.
- **Tests:** 44 unit tests (`node:test`) for the detection logic.

## Detection engine (what "collusion screening" means here)
For your product vs each rival, using the price history:
- **Rise-following:** share of the rival's price rises you matched within N days (default 2).
- **They-follow-you:** the reverse direction.
- **Match-not-beat:** you match rival cuts but never undercut them.
- **Frozen/fixed gap:** a constant price gap to a rival over time.
- **Shared seller:** the same seller behind two "rival" listings.
- **Reaction speed:** median lag of the responses.
- Each rival gets a score out of 100, and the product gets a verdict: **Compliant / Review / Risk / Collecting** (not enough data yet). The result also lists evidence lines and suggested fixes.
- **Calibrated swap-regret test** (Hartline et al. 2024/25): from a seller's price and sales records, estimate how much profit a bot "leaves on the table". Colluding bots leave more. Thresholds are 2.3% (review) and 4.2% (risk); 97% accuracy on 200 simulated test markets.
- **Simulator:** Calvano-style Q-learning markets used to train and validate the detector (19 features, AUC 0.987 for the price-pattern detector; regret test AUC 0.999).

## App pages / features (all working)
1. **Landing page:** hero ("Is your pricing algorithm colluding without you knowing?"), proof stats, features, how it works, and pricing tiers (Starter ₹999, Growth ₹4,999, Enterprise).
2. **Overview:** KPIs (products monitored, competitors tracked, prices in the current window, alerts) and a products table.
3. **Products:**
   - Register a product: name → pick platforms → auto-discover your listing plus rival brands in a 0.5–2× price band, one per brand.
   - Product list: a "Your product" column and a "Competitors watched" column.
   - Product page: a blue "Your product" card vs a "Competitors being watched" grid (each rival's price and status), the full audit (status, % of rises copied, reaction time, rivals flagged, price chart, evidence, fixes, audit history, monthly reminder), and a PDF report.
4. **AI analyst (on every product page):** "Explain this result" (English or Hindi), "Draft compliance memo" (printable), and chat with quick questions ("Which rival is the problem?", "What should I change in my repricer?", "Could a sale event explain this?"). The AI only receives the audit summary and is told not to invent anything.
5. **Alerts:** re-audits the last 6 months of stored prices week by week and lists status changes (e.g. "Compliant → Review: fixed gap to Timex"). A change counts only if it holds 2 weeks in a row, which gives 94 changes (47 escalations, 47 cleared).
6. **Audit a log:** upload a CSV pricing log (wide or long format), track live, or run the regret test. Gives the same audit result and PDF.
7. **Validation page (evidence the method works):**
   - **Pricing bots exist on Amazon.in:** Internet Archive snapshots (2024–26) show machine-like repricing (e.g. an Ambrane cable: 28 price changes in 46 snapshots).
   - **Indian tyre cartel (CCI Case 08/2013, guilty, ₹1,788 cr):** company-wise price rises. Our spread screen flags FY12, when all five companies' rises were within 0.46 points of each other.
   - **German fuel brands (Tankerkönig data behind Assad et al., JPE 2024):** Aral/Shell/Esso/Total/JET leader-follower analysis. 73% of price rises were followed within 60 minutes, vs 28% by chance (placebo test, 112k rises).
   - **Blind break detection:** found the 2017 arrival of pricing algorithms in German fuel data without being told the date.
   - **False alarm avoided:** six airlines with identical fares were correctly *not* flagged.
   - Regret-test charts, accuracy chart, "simulator matches the published paper", and a real-CCI-cases table.
   - **Monitored products card:** 35 registered Indian products (Flipkart, Amazon.in, Myntra), 103 competitors, real daily prices imported from pricehistoryapp.com (public pages, history back to 2018), audited in the current window.
8. **Settings:** data window (30/90/365 days/all), response window (1–3 days), sale days (exclude or include), Gemini connection status and setup steps, monitoring info.
9. **Explanation panel (on every product page)**, with three tabs:
   - **Why this status?** each rival's signals (rises copied, rises copied back, fixed gap, match-not-beat) with measured value, rule and points out of 100.
   - **Would it hold?** the verdict re-run with 1/2/3-day windows, with and without sale days: "Robust", "Depends on settings" or "Explained by sale days".
   - **Evidence:** you vs one rival on a chart with matched moves marked, plus every move with prices, response lag, sale-day tag and source (imported or live).
   - A **confidence** badge (High/Medium/Low) based on days covered, price moves and rival moves checked.

## Real data and honest findings
- Across about 480 real Indian listings (2024–26), rival brands matched each other's price rises **29%** of the time. Unrelated products on the same store matched 21%, and chance was 23%. So most co-movement comes from **platform sale events**, with a small extra amount of brand-to-brand following.
- **No product is proven to collude.** A few pairs are flagged for review only (e.g. Flipkart suitcases, mostly one sale window). We must not publicly accuse any named company.
- Sale days: 168 market-wide days detected (30%+ of a store's listings moving the same way). Removing them barely changes the result: rivals 27.0% vs unrelated 20.0% (chance 22.1%). Sale days explain only about 1 point; the rest could be same-category costs or seasons, so it is a screening signal, not proof.
- With a 30-day window and sale days excluded: 29 compliant, 3 review, 0 risk (Bosch drills: robust across all 6 checks; Wrogn watches and Foxglove cycling: depend on settings). An earlier fixed-gap bug (it measured flat stretches where neither price moved) had inflated reviews to 12; now fixed, with a regression test.
- Imported history is labelled as imported from pricehistoryapp.com. Our tracker adds live prices every 6 hours from registration onward.

## Constraints
- No paid data or services; the user doesn't want to buy anything.
- No logins to third-party sites. No CAPTCHA or anti-bot bypassing. No reverse-engineering of quick-commerce apps.
- Runs locally on the student's laptop, which is left on for collection.
- UI style: blue and white, minimal text.
- Features should really work. Examiners will click around during the viva, so no fake buttons or made-up numbers.

---

## What I want from you (ChatGPT)
Suggest **new features** that would make PriceGuard feel like a real, sellable B2B compliance product **and** impress engineering examiners. For each idea give:
1. What the user sees (one or two lines).
2. Why a seller or compliance team would pay for it.
3. The data or API it needs (prefer **free**, no-login sources).
4. Build effort (S/M/L) and how it plugs into the existing engine.
5. How we'd show in a demo that it works on real data.

Ideas already on the table, which you can expand or critique:
- (Done: sale-day detection from our own data, the explanation panel, confidence, counterfactuals.)
- An **events layer** to explain co-movement: Flipkart/Amazon sale calendar, Indian festivals (Calendarific), USD→INR rate (Frankfurter), news around flagged dates (GDELT, Google News RSS), and Gemini with Google Search grounding. Flags explained by an event get downgraded.
- A **CCI regulatory feed** (new orders and press releases).
- **Pre-deployment check:** test a repricing rule on the simulator before switching it on.
- A **residual screen** (Harrington & Imhof): remove festival and currency effects, then look for leftover co-movement.
- **Price suggestion:** a "safe price" range that avoids follow and fixed-gap patterns.
- **Weekly email or WhatsApp digest** and multi-user roles (seller, compliance officer, auditor).
