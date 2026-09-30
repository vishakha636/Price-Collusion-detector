"""
Read the current price of one product page.

Also `search()`: every product on the first page of a site search, which is
what the market scan and market watch are built on.

Supported: Flipkart and Myntra. Both serve the price inside the page itself
(Flipkart as schema.org JSON-LD, Myntra in its `window.__myx` state object), so
a plain HTTP request is enough -- no browser, no login.

Amazon.in is deliberately NOT supported: it answers automated requests with a
CAPTCHA page, and this project does not try to get around that.

Politeness: one request per product per collection round, a pause between
requests, and a normal browser User-Agent. Keep the watch list small.
"""

from __future__ import annotations

import json
import re
import time
from urllib.parse import quote, quote_plus, urlparse

import requests

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
    ),
    "Accept-Language": "en-IN,en;q=0.9",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
}
PAUSE_SECONDS = 2.5

SITES = {
    "flipkart": {"label": "Flipkart", "hosts": ("flipkart.com",), "supported": True},
    "myntra": {"label": "Myntra", "hosts": ("myntra.com",), "supported": True},
    "amazon": {
        "label": "Amazon.in", "hosts": ("amazon.in", "amzn.in", "amzn.to"), "supported": False,
        "reason": "Amazon blocks automated price checks with a CAPTCHA, so it cannot be watched.",
    },
}


class PriceError(Exception):
    """Raised with a message that is safe to show to the user."""


def site_of(url: str) -> str | None:
    host = (urlparse(url).hostname or "").lower()
    for key, s in SITES.items():
        if any(host == h or host.endswith("." + h) for h in s["hosts"]):
            return key
    return None


def _clean_url(url: str, site: str) -> str:
    """Drop tracking query strings; keep what identifies the product."""
    u = urlparse(url.strip())
    if site == "flipkart":
        pid = re.search(r"[?&]pid=([A-Z0-9]+)", url)
        return f"https://www.flipkart.com{u.path}" + (f"?pid={pid.group(1)}" if pid else "")
    return f"https://www.myntra.com{u.path}"


def _get(url: str) -> str:
    try:
        r = requests.get(url, headers=HEADERS, timeout=20)
    except requests.RequestException as e:
        raise PriceError(f"Could not reach the site ({e.__class__.__name__}).") from e
    if r.status_code != 200:
        raise PriceError(f"The site answered with HTTP {r.status_code}.")
    if "validateCaptcha" in r.text:
        raise PriceError("The site showed a CAPTCHA instead of the product page.")
    return r.text


def _flipkart(html: str) -> dict:
    for block in re.findall(r'<script[^>]*application/ld\+json[^>]*>(.*?)</script>', html, re.S):
        try:
            data = json.loads(block)
        except json.JSONDecodeError:
            continue
        for item in data if isinstance(data, list) else [data]:
            if item.get("@type") != "Product":
                continue
            offers = item.get("offers") or {}
            if isinstance(offers, list):
                offers = offers[0] if offers else {}
            price = offers.get("price")
            if price is None:
                continue
            brand = item.get("brand")
            mrp = re.search(r'"mrp"\s*:\s*(\d+(?:\.\d+)?)', html)
            return {
                "name": item.get("name", "").strip(),
                "brand": brand.get("name") if isinstance(brand, dict) else brand,
                "price": float(price),
                "mrp": float(mrp.group(1)) if mrp else None,
                "in_stock": "InStock" in str(offers.get("availability", "")),
            }
    raise PriceError("Could not find a price on this Flipkart page. Is it a single product page?")


def _myntra(html: str) -> dict:
    m = re.search(r"window\.__myx\s*=\s*(\{.*?\})</script>", html, re.S)
    if not m:
        raise PriceError("Could not find product data on this Myntra page. Is it a single product page?")
    pd = json.loads(m.group(1)).get("pdpData") or {}
    price = (pd.get("price") or {}).get("discounted") or (pd.get("price") or {}).get("mrp")
    if not price:
        raise PriceError("This Myntra page has no price (sold out or removed?).")
    return {
        "name": pd.get("name", "").strip(),
        "brand": (pd.get("brand") or {}).get("name"),
        "price": float(price),
        "mrp": float((pd.get("price") or {}).get("mrp") or pd.get("mrp") or 0) or None,
        "in_stock": not pd.get("flags", {}).get("outOfStock", False),
    }


