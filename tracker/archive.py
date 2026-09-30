"""
Real price history from the Internet Archive (Wayback Machine).

The Archive keeps dated snapshots of public product pages. Each snapshot is
a real copy of the page as a shopper saw it that day, so the price and the
seller on it are genuine historical observations -- free, and going back
years. Snapshots are irregular (days to weeks apart), which the audit has to
allow for.

    python -m tracker.archive discover            # which listings have most history
    python -m tracker.archive import power-banks earbuds  # fetch + parse snapshots

Politeness: the Archive rate-limits heavy use. Requests are spaced out,
retried with back-off, and every downloaded snapshot is cached on disk so
nothing is fetched twice.
"""

from __future__ import annotations

import collections
import gzip
import json
import re
import sys
import time
from pathlib import Path

import requests

CACHE = Path(__file__).resolve().parent.parent / "data" / "archive_cache"
CDX = "https://web.archive.org/cdx/search/cdx"
PAUSE = 2.0

S = requests.Session()
S.headers["User-Agent"] = "price-collusion-detector (student research project)"


def _get(url: str, params: dict | None = None, tries: int = 4) -> requests.Response | None:
    for i in range(tries):
        try:
            r = S.get(url, params=params, timeout=60)
            if r.status_code == 200 and "Temporarily Offline" not in r.text[:500]:
                return r
        except requests.RequestException:
            pass
        time.sleep(PAUSE * (3 ** i))          # 2s, 6s, 18s, 54s
    return None


def captures(url_pattern: str, since: str = "2024") -> list[tuple[str, str]]:
    """[(timestamp, original_url)], at most one per day, HTTP 200 only.

    The Archive's index (CDX) is the part that gets overloaded and answers
    503; results are cached on disk once obtained, and failures back off for
    up to several minutes before giving up.
    """
    key = re.sub(r"[^A-Za-z0-9]+", "_", f"{url_pattern}_{since}")
    f = CACHE / f"cdx_{key}.json"
    if f.exists():
        return [tuple(x) for x in json.loads(f.read_text(encoding="utf-8"))]
    params = {"url": url_pattern, "from": since, "output": "json", "fl": "timestamp,original",
              "filter": "statuscode:200", "collapse": "timestamp:8"}
    for wait in (0, 15, 45, 90, 180, 300):
        time.sleep(wait)
        try:
            r = S.get(CDX, params=params, timeout=90)
        except requests.RequestException:
            continue
        if r.status_code == 200 and r.text.startswith("["):
            rows = json.loads(r.text)[1:]
            CACHE.mkdir(parents=True, exist_ok=True)
            f.write_text(json.dumps(rows), encoding="utf-8")
            return [tuple(x) for x in rows]
        if r.status_code == 200 and not r.text.strip():
            return []                       # genuinely no snapshots
        print(f"    archive index busy (HTTP {r.status_code}), retrying…", flush=True)
    return []


def snapshot(ts: str, url: str) -> str | None:
    """Raw page as archived (the `id_` form skips the Archive's toolbar). Cached."""
    key = re.sub(r"[^A-Za-z0-9]+", "_", url)[-120:]
    f = CACHE / f"{ts}_{key}.html.gz"
    if f.exists():
        return gzip.decompress(f.read_bytes()).decode("utf-8", "ignore")
    r = _get(f"https://web.archive.org/web/{ts}id_/{url}")
    time.sleep(PAUSE)
    if r is None:
        return None
    CACHE.mkdir(parents=True, exist_ok=True)
    f.write_bytes(gzip.compress(r.content))
    return r.content.decode("utf-8", "ignore")


# --- parsers -------------------------------------------------------------------

def parse_amazon(html: str) -> dict | None:
    if "validateCaptcha" in html:
        return None
    price = re.search(r'a-price-whole">([\d,]+)', html)
    if not price:
        return None
    seller = (re.search(r'id="sellerProfileTriggerId"[^>]*>([^<]+)', html)
              or re.search(r'Sold by:?\s*(?:<[^>]+>\s*)*([A-Za-z0-9][^<]{1,60})', html))
    title = re.search(r'id="productTitle"[^>]*>\s*([^<]+)', html)
    return {
        "price": float(price.group(1).replace(",", "")),
        "seller": re.sub(r"\s+", " ", seller.group(1)).strip() if seller else None,
        "title": title.group(1).strip() if title else None,
    }


