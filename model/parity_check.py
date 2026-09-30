"""
Do the Python model (priceguard_model.py) and the PriceGuard app (audit.js)
give the same verdicts on the same real prices?

Exports every monitored product for several windows, runs both engines and
compares the verdict for the product and for each competitor. Also compares
the model's feature extraction with sim/features.py. Needs Node.js.

    python model/parity_check.py
"""

from __future__ import annotations

import json
import shutil
import sqlite3
import subprocess
import sys
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(HERE))

import priceguard_model as pgm            # noqa: E402
from export_prices import export          # noqa: E402


def main():
    sys.stdout.reconfigure(encoding="utf-8")
    con = sqlite3.connect(ROOT / "data" / "price_watch.db")
    con.row_factory = sqlite3.Row
    ids = [r[0] for r in con.execute("SELECT id FROM products WHERE active = 1 ORDER BY id")]
    total = agree = rivals_total = rivals_agree = 0
    diffs = []
    for days in (30, 90, None):
        d = HERE / "exports_parity"
        shutil.rmtree(d, ignore_errors=True)
        d.mkdir()
        for pid in ids:
            export(con, pid, d / f"p{pid}.csv", days)
        js = json.loads(subprocess.run(["node", str(HERE / "js_verdicts.mjs"), str(d)], capture_output=True, text=True, check=True).stdout)
        for f, j in js.items():
            py = pgm.rule_audit(pgm.load_prices(d / f))
            total += 1
            agree += py["level"] == j["level"]
            if py["level"] != j["level"]:
                diffs.append(f"{days or 'all'}d {f}: python {py['level']} vs app {j['level']}")
            for name, jr in j["rivals"].items():
                pr = py["rivals"].get(name)
                if pr is None:
                    continue
                rivals_total += 1
                ok = pr["level"] == jr["level"] and (pr.get("score") == jr["score"] or (pr["status"] != "ready" and jr["score"] is None))
                rivals_agree += ok
                if not ok:
                    diffs.append(f"{days or 'all'}d {f} · {name}: python {pr['level']}/{pr.get('score')} vs app {jr['level']}/{jr['score']}")
        shutil.rmtree(d, ignore_errors=True)
    print(f"Product verdicts:    {agree}/{total} identical (30 days, 90 days, all history)")
    print(f"Competitor verdicts: {rivals_agree}/{rivals_total} identical (level and score)")
    for x in diffs[:15]:
        print("  differs:", x)

    # feature extraction: model copy vs sim/features.py on real series
    from sim.features import extract_features as sim_extract
    rng = np.random.default_rng(0)
    worst = 0.0
    for _ in range(50):
        p0 = np.round(np.cumsum(rng.normal(0, 5, 200)) + 1000)
        p1 = np.round(p0 * rng.uniform(0.9, 1.1) + rng.normal(0, 3, 200))
        a, b = pgm.extract_features(p0, p1), sim_extract(p0, p1)
        worst = max(worst, max(abs(a[k] - b[k]) for k in b))
    print(f"Features vs sim/features.py: max difference {worst:.2e} over 50 series")


if __name__ == "__main__":
    main()
