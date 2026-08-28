"""
Feature extraction for the collusion detector.

DESIGN RULE (the most important decision in this project)
---------------------------------------------------------
Every feature here is computable from a *scraped price series alone* -- two
sellers, one product, prices over time. Nothing uses marginal cost, demand
parameters, profits, or the Nash/monopoly anchors.

That rule is what makes the detector transferable. In the simulation we know
cost, so "is the price above Nash?" trivially separates the classes -- and a
model trained on that learns nothing usable, because on Amazon.in you never
observe a seller's marginal cost. A detector that needs cost is a detector
that can never be deployed, which is exactly the gap the CCI flagged.

So the level-based collusion index (delta) is kept strictly as a *diagnostic
label/target*, never as an input feature. See `diagnostics()`.
"""

from __future__ import annotations

import numpy as np


def _safe(x: float, default: float = 0.0) -> float:
    return float(x) if np.isfinite(x) else default


def _autocorr1(x: np.ndarray) -> float:
    if x.size < 3 or x.std() < 1e-12:
        return 0.0
    return _safe(np.corrcoef(x[:-1], x[1:])[0, 1])


def _entropy_frac(x: np.ndarray, n_bins: int = 20) -> float:
    """Normalised Shannon entropy of the price distribution.

    A market locked into one or two prices has entropy near 0; a market
    genuinely churning across many price points is near 1.
    """
    lo, hi = x.min(), x.max()
    if hi - lo < 1e-12:
        return 0.0
    counts = np.histogram(x, bins=n_bins, range=(lo, hi))[0].astype(float)
    p = counts[counts > 0] / counts.sum()
    return _safe(-(p * np.log(p)).sum() / np.log(n_bins))


def extract_features(p0: np.ndarray, p1: np.ndarray) -> dict:
    """Scale-free interaction features for one two-seller price series."""
    p0 = np.asarray(p0, dtype=float)
    p1 = np.asarray(p1, dtype=float)
    n = len(p0)
    mid = 0.5 * (p0 + p1)
    scale = max(mid.mean(), 1e-9)

    d0 = np.diff(p0)
    d1 = np.diff(p1)
    ch0 = np.abs(d0) > 1e-9
    ch1 = np.abs(d1) > 1e-9
    any_ch = ch0 | ch1

    f = {}

    # --- co-movement: do the two sellers move as one? ---
    f["price_corr"] = _safe(np.corrcoef(p0, p1)[0, 1]) if p0.std() > 1e-12 and p1.std() > 1e-12 else 0.0
    f["diff_corr"] = _safe(np.corrcoef(d0, d1)[0, 1]) if d0.std() > 1e-12 and d1.std() > 1e-12 else 0.0
    f["sync_change_rate"] = _safe((ch0 & ch1).sum() / max(any_ch.sum(), 1))

    # --- dispersion: how far apart do they sit, relative to the price level? ---
    f["rel_gap_mean"] = _safe(np.abs(p0 - p1).mean() / scale)
    f["rel_gap_max"] = _safe(np.abs(p0 - p1).max() / scale)
    f["gap_zero_frac"] = _safe((np.abs(p0 - p1) < 1e-9).mean())   # exact price matching

    # --- volatility, normalised by level (a CV, so units cancel) ---
    f["cv_mean"] = _safe(0.5 * (p0.std() / scale + p1.std() / scale))
    f["rel_step_mean"] = _safe(0.5 * (np.abs(d0).mean() + np.abs(d1).mean()) / scale)
    f["change_freq"] = _safe(0.5 * (ch0.mean() + ch1.mean()))

    # --- persistence / lock-in ---
    f["autocorr1"] = _safe(0.5 * (_autocorr1(p0) + _autocorr1(p1)))
    f["entropy"] = _safe(0.5 * (_entropy_frac(p0) + _entropy_frac(p1)))

    # Herfindahl of the joint price *pair* distribution. A market that has
    # settled into a stable cycle visits very few (p0,p1) pairs -> HHI near 1.
    pairs = {}
    for a, b in zip(np.round(p0, 6), np.round(p1, 6)):
        pairs[(a, b)] = pairs.get((a, b), 0) + 1
    shares = np.array(list(pairs.values()), dtype=float) / n
    f["state_hhi"] = _safe((shares ** 2).sum())
    f["n_states_frac"] = _safe(len(pairs) / n)

    # --- retaliation structure: the actual signature of a reward-punishment scheme ---
    # When one seller undercuts, does the rival cut back next period (punishment),
    # and does the undercutter then climb back (forgiveness)?
    und0 = np.where(p0[:-1] < p1[:-1] - 1e-9)[0]      # firm 0 undercut at t
    und1 = np.where(p1[:-1] < p0[:-1] - 1e-9)[0]
    retal = []
    if und0.size:
        retal.append((d1[und0] < -1e-9).mean())
    if und1.size:
        retal.append((d0[und1] < -1e-9).mean())
    f["retaliation_rate"] = _safe(np.mean(retal)) if retal else 0.0
    f["undercut_frac"] = _safe((und0.size + und1.size) / max(n - 1, 1))

    # Rebound: mean normalised price move in the 3 periods after the market's
    # cheapest moments. Collusive schemes snap back up; competition does not.
    thr = np.quantile(mid, 0.15)
    lows = np.where(mid[:-4] <= thr)[0]
    if lows.size:
        f["rebound_after_low"] = _safe((mid[lows + 3] - mid[lows]).mean() / scale)
    else:
        f["rebound_after_low"] = 0.0

    # --- level, expressed without knowing cost ---
    # Ratio of the typical price to the cheapest price the market ever shows.
    # This is the closest thing to a markup that scraped data can support.
    f["level_over_min"] = _safe(mid.mean() / max(np.quantile(mid, 0.02), 1e-9))
    f["level_over_median_gap"] = _safe((np.quantile(mid, 0.9) - np.quantile(mid, 0.1)) / scale)

    # --- price leadership: does one seller systematically move first? ---
    best_lead = 0.0
    for lag in (1, 2, 3):
        if p0[:-lag].std() > 1e-12 and p1[lag:].std() > 1e-12:
            c = abs(_safe(np.corrcoef(p0[:-lag], p1[lag:])[0, 1]))
            best_lead = max(best_lead, c)
        if p1[:-lag].std() > 1e-12 and p0[lag:].std() > 1e-12:
            c = abs(_safe(np.corrcoef(p1[:-lag], p0[lag:])[0, 1]))
            best_lead = max(best_lead, c)
    f["lead_lag_strength"] = best_lead

    return f


