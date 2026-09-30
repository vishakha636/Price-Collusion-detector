"""
Calibrated (swap) regret audit of pricing agents.

Idea (Hartline, Long & Zhang 2024; Hartline, Wang & Zhang 2025): a pricing
algorithm that optimises unilaterally has vanishing *calibrated regret* --
for every price it chose, no other single price would have earned more
against the rivals' actual prices in those same rounds. An algorithm that
sustains a collusive outcome keeps passing up profitable unilateral
deviations (undercuts it avoids for fear of retaliation), so its calibrated
regret stays bounded away from zero.

Swap regret, per firm, over T rounds with a discrete price grid G:

    R_swap = (1/T) * sum_i  max_j  sum_{t: p_t = G_i} [ pi(G_j, r_t) - pi(G_i, r_t) ]

where r_t is the rival's price in round t and pi the firm's per-round profit.
The counterfactual holds the rival's price fixed: it measures the unilateral
gain, deliberately ignoring any future punishment -- that is exactly the gain
a colluding algorithm forgoes.

Two versions:
  * exact      -- counterfactual profit from the true demand model (only
                  possible in simulation; the ground truth).
  * estimated  -- counterfactual profit from a demand curve fitted to the
                  firm's own transcript (price, units, rival price). This is
                  what a company could run on its own logs; it is validated
                  here against the exact version.

Regret is reported relative to the firm's average realised profit, so it
reads as "share of profit left on the table by not deviating".

    python -m sim.regret        # writes data/regret_report.json
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import numpy as np
import pandas as pd

from .market import LogitMarket

DATA = Path(__file__).resolve().parent.parent / "data"


def swap_regret(own_idx: np.ndarray, cf_profit: np.ndarray, realised: np.ndarray) -> float:
    """
    own_idx   (T,)   grid index played each round
    cf_profit (T, k) profit each grid price would have earned that round
    realised  (T,)   profit actually earned
    Returns per-round swap regret (same units as profit).
    """
    T, k = cf_profit.shape
    total = 0.0
    for i in np.unique(own_idx):
        rows = own_idx == i
        gain = (cf_profit[rows] - realised[rows, None]).sum(axis=0)   # gain of switching i -> j
        total += max(0.0, gain.max())
    return total / T


def external_regret(cf_profit: np.ndarray, realised: np.ndarray) -> float:
    """Best single fixed price in hindsight vs what was earned (per round)."""
    return max(0.0, (cf_profit - realised[:, None]).sum(axis=0).max() / len(realised))


def fit_demand(p: np.ndarray, r: np.ndarray, q: np.ndarray):
    """
    Log-linear demand fitted to a transcript:  ln q = b0 + b1*p + b2*r.
    Only the firm's own observations are used -- no knowledge of the true model.
    Returns a function q_hat(p, r).
    """
    X = np.column_stack([np.ones_like(p), p, r])
    y = np.log(np.maximum(q, 1e-9))
    b, *_ = np.linalg.lstsq(X, y, rcond=None)
    return lambda pp, rr: np.exp(b[0] + b[1] * pp + b[2] * rr), b


def audit_firm(p_own, p_rival, market: LogitMarket, grid: np.ndarray) -> dict:
    """Exact and estimated regret for one firm's transcript."""
    own_idx = np.abs(p_own[:, None] - grid[None, :]).argmin(axis=1)
    p_own = grid[own_idx]
    k = len(grid)

    # exact counterfactuals from the true logit demand
    def share(pi_, pr_):
        u0 = (market.a - pi_) / market.mu
        u1 = (market.a - pr_) / market.mu
        u_out = market.a0 / market.mu
        m = np.maximum(np.maximum(u0, u1), u_out)
        e0, e1, eo = np.exp(u0 - m), np.exp(u1 - m), np.exp(u_out - m)
        return e0 / (e0 + e1 + eo)

    q = share(p_own, p_rival)                                   # units sold (market size 1)
    realised = (p_own - market.c) * q
    cf_exact = (grid[None, :] - market.c) * share(grid[None, :], p_rival[:, None])

    # estimated counterfactuals: demand curve fitted to (price, units, rival price) only
    q_hat, coef = fit_demand(p_own, p_rival, q)
    cf_est = (grid[None, :] - market.c) * q_hat(grid[None, :], p_rival[:, None])
    realised_est = (p_own - market.c) * q_hat(p_own, p_rival)

    avg = max(realised.mean(), 1e-9)
    return {
        "swap_exact": swap_regret(own_idx, cf_exact, realised) / avg,
        "external_exact": external_regret(cf_exact, realised) / avg,
        "swap_est": swap_regret(own_idx, cf_est, realised_est) / max(realised_est.mean(), 1e-9),
        "n_prices_used": int(len(np.unique(own_idx))),
        "demand_fit": [round(float(x), 3) for x in coef],
    }


