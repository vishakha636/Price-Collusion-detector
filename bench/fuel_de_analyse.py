"""
Analysis for the German fuel benchmark (see bench/fuel_de.py).

Assad et al. (JPE 2024) identify algorithm adoption by structural breaks in
"AP markers", above all the number of price changes a station makes per day,
because adoption dates are not observed. We do the same, blind:

  1. market-wide break: when did the average number of daily price changes
     jump? Found by least-squares search for mean shifts (Bai-Perron style,
     no date supplied);
  2. station-level breaks: for every station, the best single mean shift in
     its daily change count; a station "switches" if the shift is large and
     statistically clear;
  3. local duopolies: pairs of stations within 1 km with no other station
     nearby. Compare how their prices moved relative to the national median
     from 2015-16 to 2018-19 when both switched, one switched, or neither.

Prices are E5 (petrol) in tenths of a cent. "Relative price" is a station's
median E5 price that day minus the national median that day, which strips out
common cost movements (crude oil, taxes) -- a proxy for margin, since station
wholesale costs are not observed.
"""

from __future__ import annotations

import json
from pathlib import Path

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parent.parent
CACHE = ROOT / "data" / "fuel_de_cache"
OUT = ROOT / "data" / "fuel_de_report.json"


def load_days() -> tuple[pd.DataFrame, pd.DataFrame]:
    """Per station per sampled day: number of E5 changes and median E5 price."""
    counts, prices = {}, {}
    for f in sorted(CACHE.glob("*.parquet")):
        day = f.stem
        d = pd.read_parquet(f, columns=["station_uuid", "e5", "e5change"])
        d = d[(d.e5 > 500) & (d.e5 < 2500)]               # drop 0 / garbage prices
        ch = d[d.e5change == 1]
        counts[day] = ch.groupby("station_uuid").size()
        prices[day] = d.groupby("station_uuid").e5.median()
    C = pd.DataFrame(counts).fillna(0).astype(np.int16)       # stations x days
    P = pd.DataFrame(prices)
    return C, P


def best_break(y: np.ndarray, min_seg: int = 8) -> tuple[int, float]:
    """Single mean-shift break minimising total squared error. Returns (index, SSE gain share)."""
    n = len(y)
    cs, cs2 = np.cumsum(y), np.cumsum(y * y)
    total = cs2[-1] - cs[-1] ** 2 / n
    best, arg = np.inf, None
    for k in range(min_seg, n - min_seg):
        a = cs2[k - 1] - cs[k - 1] ** 2 / k
        b = (cs2[-1] - cs2[k - 1]) - (cs[-1] - cs[k - 1]) ** 2 / (n - k)
        if a + b < best:
            best, arg = a + b, k
    return arg, 1 - best / total if total > 0 else 0.0


def segment(y: np.ndarray, max_breaks: int = 3, min_seg: int = 8) -> list[int]:
    """Multiple breaks by binary segmentation, keeping a split only if it lowers BIC."""
    n = len(y)

    def sse(a, b):
        s = y[a:b]
        return float(((s - s.mean()) ** 2).sum())

    def bic(bks):
        edges = [0, *sorted(bks), n]
        rss = sum(sse(a, b) for a, b in zip(edges, edges[1:]))
        return n * np.log(max(rss / n, 1e-12)) + (2 * len(bks) + 1) * np.log(n)

    bks: list[int] = []
    while len(bks) < max_breaks:
        edges = [0, *sorted(bks), n]
        cand = None
        for a, b in zip(edges, edges[1:]):
            if b - a < 2 * min_seg:
                continue
            k, _ = best_break(y[a:b], min_seg)
            if k is not None and (cand is None or bic(bks + [a + k]) < cand[1]):
                cand = (a + k, bic(bks + [a + k]))
        if cand is None or cand[1] >= bic(bks):
            break
        bks.append(cand[0])
    return sorted(bks)


def haversine_km(lat1, lon1, lat2, lon2):
    r = np.pi / 180
    a = np.sin((lat2 - lat1) * r / 2) ** 2 + np.cos(lat1 * r) * np.cos(lat2 * r) * np.sin((lon2 - lon1) * r / 2) ** 2
    return 12742 * np.arcsin(np.sqrt(a))


