"""
PriceGuard model — standalone (Python or Google Colab). Needs numpy, pandas,
scikit-learn and, for charts, matplotlib.

  A. DETECTOR (machine learning)
     Logistic regression on 18 scale-free features of two price series,
     trained on 200 simulated markets (Calvano et al. 2020 Q-learning bots +
     rule-based sellers), labelled competitive / collusive by the collusion
     index. Reports 5-fold cross-validated AUC and the harder cross-mechanism
     test (train on Q-learning markets, test on rule-based ones).

  B. SCREENING RULES (what the PriceGuard app runs)
     On a real price file: for each competitor, did you follow their price
     rises, did they follow yours, do you match discounts but never go lower,
     does the price gap stay fixed. Same rules and thresholds as the app
     (frontend/src/watch/analyze.js + audit.js); model/parity_check.py
     verifies both give the same verdicts.

  C. DETECTOR ON REAL PRICES
     The trained model applied to each (you, competitor) pair of the real
     file. Caveat printed with the result: the model learned from simulated
     bots that reprice every period; real shop prices change less often.

Price file (CSV, one row per date — the app's "CSV" button exports this):
    date,You (BOSCH),Flipkart SmartBuy,INGCO
    2026-09-01,2399,2036,5099
    ...
First price column = your product.

    python priceguard_model.py                    # train + evaluate only
    python priceguard_model.py prices.csv         # + audit a real price file
"""

from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
import pandas as pd

HERE = Path(__file__).resolve().parent

# =============================================================================
# Features — identical to sim/features.py (extract_features); parity_check.py
# compares the two on real data.
# =============================================================================


def _safe(x: float, default: float = 0.0) -> float:
    return float(x) if np.isfinite(x) else default


def _autocorr1(x: np.ndarray) -> float:
    if len(x) < 3 or x[:-1].std() < 1e-12 or x[1:].std() < 1e-12:
        return 0.0
    return _safe(np.corrcoef(x[:-1], x[1:])[0, 1])


def _entropy_frac(x: np.ndarray, n_bins: int = 20) -> float:
    if x.std() < 1e-12:
        return 0.0
    counts, _ = np.histogram(x, bins=n_bins)
    p = counts[counts > 0] / counts.sum()
    return _safe(-(p * np.log(p)).sum() / np.log(n_bins))


