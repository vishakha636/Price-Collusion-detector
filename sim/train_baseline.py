"""
Baseline detector: is the simulated dataset actually learnable, and does the
signal transfer?

Three evaluations, in increasing order of honesty:

  1. IN-DISTRIBUTION      stratified 5-fold CV over all 200 markets. The easy
                          number, and the one most likely to be over-optimistic.

  2. CROSS-MECHANISM      train only on the Q-learning markets, test only on the
                          rule-based ones (and the reverse). This asks whether
                          the model learned *collusive dynamics* or just the
                          fingerprint of one algorithm. It is the number that
                          predicts whether anything will work on real data.

  3. LEVEL-PROXY ABLATION with and without `level_over_min`, the feature whose
                          near-perfect score is an artefact of how the price
                          grid is built (see sim/features.py).

Run:  python -m sim.train_baseline
"""

from __future__ import annotations

import json
from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.ensemble import GradientBoostingClassifier
from sklearn.inspection import permutation_importance
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import accuracy_score, roc_auc_score
from sklearn.model_selection import StratifiedKFold, cross_val_predict
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler

from sim.features import (DETECTOR_FEATURES, FEATURE_NAMES,
                          LEVEL_SENSITIVE_FEATURES)

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
SEED = 7

Q_REGIMES = ("q_myopic", "q_patient")
RULE_REGIMES = ("br_noisy", "grim_cartel")


def models():
    return {
        "logistic": make_pipeline(StandardScaler(),
                                  LogisticRegression(max_iter=5000, C=1.0,
                                                     random_state=SEED)),
        "grad_boost": GradientBoostingClassifier(random_state=SEED, max_depth=2,
                                                 n_estimators=250,
                                                 learning_rate=0.05),
    }


def cv_scores(X, y, feats):
    out = {}
    cv = StratifiedKFold(5, shuffle=True, random_state=SEED)
    for name, mdl in models().items():
        p = cross_val_predict(mdl, X[feats], y, cv=cv, method="predict_proba")[:, 1]
        out[name] = {
            "auc": float(roc_auc_score(y, p)),
            "accuracy": float(accuracy_score(y, (p >= 0.5).astype(int))),
        }
    return out


def transfer(df, feats, train_regimes, test_regimes):
    tr = df[df.regime.isin(train_regimes)]
    te = df[df.regime.isin(test_regimes)]
    out = {}
    for name, mdl in models().items():
        mdl.fit(tr[feats], (tr.label == "collusive").astype(int))
        p = mdl.predict_proba(te[feats])[:, 1]
        yt = (te.label == "collusive").astype(int)
        out[name] = {
            "auc": float(roc_auc_score(yt, p)),
            "accuracy": float(accuracy_score(yt, (p >= 0.5).astype(int))),
            "n_train": int(len(tr)), "n_test": int(len(te)),
        }
    return out


def main():
    df = pd.read_csv(DATA / "run_summary.csv")
    y = (df.label == "collusive").astype(int).values
    print(f"{len(df)} markets  |  {y.sum()} collusive  {len(y)-y.sum()} competitive")

    report = {"n_runs": int(len(df)),
              "detector_features": DETECTOR_FEATURES,
              "level_sensitive_features": LEVEL_SENSITIVE_FEATURES}

    # ---- 1. in-distribution ----
    print("\n1. IN-DISTRIBUTION  (stratified 5-fold CV, all 200 markets)")
    report["in_distribution"] = {}
    for tag, feats in [("dynamics_only", DETECTOR_FEATURES),
                       ("with_level_proxy", FEATURE_NAMES)]:
        sc = cv_scores(df, y, feats)
        report["in_distribution"][tag] = sc
        for m, v in sc.items():
            print(f"   {tag:18s} {m:11s} AUC {v['auc']:.3f}  acc {v['accuracy']:.3f}")

    # ---- 2. cross-mechanism transfer ----
    print("\n2. CROSS-MECHANISM TRANSFER  (dynamics-only features)")
    report["transfer"] = {
        "q_to_rule": transfer(df, DETECTOR_FEATURES, Q_REGIMES, RULE_REGIMES),
        "rule_to_q": transfer(df, DETECTOR_FEATURES, RULE_REGIMES, Q_REGIMES),
    }
    for direction, label in [("q_to_rule", "train Q-learning -> test rule-based"),
                             ("rule_to_q", "train rule-based -> test Q-learning")]:
        for m, v in report["transfer"][direction].items():
            print(f"   {label:36s} {m:11s} AUC {v['auc']:.3f}  acc {v['accuracy']:.3f}")

    # ---- 3. hardest split: the two Q-learning regimes only ----
    # No rule-based controls to make the task easy, and price level is the thing
    # the myopic/patient pair deliberately confounds.
    print("\n3. HARDEST SPLIT  (myopic vs patient Q-learners only, dynamics-only)")
    q = df[df.regime.isin(Q_REGIMES)]
    yq = (q.label == "collusive").astype(int).values
    report["q_only"] = cv_scores(q, yq, DETECTOR_FEATURES)
    for m, v in report["q_only"].items():
        print(f"   {m:11s} AUC {v['auc']:.3f}  acc {v['accuracy']:.3f}")

    # ---- 4. permutation importance ----
    print("\n4. PERMUTATION IMPORTANCE  (gradient boosting, dynamics-only)")
    mdl = models()["grad_boost"]
    mdl.fit(df[DETECTOR_FEATURES], y)
    pi = permutation_importance(mdl, df[DETECTOR_FEATURES], y, n_repeats=30,
                                random_state=SEED, scoring="roc_auc")
    imp = sorted(zip(DETECTOR_FEATURES, pi.importances_mean, pi.importances_std),
                 key=lambda r: -r[1])
    report["permutation_importance"] = [
        {"feature": f, "mean": float(m), "std": float(s)} for f, m, s in imp]
    for f, m, s in imp[:10]:
        print(f"   {f:24s} {m:+.4f} ± {s:.4f}")

    # ---- 5. single-feature AUCs ----
    report["feature_auc"] = [
        {"feature": f, "auc": float(roc_auc_score(y, df[f])),
         "separation": float(max(roc_auc_score(y, df[f]),
                                 1 - roc_auc_score(y, df[f])))}
        for f in FEATURE_NAMES]
    report["level_benchmark_auc"] = float(roc_auc_score(y, df["price_over_nash"]))

    out = DATA / "model_report.json"
    out.write_text(json.dumps(report, indent=2), encoding="utf-8")
    public = ROOT / "frontend" / "public"
    if public.is_dir():
        (public / "model_report.json").write_text(json.dumps(report), encoding="utf-8")
    print(f"\nWrote {out}")
    print("\nFor reference, the level-based measure a regulator CANNOT compute "
          f"(needs marginal cost):\n   price/Nash  AUC {report['level_benchmark_auc']:.3f}")


if __name__ == "__main__":
    main()
