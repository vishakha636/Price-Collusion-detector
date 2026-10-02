"""
Sticky simulation: the 200 simulated markets, observed the way real shops
post prices.

In the simulator a bot decides a price every period. Real shops change their
posted price on ~19% of days. Here each seller's posted price only updates on
a random share q of days (q drawn per copy, 0.10-0.50); in between, the last
posted price stays on the page. The collusive/competitive labels come from the
original simulation (collusion index), so they are unchanged.

Three thinned copies per market (600 rows); evaluation groups copies of the
same market together so a market is never in train and test at once.

    python model/train_sticky.py      # -> model/sticky_summary.csv
"""

from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
import pandas as pd

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
sys.path.insert(0, str(HERE))

from priceguard_model import DETECTOR_FEATURES, extract_features   # noqa: E402

COPIES = 3
TAIL = 400            # periods used (~ a year and a month of days)


def thin(p: np.ndarray, q: float, rng) -> np.ndarray:
    """Posted price: updates to the bot's price only on a random share q of periods."""
    upd = rng.random(len(p)) < q
    upd[0] = True
    idx = np.maximum.accumulate(np.where(upd, np.arange(len(p)), 0))
    return p[idx]


def main():
    ps = pd.read_csv(ROOT / "data" / "price_series.csv")
    rs = pd.read_csv(ROOT / "data" / "run_summary.csv").set_index("run_id")
    rng = np.random.default_rng(11)
    rows = []
    for rid, g in ps.groupby("run_id"):
        p0, p1 = g.price_0.to_numpy()[-TAIL:], g.price_1.to_numpy()[-TAIL:]
        for c in range(COPIES):
            q = float(rng.uniform(0.10, 0.50))
            f = extract_features(thin(p0, q, rng), thin(p1, q, rng))
            rows.append({"run_id": rid, "copy": c, "q": round(q, 3), "regime": rs.loc[rid, "regime"],
                         "label": rs.loc[rid, "label"], "delta": rs.loc[rid, "delta"], **f})
    df = pd.DataFrame(rows)
    out = HERE / "sticky_summary.csv"
    df.to_csv(out, index=False)
    print(f"{len(df)} rows ({df.run_id.nunique()} markets x {COPIES}) -> {out}")
    print("price changes per day:", df.groupby("label").change_freq.mean().round(3).to_dict())
    print("day-to-day stickiness:", df.groupby("label").autocorr1.mean().round(3).to_dict())


if __name__ == "__main__":
    main()
