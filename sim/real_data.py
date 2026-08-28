"""
Apply the detector's feature extraction to the REAL scraped price data.

Consumes `combined_prices.csv` produced by the scraping repo
(external/price-collusion-detector, by vishakha636), whose pipeline is:

    fuel_scraper.py  +  ecommerce_scraper.py  ->  normalize_schema.py
                                              ->  combined_prices.csv

Schema: date, timestamp, seller, product_id, product_name, price, city,
        availability, source

WHAT THIS MODULE IS FOR
-----------------------
The detector needs two sellers observed *independently and simultaneously* on
the same product. Neither current source delivers that, for two different
reasons, and the whole point of this module is to establish that precisely
rather than emit a risk score that would be meaningless:

  * ecommerce_amazon -- the recorded seller is whoever holds the Buy Box, so
    each ASIN yields exactly one seller per day. Rival sellers appear on
    *different* dates (the Buy Box changed hands), never side by side.

  * fuel_psu -- more fundamental. `fuel_scraper.parse_prices` reads a single
    city price off an aggregator page and then writes it three times, once per
    PSU label:

        if price is not None:
            for seller in FUEL_SELLERS:      # IOCL, BPCL, HPCL
                ... "seller": seller, "price": price

    So IOCL/BPCL/HPCL are three copies of one number. Any two-seller feature
    computed on such a pair compares a column with itself: price correlation
    1.000 and exact-matching 1.000 are arithmetic identities, not observations.
    Collecting more days cannot fix a duplicated column.

This module therefore detects duplicated seller series explicitly and refuses
to count them as comparable markets. Detecting that a "finding" is an artefact
of data construction is the useful output here.

It also computes only the features that are mathematically defined at the
observed series length and reports the rest as unavailable *with the reason*,
plus a readiness assessment for once a genuine multi-seller panel exists.

Run:  python -m sim.real_data
"""

from __future__ import annotations

import itertools
import json
import time
import warnings
from pathlib import Path

import numpy as np
import pandas as pd

from sim.features import (DETECTOR_FEATURES, LEVEL_SENSITIVE_FEATURES,
                          extract_features)

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"

# The scraped CSV lives in a different place depending on layout: at the repo
# root when this code sits inside the scraping repo, or under external/ when the
# scraping repo is cloned in as a sibling for local development.
CSV_CANDIDATES = [
    ROOT / "combined_prices.csv",
    ROOT / "external" / "price-collusion-detector" / "combined_prices.csv",
]


def find_scrape_csv() -> Path:
    """First existing candidate path, else the preferred one (for the error)."""
    for p in CSV_CANDIDATES:
        if p.is_file():
            return p
    return CSV_CANDIDATES[0]

# Periods each estimator needs before it is even defined. These are structural
# minima (what the formula requires), NOT the length at which the estimate
# becomes statistically trustworthy -- see RELIABLE_PERIODS.
FEATURE_MIN_PERIODS = {
    "gap_zero_frac": 2, "rel_gap_mean": 2, "rel_gap_max": 2,
    "cv_mean": 3, "change_freq": 3, "rel_step_mean": 3, "sync_change_rate": 3,
    "price_corr": 4, "diff_corr": 5, "autocorr1": 4,
    "entropy": 5, "state_hhi": 5, "n_states_frac": 5,
    "undercut_frac": 5, "retaliation_rate": 6, "lead_lag_strength": 6,
    "level_over_median_gap": 10, "level_over_min": 10,
    "rebound_after_low": 12,
}
RELIABLE_PERIODS = 30      # below this, any single estimate is noise
DETECTOR_PERIODS = 60      # minimum before applying the trained model at all
TRAINED_ON_PERIODS = 1000  # what the simulation actually trained on


