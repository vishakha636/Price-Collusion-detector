"""
Screen the harvested Indian listings (bench/pha_harvest.py) for rival brands
whose prices move together.

For every pair of different brands in the same category on the same store,
with at least 90 days of overlapping daily prices:
  * rises / cuts: day-to-day price moves (> 1%);
  * follow rate: share of A's rises matched by a B rise within WINDOW days;
  * placebo: the same with B's dates shifted by 30..90 days -- the rate you
    would get by chance given how often both reprice;
  * lift = follow rate - placebo. A pair is flagged when both directions
    beat chance clearly and there are enough rises to judge.
  * sale days: every rate is also computed with market-wide moves removed --
    days when 30%+ of a store's listings (5+) moved the same way, plus the day
    after. Same rule as frontend/src/watch/marketDays.js.

    python -m bench.pha_analyse          # -> data/pha_report.json
"""

from __future__ import annotations

import json
import sys
from itertools import combinations
from pathlib import Path

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parent.parent
CACHE = ROOT / "data" / "pha_cache"
OUT = ROOT / "data" / "pha_report.json"
WINDOW = 2
MIN_OVERLAP = 90
MIN_RISES = 4
MARKET = {"share": 0.3, "min_moved": 5, "min_active": 10}
MARKET_DAYS: dict[tuple[str, int], set] = {}     # (store, +1/-1) -> dates to drop (market day and the day after)


def find_market_days(prods: list[dict]) -> dict:
    out, summary = {}, {}
    by_store: dict[str, list] = {}
    for p in prods:
        by_store.setdefault(p["store"], []).append(p["s"])
    for st, series in by_store.items():
        w = pd.concat(series, axis=1)
        ch = w.pct_change(fill_method=None)
        active = w.notna().sum(axis=1)
        for sign in (1, -1):
            moved = ((ch * sign) > 0.01).sum(axis=1)
            hit = (active >= MARKET["min_active"]) & (moved >= MARKET["min_moved"]) & (moved / active >= MARKET["share"])
            days = set(w.index[hit])
            out[(st, sign)] = days | {d + pd.Timedelta(days=1) for d in days}
            summary[f"{st} {'up' if sign > 0 else 'down'}"] = len(days)
    return out, summary


def load() -> list[dict]:
    out = []
    for f in CACHE.glob("*.json"):
        p = json.loads(f.read_text(encoding="utf-8"))
        if p.get("synthetic") or len(p["history"]) < 60 or not p.get("brand"):
            continue
        s = pd.Series({pd.Timestamp(h["d"]): float(h["p"]) for h in p["history"]}).sort_index()
        s = s[~s.index.duplicated()].asfreq("D").ffill(limit=3)
        p["s"] = s
        out.append(p)
    return out


def moves(s: pd.Series, sign: int, store: str | None = None) -> pd.DatetimeIndex:
    """Day-to-day moves > 1% in direction `sign`; with `store`, market-wide days are dropped."""
    r = s.pct_change()
    idx = r.index[(r * sign) > 0.01]
    if store is not None:
        idx = idx[~idx.isin(MARKET_DAYS.get((store, sign), set()))]
    return idx


def follow(a: pd.DatetimeIndex, b: pd.DatetimeIndex, shift_days: int = 0) -> tuple[int, int]:
    if not len(a):
        return 0, 0
    bb = np.sort((b + pd.Timedelta(days=shift_days)).values.astype("datetime64[D]").astype(int))
    aa = a.values.astype("datetime64[D]").astype(int)
    idx = np.searchsorted(bb, aa)
    ok = idx < len(bb)
    lag = np.full(len(aa), 10**9)
    lag[ok] = bb[idx[ok]] - aa[ok]
    return int((lag <= WINDOW).sum()), len(aa)


def pair_stats(pa: dict, pb: dict, excl: bool = False) -> dict | None:
    lo = max(pa["s"].index[0], pb["s"].index[0])
    hi = min(pa["s"].index[-1], pb["s"].index[-1])
    if (hi - lo).days < MIN_OVERLAP:
        return None
    a, b = pa["s"][lo:hi], pb["s"][lo:hi]
    st = pa["store"] if excl else None
    ra, rb, ca, cb = moves(a, 1, st), moves(b, 1, st), moves(a, -1, st), moves(b, -1, st)
    if len(ra) < MIN_RISES or len(rb) < MIN_RISES:
        return None
    k_ab, n_ab = follow(ra, rb)
    k_ba, n_ba = follow(rb, ra)
    k_c, n_c = follow(ca, cb)
    shifts = [d for d in range(30, 91, 5)] + [-d for d in range(30, 91, 5)]
    plc = np.mean([follow(ra, rb, sh)[0] / n_ab for sh in shifts] + [follow(rb, ra, sh)[0] / n_ba for sh in shifts])
    rate = (k_ab + k_ba) / (n_ab + n_ba)
    joint = pd.concat([a, b], axis=1).dropna()
    corr = float(joint.pct_change().corr().iloc[0, 1]) if len(joint) > 30 else None
    return {
        "a": pa["title"], "b": pb["title"], "brand_a": pa["brand"], "brand_b": pb["brand"],
        "category": pa["category"], "store": pa["store"], "slug_a": pa["slug"], "slug_b": pb["slug"],
        "from": str(lo.date()), "to": str(hi.date()), "days": (hi - lo).days,
        "rises_a": len(ra), "rises_b": len(rb),
        "a_follows_b": round(k_ba / n_ba, 3), "b_follows_a": round(k_ab / n_ab, 3),
        "cut_follow": round(k_c / n_c, 3) if n_c else None,
        "follow_rate": round(rate, 3), "placebo": round(float(plc), 3), "lift": round(rate - float(plc), 3),
        "change_corr": round(corr, 3) if corr is not None and np.isfinite(corr) else None,
    }


