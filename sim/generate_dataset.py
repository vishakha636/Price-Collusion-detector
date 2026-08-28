"""
Build the labelled pricing-bot dataset.

Pipeline per run:
  1. TRAIN    Q-learners interact for ~600k periods until the greedy policy freezes.
  2. DEPLOY   freeze the Q-tables and roll the learned policies out with a small
              tremble rate. This rollout is the "observed market" -- the analogue
              of scraped price data, and the only thing features are computed on.
  3. PROBE    force one firm to defect to the competitive price and record how
              the rival responds (impulse response).

Outputs (into ./data):
  run_summary.csv    one row per run: parameters, features, delta, label
  price_series.csv   long-format observed price paths (the scraped-like data)
  dashboard.json     compact payload consumed by the React frontend

Run:  python -m sim.generate_dataset            (add --quick for a fast smoke test)
"""

from __future__ import annotations

import argparse
import json
import time
from collections import defaultdict
from pathlib import Path

import numpy as np
import pandas as pd

from sim.engine import (best_response_noisy, eval_rollout_batch, grim_cartel,
                        run_q_batch)
from sim.features import (FEATURE_NAMES, diagnostics, extract_features,
                          impulse_metrics)
from sim.market import LogitMarket

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"

TAIL = 1000          # periods of observed (post-training) behaviour kept per run
BURN = 200           # rollout periods discarded before observation starts
PLOT_TAIL = 200      # how much of the tail the dashboard draws
CURVE_PTS = 200      # learning-curve resolution
IR_WARMUP = 60       # tremble-free periods to settle onto the cycle before probing
IR_STEPS = 30        # impulse-response horizon
CONV_WINDOW = 25_000

LABEL_OF = {
    "q_myopic": "competitive",
    "br_noisy": "competitive",
    "q_patient": "collusive",
    "grim_cartel": "collusive",
}
K_CHOICES = [9, 11, 15]


def _nearest(grid, value):
    return int(np.argmin(np.abs(grid - value)))


# --------------------------------------------------------------------------
# planning
# --------------------------------------------------------------------------

def build_plan(n_q: int, n_rule: int, rng: np.random.Generator) -> list[dict]:
    """Sample the market and algorithm parameters for every run up front.

    Randomising mu, a and the grid size means the detector cannot latch onto one
    single calibration -- each run is a different market.
    """
    plan = []

    def add(regime, seed, i):
        mu = float(rng.uniform(0.20, 0.30))
        a = float(rng.uniform(1.9, 2.1))
        k = K_CHOICES[i % len(K_CHOICES)]
        market = LogitMarket(a=a, mu=mu)
        grid = market.price_grid(k)
        anchors = market.anchors()
        cfg = {
            "regime": regime, "label": LABEL_OF[regime], "seed": seed,
            "k": k, "mu": mu, "a": a,
            "market": market, "grid": grid, "anchors": anchors,
            "pi": market.profit_tensor(grid),
            "nash_a": _nearest(grid, anchors["p_nash"]),
            "mono_a": _nearest(grid, anchors["p_monopoly"]),
            "tremble": float(rng.uniform(0.01, 0.06)),
        }
        if regime in ("q_myopic", "q_patient"):
            cfg["gamma"] = 0.0 if regime == "q_myopic" else float(rng.uniform(0.90, 0.97))
            cfg["alpha"] = float(rng.uniform(0.08, 0.22))
            cfg["beta"] = float(rng.uniform(1.8e-5, 2.4e-5))
        else:
            cfg["gamma"] = cfg["alpha"] = cfg["beta"] = np.nan
            cfg["noise"] = float(rng.uniform(0.02, 0.12))
            cfg["punish_len"] = int(rng.integers(3, 12))
            # Kept low enough that the cartel actually holds most of the time;
            # at high defection rates the market sits in punishment and its
            # average price collapses back towards Nash.
            cfg["defect_p"] = float(rng.uniform(0.005, 0.04))
        plan.append(cfg)

    for i in range(n_q):
        add("q_myopic", i, i)
    for i in range(n_q):
        add("q_patient", 1000 + i, i)
    for i in range(n_rule):
        add("br_noisy", 2000 + i, i)
    for i in range(n_rule):
        add("grim_cartel", 3000 + i, i)
    return plan


# --------------------------------------------------------------------------
# simulation
# --------------------------------------------------------------------------