def _source_diagnostics(df: pd.DataFrame, stats_by_source: dict) -> list[dict]:
    """Why each source does or does not yield comparable two-seller series.

    Three distinct failure modes, which need different fixes:
      * "duplicated series"  -- the sellers are copies of one parsed value. No
                                amount of extra collection helps.
      * "collection design"  -- rivals are never captured on the same date.
                                Needs a different scraping target.
      * "series length"      -- genuinely independent rivals, just too few days.
                                Needs time only.
    """
    out = []
    for src, g in df.groupby("source"):
        multi, overlaps = [], []
        for pid, gp in g.groupby("product_id"):
            per = gp.groupby("seller").date.apply(lambda s: set(s))
            if len(per) < 2:
                continue
            multi.append(pid)
            best = max((len(per[a] & per[b])
                        for a, b in itertools.combinations(per.index, 2)),
                       default=0)
            overlaps.append(best)

        max_ov = max(overlaps) if overlaps else 0
        st = stats_by_source.get(str(src), {})
        usable = st.get("usable", 0)
        dup_pairs = st.get("dup_pairs", 0)
        indep_pairs = st.get("indep_pairs", 0)

        if dup_pairs and not indep_pairs:
            blocker = "duplicated series"
            verdict = (f"not a multi-seller panel at all: all {dup_pairs} seller "
                       "pairs are exact duplicates of one another, because the "
                       "scraper reads a single price and writes it once per "
                       "seller label. Every two-seller feature on such a pair is "
                       "an identity, not a measurement, and more days cannot "
                       "change that")
        elif usable and max_ov >= 2:
            blocker = "series length"
            verdict = ("structurally sound: independent rival sellers are "
                       "observed on the same date, so the series only needs to "
                       "get longer")
        elif multi and max_ov <= 1:
            blocker = "collection design"
            verdict = ("the same product is almost never captured from two "
                       "sellers on the same date, so no simultaneous price pair "
                       "exists to compare")
        else:
            blocker = "collection design"
            verdict = ("only one seller per product is recorded, so there is "
                       "nothing to compare within a market")

        out.append({
            "source": str(src),
            "n_products": int(g.product_id.nunique()),
            "n_products_multi_seller": len(multi),
            "max_pair_overlap_days": int(max_ov),
            "usable_markets": int(usable),
            "duplicate_pairs": int(dup_pairs),
            "independent_pairs": int(indep_pairs),
            "blocker": blocker,
            "verdict": verdict,
        })
    return out


def _panel(group: pd.DataFrame) -> pd.DataFrame:
    """date x seller price panel for one market (duplicates averaged)."""
    return group.pivot_table(index="date", columns="seller", values="price",
                             aggfunc="mean").sort_index()


def _features_for_pair(p0: np.ndarray, p1: np.ndarray) -> tuple[dict, dict]:
    """Features for one seller pair, with under-length ones set to None."""
    n = len(p0)
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        with np.errstate(all="ignore"):
            try:
                raw = extract_features(p0, p1)
            except Exception:
                raw = {}

    out, unavailable = {}, {}
    for f in DETECTOR_FEATURES + LEVEL_SENSITIVE_FEATURES:
        need = FEATURE_MIN_PERIODS.get(f, 5)
        v = raw.get(f)
        if n < need:
            out[f] = None
            unavailable[f] = f"needs {need} periods, has {n}"
        elif v is None or not np.isfinite(v):
            out[f] = None
            unavailable[f] = "undefined (no variation in the series)"
        else:
            out[f] = round(float(v), 6)
    return out, unavailable


