"""
Brands on the German fuel market: do rival chains move prices together, and
who leads?

1. Brand level, 2015-2019: median E5 price per brand on each sampled day.
   Rivals rise and fall together here mostly because crude oil does -- a
   common cost, shown as the "not evidence on its own" baseline.
2. Street level, within the day: pairs of rival stations (Aral / Shell / Esso
   / Total / JET) within 1 km. For every price RISE at one station, does the
   neighbour raise too within 60 minutes, and how fast? Same for CUTS. The
   Bundeskartellamt's fuel sector inquiry (2011) found that Aral or Shell
   initiate nearly all price increases and the others follow; this measures
   that on the raw data.

    python -m bench.fuel_de_brands     # writes data/fuel_de_brands.json
"""

from __future__ import annotations

import json
from collections import defaultdict
from pathlib import Path

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parent.parent
CACHE = ROOT / "data" / "fuel_de_cache"
OUT = ROOT / "data" / "fuel_de_brands.json"
BRANDS = ["ARAL", "SHELL", "ESSO", "TOTAL", "JET"]
WINDOW_MIN = 60


def brand_of(raw: str) -> str | None:
    b = str(raw).upper()
    for k in BRANDS:
        if k in b:
            return k
    return None


def main():
    st = pd.read_csv(CACHE / "stations.csv")
    st["b"] = st.brand.map(brand_of)
    st = st.dropna(subset=["b", "latitude", "longitude"])
    brand = dict(zip(st.uuid, st.b))

    # rival pairs within 1 km (different brands)
    lat, lon, ids, bs = st.latitude.to_numpy(), st.longitude.to_numpy(), st.uuid.to_numpy(), st.b.to_numpy()
    order = np.argsort(lat)
    pairs = []
    for ii, i in enumerate(order):
        for jj in range(ii + 1, len(order)):
            j = order[jj]
            if lat[j] - lat[i] > 0.01:
                break
            if bs[i] == bs[j]:
                continue
            r = np.pi / 180
            a = np.sin((lat[j] - lat[i]) * r / 2) ** 2 + np.cos(lat[i] * r) * np.cos(lat[j] * r) * np.sin((lon[j] - lon[i]) * r / 2) ** 2
            if 12742 * np.arcsin(np.sqrt(a)) <= 1.0:
                pairs.append((ids[i], ids[j]))
    print(f"rival pairs within 1 km: {len(pairs)}", flush=True)
    pair_set = defaultdict(list)
    for a, b in pairs:
        pair_set[a].append(b)
        pair_set[b].append(a)

    brand_daily = defaultdict(dict)
    # leader -> follower counts, split by rises / cuts
    lead = {"rise": defaultdict(lambda: [0, 0, []]), "cut": defaultdict(lambda: [0, 0, []])}
    example = None
    for f in sorted(CACHE.glob("*.parquet")):
        day = f.stem
        d = pd.read_parquet(f, columns=["date", "station_uuid", "e5", "e5change"])
        d = d[(d.e5 > 500) & (d.e5 < 2500)]
        d["b"] = d.station_uuid.map(brand)
        for b, g in d.dropna(subset=["b"]).groupby("b"):
            brand_daily[b][day] = float(g.e5.median())
        if day < "2018-01-01":
            continue                                      # street-level analysis: 2018-19
        ev = d[(d.e5change == 1) & d.station_uuid.isin(pair_set.keys())].sort_values("date")
        ev = ev.assign(prev=ev.groupby("station_uuid").e5.shift()).dropna(subset=["prev"])
        ev["dir"] = np.sign(ev.e5 - ev.prev)
        ev["ns"] = ev.date.astype("int64")
        by_st = {k: g for k, g in ev.groupby("station_uuid")}
        # per station: sorted times of rises and of cuts (nanoseconds)
        times = {k: {1: g.ns[g.dir == 1].to_numpy(), -1: g.ns[g.dir == -1].to_numpy()} for k, g in by_st.items()}
        win = WINDOW_MIN * 60 * 10**9
        for a in times:
            for b in pair_set[a]:
                tb = times.get(b)
                for kind, sgn in (("rise", 1), ("cut", -1)):
                    ta = times[a][sgn]
                    if not len(ta):
                        continue
                    rec = lead[kind][(brand[a], brand[b])]
                    rec[0] += len(ta)
                    if tb is None or not len(tb[sgn]):
                        continue
                    idx = np.searchsorted(tb[sgn], ta)            # first rival move at/after each move
                    ok = idx < len(tb[sgn])
                    lag = np.full(len(ta), np.inf)
                    lag[ok] = (tb[sgn][idx[ok]] - ta[ok]) / 6e10  # minutes
                    hit = lag <= WINDOW_MIN
                    rec[1] += int(hit.sum())
                    rec[2].extend(lag[hit].tolist())
        # keep one illustrative Aral-Shell day
        if example is None and day >= "2018-06-01":
            for a, b in pairs:
                if {brand[a], brand[b]} == {"ARAL", "SHELL"} and a in by_st and b in by_st and len(by_st[a]) >= 8 and len(by_st[b]) >= 8:
                    aral, shell = (a, b) if brand[a] == "ARAL" else (b, a)
                    series = lambda u: [{"t": x.date.strftime("%H:%M"), "p": int(x.e5)} for x in d[d.station_uuid == u].sort_values("date").itertuples()]
                    example = {"day": day, "aral": series(aral), "shell": series(shell)}
                    break

    def summ(kind):
        out = []
        for (ba, bb), (n, k, lags) in lead[kind].items():
            if n >= 200:
                out.append({"leader": ba, "follower": bb, "moves": n, "followed": round(k / n, 3),
                            "median_lag_min": round(float(np.median(lags)), 1) if lags else None})
        return sorted(out, key=lambda x: -x["followed"])

    rises, cuts = summ("rise"), summ("cut")
    brand_series = [{"day": dday, **{b: brand_daily[b].get(dday) for b in BRANDS}}
                    for dday in sorted({x for v in brand_daily.values() for x in v})]
    corr = pd.DataFrame(brand_series).set_index("day")[BRANDS].pct_change().corr().round(2)
    report = {
        "brands": BRANDS, "brand_daily": brand_series,
        "brand_daily_change_corr": corr.to_dict(),
        "window_min": WINDOW_MIN, "pairs": len(pairs),
        "rises": rises, "cuts": cuts, "example": example,
    }
    OUT.write_text(json.dumps(report, indent=1), encoding="utf-8")
    print("price RISES followed by the rival within 60 min (2018-19):")
    for x in rises[:10]:
        print(f"  {x['leader']:6} -> {x['follower']:6} followed {x['followed']:.0%} of {x['moves']}, median {x['median_lag_min']} min")
    print("price CUTS followed within 60 min:")
    for x in cuts[:10]:
        print(f"  {x['leader']:6} -> {x['follower']:6} followed {x['followed']:.0%} of {x['moves']}, median {x['median_lag_min']} min")
    print("brand day-to-day change correlation:\n", corr.to_string())
    print(f"saved {OUT}")


if __name__ == "__main__":
    main()