def extract_features(p0, p1) -> dict:
    """Scale-free interaction features for one two-seller price series."""
    p0 = np.asarray(p0, dtype=float)
    p1 = np.asarray(p1, dtype=float)
    n = len(p0)
    mid = 0.5 * (p0 + p1)
    scale = max(mid.mean(), 1e-9)
    d0, d1 = np.diff(p0), np.diff(p1)
    ch0, ch1 = np.abs(d0) > 1e-9, np.abs(d1) > 1e-9
    any_ch = ch0 | ch1
    f = {}
    f["price_corr"] = _safe(np.corrcoef(p0, p1)[0, 1]) if p0.std() > 1e-12 and p1.std() > 1e-12 else 0.0
    f["diff_corr"] = _safe(np.corrcoef(d0, d1)[0, 1]) if d0.std() > 1e-12 and d1.std() > 1e-12 else 0.0
    f["sync_change_rate"] = _safe((ch0 & ch1).sum() / max(any_ch.sum(), 1))
    f["rel_gap_mean"] = _safe(np.abs(p0 - p1).mean() / scale)
    f["rel_gap_max"] = _safe(np.abs(p0 - p1).max() / scale)
    f["gap_zero_frac"] = _safe((np.abs(p0 - p1) < 1e-9).mean())
    f["cv_mean"] = _safe(0.5 * (p0.std() / scale + p1.std() / scale))
    f["rel_step_mean"] = _safe(0.5 * (np.abs(d0).mean() + np.abs(d1).mean()) / scale)
    f["change_freq"] = _safe(0.5 * (ch0.mean() + ch1.mean()))
    f["autocorr1"] = _safe(0.5 * (_autocorr1(p0) + _autocorr1(p1)))
    f["entropy"] = _safe(0.5 * (_entropy_frac(p0) + _entropy_frac(p1)))
    pairs = {}
    for a, b in zip(np.round(p0, 6), np.round(p1, 6)):
        pairs[(a, b)] = pairs.get((a, b), 0) + 1
    shares = np.array(list(pairs.values()), dtype=float) / n
    f["state_hhi"] = _safe((shares ** 2).sum())
    f["n_states_frac"] = _safe(len(pairs) / n)
    und0 = np.where(p0[:-1] < p1[:-1] - 1e-9)[0]
    und1 = np.where(p1[:-1] < p0[:-1] - 1e-9)[0]
    retal = []
    if und0.size:
        retal.append((d1[und0] < -1e-9).mean())
    if und1.size:
        retal.append((d0[und1] < -1e-9).mean())
    f["retaliation_rate"] = _safe(np.mean(retal)) if retal else 0.0
    f["undercut_frac"] = _safe((und0.size + und1.size) / max(n - 1, 1))
    thr = np.quantile(mid, 0.15)
    lows = np.where(mid[:-4] <= thr)[0]
    f["rebound_after_low"] = _safe((mid[lows + 3] - mid[lows]).mean() / scale) if lows.size else 0.0
    f["level_over_min"] = _safe(mid.mean() / max(np.quantile(mid, 0.02), 1e-9))
    f["level_over_median_gap"] = _safe((np.quantile(mid, 0.9) - np.quantile(mid, 0.1)) / scale)
    best_lead = 0.0
    for lag in (1, 2, 3):
        if p0[:-lag].std() > 1e-12 and p1[lag:].std() > 1e-12:
            best_lead = max(best_lead, abs(_safe(np.corrcoef(p0[:-lag], p1[lag:])[0, 1])))
        if p1[:-lag].std() > 1e-12 and p0[lag:].std() > 1e-12:
            best_lead = max(best_lead, abs(_safe(np.corrcoef(p1[:-lag], p0[lag:])[0, 1])))
    f["lead_lag_strength"] = best_lead
    return f


# level_over_min is excluded: in the simulation it separates the classes for an
# artificial reason (the price grid spans exactly Nash..monopoly), see sim/features.py
DETECTOR_FEATURES = [
    "price_corr", "diff_corr", "sync_change_rate", "rel_gap_mean", "rel_gap_max", "gap_zero_frac",
    "cv_mean", "rel_step_mean", "change_freq", "autocorr1", "entropy", "state_hhi", "n_states_frac",
    "retaliation_rate", "undercut_frac", "rebound_after_low", "level_over_median_gap", "lead_lag_strength",
]

# =============================================================================
# A. Detector: train and evaluate on the simulated markets
# =============================================================================


def load_training(path=HERE / "run_summary.csv") -> pd.DataFrame:
    df = pd.read_csv(path)
    df["y"] = (df["label"] == "collusive").astype(int)
    return df


def make_model():
    from sklearn.linear_model import LogisticRegression
    from sklearn.pipeline import make_pipeline
    from sklearn.preprocessing import StandardScaler
    return make_pipeline(StandardScaler(), LogisticRegression(max_iter=2000, C=1.0))


def evaluate(df: pd.DataFrame) -> dict:
    """5-fold CV (in-distribution) and cross-mechanism transfer."""
    from sklearn.metrics import accuracy_score, roc_auc_score
    from sklearn.model_selection import StratifiedKFold, cross_val_predict
    X, y = df[DETECTOR_FEATURES].to_numpy(), df["y"].to_numpy()
    prob = cross_val_predict(make_model(), X, y, cv=StratifiedKFold(5, shuffle=True, random_state=7), method="predict_proba")[:, 1]
    out = {"markets": len(df), "collusive": int(y.sum()), "competitive": int(len(y) - y.sum()),
           "cv_auc": roc_auc_score(y, prob), "cv_accuracy": accuracy_score(y, prob >= 0.5), "cv_prob": prob}
    q = df.regime.isin(["q_myopic", "q_patient"])
    for name, tr, te in [("train Q-learning -> test rule-based", q, ~q), ("train rule-based -> test Q-learning", ~q, q)]:
        m = make_model().fit(df.loc[tr, DETECTOR_FEATURES], df.loc[tr, "y"])
        p = m.predict_proba(df.loc[te, DETECTOR_FEATURES])[:, 1]
        out[name] = roc_auc_score(df.loc[te, "y"], p) if df.loc[te, "y"].nunique() > 1 else float("nan")
    return out


