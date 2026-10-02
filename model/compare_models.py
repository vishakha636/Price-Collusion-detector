"""
Compare the three ways of judging a (you, competitor) pair on real data:

  RULES        the app's screening rules (priceguard_model.rule_audit)
  STICKY SIM   ML detector trained on simulated markets observed like real shops
               (train_sticky.py) -- labels: collusive / competitive
  REAL MODEL   trained on real product pairs (train_real.py) -- labels:
               rival brands / unrelated products; score = how unusual the
               co-movement is, as a percentile of unrelated pairs

    python model/compare_models.py     # prints the comparison, writes model/comparison.csv
"""

from __future__ import annotations

import sqlite3
import sys
from pathlib import Path

import numpy as np
import pandas as pd

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
sys.path.insert(0, str(HERE))
sys.path.insert(0, str(ROOT))

import priceguard_model as pgm                       # noqa: E402
from export_prices import export                     # noqa: E402
from train_real import REAL_FEATURES, pair_features  # noqa: E402


def models():
    from sklearn.ensemble import GradientBoostingClassifier
    from sklearn.linear_model import LogisticRegression
    from sklearn.pipeline import make_pipeline
    from sklearn.preprocessing import StandardScaler
    return {"logistic": lambda: make_pipeline(StandardScaler(), LogisticRegression(max_iter=3000)),
            "grad boost": lambda: GradientBoostingClassifier(random_state=0)}


def grouped_auc(X, y, groups, make):
    from sklearn.metrics import roc_auc_score
    from sklearn.model_selection import GroupKFold, cross_val_predict
    p = cross_val_predict(make(), X, y, cv=GroupKFold(5), groups=groups, method="predict_proba")[:, 1]
    return roc_auc_score(y, p)


def nn_distance(train_X: np.ndarray, X: np.ndarray):
    from sklearn.preprocessing import StandardScaler
    sc = StandardScaler().fit(train_X)
    Z, z = sc.transform(train_X), sc.transform(X)
    D = np.sqrt(((Z[:, None, :] - Z[None, :, :]) ** 2).sum(-1))
    np.fill_diagonal(D, np.inf)
    limit = float(np.quantile(D.min(1), 0.95))
    d = np.sqrt(((z[:, None, :] - Z[None, :, :]) ** 2).sum(-1)).min(1)
    return d, limit


