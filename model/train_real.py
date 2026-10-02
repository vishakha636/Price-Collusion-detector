"""
Build the REAL training set: pairs of real Indian e-commerce listings with
labels that are certain.

  label 1 = rival pair      same store, same category, different brands
  label 0 = unrelated pair  same store, different category (e.g. perfume vs
                            suitcase) -- they cannot coordinate prices

Data: ~480 listings of daily prices (pricehistoryapp.com public pages, see
bench/pha_harvest.py). A model trained on this learns how much co-movement is
normal between products on the same store, and scores how far a pair goes
beyond that. A high score = unusual co-movement for a rival pair; it is a
screening signal, not proof of collusion.

Features are interaction-only and chance-adjusted, computed with sale days
removed (days when 30%+ of a store's listings moved the same way). No price
levels: rivals have similar prices by definition, and a model that saw levels
would learn "similar price = rival".

    python model/train_real.py        # -> model/real_pairs.csv
"""

from __future__ import annotations

import sys
from itertools import combinations
from pathlib import Path

import warnings

import numpy as np
import pandas as pd

warnings.filterwarnings("ignore", category=RuntimeWarning)

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(HERE))

WINDOW = 2              # days to count a reply
MIN_OVERLAP = 90        # days both listings were observed
SHIFTS = [d for d in range(30, 91, 10)] + [-d for d in range(30, 91, 10)]   # placebo offsets
REAL_FEATURES = ["rise_lift", "cut_lift", "rise_follow", "cut_follow", "diff_corr", "excess_sync",
                 "gap_cv", "lead_lag_ret"]
# the sticky-simulation detector's features (how the two prices relate, no levels),
# kept with each real pair so its scores can be ranked against real rival pairs
INTERACTION = ["price_corr", "diff_corr", "sync_change_rate", "retaliation_rate", "undercut_frac", "lead_lag_strength"]


def _days(idx) -> np.ndarray:
    return np.asarray(idx.values.astype("datetime64[D]").astype(int))


def _follow(a: np.ndarray, b: np.ndarray, shift: int = 0) -> tuple[int, int]:
    """How many of a's moves were matched by a move of b within WINDOW days."""
    if not len(a) or not len(b):
        return 0, len(a)
    bb = np.sort(b + shift)
    i = np.searchsorted(bb, a)
    ok = i < len(bb)
    lag = np.full(len(a), 10 ** 9)
    lag[ok] = bb[i[ok]] - a[ok]
    return int((lag <= WINDOW).sum()), len(a)


def _rate(a, b):
    """Two-way follow rate and its chance level (placebo shifts)."""
    k1, n1 = _follow(a, b)
    k2, n2 = _follow(b, a)
    n = n1 + n2
    if n == 0:
        return np.nan, np.nan
    plc = np.mean([(_follow(a, b, s)[0] + _follow(b, a, s)[0]) / n for s in SHIFTS])
    return (k1 + k2) / n, plc