def build(csv_path: Path | None = None) -> dict:
    csv_path = csv_path or find_scrape_csv()
    if not csv_path.is_file():
        raise FileNotFoundError(
            "combined_prices.csv not found. Looked in:\n"
            + "\n".join(f"  {p}" for p in CSV_CANDIDATES)
            + "\n\nGenerate it with `python run_pipeline.py`, or clone the "
              "scraping repo alongside this one:\n"
              "  git clone https://github.com/vishakha636/Price-Collusion-detector.git "
              "external/price-collusion-detector")

    df = pd.read_csv(csv_path)
    df["price"] = pd.to_numeric(df["price"], errors="coerce")
    df = df.dropna(subset=["price", "seller", "date"])
    dates = sorted(df.date.unique())

    markets = []
    # A "market" is one product in one location: the unit within which sellers
    # actually compete, and therefore the unit the detector operates on.
    for (source, pid, city), g in df.groupby(["source", "product_id", "city"],
                                             dropna=False):
        pan = _panel(g)
        if pan.shape[1] < 2:
            continue                      # need at least two sellers to compare
        sellers = list(pan.columns)
        n_periods = int(pan.shape[0])

        pairs = []
        for i in range(len(sellers)):
            for j in range(i + 1, len(sellers)):
                sub = pan[[sellers[i], sellers[j]]].dropna()
                if len(sub) < 2:
                    continue
                a = sub[sellers[i]].to_numpy(float)
                b = sub[sellers[j]].to_numpy(float)
                feats, unavail = _features_for_pair(a, b)

                # Two sellers whose prices match at EVERY observation are not
                # two observations -- they are one value recorded twice. Every
                # comparative feature then degenerates to an identity, so such a
                # pair carries no information and must not be counted as a
                # comparable market.
                identical = float(np.mean(np.abs(a - b) < 1e-9))
                degenerate = bool(identical >= 1.0 - 1e-12)

                pairs.append({
                    "a": str(sellers[i]), "b": str(sellers[j]),
                    "n": int(len(sub)),
                    "identical_frac": round(identical, 4),
                    "degenerate": degenerate,
                    "degenerate_reason": (
                        "prices identical at every observation - these are not "
                        "independent measurements but one value duplicated "
                        "across seller labels" if degenerate else None),
                    "features": feats,
                    "n_available": sum(v is not None for v in feats.values()),
                    "n_unavailable": sum(v is None for v in feats.values()),
                    "unavailable": unavail,
                })
        if not pairs:
            continue

        name = str(g.product_name.iloc[0])
        markets.append({
            "key": f"{source}|{pid}|{city}",
            "source": str(source), "product_id": str(pid),
            "product_name": name[:110] + ("…" if len(name) > 110 else ""),
            "city": str(city),
            # A market only counts as comparable if at least one seller pair is
            # genuinely independent.
            "usable": any(not p["degenerate"] for p in pairs),
            "n_degenerate_pairs": sum(p["degenerate"] for p in pairs),
            "sellers": [str(s) for s in sellers],
            "n_sellers": len(sellers), "n_periods": n_periods,
            "dates": [str(d) for d in pan.index],
            "series": {str(s): [None if pd.isna(v) else round(float(v), 2)
                                for v in pan[s]] for s in sellers},
            "mean_price": round(float(np.nanmean(pan.to_numpy(float))), 2),
            "pairs": pairs,
        })

    markets.sort(key=lambda m: (not m["usable"], -m["n_periods"], m["key"]))

    # Readiness is measured over USABLE markets only. Counting degenerate ones
    # would report the project as further along than it is.
    usable_markets = [m for m in markets if m["usable"]]
    per_len = [m["n_periods"] for m in usable_markets]
    by_source = {}
    for src, g in df.groupby("source"):
        by_source[str(src)] = {
            "rows": int(len(g)), "sellers": int(g.seller.nunique()),
            "products": int(g.product_id.nunique()),
            "cities": int(g.city.nunique()), "dates": int(g.date.nunique()),
        }

    max_len = max(per_len) if per_len else 0
    stats_by_source = {}
    for m in markets:
        s = stats_by_source.setdefault(
            m["source"], {"usable": 0, "dup_pairs": 0, "indep_pairs": 0})
        s["usable"] += 1 if m["usable"] else 0
        s["dup_pairs"] += sum(p["degenerate"] for p in m["pairs"])
        s["indep_pairs"] += sum(not p["degenerate"] for p in m["pairs"])
    diagnostics = _source_diagnostics(df, stats_by_source)
    observed_max = max((m["n_periods"] for m in markets), default=0)

    # Secondary data-quality check: distinct cities returning byte-identical
    # series is not credible for Indian retail fuel, where state VAT differs.
    # It suggests the city parameter is not reaching the parsed value.
    quality = []
    for src, g in df.groupby("source"):
        if g.city.nunique() < 2:
            continue
        piv = g.pivot_table(index="date", columns="city", values="price",
                            aggfunc="mean")
        groups = {}
        for c in piv.columns:
            groups.setdefault(tuple(np.round(piv[c].to_numpy(float), 4)),
                              []).append(str(c))
        dupes = [v for v in groups.values() if len(v) > 1]
        if dupes:
            quality.append({
                "source": str(src),
                "issue": "identical series across distinct cities",
                "groups": dupes,
                "detail": ("these cities return the same price on every "
                           "observed date; Indian retail fuel prices differ by "
                           "city because state VAT differs, so the city "
                           "parameter is likely not reaching the parsed value"),
            })

    return {
        "meta": {
            "generated_at": time.strftime("%Y-%m-%d %H:%M:%S"),
            "source_repo": "github.com/vishakha636/Price-Collusion-detector",
            "source_file": csv_path.name,
            "n_rows": int(len(df)),
            "dates": [str(d) for d in dates],
            "n_dates": len(dates),
            "by_source": by_source,
            "source_diagnostics": diagnostics,
            "data_quality": quality,
            "reliable_periods": RELIABLE_PERIODS,
            "detector_periods": DETECTOR_PERIODS,
            "trained_on_periods": TRAINED_ON_PERIODS,
            "feature_requirements": [
                {"feature": f, "min_periods": FEATURE_MIN_PERIODS.get(f, 5),
                 "defined_now": max_len >= FEATURE_MIN_PERIODS.get(f, 5)}
                for f in DETECTOR_FEATURES + LEVEL_SENSITIVE_FEATURES],
        },
        "readiness": {
            "n_markets": len(usable_markets),
            "n_markets_inspected": len(markets),
            "n_markets_degenerate": len(markets) - len(usable_markets),
            "max_periods": max_len,
            "observed_max_periods": observed_max,
            "features_defined_at_observed": sum(
                1 for f in DETECTOR_FEATURES
                if observed_max >= FEATURE_MIN_PERIODS.get(f, 5)),
            "median_periods": int(np.median(per_len)) if per_len else 0,
            "features_defined_now": sum(
                1 for f in DETECTOR_FEATURES
                if max_len >= FEATURE_MIN_PERIODS.get(f, 5)),
            "features_total": len(DETECTOR_FEATURES),
            "more_periods_needed": max(DETECTOR_PERIODS - max_len, 0),
            "days_at_1_scrape_per_day": max(DETECTOR_PERIODS - max_len, 0),
            "days_at_4_scrapes_per_day": int(
                np.ceil(max(DETECTOR_PERIODS - max_len, 0) / 4)),
        },
        "markets": markets,
    }


