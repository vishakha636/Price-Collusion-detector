"""
Export a monitored product's prices from PriceGuard's database as the CSV the
model reads (same format as the app's "CSV" button).

    python model/export_prices.py 13              # product #13 -> model/prices_13.csv
    python model/export_prices.py 13 --days 90    # last 90 days only
    python model/export_prices.py all --days 30   # every product -> model/exports/
"""

from __future__ import annotations

import argparse
import csv
import datetime as dt
import json
import sqlite3
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DB = ROOT / "data" / "price_watch.db"


def export(con, pid: int, out: Path, days: int | None = None) -> Path | None:
    r = con.execute("SELECT * FROM products WHERE id = ?", (pid,)).fetchone()
    if not r:
        return None
    own, comps = json.loads(r["own"]), json.loads(r["competitors"])
    mine = own[0]
    cols = [mine] + [c for c in comps if c["platform"] == mine["platform"]]
    since = (dt.datetime.now(dt.timezone.utc) - dt.timedelta(days=days)).isoformat(timespec="seconds") if days else ""
    by_t: dict[str, dict] = {}
    for x in con.execute("SELECT round_ts, listing_id, price FROM product_readings WHERE product_id = ? AND round_ts >= ?", (pid, since)):
        by_t.setdefault(x["round_ts"], {})[x["listing_id"]] = x["price"]
    names = [f"You ({mine.get('brand') or 'you'})"] + [c.get("brand") or c["name"].split()[0] for c in cols[1:]]
    with out.open("w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(["date", *names])
        for t in sorted(by_t):
            w.writerow([t, *[by_t[t].get(c["listing_id"], "") for c in cols]])
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("product", help="product id, or 'all'")
    ap.add_argument("--days", type=int, default=None)
    a = ap.parse_args()
    con = sqlite3.connect(DB)
    con.row_factory = sqlite3.Row
    if a.product == "all":
        d = Path(__file__).parent / "exports"
        d.mkdir(exist_ok=True)
        ids = [r[0] for r in con.execute("SELECT id FROM products WHERE active = 1 ORDER BY id")]
        for pid in ids:
            export(con, pid, d / f"prices_{pid}.csv", a.days)
        print(f"{len(ids)} products -> {d}")
    else:
        out = export(con, int(a.product), Path(__file__).parent / f"prices_{a.product}.csv", a.days)
        print(out or "no such product")


if __name__ == "__main__":
    main()
