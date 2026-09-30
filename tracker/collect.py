"""
One collection round: read the current price of every watched product.

Run on a schedule (the server does this itself every few hours while it is
running), or by hand / from Windows Task Scheduler:

    python -m tracker.collect
"""

from __future__ import annotations

import sys
import time

from . import products, sites, store


def collect_pair(con, pair: dict) -> dict:
    """Read both products of one pair back to back under one round timestamp."""
    ts = store.now()
    result = {}
    for side, got in zip("ab", sites.fetch_many([pair["url_a"], pair["url_b"]])):
        if isinstance(got, sites.PriceError):
            store.add_reading(con, pair["id"], ts, side, None, str(got))
            result[side] = {"error": str(got)}
        else:
            store.add_reading(con, pair["id"], ts, side, got)
            result[side] = {"price": got["price"]}
    return result


def collect_market(con, market: dict, ts: str | None = None) -> int:
    """Re-run one market's search and store every product seen. One request."""
    products = sites.search(market["site"], market["query"])
    store.add_market_scan(con, market["id"], ts or store.now(), products)
    return len(products)


def collect_audit(con, audit: dict, ts: str | None = None) -> list:
    """Read the seller's product and every rival back to back, one round."""
    results = sites.fetch_many([p["url"] for p in audit["products"]])
    store.add_audit_round(con, audit["id"], ts or store.now(), results)
    return results


def collect_all(con=None, log=print) -> int:
    con = con or store.connect()
    pairs = store.list_pairs(con)
    markets = store.list_markets(con)
    audits = store.list_audits(con)
    products.init(con)
    prods = products.list_products(con)
    for p in prods:
        n = products.collect_product(con, p)
        log(f"[product {p['id']}] {p['name']}: {n} prices")
        time.sleep(sites.PAUSE_SECONDS)
    for a in audits:
        r = collect_audit(con, a)
        log(f"[audit {a['id']}] " + " | ".join(
            "err" if isinstance(x, Exception) else f"{x['price']:.0f}" for x in r))
        time.sleep(sites.PAUSE_SECONDS)
    for i, p in enumerate(pairs):
        if i:
            time.sleep(sites.PAUSE_SECONDS)
        r = collect_pair(con, p)
        log(f"[pair {p['id']}] {p['brand_a'] or p['name_a'][:30]}: {r['a']}  |  "
            f"{p['brand_b'] or p['name_b'][:30]}: {r['b']}")
    for m in markets:
        time.sleep(sites.PAUSE_SECONDS)
        try:
            n = collect_market(con, m)
            log(f"[market {m['id']}] {m['site']} “{m['query']}”: {n} products")
        except sites.PriceError as e:
            log(f"[market {m['id']}] {m['site']} “{m['query']}”: failed — {e}")
    return len(pairs) + len(markets) + len(audits) + len(prods)


if __name__ == "__main__":
    n = collect_all()
    print(f"collected {n} pair(s)/market(s)")
    sys.exit(0)
