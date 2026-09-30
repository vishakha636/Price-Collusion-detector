"""
Register the harvested listings (bench/pha_harvest.py) as monitored products,
with their past daily prices loaded as readings.

One product per (store, category) with at least 3 rival brands: the brand with
the longest history is treated as "yours", up to 6 other brands as
competitors. Every listing is tagged history_source="pricehistoryapp.com" so
the UI can say where the pre-registration prices came from; readings added
later by our own tracker are not tagged.

    python -m bench.pha_import           # adds products to data/price_watch.db
    python -m bench.pha_import --clear   # remove previously imported products first
"""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path

from tracker import products, store

ROOT = Path(__file__).resolve().parent.parent
CACHE = ROOT / "data" / "pha_cache"
SOURCE = "pricehistoryapp.com"
STORES = {"Flipkart": "flipkart", "Amazon": "amazon", "Myntra": "myntra"}
MIN_POINTS, MIN_OVERLAP, MAX_RIVALS = 60, 90, 6
SKIP = {"Fiction", "Non-Fiction", "Books"}


def listing_id(p: dict) -> str:
    u = p.get("url") or ""
    m = re.search(r"pid=([A-Z0-9]+)", u) or re.search(r"/dp/([A-Z0-9]{10})", u) or re.search(r"/(\d{6,})/buy", u)
    return m.group(1) if m else p["slug"][:60]


def load() -> list[dict]:
    out = []
    for f in CACHE.glob("*.json"):
        p = json.loads(f.read_text(encoding="utf-8"))
        if p.get("synthetic") or not p.get("brand") or p["brand"].strip().lower() in ("unknown", "generic") or p.get("store") not in STORES or len(p["history"]) < MIN_POINTS:
            continue
        p["brand"] = p["brand"].strip()
        p["category"] = (p.get("category") or "").encode().decode("unicode_escape", errors="ignore") if "\\u" in (p.get("category") or "") else (p.get("category") or "")
        p["first"], p["last"] = p["history"][0]["d"], p["history"][-1]["d"]
        out.append(p)
    return out


def same_company(a: str, b: str) -> bool:
    """WILD STONE vs WILD STONE CODE, Kamiliant by American Tourister vs American Tourister."""
    a, b = re.sub(r"[^a-z0-9 ]", "", a.lower()), re.sub(r"[^a-z0-9 ]", "", b.lower())
    return a.startswith(b) or b.startswith(a) or a.endswith(" " + b) or b.endswith(" " + a)


def overlap(a: dict, b: dict) -> int:
    import datetime as dt
    lo, hi = max(a["first"], b["first"]), min(a["last"], b["last"])
    return (dt.date.fromisoformat(hi) - dt.date.fromisoformat(lo)).days


def main():
    sys.stdout.reconfigure(encoding="utf-8")
    con = store.connect()
    products.init(con)
    if "--clear" in sys.argv:
        for p in products.list_products(con):
            if any(x.get("history_source") == SOURCE for x in p["own"]):
                con.execute("DELETE FROM product_readings WHERE product_id = ?", (p["id"],))
                con.execute("DELETE FROM products WHERE id = ?", (p["id"],))
        con.commit()

    groups: dict[tuple, dict[str, dict]] = {}
    for p in load():
        by_brand = groups.setdefault((p["store"], p["category"]), {})
        key = p["brand"].upper()
        if key not in by_brand or len(p["history"]) > len(by_brand[key]["history"]):
            by_brand[key] = p                         # longest history per brand

    made = 0
    for (st, cat), by_brand in sorted(groups.items()):
        if not cat or cat in SKIP or len(by_brand) < 3:
            continue
        ranked = sorted(by_brand.values(), key=lambda p: -len(p["history"]))
        own = ranked[0]
        rivals = []
        for p in ranked[1:]:
            if overlap(own, p) >= MIN_OVERLAP and not any(same_company(p["brand"], q["brand"]) for q in [own, *rivals]):
                rivals.append(p)
        rivals = rivals[:MAX_RIVALS]
        if len(rivals) < 2:
            continue
        plat = STORES[st]
        ckey = re.sub(r"[^a-z0-9]+", "-", cat.lower()).strip("-")
        con.execute("INSERT OR IGNORE INTO categories VALUES (?, ?, ?)", (ckey, cat, json.dumps([plat])))

        def entry(p):
            return {"platform": plat, "name": p["title"], "brand": p["brand"], "source_url": p["url"],
                    "listing_id": listing_id(p), "price": p["history"][-1]["p"], "history_source": SOURCE,
                    "history_from": p["first"]}

        own_l, comp_l = [entry(own)], [entry(p) for p in rivals]
        name = f"{own['brand'].title()} · {cat}"
        cur = con.execute(
            "INSERT INTO products (name, category, platforms, own, competitors, status, last_checked, created) "
            "VALUES (?, ?, ?, ?, ?, 'not_checked', ?, ?)",
            (name, ckey, json.dumps([plat]), json.dumps(own_l), json.dumps(comp_l),
             max(p["last"] for p in [own, *rivals]) + "T12:00:00+00:00", store.now()))
        pid = cur.lastrowid
        rows = [(pid, f"{h['d']}T12:00:00+00:00", e["listing_id"], float(h["p"]))
                for p, e in zip([own, *rivals], own_l + comp_l) for h in p["history"]]
        con.executemany("INSERT OR REPLACE INTO product_readings VALUES (?, ?, ?, ?)", rows)
        made += 1
        print(f"  #{pid} {name} ({st}): {len(rivals)} rivals, {len(rows)} daily prices from {min(p['first'] for p in [own, *rivals])}")
    con.commit()
    print(f"registered {made} products with imported history")


if __name__ == "__main__":
    main()