def parse_flipkart(html: str) -> dict | None:
    for block in re.findall(r'<script[^>]*application/ld\+json[^>]*>(.*?)</script>', html, re.S):
        try:
            data = json.loads(block)
        except json.JSONDecodeError:
            continue
        for item in data if isinstance(data, list) else [data]:
            if isinstance(item, dict) and item.get("@type") == "Product":
                offers = item.get("offers") or {}
                if isinstance(offers, list):
                    offers = offers[0] if offers else {}
                if offers.get("price"):
                    return {"price": float(offers["price"]), "seller": None, "title": item.get("name")}
    return None


def parse(url: str, html: str) -> dict | None:
    return parse_flipkart(html) if "flipkart.com" in url else parse_amazon(html)


# --- discovery -----------------------------------------------------------------

# Indian listings to consider, by category (Amazon.in URL prefixes).
CANDIDATES = {
    "sunscreen": ["Minimalist-Sunscreen", "Lakme-Sun-Expert", "Dot-Key", "Reequil", "Deconstruct",
                  "Neutrogena-Ultra-Sheer", "Aqualogica", "Lotus-Herbals-Safe-Sun"],
    "earbuds": ["boAt-Airdopes", "Noise-Buds", "OnePlus-Nord-Buds", "realme-Buds", "boult-audio"],
    "power bank": ["Mi-Power-Bank", "Ambrane", "URBN", "boAt-EnergyShroom", "Portronics"],
}


def discover(since: str = "2024") -> dict:
    """Snapshots per Amazon.in listing (ASIN), for every candidate brand."""
    out = {}
    for cat, prefixes in CANDIDATES.items():
        out[cat] = []
        for pre in prefixes:
            caps = captures(f"www.amazon.in/{pre}*", since)
            by_asin = collections.defaultdict(list)
            for ts, u in caps:
                m = re.search(r"/dp/([A-Z0-9]{10})", u)
                if m:
                    by_asin[m.group(1)].append((ts, u))
            best = sorted(by_asin.items(), key=lambda kv: -len(kv[1]))[:2]
            for asin, rows in best:
                days = sorted({ts[:8] for ts, _ in rows})
                out[cat].append({"brand": pre, "asin": asin, "snapshots": len(days),
                                 "first": days[0], "last": days[-1], "url": rows[-1][1]})
            print(f"  {cat:10} {pre:26} " +
                  (", ".join(f"{a}:{len(r)}" for a, r in best) if best else "no snapshots"), flush=True)
            time.sleep(PAUSE * 2)
    return out


# --- import ----------------------------------------------------------------------

# Rival groups on Amazon.in: (name, ASIN, URL slug prefix). The first listing
# plays "your product". The Archive's index only allows a trailing wildcard,
# so the slug prefix is how the /Brand-Product-Name/dp/ASIN links are found.
GROUPS = {
    # product identities checked against the archived page titles
    "cables": {"title": "Type-C cables · Amazon.in", "must": r"cable", "listings": [
        ("Ambrane Type-C cable", "B098NS6PVG", "Ambrane"),
        ("Portronics Konnect L", "B09KH58JZR", "Portronics")]},
    "sunscreen": {"title": "Sunscreens · Amazon.in", "must": r"sunscreen|spf", "listings": [
        ("Minimalist SPF 50", "B09FPS9D5T", "Minimalist-Sunscreen"), ("Dot & Key", "B0CF28HXPY", "Dot-Key"),
        ("Aqualogica", "B09TPFTJNN", "Aqualogica"), ("Neutrogena", "B082PFY9S7", "Neutrogena-Ultra-Sheer")]},
    "earbuds": {"title": "Wireless earbuds · Amazon.in", "must": r"earbud|wireless|tws", "listings": [
        ("boAt Airdopes 311 Pro", "B0CZ3ZPD8B", "boAt"),
        ("GOBOULT Z40", "B0BQN3NW8C", "boult-audio")]},
}
OUT = Path(__file__).resolve().parent.parent / "frontend" / "public" / "history"


