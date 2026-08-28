"""
Pricing-bot simulation engine.

Four data-generating regimes, two labels:

  COMPETITIVE                          COLLUSIVE
  -----------                          ---------
  q_myopic      gamma = 0              q_patient     gamma ~ 0.95
  Q-learners that only chase this      Q-learners that value the future, and
  period's profit. Converge on         (per Calvano et al. 2020) autonomously
  Bertrand-Nash.                       learn reward-punishment schemes that
                                       sustain supra-competitive prices.

  br_noisy                             grim_cartel
  Rule-based static best-responders    Rule-based grim-trigger cartel at the
  with idiosyncratic noise. A          monopoly price. An *explicit* cartel:
  non-learning competitive control.    the positive control for the detector.

Why two mechanisms per label matters: with only q_myopic vs q_patient, a
classifier can cheat by learning "Q-learning artefact" or "high price = bad".
The rule-based pair forces it to key on interaction *dynamics* instead.

LEARN, THEN MEASURE
-------------------
The price series we keep is NOT the tail of the learning trace. During learning
the agents are still exploring at rate epsilon, so a learning tail is mostly
exploration noise -- it makes myopic bots look collusive (random draws on a
grid centred above Nash pull the mean up) and hides the structure the patient
bots actually learned. Instead we train, freeze the Q-tables, and then *deploy*
the learned policies for a separate evaluation rollout. That rollout carries a
small "tremble" rate: a real pricing bot occasionally moves off-policy
(stock-outs, promos, stale feeds), and those trembles are what make the
reward-punishment machinery visible in an observed price series.

PERFORMANCE
-----------
A Q-learning market is inherently sequential -- you cannot vectorise across
time. So this engine vectorises across *runs* instead: R independent markets
advance one period together under NumPy fancy indexing. Both firms are stacked
into one length-2R axis so each period costs a single set of NumPy calls rather
than one per firm, and the random draws are generated in chunks. That turns
~10^8 Python-level operations into ~10^7 NumPy calls on small arrays, which is
in the same range as numba with no compiled dependency.
"""

from __future__ import annotations

import numpy as np


# --------------------------------------------------------------------------
# Q-learning core (vectorised over runs)
# --------------------------------------------------------------------------

_CHUNK = 4096          # periods of random draws generated at a time