def train(df: pd.DataFrame):
    return make_model().fit(df[DETECTOR_FEATURES], df["y"])


# =============================================================================
# B. Screening rules — Python version of analyze.js + audit.js
# =============================================================================

NEED = {"days": 14, "changes": 3, "window_days": 2, "match_pts": 2, "gap_cv": 0.02}
WEIGHTS = {"copy": 45, "they_copy": 20, "gap": 20, "match": 15}


def load_prices(path) -> pd.DataFrame:
    """Price file -> DataFrame indexed by time, one column per product (first = yours)."""
    df = pd.read_csv(path)
    date_col = next(c for c in df.columns if any(k in c.lower() for k in ("date", "time")))
    df[date_col] = pd.to_datetime(df[date_col], utc=True, dayfirst=False)
    df = df.set_index(date_col).sort_index()
    for c in df.columns:
        df[c] = pd.to_numeric(df[c].astype(str).str.replace(r"[₹,\s]|rs\.?|inr", "", regex=True, case=False), errors="coerce")
    return df


def _events(t: np.ndarray, p: np.ndarray) -> list[dict]:
    """Price-change events, skipping missing readings (changeEvents)."""
    ev, prev = [], None
    for ti, pi in zip(t, p):
        if np.isnan(pi):
            continue
        if prev is not None and abs(pi - prev) > 1e-9:
            ev.append({"t": ti, "from": prev, "to": pi, "pct": (pi - prev) / prev * 100})
        prev = pi
    return ev


def _responses(lead, follow, d, win, skip_ties=False):
    out = []
    for e in lead:
        if np.sign(e["pct"]) != d:
            continue
        is_reply = any(np.sign(f["pct"]) == d and (f["t"] <= e["t"] if skip_ties else f["t"] < e["t"]) and e["t"] - f["t"] <= win for f in follow)
        if is_reply:
            continue
        reply = next((f for f in follow if np.sign(f["pct"]) == d and e["t"] <= f["t"] <= e["t"] + win), None)
        out.append((e, reply))
    return out


def _follows(leader, follower, d, win):
    moves = [e for e in leader if np.sign(e["pct"]) == d]
    lags = []
    for e in moves:
        r = next((f for f in follower if np.sign(f["pct"]) == d and e["t"] <= f["t"] <= e["t"] + win), None)
        if r:
            lags.append(r["t"] - e["t"])
    return {"k": len(lags), "n": len(moves), "lags": lags}