def main():
    C, P = load_days()
    days = list(C.columns)
    print(f"{C.shape[0]} stations x {len(days)} sampled days")

    # stations observed throughout (active in first and last half-year)
    active = (C.iloc[:, :26] > 0).sum(axis=1).ge(13) & (C.iloc[:, -26:] > 0).sum(axis=1).ge(13)
    Ca = C[active]
    nat = Ca.mean(axis=0).to_numpy(dtype=float)               # avg changes per station-day
    breaks = segment(nat)
    print("market-wide breaks:", [days[b] for b in breaks])

    # station-level breaks in change frequency
    rows = []
    for uuid, y in Ca.iterrows():
        y = y.to_numpy(dtype=float)
        k, gain = best_break(y)
        pre, post = y[:k].mean(), y[k:].mean()
        pooled = np.sqrt((y[:k].var(ddof=1) / k) + (y[k:].var(ddof=1) / (len(y) - k))) or 1e-9
        t = (post - pre) / pooled
        rows.append((uuid, days[k], pre, post, t))
    S = pd.DataFrame(rows, columns=["uuid", "break_day", "pre", "post", "t"]).set_index("uuid")
    S["switch"] = (S.post - S.pre >= 2) & (S.post >= 1.5 * S.pre) & (S.t >= 5)
    sw = S[S.switch]
    by_q = pd.to_datetime(sw.break_day).dt.to_period("Q").astype(str).value_counts().sort_index()
    print(f"stations switching to more frequent repricing: {len(sw)}/{len(S)}")
    print(by_q.to_string())

    # local duopolies: exactly one other station within 1 km, each other's only neighbour
    st = pd.read_csv(CACHE / "stations.csv").set_index("uuid")
    st = st[st.index.isin(S.index)].dropna(subset=["latitude", "longitude"])
    lat, lon = st.latitude.to_numpy(), st.longitude.to_numpy()
    ids = st.index.to_numpy()
    neigh = {}
    order = np.argsort(lat)
    for ii, i in enumerate(order):                       # sweep on latitude (~0.009 deg = 1 km)
        near = []
        for jj in range(ii + 1, len(order)):
            j = order[jj]
            if lat[j] - lat[i] > 0.01:
                break
            if haversine_km(lat[i], lon[i], lat[j], lon[j]) <= 1.0:
                near.append(j)
        for j in near:
            neigh.setdefault(i, []).append(j)
            neigh.setdefault(j, []).append(i)
    pairs = [(ids[i], ids[v[0]]) for i, v in neigh.items() if len(v) == 1 and len(neigh[v[0]]) == 1 and i < v[0]]
    print(f"local duopolies: {len(pairs)}")

    rel = P.sub(P.median(axis=0), axis=1)                     # price minus national median, per day
    early = [d for d in days if d < "2017-01-01"]
    late = [d for d in days if d >= "2018-01-01"]
    groups = {"both": [], "one": [], "neither": []}
    for a, b in pairs:
        n_sw = int(S.switch.get(a, False)) + int(S.switch.get(b, False))
        g = "both" if n_sw == 2 else "one" if n_sw == 1 else "neither"
        before = rel.loc[[a, b], early].mean(axis=1).mean()
        after = rel.loc[[a, b], late].mean(axis=1).mean()
        if np.isfinite(before) and np.isfinite(after):
            groups[g].append(after - before)
    duo = {g: {"pairs": len(v), "change_tenth_cent": round(float(np.mean(v)), 2) if v else None,
               "se": round(float(np.std(v, ddof=1) / np.sqrt(len(v))), 2) if len(v) > 1 else None}
           for g, v in groups.items()}
    print("duopolies, change in relative price 2015-16 -> 2018-19 (tenths of a cent):", duo)

    report = {
        "source": "Tankerkönig / MTS-K via github.com/Babalion/tankerkoenig-data-parquet (CC BY 4.0)",
        "sample": f"{len(days)} Tuesdays, {days[0]} to {days[-1]}",
        "stations_observed": int(len(Ca)),
        "national": [{"day": d, "changes": round(float(v), 3)} for d, v in zip(days, nat)],
        "market_breaks": [days[b] for b in breaks],
        "station_switch": {"switched": int(len(sw)), "of": int(len(S)),
                           "median_before": round(float(sw.pre.median()), 2),
                           "median_after": round(float(sw.post.median()), 2),
                           "by_quarter": by_q.to_dict()},
        "duopolies": duo,
    }
    OUT.write_text(json.dumps(report, indent=1), encoding="utf-8")
    print(f"saved {OUT}")


if __name__ == "__main__":
    main()
