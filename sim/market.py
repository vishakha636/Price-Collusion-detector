"""
Logit-demand differentiated-products market (Calvano, Calzolari, Denicolo & Pastorello,
"Artificial Intelligence, Algorithmic Pricing and Collusion", AER 2020).

This module supplies the *economic ground truth* that the whole project rests on:
the Bertrand-Nash price (what genuine competition looks like) and the joint-profit
monopoly price (what perfect collusion looks like). Every collusion score in the
dataset is measured against these two anchors.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np


@dataclass(frozen=True)
class LogitMarket:
    """Symmetric n-firm logit demand with an outside option.

    q_i = exp((a_i - p_i)/mu) / ( sum_j exp((a_j - p_j)/mu) + exp(a_0/mu) )

    Defaults reproduce the Calvano et al. (2020) baseline calibration, for which
    p_Nash = 1.4729 and p_monopoly = 1.9249.
    """

    a: float = 2.0       # quality index of each product
    a0: float = 0.0      # quality index of the outside good
    mu: float = 0.25     # horizontal differentiation (mu -> 0 is homogeneous goods)
    c: float = 1.0       # constant marginal cost
    n: int = 2           # number of firms

    # ---------- primitives ----------

    def shares(self, prices: np.ndarray) -> np.ndarray:
        """Market shares of the n firms (outside option absorbs the remainder)."""
        prices = np.asarray(prices, dtype=float)
        u = np.append((self.a - prices) / self.mu, self.a0 / self.mu)
        u -= u.max()                      # numerically safe softmax
        e = np.exp(u)
        return (e / e.sum())[:-1]

    def profits(self, prices: np.ndarray) -> np.ndarray:
        prices = np.asarray(prices, dtype=float)
        return (prices - self.c) * self.shares(prices)

    # ---------- equilibrium anchors ----------

    def _upper(self) -> float:
        """A price comfortably above both anchors, used to bracket the solvers."""
        return self.c + self.a + 20.0 * self.mu

    def nash_price(self, tol: float = 1e-13, max_iter: int = 300) -> float:
        """Symmetric Bertrand-Nash price.

        FOC of firm i:  q_i + (p_i - c) dq_i/dp_i = 0  with  dq_i/dp_i = -q_i(1-q_i)/mu
        =>  p_i = c + mu / (1 - q_i).

        Solved by bisection on g(p) = c + mu/(1 - q(p)) - p rather than by
        fixed-point iteration: the iteration only contracts for some (a, mu),
        and this module is called with randomised calibrations.
        g(c) > 0 and g(p) -> c + mu - p < 0 for large p, so a root is bracketed.
        """
        def g(p: float) -> float:
            q = self.shares(np.full(self.n, p))[0]
            return self.c + self.mu / (1.0 - q) - p

        lo, hi = self.c, self._upper()
        if g(hi) > 0.0:
            raise RuntimeError("Nash price is not bracketed")
        for _ in range(max_iter):
            mid = 0.5 * (lo + hi)
            if g(mid) > 0.0:
                lo = mid
            else:
                hi = mid
            if hi - lo < tol:
                break
        return 0.5 * (lo + hi)

    def monopoly_price(self, tol: float = 1e-13, max_iter: int = 300) -> float:
        """Symmetric price that maximises *joint* profit (the perfect-cartel price).

        Found by golden-section search on total profit n*(p-c)*q(p), which is
        single-peaked in p. The FOC form p = c + mu/(1 - n*q) is not used as an
        iteration because 1 - n*q goes negative at low prices and the map then
        oscillates instead of converging.
        """
        def joint(p: float) -> float:
            return self.n * (p - self.c) * self.shares(np.full(self.n, p))[0]

        inv_phi = (np.sqrt(5.0) - 1.0) / 2.0
        lo, hi = self.c, self._upper()
        x1 = hi - inv_phi * (hi - lo)
        x2 = lo + inv_phi * (hi - lo)
        f1, f2 = joint(x1), joint(x2)
        for _ in range(max_iter):
            if f1 > f2:
                hi, x2, f2 = x2, x1, f1
                x1 = hi - inv_phi * (hi - lo)
                f1 = joint(x1)
            else:
                lo, x1, f1 = x1, x2, f2
                x2 = lo + inv_phi * (hi - lo)
                f2 = joint(x2)
            if hi - lo < tol:
                break
        return 0.5 * (lo + hi)

    def anchors(self) -> dict:
        """Nash / monopoly prices and the corresponding per-firm profits."""
        pn = self.nash_price()
        pm = self.monopoly_price()
        return {
            "p_nash": pn,
            "p_monopoly": pm,
            "profit_nash": float(self.profits(np.full(self.n, pn))[0]),
            "profit_monopoly": float(self.profits(np.full(self.n, pm))[0]),
        }

    # ---------- action space ----------

    def price_grid(self, k: int = 15, xi: float = 0.1) -> np.ndarray:
        """The k discrete prices the bots may choose from.

        Calvano's construction: span [p_N, p_M] and extend by a fraction xi on each
        side, so the grid brackets both anchors instead of wasting resolution on
        prices no rational firm would ever set.
        """
        pn, pm = self.nash_price(), self.monopoly_price()
        span = pm - pn
        return np.linspace(pn - xi * span, pm + xi * span, k)

    def profit_tensor(self, grid: np.ndarray) -> np.ndarray:
        """PI[i, j] = profit of firm 0 when it plays grid[i] and the rival plays grid[j].

        Precomputing this turns the simulation inner loop into pure table lookups.
        Symmetry means firm 1's profit at (i, j) is simply PI[j, i].
        """
        k = len(grid)
        pi = np.empty((k, k), dtype=np.float64)
        for i in range(k):
            for j in range(k):
                pi[i, j] = self.profits(np.array([grid[i], grid[j]]))[0]
        return pi


    def discrete_nash(self, grid: np.ndarray):
        """Pure-strategy Nash equilibrium of the *discretised* game.

        The bots choose from k prices, not from a continuum, so the continuous
        Nash price is not exactly attainable. This is the honest competitive
        benchmark for a simulated run: a perfectly competitive pair of bots on
        this grid lands here, not on `nash_price()`. The gap between the two is
        pure discretisation and shows up as a small positive floor on delta.

        Returns (index, price) of the symmetric pure Nash, or the closest grid
        point to the continuous Nash if no symmetric pure equilibrium exists.
        """
        pi = self.profit_tensor(grid)
        br = np.argmax(pi, axis=0)          # br[j] = best reply to rival price j
        for i in range(len(grid)):
            if br[i] == i:                  # (i, i) is a mutual best response
                return i, float(grid[i])
        i = int(np.argmin(np.abs(grid - self.nash_price())))
        return i, float(grid[i])


if __name__ == "__main__":
    m = LogitMarket()
    a = m.anchors()
    print(f"p_Nash      = {a['p_nash']:.4f}   (Calvano et al. report 1.4729)")
    print(f"p_Monopoly  = {a['p_monopoly']:.4f}   (Calvano et al. report 1.9249)")
    print(f"profit_Nash = {a['profit_nash']:.4f}")
    print(f"profit_Mono = {a['profit_monopoly']:.4f}")
    print(f"grid(15)    = {np.round(m.price_grid(15), 4)}")