def summarise(ps: list[dict]) -> dict:
    if not ps:
        return {"pairs": 0}
    return {"pairs": len(ps), "mean_follow": round(float(np.mean([x["follow_rate"] for x in ps])), 3),
            "mean_placebo": round(float(np.mean([x["placebo"] for x in ps])), 3)}


def main():
    sys.stdout.reconfigure(encoding="utf-8")
    prods = load()
    print(f"{len(prods)} usable listings")
    md, md_summary = find_market_days(prods)
    MARKET_DAYS.update(md)
    print("market-wide days found:", md_summary)
    groups: dict[tuple, list] = {}
    for p in prods:
        groups.setdefault((p["category"], p["store"]), []).append(p)
    pairs, pairs_net = [], []
    for key, ps in groups.items():
        for pa, pb in combinations(ps, 2):
            if pa["brand"].upper() == pb["brand"].upper():
                continue
            st = pair_stats(pa, pb)
            if st:
                pairs.append(st)
            st = pair_stats(pa, pb, excl=True)
            if st:
                pairs_net.append(st)
    pairs.sort(key=lambda x: -x["lift"])
    # control: same store, different category (e.g. perfume vs suitcase). Sale
    # events move both, so this is the co-movement the platform alone produces.
    rng = np.random.default_rng(0)
    by_store: dict[str, list] = {}
    for p in prods:
        by_store.setdefault(p["store"], []).append(p)
    control, control_net = [], []
    for _ in range(4000):
        st = rng.choice([k for k, v in by_store.items() if len(v) >= 2])
        pa, pb = rng.choice(len(by_store[st]), 2, replace=False)
        pa, pb = by_store[st][pa], by_store[st][pb]
        if pa["category"] != pb["category"] and pa["brand"].upper() != pb["brand"].upper():
            c = pair_stats(pa, pb)
            if c:
                control.append(c)
            c = pair_stats(pa, pb, excl=True)
            if c:
                control_net.append(c)
    flagged = [x for x in pairs if x["lift"] >= 0.25 and x["follow_rate"] >= 0.5]
    all_rate = np.mean([x["follow_rate"] for x in pairs]) if pairs else None
    all_plc = np.mean([x["placebo"] for x in pairs]) if pairs else None
    report = {
        "source": "pricehistoryapp.com public product pages (daily prices, is_synthetic=false)",
        "listings": len(prods), "rival_pairs": len(pairs), "flagged": len(flagged),
        "window_days": WINDOW, "mean_follow": all_rate and round(float(all_rate), 3),
        "mean_placebo": all_plc and round(float(all_plc), 3),
        "market_days": md_summary,
        "excluding_sale_days": {
            "rival": summarise(pairs_net), "control": summarise(control_net),
        },
        "control": {"pairs": len(control),
                    "mean_follow": round(float(np.mean([x["follow_rate"] for x in control])), 3) if control else None,
                    "mean_placebo": round(float(np.mean([x["placebo"] for x in control])), 3) if control else None},
        "pairs": pairs,
    }
    OUT.write_text(json.dumps(report, indent=1, ensure_ascii=False), encoding="utf-8")
    (ROOT / "frontend" / "public" / "pha_report.json").write_text(
        json.dumps({k: v for k, v in report.items() if k != "pairs"} | {"top": pairs[:10]}, ensure_ascii=False), encoding="utf-8")
    print("control (unrelated products, same store):", report["control"])
    print("excluding sale days:", report["excluding_sale_days"])
    print(f"rival pairs: {len(pairs)}, flagged: {len(flagged)}; mean follow {report['mean_follow']} vs placebo {report['mean_placebo']}")
    for x in pairs[:15]:
        print(f"  {x['lift']:+.2f} follow {x['follow_rate']:.0%} vs chance {x['placebo']:.0%} | {x['store']} {x['category']}: {x['brand_a']} vs {x['brand_b']} ({x['days']}d, rises {x['rises_a']}/{x['rises_b']})")


if __name__ == "__main__":
    main()