def audit_pair(t: np.ndarray, a: np.ndarray, b: np.ndarray, win: float) -> dict:
    """One competitor vs you. t in days; a = your prices, b = theirs (NaN = no reading)."""
    keep = ~(np.isnan(a) & np.isnan(b))
    t, a, b = t[keep], a[keep], b[keep]
    span = t[-1] - t[0] if len(t) > 1 else 0
    ev_a, ev_b = _events(t, a), _events(t, b)
    res = {"status": "collecting", "level": "collecting", "signs": {}, "span": span, "changes": len(ev_a) + len(ev_b)}
    if span < NEED["days"] or res["changes"] < NEED["changes"]:
        return res
    signs = {}
    ups = _responses(ev_a, ev_b, 1, win) + _responses(ev_b, ev_a, 1, win, True)
    if len(ups) >= 2:
        k = sum(1 for _, r in ups if r)
        signs["rise_together"] = {"strong": k / len(ups) >= 0.6, "detail": f"{k} of {len(ups)} rises matched"}
    cuts = _responses(ev_a, ev_b, -1, win) + _responses(ev_b, ev_a, -1, win, True)
    answered = [(e, r) for e, r in cuts if r]
    if len(answered) >= 2:
        matched = sum(1 for e, r in answered if abs(r["pct"] - e["pct"]) <= NEED["match_pts"])
        beaten = sum(1 for e, r in answered if r["pct"] < e["pct"] - NEED["match_pts"])
        signs["match_not_beat"] = {"strong": matched / len(answered) >= 0.6 and beaten == 0,
                                   "detail": f"{matched} of {len(answered)} cuts matched, {beaten} beaten"}
    both = ~np.isnan(a) & ~np.isnan(b)
    all_t = [e["t"] for e in ev_a + ev_b]
    settled = [i for i in np.where(both)[0] if not any(et <= t[i] and t[i] - et < win for et in all_t)]
    if len(settled) >= 5 and len(set(a[settled])) >= 2 and len(set(b[settled])) >= 2:
        ratio = b[settled] / a[settled]
        cv = ratio.std() / ratio.mean()
        signs["frozen_gap"] = {"strong": cv < NEED["gap_cv"], "detail": f"gap variation {cv * 100:.1f}%"}
    strong = sum(s["strong"] for s in signs.values())
    rate = lambda x: x["k"] / x["n"] if x["n"] >= 2 else 0
    copy, they = _follows(ev_b, ev_a, 1, win), _follows(ev_a, ev_b, 1, win)
    score = min(100, WEIGHTS["copy"] * rate(copy) + WEIGHTS["they_copy"] * rate(they)
                + WEIGHTS["gap"] * signs.get("frozen_gap", {}).get("strong", False)
                + WEIGHTS["match"] * signs.get("match_not_beat", {}).get("strong", False))
    return {**res, "status": "ready", "level": "red" if strong >= 2 else "amber" if strong == 1 else "green",
            "signs": signs, "you_followed": copy, "they_followed": they, "score": int(np.floor(score + 0.5))}  # round half up, like JS


LEVEL = {"red": "High risk", "amber": "Review", "green": "Compliant", "collecting": "Collecting"}
RANK = {"collecting": 0, "green": 1, "amber": 2, "red": 3}


def rule_audit(prices: pd.DataFrame, window_days: float = NEED["window_days"]) -> dict:
    t = (prices.index - prices.index[0]).total_seconds().to_numpy() / 86400
    me = prices.columns[0]
    rivals = {c: audit_pair(t, prices[me].to_numpy(float), prices[c].to_numpy(float), window_days) for c in prices.columns[1:]}
    ready = [r["level"] for r in rivals.values() if r["status"] == "ready"]
    level = max(ready, key=RANK.get) if ready else "collecting"
    return {"product": me, "level": level, "verdict": LEVEL[level], "rivals": rivals}


# =============================================================================
# C. Detector on real prices
# =============================================================================

CAVEAT = ("Trained on simulated markets where bots reprice every period; real shop prices change "
          "less often, so treat this probability as supporting evidence, not a verdict.")
def distance_check(prices: pd.DataFrame, train_df: pd.DataFrame) -> pd.DataFrame:
    """How far is each (you, competitor) pair from the nearest simulated market?

    Features are standardised on the training data; the distance to the
    nearest training market is compared with how close training markets are
    to each other (95th percentile of their nearest-neighbour distances).
    Far beyond that = the model is extrapolating and its score means little."""
    from sklearn.preprocessing import StandardScaler
    X = train_df[DETECTOR_FEATURES].to_numpy()
    sc = StandardScaler().fit(X)
    Z = sc.transform(X)
    D = np.sqrt(((Z[:, None, :] - Z[None, :, :]) ** 2).sum(-1))
    np.fill_diagonal(D, np.inf)
    limit = float(np.quantile(D.min(1), 0.95))
    daily = prices.resample("D").last().ffill()
    me = daily.columns[0]
    rows = []
    for c in daily.columns[1:]:
        pair = daily[[me, c]].dropna()
        if len(pair) < 10:
            continue
        f = extract_features(pair[me].to_numpy(), pair[c].to_numpy())
        z = sc.transform(pd.DataFrame([f])[DETECTOR_FEATURES].to_numpy())
        dist = float(np.sqrt(((Z - z) ** 2).sum(1)).min())
        rows.append({"competitor": c, "distance to nearest simulated market": round(dist, 1),
                     "training markets are within": round(limit, 1), "inside training range": dist <= limit})
    return pd.DataFrame(rows)