def fetch(url: str) -> dict:
    """Return {site, url, name, brand, price, mrp, in_stock} for a product URL."""
    site = site_of(url)
    if site is None:
        raise PriceError("Paste a Flipkart or Myntra product link.")
    if not SITES[site]["supported"]:
        raise PriceError(SITES[site]["reason"])
    clean = _clean_url(url, site)
    info = (_flipkart if site == "flipkart" else _myntra)(_get(clean))
    return {"site": site, "url": clean, **info}


def _walk(o, want):
    """Yield every dict inside a nested JSON value that satisfies `want`."""
    if isinstance(o, dict):
        if want(o):
            yield o
        for v in o.values():
            yield from _walk(v, want)
    elif isinstance(o, list):
        for v in o:
            yield from _walk(v, want)


def _search_flipkart(query: str) -> list[dict]:
    html = _get(f"https://www.flipkart.com/search?q={quote_plus(query)}")
    m = re.search(r"window\.__INITIAL_STATE__\s*=\s*(\{.*?\});\s*</script>", html, re.S)
    if not m:
        raise PriceError("Flipkart did not return search results.")
    state = json.loads(m.group(1))
    out = []
    for p in _walk(state, lambda d: "pricing" in d and "titles" in d and "id" in d):
        prices = (p.get("pricing") or {}).get("prices") or []
        sell = next((x["value"] for x in prices if not x.get("strikeOff")), None)
        mrp = next((x["value"] for x in prices if x.get("strikeOff")), None)
        t = p.get("titles") or {}
        if sell is None or not p.get("baseUrl"):
            continue
        out.append({
            "id": f"fk:{p['id']}",
            "brand": (t.get("superTitle") or (t.get("title") or "?").split()[0]).strip(),
            "name": (t.get("title") or t.get("newTitle") or "").strip(),
            "price": float(sell), "mrp": float(mrp) if mrp else None,
            "url": f"https://www.flipkart.com{p['baseUrl'].split('?')[0]}?pid={p['id']}",
            "in_stock": (p.get("availability") or {}).get("displayState", "IN_STOCK") == "IN_STOCK",
        })
    return out


def _search_myntra(query: str) -> list[dict]:
    slug = re.sub(r"[^a-z0-9]+", "-", query.lower()).strip("-")
    html = _get(f"https://www.myntra.com/{slug}?rawQuery={quote(query)}")
    m = re.search(r"window\.__myx\s*=\s*(\{.*?\})</script>", html, re.S)
    if not m:
        raise PriceError("Myntra did not return search results.")
    prods = ((json.loads(m.group(1)).get("searchData") or {}).get("results") or {}).get("products") or []
    return [{
        "id": f"my:{p['productId']}",
        "brand": p.get("brand", "?").strip(),
        "name": p.get("productName", "").strip(),
        "price": float(p["price"]), "mrp": float(p["mrp"]) if p.get("mrp") else None,
        "url": f"https://www.myntra.com/{p.get('landingPageUrl', '')}",
        "in_stock": True,
    } for p in prods if p.get("price")]


def search(site: str, query: str) -> list[dict]:
    """Every product on the first page of a site search, de-duplicated."""
    query = query.strip()
    if not query:
        raise PriceError("Type what you want to search for.")
    if site not in SITES:
        raise PriceError("Unknown site.")
    if not SITES[site]["supported"]:
        raise PriceError(SITES[site]["reason"])
    rows = _search_flipkart(query) if site == "flipkart" else _search_myntra(query)
    seen, out = set(), []
    for r in rows:
        if r["id"] not in seen:
            seen.add(r["id"])
            out.append(r)
    if not out:
        raise PriceError(f"No products found for “{query}”.")
    return out


def fetch_many(urls: list[str]) -> list[dict | PriceError]:
    """Fetch several products with a polite pause between requests."""
    out = []
    for i, u in enumerate(urls):
        if i:
            time.sleep(PAUSE_SECONDS)
        try:
            out.append(fetch(u))
        except PriceError as e:
            out.append(e)
    return out