FEATURE_NAMES = [
    "price_corr", "diff_corr", "sync_change_rate",
    "rel_gap_mean", "rel_gap_max", "gap_zero_frac",
    "cv_mean", "rel_step_mean", "change_freq",
    "autocorr1", "entropy", "state_hhi", "n_states_frac",
    "retaliation_rate", "undercut_frac", "rebound_after_low",
    "level_over_min", "level_over_median_gap", "lead_lag_strength",
]

# ---------------------------------------------------------------------------
# Feature tiers
# ---------------------------------------------------------------------------
# Being scale-free is necessary but NOT sufficient for a feature to transfer to
# real data. `level_over_min` compares the typical price to the cheapest price
# ever observed -- a sensible markup proxy in principle, but in THIS simulation
# it scores AUC 0.99 for the wrong reason: the action grid is constructed to
# span exactly [p_Nash, p_monopoly], so a collusive run sits at the top of its
# grid and its occasional trembles reach all the way down to the competitive
# price. The ratio therefore recovers p_monopoly/p_Nash almost by construction.
#
# Real scraped prices are not drawn from a grid anchored on the two equilibria,
# so that signal would not survive deployment. It is excluded from the headline
# detector and from model training by default, and reported separately so the
# inflation is visible rather than hidden.
LEVEL_SENSITIVE_FEATURES = ["level_over_min"]

DETECTOR_FEATURES = [f for f in FEATURE_NAMES if f not in LEVEL_SENSITIVE_FEATURES]


def diagnostics(p0, p1, market, anchors) -> dict:
    """Ground-truth economics -- LABELS AND EVALUATION ONLY, never model inputs.

    delta is the standard collusion index from Calvano et al. (2020):
        delta = (profit - profit_Nash) / (profit_monopoly - profit_Nash)
    delta = 0 means the bots ended up at the competitive outcome; delta = 1
    means they achieved the perfect-cartel outcome.
    """
    p0 = np.asarray(p0, dtype=float)
    p1 = np.asarray(p1, dtype=float)
    pr = np.array([market.profits(np.array([a, b])) for a, b in zip(p0, p1)])
    avg_profit = float(pr.mean())
    pn, pm = anchors["profit_nash"], anchors["profit_monopoly"]
    return {
        "avg_price": float(0.5 * (p0.mean() + p1.mean())),
        "avg_profit": avg_profit,
        "delta": float((avg_profit - pn) / (pm - pn)),
        "price_over_nash": float(0.5 * (p0.mean() + p1.mean()) / anchors["p_nash"]),
    }


def impulse_metrics(ir0, ir1, pre_level: float) -> dict:
    """Quantify the response to a forced defection.

    `ir0`/`ir1` are prices from the impulse-response experiment: firm 0 is forced
    to undercut to the competitive price at step 0, then both revert to their own
    learned policies. A reward-punishment scheme shows up as (a) the rival cutting
    price in response, and (b) the market climbing back to its pre-shock level.
    """
    ir0 = np.asarray(ir0, dtype=float)
    ir1 = np.asarray(ir1, dtype=float)
    if pre_level <= 1e-9:
        return {"punish_depth": 0.0, "recovery_steps": -1, "recovered_frac": 0.0}

    # how hard the *rival* punished, as a fraction of the pre-shock level
    punish_depth = float((pre_level - ir1[1:].min()) / pre_level) if len(ir1) > 1 else 0.0

    mid = 0.5 * (ir0 + ir1)
    back = np.where(mid >= 0.99 * pre_level)[0]
    back = back[back > 0]
    recovery = int(back[0]) if back.size else -1
    return {
        "punish_depth": max(punish_depth, 0.0),
        "recovery_steps": recovery,
        "recovered_frac": float(mid[-1] / pre_level),
    }
