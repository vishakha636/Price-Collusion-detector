"""
Registered products: the seller's own listing(s) plus the competitors found
for them, monitored every collection round.

Categories and platforms live in the database (seeded below), so adding a
category or switching a platform's agent on is a data change, not a code
change. A platform is only offered as selectable when its agent actually
works; the rest are listed as "agent not ready".
"""

from __future__ import annotations

import json
import re

from . import sites, store

# --- registry ----------------------------------------------------------------

# Every platform we know of, and whether a working agent exists for it.
PLATFORMS = [
    ("flipkart", "Flipkart", True, None),
    ("myntra", "Myntra", True, None),
    ("amazon", "Amazon.in", False, "Blocks automated checks (CAPTCHA)"),
    ("nykaa", "Nykaa", False, "Agent not built yet"),
    ("croma", "Croma", False, "Agent not built yet"),
    ("tatacliq", "Tata CLiQ", False, "Agent not built yet"),
    ("uber", "Uber", False, "Fares only inside the app"),
    ("ola", "Ola", False, "Fares only inside the app"),
    ("iocl", "IndianOil", False, "Agent not built yet"),
    ("nse", "NSE", False, "Agent not built yet"),
]

# Category -> platforms that sell it. Extend by adding rows.
CATEGORIES = [
    ("earphones", "Earphones", ["flipkart", "myntra", "amazon", "croma", "tatacliq"]),
    ("sunscreen", "Sunscreen", ["myntra", "flipkart", "nykaa", "amazon"]),
    ("phone", "Phone", ["flipkart", "amazon", "croma", "tatacliq"]),
    ("power-bank", "Power bank", ["flipkart", "amazon", "croma"]),
    ("t-shirt", "T-shirt", ["myntra", "flipkart", "amazon"]),
    ("shoes", "Shoes", ["myntra", "flipkart", "amazon"]),
    ("cab-fare", "Cab fare", ["uber", "ola"]),
    ("fuel", "Fuel", ["iocl"]),
    ("stock", "Stock", ["nse"]),
]

SCHEMA = """
CREATE TABLE IF NOT EXISTS platforms (
    key TEXT PRIMARY KEY, label TEXT NOT NULL, ready INTEGER NOT NULL, note TEXT
);
CREATE TABLE IF NOT EXISTS categories (
    key TEXT PRIMARY KEY, label TEXT NOT NULL, platforms TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS products (
    id           INTEGER PRIMARY KEY,
    name         TEXT NOT NULL,
    category     TEXT NOT NULL,
    platforms    TEXT NOT NULL,     -- JSON list of platform keys
    own          TEXT NOT NULL,     -- JSON list of {platform, name, brand, source_url, listing_id}
    competitors  TEXT NOT NULL,     -- JSON list of {platform, name, brand, source_url, listing_id}
    status       TEXT NOT NULL DEFAULT 'not_checked',
    last_checked TEXT,
    created      TEXT NOT NULL,
    active       INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS product_readings (
    product_id INTEGER NOT NULL REFERENCES products(id),
    round_ts   TEXT NOT NULL,
    listing_id TEXT NOT NULL,
    price      REAL,
    PRIMARY KEY (product_id, round_ts, listing_id)
);
"""

STATUSES = {"compliant", "review", "risk", "not_checked"}


def init(con):
    con.executescript(SCHEMA)
    # seed without overwriting edits made later in the database
    con.executemany("INSERT OR IGNORE INTO platforms VALUES (?, ?, ?, ?)",
                    [(k, l, int(r), n) for k, l, r, n in PLATFORMS])
    con.executemany("INSERT OR IGNORE INTO categories VALUES (?, ?, ?)",
                    [(k, l, json.dumps(p)) for k, l, p in CATEGORIES])
    con.commit()


def categories(con) -> list[dict]:
    plats = {r["key"]: dict(r) for r in con.execute("SELECT * FROM platforms")}
    out = []
    for r in con.execute("SELECT * FROM categories ORDER BY label"):
        keys = json.loads(r["platforms"])
        out.append({"key": r["key"], "label": r["label"],
                    "platforms": [{**plats[k], "ready": bool(plats[k]["ready"])} for k in keys if k in plats]})
    return out


# --- competitor discovery ------------------------------------------------------

_WORD = re.compile(r"[a-z0-9]+")


def _tokens(s: str) -> set[str]:
    return {w for w in _WORD.findall((s or "").lower()) if len(w) > 1}


def _match(name: str, listing: dict) -> float:
    """Share of the product-name words found in the listing's brand + title."""
    want = _tokens(name)
    have = _tokens(f"{listing.get('brand', '')} {listing.get('name', '')}")
    return len(want & have) / len(want) if want else 0.0