def simulate_q_group(cfgs: list[dict], k: int, n_periods: int, seed: int, log):
    """Train and probe every Q-learning run that shares a grid size, as one batch."""
    R = len(cfgs)
    pi = np.stack([c["pi"] for c in cfgs])
    gamma = np.array([c["gamma"] for c in cfgs])
    alpha = np.array([c["alpha"] for c in cfgs])
    beta = np.array([c["beta"] for c in cfgs])
    tremble = np.array([c["tremble"] for c in cfgs])
    nash_a = np.array([c["nash_a"] for c in cfgs], dtype=np.int16)

    t0 = time.time()
    q, curve, conv_t, s0, s1 = run_q_batch(
        pi, gamma, alpha, beta, n_periods, CURVE_PTS, CONV_WINDOW, seed)
    log(f"    trained {R} runs (k={k}) in {time.time()-t0:.0f}s, "
        f"converged {(conv_t >= 0).mean():.0%}")

    # 2. DEPLOY -- the observed market
    obs0, obs1 = eval_rollout_batch(q, k, s0, s1, BURN + TAIL,
                                    tremble=tremble, seed=seed + 1)
    obs0, obs1 = obs0[:, BURN:], obs1[:, BURN:]

    # 3. PROBE -- settle onto the cycle tremble-free, then force a defection
    w0, w1 = eval_rollout_batch(q, k, s0, s1, IR_WARMUP, tremble=0.0, seed=seed + 2)
    ir0, ir1 = eval_rollout_batch(q, k, w0[:, -1].astype(int), w1[:, -1].astype(int),
                                  IR_STEPS, tremble=0.0, seed=seed + 3,
                                  force_action=nash_a)
    pre = np.array([
        0.5 * (c["grid"][w0[r, -20:].astype(int)].mean()
               + c["grid"][w1[r, -20:].astype(int)].mean())
        for r, c in enumerate(cfgs)])

    for r, c in enumerate(cfgs):
        g = c["grid"]
        c["_p0"], c["_p1"] = g[obs0[r].astype(int)], g[obs1[r].astype(int)]
        c["_ir0"], c["_ir1"] = g[ir0[r].astype(int)], g[ir1[r].astype(int)]
        c["_curve"] = np.interp(curve[r], np.arange(k), g)
        c["_pre"] = float(pre[r])
        c["conv_period"] = int(conv_t[r])
        c["converged"] = bool(conv_t[r] >= 0)


