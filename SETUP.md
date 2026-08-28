# Setup — run this project on your machine

Two parts: a Python simulation that generates the dataset, and a React dashboard
that displays it. **The generated data is committed to the repo**, so you can see
the dashboard in about two minutes without running the simulation at all.

---

## 0. Prerequisites

| Need | Version | Check with |
|---|---|---|
| Python | 3.10 or newer (3.11 tested) | `python --version` |
| Node.js | 20.19+ or 22.12+ (22.13 tested) | `node --version` |
| git | any | `git --version` |

On Windows, if `python` opens the Microsoft Store, use `py --version` and
substitute `py` for `python` in every command below.

---

## 1. Clone the repo

```bash
git clone -b v1 https://github.com/vishakha636/Price-Collusion-detector.git
cd Price-Collusion-detector
```

All remaining commands run from this folder.

> **The `v1` branch has not been pushed yet.** Until it is, this command fails
> with `Remote branch v1 not found`. Wait for word that v1 is up, then run it.

---

## 2. See the dashboard (fast path — ~2 min)

The dataset and model results are already committed, so the frontend needs
nothing from Python.

```bash
npm install --prefix frontend
```

```bash
npm run dev --prefix frontend
```

Open **http://localhost:5174**.

You should see nine sections, starting with "Do pricing bots learn to collude on
their own?" and stat cards reading 200 markets / 600k periods. If you see
"Loading simulation dataset…" forever, jump to Troubleshooting.

Stop the server with `Ctrl+C`.

That's everything most people need. The rest is only for re-running the science.

---

## 3. Python setup (only if you want to regenerate data)

```bash
pip install -r requirements.txt
```

The simulation itself needs only `numpy`, `pandas`, and `scikit-learn`. The
`requests` / `beautifulsoup4` / `selenium` / `webdriver-manager` entries are for
the scrapers, so if you are not scraping you can install just the three:

```bash
pip install numpy pandas scikit-learn
```

### Check it works before committing to a long run

```bash
python sim/market.py
```

Should print `p_Nash = 1.4729` and `p_Monopoly = 1.9250`. Those match the
published values in Calvano et al. (AER 2020) — if they don't, something is
wrong with your install, so stop here.

### Smoke-test the whole pipeline (~25 s)

```bash
python -m sim.generate_dataset --quick
```

24 markets at 40k periods. **The numbers this produces are wrong on purpose** —
the bots haven't converged yet. It only proves the plumbing works.

> Careful: this overwrites `data/`. Run the full version below to restore real
> numbers, or `git checkout data/` to get the committed data back.

---

## 4. Regenerate everything properly

Run in this order. Step 1 is slow.

```bash
python -m sim.generate_dataset
```

**~8 minutes.** Simulates 200 markets for 600,000 periods each. Single-core and
CPU-bound, so your laptop will get warm and a slower machine may take 15 min.
Progress prints per batch. Writes `data/run_summary.csv`,
`data/price_series.csv`, `data/dashboard.json`, and auto-copies the payload into
`frontend/public/`.

Sanity check at the end — patient bots should land well above myopic ones:

```
collusive   grim_cartel  40  0.800
            q_patient    60  0.688
competitive br_noisy     40  0.090
            q_myopic     60  0.196
```

```bash
python -m sim.train_baseline
```

~30 s. Trains the detector, writes `data/model_report.json` (section 07).

```bash
python -m sim.real_data
```

Instant. Runs the scraped price data through the same feature extractor, writes
`data/real_data.json` (section 08). It finds `combined_prices.csv` at the repo
root automatically.

Then restart the frontend (step 2) to see the new numbers.

---

## What each file does

```
sim/market.py             demand model; solves the Nash and monopoly anchors
sim/engine.py             the Q-learning bots (vectorised over runs)
sim/features.py           the 19 detector features
sim/generate_dataset.py   train -> deploy -> probe; builds the dataset
sim/train_baseline.py     trains + evaluates the detector
sim/real_data.py          applies the features to real scraped prices
frontend/                 the dashboard (React + Vite)
data/                     generated output, committed so the UI runs standalone
```

The scrapers (`fuel_scraper.py`, `ecommerce_scraper.py`, `run_pipeline.py`) are a
separate concern — see the note below before running them.

---

## Troubleshooting

**Dashboard stuck on "Loading simulation dataset…"**
`frontend/public/dashboard.json` is missing. Copy it from `data/`:

```bash
cp data/dashboard.json data/model_report.json data/real_data.json frontend/public/
```

On Windows PowerShell:

```bash
Copy-Item data\dashboard.json,data\model_report.json,data\real_data.json frontend\public\
```

If `data/dashboard.json` doesn't exist either, it was never generated — run step 4.

**"Port 5174 is already in use"**
Something else is on that port. Either stop it, or run on another:

```bash
npm run dev --prefix frontend -- --port 5175
```

**`npm install` fails with ERESOLVE, or Vite won't start**
Node is too old for Vite 8. Check `node --version` — you need 20.19+ or 22.12+.

**`ModuleNotFoundError: No module named 'sim'`**
You're not in the repo root. `cd` to the folder containing the `sim/` directory.
Also note the commands use `-m sim.x` (a dot, not a slash).

**`python -m sim.generate_dataset` seems frozen**
It is working — the first batch takes ~2.5 min before printing anything. Wait for
`batch 1/3 ... trained 40 runs`.

**Simulation results look wrong**
You probably ran `--quick` last. Re-run step 4 without it.

---

## Before you run the scrapers

`run_pipeline.py` drives live requests at Amazon.in and a fuel-price aggregator,
and needs Selenium plus a matching chromedriver. You do **not** need it — the
scraped `combined_prices.csv` is already committed. Two things to know if you do
run it:

- It overwrites the committed CSVs.
- There are two known data bugs, documented in the README under findings 7–9.
  The most important: `fuel_scraper.py` reads one price per city and writes it
  three times, once per PSU label, so IOCL/BPCL/HPCL are copies of one number
  rather than three independent observations. Read that section before drawing
  any conclusion from the fuel data.