def main():
    sys.stdout.reconfigure(encoding="utf-8")
    from sklearn.metrics import roc_auc_score
    M = models()

    # --- sticky simulation ---
    st = pd.read_csv(HERE / "sticky_summary.csv")
    st["y"] = (st.label == "collusive").astype(int)
    print("STICKY SIM detector (simulated markets observed like real shops)")
    for k, make in M.items():
        print(f"  {k:10} CV AUC {grouped_auc(st[pgm.DETECTOR_FEATURES], st.y, st.run_id, make):.3f} (markets never split across folds)")
    q = st.regime.isin(["q_myopic", "q_patient"])
    for name, tr, te in [("Q-learning -> rule-based", q, ~q), ("rule-based -> Q-learning", ~q, q)]:
        m = M["logistic"]().fit(st.loc[tr, pgm.DETECTOR_FEATURES], st.loc[tr, "y"])
        print(f"  transfer {name}: AUC {roc_auc_score(st.loc[te, 'y'], m.predict_proba(st.loc[te, pgm.DETECTOR_FEATURES])[:, 1]):.3f}")
    sticky = M["logistic"]().fit(st[pgm.DETECTOR_FEATURES], st.y)
    orig = pgm.load_training()
    original = pgm.train(orig)

    # --- real model ---
    rp = pd.read_csv(HERE / "real_pairs.csv").fillna(0)
    print("\nREAL MODEL (real pairs: rival brands vs unrelated products)")
    for k, make in M.items():
        print(f"  {k:10} CV AUC {grouped_auc(rp[REAL_FEATURES], rp.label, rp.store + '|' + rp.cat_a, make):.3f} (categories never split across folds)")
    real = M["grad boost"]().fit(rp[REAL_FEATURES], rp.label)
    null = np.sort(real.predict_proba(rp.loc[rp.label == 0, REAL_FEATURES])[:, 1])   # scores of unrelated pairs

    # --- our monitored products: every (you, competitor) pair, full history ---
    con = sqlite3.connect(ROOT / "data" / "price_watch.db")
    con.row_factory = sqlite3.Row
    tmp = HERE / "_cmp"
    tmp.mkdir(exist_ok=True)
    rows, simX = [], []
    for (pid, name) in con.execute("SELECT id, name FROM products WHERE active = 1 ORDER BY id"):
        prices = pgm.load_prices(export(con, pid, tmp / f"{pid}.csv", 90))
        if len(prices) < 10:
            continue
        audit = pgm.rule_audit(prices)
        daily = prices.resample("D").last().ffill()
        full = pgm.load_prices(export(con, pid, tmp / f"{pid}_all.csv", None)).resample("D").last().ffill()
        me = daily.columns[0]
        for c in daily.columns[1:]:
            pair = daily[[me, c]].dropna()
            if len(pair) < 20:
                continue
            f = pgm.extract_features(pair[me].to_numpy(), pair[c].to_numpy())
            fr = pair_features(full[me].dropna(), full[c].dropna()) if c in full else None
            real_pct = None
            if fr:
                s = real.predict_proba(pd.DataFrame([fr])[REAL_FEATURES])[0, 1]
                real_pct = round(100 * np.searchsorted(null, s) / len(null))
            simX.append([f[k] for k in pgm.DETECTOR_FEATURES])
            r = audit["rivals"][c]
            rows.append({"product": name, "competitor": c, "rules (90 d)": pgm.LEVEL[r["level"]],
                         "original sim P": round(float(original.predict_proba(pd.DataFrame([f])[pgm.DETECTOR_FEATURES])[0, 1]), 2),
                         "sticky sim P": round(float(sticky.predict_proba(pd.DataFrame([f])[pgm.DETECTOR_FEATURES])[0, 1]), 2),
                         "real model: more unusual than % of unrelated pairs": real_pct})
    for f in tmp.glob("*.csv"):
        f.unlink()
    tmp.rmdir()
    out = pd.DataFrame(rows)
    simX = np.array(simX)
    d_orig, lim_orig = nn_distance(orig[pgm.DETECTOR_FEATURES].to_numpy(), simX)
    d_st, lim_st = nn_distance(st[pgm.DETECTOR_FEATURES].to_numpy(), simX)
    out["inside original range"] = d_orig <= lim_orig
    out["inside sticky range"] = d_st <= lim_st
    out.to_csv(HERE / "comparison.csv", index=False)

    print(f"\nOUR {out['product'].nunique()} PRODUCTS · {len(out)} (you, competitor) pairs · last 90 days")
    print(f"  inside training range: original sim {out['inside original range'].mean():.0%} · sticky sim {out['inside sticky range'].mean():.0%}")
    print(f"  median distance to nearest training market: original {np.median(d_orig):.1f} (limit {lim_orig:.1f}) · sticky {np.median(d_st):.1f} (limit {lim_st:.1f})")
    print(f"  pairs scored > 0.9: original sim {(out['original sim P'] > 0.9).mean():.0%} · sticky sim {(out['sticky sim P'] > 0.9).mean():.0%}")
    flagged = out["rules (90 d)"].isin(["Review", "High risk"])
    if flagged.any() and (~flagged).any():
        for col in ["original sim P", "sticky sim P", "real model: more unusual than % of unrelated pairs"]:
            v = out[col].astype(float)
            print(f"  {col:52} flagged by rules: {v[flagged].mean():.2f} · not flagged: {v[~flagged].mean():.2f}")
    with pd.option_context("display.width", 220, "display.max_columns", 20, "display.max_colwidth", 28):
        print()
        print(out.sort_values("sticky sim P", ascending=False).to_string(index=False))


if __name__ == "__main__":
    main()