def run_q_batch(pi, gamma, alpha, beta, n_periods, curve_pts, conv_window, seed):
    """Train R two-agent Q-learning markets in lockstep.

    State  = the pair of prices posted last period  (k*k states).
    Action = one of k prices.
    Reward = this period's profit.
    Exploration = epsilon-greedy with epsilon_t = exp(-beta * t).

    Both firms are stacked along one length-2R axis: rows [0, R) are firm 0 and
    rows [R, 2R) are firm 1. They share the same joint state index, so a single
    gather/scatter per period updates both.

    Parameters
    ----------
    pi : (R, k, k) float   pi[r, i, j] = profit of firm 0 in market r when it
                           plays price i against rival price j. The market is
                           symmetric, so firm 1's profit is pi[r, j, i].
    gamma, alpha, beta : (R,) float   per-run discount factor, learning rate,
                           and exploration-decay rate.

    Returns
    -------
    q      : (2R, k*k, k) float  the learned Q-tables
    curve  : (R, curve_pts) float mean price index through learning
    conv_t : (R,) int   period at which the greedy policy froze for
                        `conv_window` periods (-1 = never converged)
    s0, s1 : (R,) int   terminal state, used to seed the evaluation rollout
    """
    pi = np.ascontiguousarray(pi, dtype=np.float64)
    R, k, _ = pi.shape
    n_states = k * k
    rng = np.random.default_rng(seed)
    idx = np.arange(R)
    idx2 = np.arange(2 * R)

    gamma = np.asarray(gamma, dtype=np.float64).reshape(R)
    alpha2 = np.tile(np.asarray(alpha, dtype=np.float64).reshape(R), 2)
    gamma2 = np.tile(gamma, 2)
    beta = np.asarray(beta, dtype=np.float64).reshape(R)

    # Calvano's initialisation: the discounted value of playing uniformly at
    # random forever. Starting from zeros instead biases the agents against
    # ever revisiting an action they happened to try early.
    disc = np.where(gamma < 1.0, 1.0 / (1.0 - gamma), 1.0)          # (R,)
    init = pi.mean(axis=2) * disc[:, None]                          # (R, k)
    init2 = np.tile(init, (2, 1))                                   # (2R, k)
    q = np.repeat(init2[:, None, :], n_states, axis=1).copy()       # (2R, S, k)

    # Flatten (agent, state) into one axis. NumPy's general N-d advanced
    # indexing costs several microseconds of setup per call; single-axis
    # indexing on a 2-D view goes through the fast `take` path instead, which
    # is worth ~3x on this loop.
    qf = q.reshape(2 * R * n_states, k)                             # view, not a copy
    base = idx2 * n_states                                          # (2R,)
    pif = np.ascontiguousarray(pi).reshape(R * k * k)
    pbase = idx * k * k                                             # (R,)

    # Greedy-policy cache. Maintaining it explicitly means the convergence test
    # only has to re-check the single state touched each period.
    pol = np.argmax(q, axis=2).astype(np.int16).reshape(2 * R * n_states)
    stable = np.zeros(R, dtype=np.int64)
    conv_t = np.full(R, -1, dtype=np.int64)

    s2 = np.empty(2 * R, dtype=np.int64)      # reused scratch buffers
    nxt = np.empty(2 * R, dtype=np.int64)
    r = np.empty(2 * R, dtype=np.float64)

    s0 = rng.integers(0, k, R)
    s1 = rng.integers(0, k, R)

    curve = np.zeros((R, curve_pts))
    curve_n = np.zeros(curve_pts)
    bucket = max(n_periods // curve_pts, 1)

    # epsilon_t = exp(-beta*t) is advanced multiplicatively to avoid an exp()
    # call every period.
    eps = np.ones(2 * R)
    decay = np.tile(np.exp(-beta), 2)

    u_exp = u_act = None
    for t in range(n_periods):
        c = t % _CHUNK
        if c == 0:
            m = min(_CHUNK, n_periods - t)
            u_exp = rng.random((m, 2 * R))
            u_act = (rng.random((m, 2 * R)) * k).astype(np.int16)

        s = s0 * k + s1
        s2[:R] = base[:R] + s
        s2[R:] = base[R:] + s
        eps *= decay

        a = np.where(u_exp[c] < eps, u_act[c], pol[s2])
        a0, a1 = a[:R], a[R:]

        pab = pbase + a0 * k + a1
        r[:R] = pif[pab]
        r[R:] = pif[pbase + a1 * k + a0]
        s_next = a0 * k + a1

        row = qf[s2]                            # (2R, k) -- one gather
        nxt[:R] = base[:R] + s_next
        nxt[R:] = base[R:] + s_next
        best = qf[nxt].max(axis=1)

        cur = row[idx2, a]
        row[idx2, a] = cur + alpha2 * (r + gamma2 * best - cur)
        qf[s2] = row                            # one scatter

        new = row.argmax(axis=1).astype(np.int16)
        unchanged = new == pol[s2]
        pol[s2] = new
        both = unchanged[:R] & unchanged[R:]
        stable = np.where(both, stable + 1, 0)
        conv_t = np.where((conv_t < 0) & (stable >= conv_window), t, conv_t)

        b = t // bucket
        if b < curve_pts:
            curve[:, b] += 0.5 * (a0 + a1)
            curve_n[b] += 1.0

        s0, s1 = a0, a1

    curve /= np.maximum(curve_n, 1.0)
    return q, curve, conv_t, s0, s1


def eval_rollout_batch(q, k, s0, s1, n_steps, tremble=0.0, seed=0,
                       force_action=None):
    """Deploy the frozen policies and record the resulting price series.

    This is the "observed market" -- the analogue of what a regulator would
    scrape. Learning is over; the agents just execute their policies.

    tremble : scalar, or a per-run (R,) array. Probability per firm per period
        of an off-policy move. Real
        pricing bots do this constantly (stock-outs, promos, stale competitor
        feeds). Without it a converged deterministic policy collapses into a
        fixed point and the price series carries no information at all; with
        it, the reward-punishment structure becomes visible as the market gets
        knocked off its cycle and has to climb back.
    force_action : if given, firm 0 is forced to this price at step 0 and then
        reverts to its own policy -- the impulse-response defection experiment.
    """
    R = q.shape[0] // 2
    idx2 = np.arange(2 * R)
    rng = np.random.default_rng(seed)
    s0 = np.asarray(s0).copy()
    s1 = np.asarray(s1).copy()
    out0 = np.empty((R, n_steps), dtype=np.int16)
    out1 = np.empty((R, n_steps), dtype=np.int16)

    trem2 = np.tile(np.broadcast_to(np.asarray(tremble, dtype=float), (R,)), 2)
    any_tremble = bool((trem2 > 0.0).any())

    for t in range(n_steps):
        s2 = np.concatenate((s0 * k + s1,) * 2)
        a = np.argmax(q[idx2, s2], axis=1).astype(np.int16)
        if any_tremble:
            hit = rng.random(2 * R) < trem2
            a = np.where(hit, (rng.random(2 * R) * k).astype(np.int16), a)
        a0, a1 = a[:R].copy(), a[R:].copy()
        if t == 0 and force_action is not None:
            a0 = np.full(R, force_action, dtype=np.int16) if np.isscalar(force_action) \
                else np.asarray(force_action, dtype=np.int16)
        out0[:, t] = a0
        out1[:, t] = a1
        s0, s1 = a0.astype(int), a1.astype(int)
    return out0, out1


# --------------------------------------------------------------------------
# Rule-based controls
# --------------------------------------------------------------------------

def best_response_noisy(pi, n_periods, noise, seed):
    """Competitive control: myopic static best response to the rival's last
    price, perturbed by occasional idiosyncratic mistakes (menu costs, stale
    scrapes, A/B tests). Reaches the Nash region without any learning."""
    pi = np.asarray(pi, dtype=np.float64)
    k = pi.shape[0]
    rng = np.random.default_rng(seed)
    br = np.argmax(pi, axis=0)          # br[j] = best reply to rival price j
    o0 = np.empty(n_periods, dtype=np.int16)
    o1 = np.empty(n_periods, dtype=np.int16)
    a0, a1 = int(rng.integers(k)), int(rng.integers(k))
    for t in range(n_periods):
        b0, b1 = int(br[a1]), int(br[a0])
        if rng.random() < noise:
            b0 = int(rng.integers(k))
        if rng.random() < noise:
            b1 = int(rng.integers(k))
        a0, a1 = b0, b1
        o0[t], o1[t] = a0, a1
    return o0, o1


def grim_cartel(k, n_periods, coll_a, nash_a, punish_len, defect_p, noise, seed):
    """Collusive control: both firms hold the cartel price; any defection
    triggers `punish_len` periods at the Nash price, then the cartel re-forms."""
    rng = np.random.default_rng(seed)
    o0 = np.empty(n_periods, dtype=np.int16)
    o1 = np.empty(n_periods, dtype=np.int16)
    punish = 0
    for t in range(n_periods):
        if punish > 0:
            a0 = a1 = nash_a
            punish -= 1
        else:
            a0 = a1 = coll_a
            if rng.random() < defect_p:
                a0 = max(0, coll_a - 1 - int(rng.integers(3)))
                punish = punish_len
            elif rng.random() < defect_p:
                a1 = max(0, coll_a - 1 - int(rng.integers(3)))
                punish = punish_len
        if rng.random() < noise:
            a0 = min(k - 1, max(0, a0 + int(rng.integers(-1, 2))))
        if rng.random() < noise:
            a1 = min(k - 1, max(0, a1 + int(rng.integers(-1, 2))))
        o0[t], o1[t] = a0, a1
    return o0, o1