def main():
    payload = build()
    DATA.mkdir(exist_ok=True)
    blob = json.dumps(payload)
    (DATA / "real_data.json").write_text(blob, encoding="utf-8")
    public = ROOT / "frontend" / "public"
    if public.is_dir():
        (public / "real_data.json").write_text(blob, encoding="utf-8")

    m, r = payload["meta"], payload["readiness"]
    print(f"Source: {m['source_file']}  ({m['n_rows']} rows, "
          f"{m['n_dates']} dates: {m['dates'][0]} .. {m['dates'][-1]})")
    for src, s in m["by_source"].items():
        print(f"  {src:20s} {s['rows']:5d} rows  {s['sellers']:3d} sellers  "
              f"{s['products']:4d} products  {s['cities']:2d} cities")

    print(f"\nMarkets inspected (>=2 seller labels, same product+city): "
          f"{r['n_markets_inspected']}")
    print(f"  of which genuinely comparable: {r['n_markets']}")
    print(f"  of which degenerate (duplicated series): {r['n_markets_degenerate']}")
    print(f"\n{'market':<38s} {'sellers':>7s} {'periods':>7s} {'identical':>10s} "
          f"{'status':>12s}")
    for mk in payload["markets"][:12]:
        idf = np.mean([p["identical_frac"] for p in mk["pairs"]])
        label = f"{mk['source'].replace('ecommerce_','')}/{mk['city']}/{mk['product_id']}"
        status = "comparable" if mk["usable"] else "DEGENERATE"
        print(f"{label[:38]:<38s} {mk['n_sellers']:>7d} {mk['n_periods']:>7d} "
              f"{idf:>9.0%} {status:>12s}")

    print(f"\nPER-SOURCE DIAGNOSIS")
    for d in m["source_diagnostics"]:
        print(f"  {d['source']}")
        print(f"    products {d['n_products']}, of which multi-seller "
              f"{d['n_products_multi_seller']}; best same-date overlap "
              f"{d['max_pair_overlap_days']} day(s); usable markets "
              f"{d['usable_markets']}")
        print(f"    blocker = {d['blocker']}: {d['verdict']}")

    if m["data_quality"]:
        print(f"\nDATA-QUALITY FLAGS")
        for q in m["data_quality"]:
            print(f"  [{q['source']}] {q['issue']}")
            for grp in q["groups"]:
                print(f"    identical: {', '.join(grp)}")
            print(f"    {q['detail']}")

    print(f"\nREADINESS")
    print(f"  longest real series          {r['max_periods']} periods")
    print(f"  detector was trained on      {m['trained_on_periods']} periods")
    print(f"  features defined at present  {r['features_defined_now']}/{r['features_total']}")
    print(f"  minimum to apply detector    {m['detector_periods']} periods "
          f"-> {r['days_at_1_scrape_per_day']} more days at 1 scrape/day, "
          f"{r['days_at_4_scrapes_per_day']} at 4/day")
    print(f"\nWrote {DATA/'real_data.json'}")


if __name__ == "__main__":
    main()