def ml_scores(prices: pd.DataFrame, model) -> dict:
    """Daily series (last price of each day, carried forward) -> P(collusive) per competitor."""
    daily = prices.resample("D").last().ffill()
    me = daily.columns[0]
    out = {}
    for c in daily.columns[1:]:
        pair = daily[[me, c]].dropna()
        if len(pair) < 10:
            out[c] = None
            continue
        f = extract_features(pair[me].to_numpy(), pair[c].to_numpy())
        out[c] = float(model.predict_proba(pd.DataFrame([f])[DETECTOR_FEATURES])[0, 1])
    return out


def plot_prices(prices: pd.DataFrame, title: str = ""):
    import matplotlib.pyplot as plt
    ax = prices.ffill().plot(figsize=(10, 4), drawstyle="steps-post", linewidth=1.6)
    ax.lines[0].set_linewidth(3)
    ax.set_ylabel("price (₹)")
    ax.set_title(title)
    ax.grid(alpha=0.3)
    plt.tight_layout()
    return ax


def report(prices: pd.DataFrame, model=None, window_days: float = 2) -> dict:
    audit = rule_audit(prices, window_days)
    print(f"\nProduct: {audit['product']}   ·   {len(prices)} readings   ·   "
          f"{prices.index[0].date()} to {prices.index[-1].date()}")
    print(f"Verdict (screening rules): {audit['verdict']}\n")
    rows = []
    ml = ml_scores(prices, model) if model is not None else {}
    for name, r in audit["rivals"].items():
        yf, tf = r.get("you_followed", {}), r.get("they_followed", {})
        rows.append({
            "competitor": name, "verdict": LEVEL[r["level"]], "score": r.get("score"),
            "you followed their rises": f"{yf['k']}/{yf['n']}" if yf else "—",
            "they followed yours": f"{tf['k']}/{tf['n']}" if tf else "—",
            "warning signs": ", ".join(k for k, s in r["signs"].items() if s["strong"]) or "none",
            "sim-model score": None if ml.get(name) is None else round(ml[name], 2),
        })
    table = pd.DataFrame(rows)
    with pd.option_context("display.width", 160, "display.max_columns", 20):
        print(table.to_string(index=False))
    if model is not None:
        rc = distance_check(prices, load_training())
        print("\nIs this file like the markets the detector learned from?")
        print(rc.to_string(index=False))
        if len(rc) and not rc["inside training range"].all():
            print("-> Outside the training range: the sim-model score is not reliable here. Use the screening-rule verdict.")
        print(f"Model note: {CAVEAT}")
        return {"audit": audit, "table": table, "ml": ml, "range": rc}
    return {"audit": audit, "table": table, "ml": ml}


def main(argv):
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except (AttributeError, ValueError):
        pass
    df = load_training()
    ev = evaluate(df)
    print(f"A. Detector trained on {ev['markets']} simulated markets "
          f"({ev['collusive']} collusive, {ev['competitive']} competitive), {len(DETECTOR_FEATURES)} features")
    print(f"   5-fold cross-validated AUC {ev['cv_auc']:.3f} · accuracy {ev['cv_accuracy']:.0%}")
    for k in ("train Q-learning -> test rule-based", "train rule-based -> test Q-learning"):
        print(f"   {k}: AUC {ev[k]:.3f}")
    model = train(df)
    for path in argv[1:]:
        print(f"\nB + C. {path}")
        report(load_prices(path), model)


if __name__ == "__main__":
    main(sys.argv)
