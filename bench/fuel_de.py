"""
German retail fuel benchmark: can our screens detect the arrival of pricing
algorithms blind, on the real data behind Assad, Clark, Ershov & Xu
("Algorithmic Pricing and Competition", Journal of Political Economy 2024)?

Data: every price change at every German fuel station, published by
Tankerkönig / MTS-K under CC BY 4.0. Read here from the public parquet mirror
github.com/Babalion/tankerkoenig-data-parquet (one small file per day), so no
account is needed. We sample one day per week (Tuesdays), 2015-2019.

    python -m bench.fuel_de download     # ~260 days, ~200 MB
    python -m bench.fuel_de analyse      # writes data/fuel_de_report.json
"""

from __future__ import annotations

import datetime as dt
import sys
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import requests

ROOT = Path(__file__).resolve().parent.parent
CACHE = ROOT / "data" / "fuel_de_cache"
RAW = "https://raw.githubusercontent.com/Babalion/tankerkoenig-data-parquet/master"


def sample_days(start=dt.date(2015, 1, 6), end=dt.date(2019, 12, 31), step=7):
    d = start
    while d <= end:
        yield d
        d += dt.timedelta(days=step)


def _get(url: str, dest: Path) -> bool:
    if dest.exists() and dest.stat().st_size > 0:
        return True
    for i in range(4):
        try:
            r = requests.get(url, timeout=60)
            if r.status_code == 200:
                dest.write_bytes(r.content)
                return True
            if r.status_code == 404:
                return False
        except requests.RequestException:
            pass
        time.sleep(2 * (i + 1))
    return False


def download():
    CACHE.mkdir(parents=True, exist_ok=True)
    _get(f"{RAW}/stations/stations.csv", CACHE / "stations.csv")
    days = list(sample_days())
    jobs = [(f"{RAW}/prices/{d:%Y}/{d:%m}/{d:%Y-%m-%d}-prices.parquet.brotli",
             CACHE / f"{d:%Y-%m-%d}.parquet") for d in days]
    ok = 0
    with ThreadPoolExecutor(max_workers=4) as pool:
        for i, good in enumerate(pool.map(lambda j: _get(*j), jobs)):
            ok += good
            if i % 40 == 0:
                print(f"  {i}/{len(jobs)} days", flush=True)
    print(f"downloaded {ok}/{len(jobs)} days into {CACHE}")


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    cmd = sys.argv[1] if len(sys.argv) > 1 else ""
    if cmd == "download":
        download()
    elif cmd == "analyse":
        from .fuel_de_analyse import main
        main()
    else:
        print(__doc__)