def listing_history(asin: str, prefix: str, since: str = "2024", log=print) -> list[dict]:
    """One reading per snapshot day: {t, price, seller}. CAPTCHA days are skipped."""
    days: dict[str, list[tuple[str, str]]] = collections.defaultdict(list)
    for pattern in (f"www.amazon.in/dp/{asin}*", f"www.amazon.in/gp/product/{asin}*", f"www.amazon.in/{prefix}*"):
        for ts, u in captures(pattern, since):
            if asin in u:
                days[ts[:8]].append((ts, u))
        time.sleep(PAUSE)
    # prefer a snapshot already in the cache for that day
    def pick(opts):
        for ts, u in opts:
            key = re.sub(r"[^A-Za-z0-9]+", "_", u)[-120:]
            if (CACHE / f"{ts}_{key}.html.gz").exists():
                return ts, u
        return opts[0]
    days = {d: pick(o) for d, o in days.items()}
    # a few downloads at a time -- still gentle on the Archive, much faster
    from concurrent.futures import ThreadPoolExecutor
    items = sorted(days.items())

    def one(item):
        day, (ts, u) = item
        html = snapshot(ts, u)
        return day, (parse(u, html) if html else None)

    points, skipped = [], 0
    with ThreadPoolExecutor(max_workers=3) as pool:
        for i, (day, got) in enumerate(pool.map(one, items)):
            if got:
                points.append({"t": f"{day[:4]}-{day[4:6]}-{day[6:]}", "price": got["price"], "seller": got["seller"],
                               "title": got.get("title")})
            else:
                skipped += 1
            if i % 50 == 0:
                log(f"    {asin}: {i}/{len(days)} days read, {len(points)} usable", flush=True)
    log(f"    {asin}: {len(points)} usable of {len(days)} snapshot days ({skipped} blocked/empty)", flush=True)
    return points


def import_group(key: str, log=print) -> Path | None:
    g = GROUPS[key]
    series = []
    for name, asin, prefix in g["listings"]:
        log(f"  {name} ({asin})", flush=True)
        series.append({"name": name, "asin": asin, "url": f"https://www.amazon.in/dp/{asin}",
                       "points": listing_history(asin, prefix, log=log)})
    if sum(1 for s in series if s["points"]) < 2:
        log(f"  {key}: not enough history yet (archive index unavailable?) - not saved", flush=True)
        return None
    for s in series:                      # most common page title = what the listing actually is
        titles = [p["title"] for p in s["points"] if p.get("title")]
        s["title"] = max(set(titles), key=titles.count) if titles else None
    # drop listings that turn out to be a different product (e.g. a face wash in "sunscreens")
    if g.get("must"):
        bad = [s["name"] for s in series if s["title"] and not re.search(g["must"], s["title"], re.I)]
        for name in bad:
            log(f"  excluded {name}: page title is not a {key} product", flush=True)
        series = [s for s in series if s["name"] not in bad]
        if sum(1 for s in series if s["points"]) < 2:
            return None
    OUT.mkdir(parents=True, exist_ok=True)
    f = OUT / f"{key}.json"
    f.write_text(json.dumps({"key": key, "title": g["title"], "source": "Internet Archive snapshots of Amazon.in",
                             "imported": time.strftime("%Y-%m-%d"), "series": series}, ensure_ascii=False), encoding="utf-8")
    index = OUT / "index.json"
    idx = json.loads(index.read_text(encoding="utf-8")) if index.exists() else []
    idx = [x for x in idx if x["key"] != key] + [{"key": key, "title": g["title"],
            "listings": [s["name"] for s in series], "points": sum(len(s["points"]) for s in series)}]
    index.write_text(json.dumps(idx, ensure_ascii=False, indent=1), encoding="utf-8")
    log(f"  saved {f}", flush=True)
    return f


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    if len(sys.argv) > 1 and sys.argv[1] == "discover":
        res = discover()
        Path(CACHE.parent / "archive_discovery.json").write_text(json.dumps(res, indent=1), encoding="utf-8")
        print("\nsaved data/archive_discovery.json")
    elif len(sys.argv) > 2 and sys.argv[1] == "watch":
        # keep trying every 30 minutes until every group is saved (the index recovers on its own)
        pending = list(sys.argv[2:])
        while pending:
            for key in list(pending):
                print(f"importing {key}", flush=True)
                if import_group(key):
                    pending.remove(key)
            if pending:
                print(f"waiting 30 min; still pending: {pending}", flush=True)
                time.sleep(1800)
        print("all groups imported", flush=True)
    elif len(sys.argv) > 2 and sys.argv[1] == "import":
        for key in sys.argv[2:]:
            print(f"importing {key}", flush=True)
            import_group(key)
    else:
        print(__doc__)
