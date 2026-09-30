"""
Real daily price histories of Indian e-commerce listings (Amazon.in, Flipkart,
Myntra) from the public product pages of pricehistoryapp.com.

Each product page embeds the tracker's recorded daily prices ("priceHistory",
flagged is_synthetic=false) going back up to two years. robots.txt allows
these pages (only /api/ and sign-in pages are disallowed); we fetch public
HTML only, one request every 1.5 s, and cache everything.

    python -m bench.pha_harvest            # -> data/pha_cache/*.json
    python -m bench.pha_harvest slugs.txt  # only these product slugs (one per line)
"""

from __future__ import annotations

import json
import re
import sys
import time
from pathlib import Path

import requests

ROOT = Path(__file__).resolve().parent.parent
CACHE = ROOT / "data" / "pha_cache"
BASE = "https://pricehistoryapp.com"
UA = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/128 Safari/537.36"}
PAUSE = 1.5


def get(url: str) -> str | None:
    for i in range(3):
        try:
            r = requests.get(url, headers=UA, timeout=30)
            if r.status_code == 200:
                return r.text
            if r.status_code == 404:
                return None
        except requests.RequestException:
            pass
        time.sleep(5 * (i + 1))
    return None


def listing_pages() -> list[str]:
    sm = get(f"{BASE}/sitemap.xml") or ""
    locs = re.findall(r"<loc>([^<]+)</loc>", sm)
    return [u for u in locs if "/deals" in u or "sale" in u or "big-billion" in u
            or "great-indian" in u or "price-history" in u or u.rstrip("/") == BASE] + [f"{BASE}/latest-deals", f"{BASE}/featured-deals"]


def _unescape(s: str) -> str:
    return s.encode().decode("unicode_escape", errors="ignore") if "\\u" in s else s


def parse_product(html: str) -> dict | None:
    t = html.replace('\\"', '"')
    m = re.search(r'"priceHistory":(\[[^\]]*\])', t)
    if not m:
        return None
    try:
        hist = json.loads(m.group(1))
    except json.JSONDecodeError:
        return None
    def field(k):
        x = re.search(rf'"{k}":"([^"]*)"', t)
        return _unescape(x.group(1)) if x else None
    meta = re.search(r'"is_synthetic":(true|false)', t)
    tm = re.search(r'"category":"([^"]*)","title":"([^"]+)"', t)
    return {
        "title": _unescape(tm.group(2)) if tm else None,
        "brand": field("brand"),
        "store": field("store"),
        "url": field("productUrl"),
        "category": tm.group(1) if tm else field("category"),
        "synthetic": meta.group(1) == "true" if meta else None,
        "history": [{"d": h["date"], "p": h["price"]} for h in hist if "date" in h and "price" in h],
    }


def main():
    sys.stdout.reconfigure(encoding="utf-8")
    CACHE.mkdir(parents=True, exist_ok=True)
    slugs: set[str] = set()
    if len(sys.argv) > 1:
        slugs = {l.strip().rsplit("/", 1)[-1] for l in open(sys.argv[1], encoding="utf-8") if l.strip()}
    pages = [] if slugs else listing_pages()
    print(f"{len(pages)} listing pages", flush=True)
    for u in pages:
        html = get(u) or ""
        slugs |= set(re.findall(r"/product/([a-z0-9-]+)", html))
        time.sleep(PAUSE)
    print(f"{len(slugs)} products found", flush=True)
    new = 0
    for i, s in enumerate(sorted(slugs)):
        out = CACHE / f"{s[:150]}.json"
        if out.exists():
            continue
        html = get(f"{BASE}/product/{s}")
        p = parse_product(html) if html else None
        if p:
            p["slug"] = s
            out.write_text(json.dumps(p, ensure_ascii=False), encoding="utf-8")
            new += 1
        if i % 25 == 0:
            print(f"  {i}/{len(slugs)}", flush=True)
        time.sleep(PAUSE)
    print(f"saved {new} new products into {CACHE}")


if __name__ == "__main__":
    main()