def discover(name: str, platform_keys: list[str], category: str = "", per_platform: int = 8) -> list[dict]:
    """
    For each platform: search for the product, pick the best-matching listing
    as "yours", and propose rival-brand listings in a similar price band. A
    search for the exact product mostly returns that brand, so a second search
    on the category term fills in the rivals.
    """
    results = []
    for key in platform_keys:
        try:
            listings = sites.search(key, name)
        except sites.PriceError as e:
            results.append({"platform": key, "error": str(e), "own": None, "competitors": []})
            continue
        if category:
            try:
                ids = {x["id"] for x in listings}
                listings += [x for x in sites.search(key, category) if x["id"] not in ids]
            except sites.PriceError:
                pass
        ranked = sorted(listings, key=lambda x: -_match(name, x))
        own = ranked[0] if ranked and _match(name, ranked[0]) >= 0.5 else None
        pool = [x for x in listings if not own or (x["id"] != own["id"] and x["brand"].lower() != own["brand"].lower())]
        if own:
            lo, hi = own["price"] * 0.5, own["price"] * 2.0
            pool = [x for x in pool if lo <= x["price"] <= hi]
            pool.sort(key=lambda x: abs(x["price"] - own["price"]))
        # one listing per rival brand, so the list reads as "competitors"
        seen, comps = set(), []
        for x in pool:
            if x["brand"].lower() in seen:
                continue
            seen.add(x["brand"].lower())
            comps.append(x)
            if len(comps) >= per_platform:
                break
        results.append({"platform": key, "own": own, "candidates": ranked[:10], "competitors": comps,
                        "found": len(listings)})
    return results


# --- storage ----------------------------------------------------------------------

def _listing(platform: str, x: dict) -> dict:
    return {"platform": platform, "name": x["name"], "brand": x.get("brand"),
            "source_url": x.get("source_url") or x["url"], "listing_id": x.get("listing_id") or x["id"],
            "price": x.get("price")}


def register(con, name: str, category: str, platforms: list[str], own: list[dict], competitors: list[dict]) -> int:
    own_l = [_listing(o["platform"], o) for o in own]
    comp_l = [_listing(c["platform"], c) for c in competitors]
    now = store.now()
    cur = con.execute(
        "INSERT INTO products (name, category, platforms, own, competitors, status, last_checked, created) "
        "VALUES (?, ?, ?, ?, ?, 'not_checked', ?, ?)",
        (name, category, json.dumps(platforms), json.dumps(own_l), json.dumps(comp_l), now, now))
    pid = cur.lastrowid
    # first reading: the prices just seen during discovery
    con.executemany("INSERT OR REPLACE INTO product_readings VALUES (?, ?, ?, ?)",
                    [(pid, now, x["listing_id"], x["price"]) for x in own_l + comp_l if x.get("price")])
    con.commit()
    return pid


def _row(con, r, days: int | None = None) -> dict:
    """A product with its readings; with `days`, only the most recent `days` days (older ones stay stored)."""
    import datetime as dt
    p = dict(r)
    for k in ("platforms", "own", "competitors"):
        p[k] = json.loads(p[k])
    since = (dt.datetime.now(dt.timezone.utc) - dt.timedelta(days=days)).isoformat(timespec="seconds") if days else ""
    p["window_days"] = days
    readings: dict[str, list] = {}
    for x in con.execute("SELECT round_ts, listing_id, price FROM product_readings "
                         "WHERE product_id = ? AND round_ts >= ? ORDER BY round_ts", (p["id"], since)):
        readings.setdefault(x["listing_id"], []).append({"t": x["round_ts"], "price": x["price"]})
    p["readings"] = readings
    return p


def list_products(con, days: int | None = None) -> list[dict]:
    return [_row(con, r, days) for r in con.execute("SELECT * FROM products WHERE active = 1 ORDER BY id DESC")]


def get_product(con, pid: int) -> dict | None:
    r = con.execute("SELECT * FROM products WHERE id = ?", (pid,)).fetchone()
    return _row(con, r) if r else None


def set_status(con, pid: int, status: str):
    if status not in STATUSES:
        raise ValueError(status)
    con.execute("UPDATE products SET status = ? WHERE id = ?", (status, pid))
    con.commit()


def deactivate(con, pid: int):
    con.execute("UPDATE products SET active = 0 WHERE id = ?", (pid,))
    con.commit()


# --- monitoring -----------------------------------------------------------------

def collect_product(con, p: dict, ts: str | None = None) -> int:
    """
    One round for a product: re-run the same two searches used at
    registration (product name + category term) once per platform, and
    record today's price for every tracked listing found. Listings that
    dropped out of both searches are read from their own page.
    """
    import time
    ts = ts or store.now()
    tracked = p["own"] + p["competitors"]
    cat = con.execute("SELECT label FROM categories WHERE key = ?", (p["category"],)).fetchone()
    queries = [p["name"]] + ([cat["label"]] if cat else [])
    got = 0
    for key in p["platforms"]:
        want = {x["listing_id"]: x for x in tracked if x["platform"] == key}
        found: dict[str, float] = {}
        for q in queries:
            try:
                found.update({x["id"]: x["price"] for x in sites.search(key, q)})
            except sites.PriceError:
                pass
            time.sleep(sites.PAUSE_SECONDS)
        for lid, x in want.items():
            price = found.get(lid)
            if price is None:
                try:
                    price = sites.fetch(x["source_url"])["price"]
                except sites.PriceError:
                    price = None
                time.sleep(sites.PAUSE_SECONDS)
            if price is not None:
                con.execute("INSERT OR REPLACE INTO product_readings VALUES (?, ?, ?, ?)", (p["id"], ts, lid, price))
                got += 1
    con.execute("UPDATE products SET last_checked = ? WHERE id = ?", (ts, p["id"]))
    con.commit()
    return got