def pair_features(sa: pd.Series, sb: pd.Series, drop: dict | None = None, min_overlap: int = MIN_OVERLAP) -> dict | None:
    """Daily price series of two listings -> interaction features (None if too little overlap)."""
    lo, hi = max(sa.index[0], sb.index[0]), min(sa.index[-1], sb.index[-1])
    if (hi - lo).days < min_overlap:
        return None
    a, b = sa[lo:hi], sb[lo:hi]
    ra, rb = a.pct_change(), b.pct_change()
    moves = {}
    for name, r in (("a", ra), ("b", rb)):
        for sign in (1, -1):
            idx = r.index[(r * sign) > 0.01]
            if drop:
                idx = idx[~idx.isin(drop.get(sign, set()))]
            moves[(name, sign)] = _days(idx)
    if len(moves[("a", 1)]) + len(moves[("b", 1)]) < 4:
        return None
    rise, rise_plc = _rate(moves[("a", 1)], moves[("b", 1)])
    cut, cut_plc = _rate(moves[("a", -1)], moves[("b", -1)])
    ok = ra.notna() & rb.notna()
    if drop:
        sale = ra.index.isin(drop.get(1, set()) | drop.get(-1, set()))
        ok &= ~sale
    x, y = ra[ok].to_numpy(), rb[ok].to_numpy()
    diff_corr = float(np.corrcoef(x, y)[0, 1]) if x.std() > 1e-12 and y.std() > 1e-12 else 0.0
    ma, mb = np.abs(x) > 0.01, np.abs(y) > 0.01
    same_dir = ((np.sign(x) == np.sign(y)) & ma & mb).mean()
    excess_sync = float(same_dir - 0.5 * ma.mean() * mb.mean())     # beyond independent movers
    ratio = (a / b).dropna()
    gap_cv = float(ratio.std() / ratio.mean()) if len(ratio) > 2 else np.nan
    lead = 0.0
    for L in (1, 2, 3):
        for u, v in ((x, y), (y, x)):
            if len(u) > L + 5 and u[:-L].std() > 1e-12 and v[L:].std() > 1e-12:
                lead = max(lead, abs(float(np.corrcoef(u[:-L], v[L:])[0, 1])))
    f = {"rise_follow": rise, "rise_lift": rise - rise_plc, "cut_follow": cut,
         "cut_lift": (cut - cut_plc) if not np.isnan(cut) else np.nan,
         "diff_corr": diff_corr, "excess_sync": excess_sync, "gap_cv": gap_cv, "lead_lag_ret": lead,
         "days": (hi - lo).days}
    return {k: (0.0 if (isinstance(v, float) and np.isnan(v)) else v) for k, v in f.items()}


def main():
    sys.stdout.reconfigure(encoding="utf-8")
    from bench.pha_analyse import find_market_days, load
    prods = load()
    md, _ = find_market_days(prods)
    print(f"{len(prods)} real listings")
    rng = np.random.default_rng(0)
    rows = []
    by_store: dict[str, list] = {}
    for p in prods:
        by_store.setdefault(p["store"], []).append(p)

    from priceguard_model import extract_features

    def add(pa, pb, label):
        drop = {1: md.get((pa["store"], 1), set()), -1: md.get((pa["store"], -1), set())}
        f = pair_features(pa["s"], pb["s"], drop)
        if f:
            both = pd.concat([pa["s"], pb["s"]], axis=1).ffill().dropna()
            sim = (extract_features(both.iloc[:, 0].to_numpy(), both.iloc[:, 1].to_numpy()) if len(both) >= 20
                   else {k: np.nan for k in INTERACTION})
            rows.append({**f, **{f"sim_{k}": sim[k] for k in INTERACTION}, "label": label, "store": pa["store"],
                         "cat_a": pa["category"], "cat_b": pb["category"], "brand_a": pa["brand"], "brand_b": pb["brand"]})

    for st, ps in by_store.items():
        for pa, pb in combinations(ps, 2):
            if pa["brand"].upper() == pb["brand"].upper():
                continue
            if pa["category"] == pb["category"]:
                add(pa, pb, 1)
    n_rival = len(rows)
    target = 3 * n_rival            # unrelated pairs: about 3 per rival pair
    tries = 0
    while len(rows) - n_rival < target and tries < target * 20:
        tries += 1
        st = rng.choice([k for k, v in by_store.items() if len(v) >= 2])
        i, j = rng.choice(len(by_store[st]), 2, replace=False)
        pa, pb = by_store[st][i], by_store[st][j]
        if pa["category"] != pb["category"] and pa["brand"].upper() != pb["brand"].upper():
            add(pa, pb, 0)
    df = pd.DataFrame(rows)
    out = HERE / "real_pairs.csv"
    df.to_csv(out, index=False)
    print(f"{(df.label == 1).sum()} rival pairs, {(df.label == 0).sum()} unrelated pairs -> {out}")
    print(df.groupby("label")[REAL_FEATURES].mean().round(3).T.to_string())


if __name__ == "__main__":
    main()