def simulate_rule(cfg: dict):
    """Run one rule-based control and probe it the same way."""
    k, grid, pi = cfg["k"], cfg["grid"], cfg["pi"]
    nash_a, mono_a = cfg["nash_a"], cfg["mono_a"]
    n = BURN + TAIL

    if cfg["regime"] == "br_noisy":
        o0, o1 = best_response_noisy(pi, n, cfg["noise"], cfg["seed"])
        br = np.argmax(pi, axis=0)
        # Settle noise-free onto the best-response fixed point, so the
        # pre-shock baseline is the regime's undisturbed level.
        a0, a1 = int(o0[-1]), int(o1[-1])
        for _ in range(IR_WARMUP):
            a0, a1 = int(br[a1]), int(br[a0])
        pre_a = 0.5 * (grid[a0] + grid[a1])
        ir0, ir1 = [], []
        for t in range(IR_STEPS):
            b0 = nash_a if t == 0 else int(br[a1])
            b1 = int(br[a0])
            ir0.append(b0); ir1.append(b1)
            a0, a1 = b0, b1
    else:  # grim_cartel
        coll_a = int(min(k - 1, mono_a))
        o0, o1 = grim_cartel(k, n, coll_a, nash_a, cfg["punish_len"],
                             cfg["defect_p"], cfg["tremble"], cfg["seed"])
        pre_a = float(grid[coll_a])       # undisturbed level = the cartel price
        ir0, ir1 = [], []
        punish = cfg["punish_len"]
        for t in range(IR_STEPS):
            if t == 0:
                ir0.append(nash_a); ir1.append(coll_a)
            elif punish > 0:
                ir0.append(nash_a); ir1.append(nash_a); punish -= 1
            else:
                ir0.append(coll_a); ir1.append(coll_a)

    cfg["_p0"] = grid[np.asarray(o0[BURN:], int)]
    cfg["_p1"] = grid[np.asarray(o1[BURN:], int)]
    cfg["_ir0"] = grid[np.asarray(ir0, int)]
    cfg["_ir1"] = grid[np.asarray(ir1, int)]
    cfg["_pre"] = float(pre_a)
    step = max(len(o0) // CURVE_PTS, 1)
    cfg["_curve"] = grid[np.asarray(o0, int)][::step][:CURVE_PTS]
    cfg["conv_period"] = -1
    cfg["converged"] = True


def finalise(cfg: dict) -> dict:
    """Turn a simulated run into one dataset row."""
    feats = extract_features(cfg["_p0"], cfg["_p1"])
    diag = diagnostics(cfg["_p0"], cfg["_p1"], cfg["market"], cfg["anchors"])
    imp = impulse_metrics(cfg["_ir0"], cfg["_ir1"], pre_level=cfg["_pre"])
    row = {
        "run_id": f"{cfg['regime']}_{cfg['seed']}",
        "regime": cfg["regime"], "label": cfg["label"], "seed": cfg["seed"],
        "k": cfg["k"], "mu": round(cfg["mu"], 4), "a": round(cfg["a"], 4),
        "tremble": round(cfg["tremble"], 4),
        "gamma": None if np.isnan(cfg["gamma"]) else round(cfg["gamma"], 4),
        "alpha": None if np.isnan(cfg["alpha"]) else round(cfg["alpha"], 4),
        "beta": None if np.isnan(cfg["beta"]) else cfg["beta"],
        "p_nash": round(cfg["anchors"]["p_nash"], 4),
        "p_monopoly": round(cfg["anchors"]["p_monopoly"], 4),
        "converged": cfg["converged"], "conv_period": cfg["conv_period"],
    }
    for d in (diag, imp, feats):
        row.update({k: round(float(v), 6) for k, v in d.items()})
    return row


# --------------------------------------------------------------------------

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--quick", action="store_true", help="fast pipeline smoke test")
    ap.add_argument("--periods", type=int, default=600_000)
    ap.add_argument("--n-q", type=int, default=60, help="runs per Q-learning regime")
    ap.add_argument("--n-rule", type=int, default=40, help="runs per rule-based regime")
    args = ap.parse_args()
    if args.quick:
        args.periods, args.n_q, args.n_rule = 40_000, 6, 6

    def log(msg):
        print(msg, flush=True)

    DATA.mkdir(exist_ok=True)
    rng = np.random.default_rng(20260826)
    plan = build_plan(args.n_q, args.n_rule, rng)
    n_q_total = sum(1 for c in plan if c["regime"].startswith("q_"))
    log(f"Simulating {len(plan)} markets "
        f"({n_q_total} Q-learning runs x {args.periods:,} periods, batched by grid size)")
    t0 = time.time()

    groups = defaultdict(list)
    for c in plan:
        if c["regime"].startswith("q_"):
            groups[c["k"]].append(c)
    for i, (k, cfgs) in enumerate(sorted(groups.items())):
        log(f"  batch {i+1}/{len(groups)}: k={k}, {len(cfgs)} runs")
        simulate_q_group(cfgs, k, args.periods, seed=100 + k, log=log)

    rule = [c for c in plan if not c["regime"].startswith("q_")]
    log(f"  rule-based controls: {len(rule)} runs")
    for c in rule:
        simulate_rule(c)

    rows = [finalise(c) for c in plan]
    log(f"  simulation complete in {time.time()-t0:.0f}s")

    # ---- tabular outputs ----
    summary = pd.DataFrame(rows)
    summary.to_csv(DATA / "run_summary.csv", index=False)

    pd.concat([pd.DataFrame({
        "run_id": r["run_id"], "regime": r["regime"], "label": r["label"],
        "t": np.arange(len(c["_p0"])), "price_0": c["_p0"], "price_1": c["_p1"],
    }) for r, c in zip(rows, plan)], ignore_index=True).to_csv(
        DATA / "price_series.csv", index=False)

    # ---- dashboard payload ----
    def rd(x, d=4):
        return [round(float(v), d) for v in np.asarray(x)]

    base = LogitMarket()
    bgrid = base.price_grid(15)
    payload = {
        "meta": {
            "generated_at": time.strftime("%Y-%m-%d %H:%M:%S"),
            "n_runs": len(rows),
            "periods_per_q_run": args.periods,
            "tail_periods": TAIL, "plot_tail": PLOT_TAIL, "ir_steps": IR_STEPS,
            "feature_names": FEATURE_NAMES,
            "baseline_anchors": base.anchors(),
            "discrete_nash": base.discrete_nash(bgrid)[1],
            "regimes": {
                "q_myopic": "Q-learning bots, gamma=0 (myopic). Converge to price cycles near Bertrand-Nash.",
                "q_patient": "Q-learning bots, gamma~0.95 (patient). Autonomously learn reward-punishment schemes.",
                "br_noisy": "Rule-based static best-response + noise. Non-learning competitive control.",
                "grim_cartel": "Rule-based grim-trigger cartel. Explicit-collusion positive control.",
            },
        },
        "runs": [{
            **r,
            "tail": [rd(c["_p0"][-PLOT_TAIL:]), rd(c["_p1"][-PLOT_TAIL:])],
            "curve": rd(c["_curve"]),
            "ir": [rd(c["_ir0"]), rd(c["_ir1"])],
        } for r, c in zip(rows, plan)],
    }
    blob = json.dumps(payload)
    (DATA / "dashboard.json").write_text(blob, encoding="utf-8")
    # Serve the same payload straight to the React dev server / build.
    public = ROOT / "frontend" / "public"
    if public.is_dir():
        (public / "dashboard.json").write_text(blob, encoding="utf-8")
        log(f"  copied dashboard.json -> {public}")

    # ---- report ----
    log(f"\nWrote {DATA}")
    log(f"  run_summary.csv   {len(summary):,} runs x {summary.shape[1]} cols")
    log(f"  price_series.csv  {len(summary)*TAIL:,} rows")
    log(f"  dashboard.json    {(DATA/'dashboard.json').stat().st_size/1e6:.2f} MB")
    log("\nCollusion index (delta): 0 = Bertrand-Nash, 1 = perfect cartel")
    log(summary.groupby(["label", "regime"]).agg(
        n=("delta", "size"), delta_mean=("delta", "mean"), delta_sd=("delta", "std"),
        price_over_nash=("price_over_nash", "mean"),
        punish=("punish_depth", "mean"), converged=("converged", "mean"),
    ).round(3).to_string())


if __name__ == "__main__":
    main()