def auc(pos: np.ndarray, neg: np.ndarray) -> float:
    """Probability a random collusive run scores higher than a random competitive one."""
    pos, neg = np.asarray(pos), np.asarray(neg)
    wins = (pos[:, None] > neg[None, :]).sum() + 0.5 * (pos[:, None] == neg[None, :]).sum()
    return float(wins / (len(pos) * len(neg)))


def main():
    runs = pd.read_csv(DATA / "run_summary.csv")
    series = pd.read_csv(DATA / "price_series.csv")
    rows = []
    for run in runs.itertuples():
        s = series[series.run_id == run.run_id]
        market = LogitMarket(a=run.a, mu=run.mu)
        grid = market.price_grid(int(run.k))
        p0, p1 = s.price_0.to_numpy(), s.price_1.to_numpy()
        f0 = audit_firm(p0, p1, market, grid)
        f1 = audit_firm(p1, p0, market, grid)
        rows.append({
            "run_id": run.run_id, "regime": run.regime, "label": run.label, "delta": run.delta,
            **{k: round((f0[k] + f1[k]) / 2, 5) for k in ("swap_exact", "external_exact", "swap_est")},
        })
        if len(rows) % 25 == 0:
            print(f"  {len(rows)}/{len(runs)} runs audited", flush=True)

    df = pd.DataFrame(rows)
    by = df.groupby("regime")[["swap_exact", "swap_est", "external_exact", "delta"]].median().round(4)
    col = df[df.label == "collusive"]
    comp = df[df.label == "competitive"]
    learned = df[df.regime.isin(["q_myopic", "q_patient"])]
    report = {
        "method": "calibrated swap regret, relative to average realised profit (median per regime)",
        "n_runs": len(df),
        "by_regime": by.to_dict(orient="index"),
        "auc": {
            "exact_all": auc(col.swap_exact, comp.swap_exact),
            "estimated_all": auc(col.swap_est, comp.swap_est),
            "exact_learned_only": auc(learned[learned.label == "collusive"].swap_exact,
                                      learned[learned.label == "competitive"].swap_exact),
            "estimated_learned_only": auc(learned[learned.label == "collusive"].swap_est,
                                          learned[learned.label == "competitive"].swap_est),
        },
        "exact_vs_estimated_corr": round(float(np.corrcoef(df.swap_exact, df.swap_est)[0, 1]), 3),
        "regret_vs_delta_corr": round(float(np.corrcoef(df.swap_exact, df.delta)[0, 1]), 3),
        "runs": rows,
    }
    (DATA / "regret_report.json").write_text(json.dumps(report, indent=1), encoding="utf-8")
    print("\nmedian regret (share of profit left on the table) by regime:")
    print(by.to_string())
    print("\nAUC collusive vs competitive:", {k: round(v, 3) for k, v in report["auc"].items()})
    print("exact vs estimated correlation:", report["exact_vs_estimated_corr"])
    print("regret vs collusion index (delta) correlation:", report["regret_vs_delta_corr"])


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    main()
