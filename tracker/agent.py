"""
Product agent: paste one product link (or name) -> PriceGuard finds the
competitors on every platform it can reach, collects their prices, attaches
any price history it already has, and registers the product so the app shows
the full audit and report.

What each platform allows (checked Sep 2026):
  * Myntra   -- live search works: competitors found live.
  * Flipkart -- product pages can be read, but search results now load inside
                the app (not in the page), so competitors come from
                PriceGuard's catalog; their current prices are then read live.
  * Amazon.in-- blocks automated reading (CAPTCHA): catalog only, no live prices.

The catalog = every listing PriceGuard already tracks (data/price_watch.db)
plus the harvested daily price histories (data/pha_cache, pricehistoryapp.com).

    python -m tracker.agent <product link or name>
"""

from __future__ import annotations

import datetime as dt
import json
import re
import sys
import time
from pathlib import Path
from urllib.parse import urlparse

from . import products, sites, store

ROOT = Path(__file__).resolve().parent.parent
CACHE = ROOT / "data" / "pha_cache"
STORE_KEY = {"Flipkart": "flipkart", "Amazon": "amazon", "Myntra": "myntra"}
LIVE_SEARCH = {"myntra"}              # platforms whose search results can be read
LIVE_PRICES = {"flipkart", "myntra"}  # platforms whose product pages can be read
MAX_RIVALS = 6
_WORD = re.compile(r"[a-z0-9]+")
STOP = {"for", "with", "and", "the", "men", "women", "of", "in", "pack", "ml", "g", "black", "white", "blue"}


def norm_id(url_or_id: str, platform: str) -> str:
    """One id per listing regardless of where it came from (search, page, catalog)."""
    s = str(url_or_id)
    for pat in (r"pid=([A-Z0-9]{10,})", r"/dp/([A-Z0-9]{10})", r"/(\d{5,})/buy", r"^(?:fk|my|am):(.+)$"):
        m = re.search(pat, s)
        if m:
            return m.group(1)
    return s[:80]


def tokens(s: str) -> set[str]:
    return {w for w in _WORD.findall((s or "").lower()) if len(w) > 1 and w not in STOP}


def same_company(a: str, b: str) -> bool:
    a, b = re.sub(r"[^a-z0-9 ]", "", (a or "").lower()).strip(), re.sub(r"[^a-z0-9 ]", "", (b or "").lower()).strip()
    return bool(a and b) and (a.startswith(b) or b.startswith(a) or a.endswith(" " + b) or b.endswith(" " + a))


# --- catalog -------------------------------------------------------------------------

def load_catalog(con) -> list[dict]:
    """Every listing we know: harvested histories + listings tracked in the database."""
    out, seen = [], set()
    for f in CACHE.glob("*.json"):
        p = json.loads(f.read_text(encoding="utf-8"))
        plat = STORE_KEY.get(p.get("store"))
        if not plat or not p.get("brand") or p.get("synthetic"):
            continue
        cat = p.get("category") or ""
        if "\\u" in cat:
            cat = cat.encode().decode("unicode_escape", errors="ignore")
        lid = norm_id(p.get("url") or p["slug"], plat)
        seen.add((plat, lid))
        out.append({"platform": plat, "listing_id": lid, "brand": p["brand"].strip(), "name": p.get("title") or "",
                    "category": cat, "url": p.get("url"), "history": [(h["d"], h["p"]) for h in p["history"]],
                    "source": "pricehistoryapp.com"})
    cats = {r["key"]: r["label"] for r in con.execute("SELECT key, label FROM categories")}
    for r in con.execute("SELECT * FROM products WHERE active = 1"):
        for x in json.loads(r["own"]) + json.loads(r["competitors"]):
            lid = norm_id(x.get("source_url") or x["listing_id"], x["platform"])
            if (x["platform"], lid) in seen:
                continue
            seen.add((x["platform"], lid))
            out.append({"platform": x["platform"], "listing_id": lid, "brand": x.get("brand") or "", "name": x.get("name") or "",
                        "category": cats.get(r["category"], r["category"]), "url": x.get("source_url"),
                        "history": [], "source": "PriceGuard", "db_listing": x["listing_id"]})
    return out


def db_history(con, listing_ids: set[str]) -> dict[str, list]:
    """Readings already stored for these listings (under any product)."""
    out: dict[str, list] = {}
    for r in con.execute("SELECT listing_id, round_ts, price FROM product_readings"):
        lid = r["listing_id"]
        key = lid if lid in listing_ids else (lid.split(":", 1)[-1] if lid.split(":", 1)[-1] in listing_ids else None)
        if key and r["price"] is not None:
            out.setdefault(key, []).append((r["round_ts"][:10], r["price"]))
    return out


# --- the agent ------------------------------------------------------------------------

class Agent:
    def __init__(self, log=print):
        self.log = log
        self.steps: list[dict] = []

    def step(self, text: str, status: str = "done", detail: str = ""):
        s = {"text": text, "status": status, "detail": detail, "t": time.time()}
        self.steps.append(s)
        self.log(f"[{status}] {text}" + (f" · {detail}" if detail else ""))
        return s

    def identify(self, query: str, catalog: list[dict]) -> dict:
        """The seller's own product, from its page (or the catalog when the page can't be read)."""
        q = query.strip()
        site = sites.site_of(q) if q.startswith("http") else None
        if site:
            lid = norm_id(q, site)
            known = next((c for c in catalog if c["platform"] == site and c["listing_id"] == lid), None)
            if site in LIVE_PRICES:
                info = sites.fetch(q)
                self.step("Read product page", detail=f"{info['brand']} · ₹{info['price']:,.0f} · {site.title()}")
                # Myntra links name the product type: myntra.com/<type>/<brand>/...
                path = [x for x in urlparse(info["url"]).path.split("/") if x]
                hint = path[0].replace("-", " ") if site == "myntra" and len(path) > 2 else ""
                return {"platform": site, "listing_id": lid, "brand": info["brand"], "name": info["name"],
                        "url": info["url"], "price": info["price"], "category": (known or {}).get("category", ""),
                        "type_hint": hint, "history": (known or {}).get("history", [])}
            if known:
                self.step("Product found in catalog", detail=f"{known['brand']} · {site} page not readable (CAPTCHA)")
                return {**known, "price": known["history"][-1][1] if known["history"] else None}
            raise sites.PriceError(f"{sites.SITES[site]['label']} blocks automated reading. Paste the product name instead.")
        # a name: best token match in the catalog
        want = tokens(q)
        best = max(catalog, key=lambda c: len(want & tokens(f"{c['brand']} {c['name']}")) / max(len(want), 1), default=None)
        if not best or len(want & tokens(f"{best['brand']} {best['name']}")) / max(len(want), 1) < 0.5:
            raise sites.PriceError("Product not found. Paste a Flipkart or Myntra product link.")
        self.step("Product found in catalog", detail=f"{best['brand']} · {best['platform'].title()}")
        return {**best, "price": best["history"][-1][1] if best["history"] else None}

    def category_of(self, own: dict, catalog: list[dict]) -> str:
        if own.get("category"):
            return own["category"]
        hint = own.get("type_hint")
        if hint:
            # a catalog category naming the same type ("watches" -> "Mens Watches"), else the type itself
            stem = lambda w: w[:-1] if w.endswith("s") else w
            want = {stem(w) for w in tokens(hint)}
            cats = sorted({c["category"] for c in catalog if c["platform"] == own["platform"] and c["category"]})
            match = next((c for c in cats if want <= {stem(w) for w in tokens(c)}), None)
            return match or hint.title()
        # the catalog category whose listings share most words with this title
        words = tokens(own["name"]) - tokens(own["brand"])
        score: dict[str, int] = {}
        for c in catalog:
            if c["category"]:
                score[c["category"]] = score.get(c["category"], 0) + len(words & tokens(c["name"]))
        return max(score, key=score.get) if score and max(score.values()) > 0 else " ".join(list(words)[:3])

    def rivals_in(self, platform: str, own: dict, category: str, catalog: list[dict]) -> list[dict]:
        price = own.get("price")
        band = (lambda p: p is not None and price * 0.5 <= p <= price * 2.0) if price else (lambda p: True)
        cands = []
        if platform in LIVE_SEARCH:
            try:
                found = sites.search(platform, category or own["name"])
                self.step(f"{platform.title()}: live search", detail=f"{len(found)} listings for “{category}”")
                cands += [{"platform": platform, "listing_id": norm_id(x["id"], platform), "brand": x["brand"], "name": x["name"],
                           "url": x["url"], "price": x["price"], "history": [], "source": "live search"} for x in found]
            except sites.PriceError as e:
                self.step(f"{platform.title()}: live search", "warn", str(e))
        cat_words = tokens(category)
        for c in catalog:
            if c["platform"] != platform:
                continue
            if c["category"] != category and not (cat_words and cat_words <= tokens(c["name"] + " " + c["category"])):
                continue
            last = c["history"][-1][1] if c["history"] else None
            cands.append({**c, "price": last})
        picked, seen = [], []
        # prefer listings with history, then closest price
        cands.sort(key=lambda c: (-len(c.get("history") or []), abs((c.get("price") or 0) - (price or 0))))
        for c in cands:
            if c["listing_id"] == own.get("listing_id") or same_company(c["brand"], own["brand"]):
                continue
            if any(same_company(c["brand"], b) for b in seen) or not band(c.get("price")):
                continue
            seen.append(c["brand"])
            picked.append(c)
            if len(picked) >= MAX_RIVALS:
                break
        return picked

    def run(self, query: str, con=None) -> dict:
        con = con or store.connect()
        products.init(con)
        catalog = load_catalog(con)
        self.step("Catalog loaded", detail=f"{len(catalog)} known listings")
        own = self.identify(query, catalog)
        category = self.category_of(own, catalog)
        self.step("Category", detail=category or "unknown")

        # already monitored? reuse it instead of registering twice
        for r in con.execute("SELECT id, own FROM products WHERE active = 1"):
            if any(norm_id(x.get("source_url") or x["listing_id"], x["platform"]) == own["listing_id"] for x in json.loads(r["own"])):
                self.step("Already monitored", detail=f"product #{r['id']}")
                return {"product_id": r["id"], "steps": self.steps, "existing": True}

        platform = own["platform"]
        rivals = self.rivals_in(platform, own, category, catalog)
        self.step(f"{platform.title()}: competitors", detail=f"{len(rivals)} found · " + ", ".join(r["brand"] for r in rivals) if rivals else "none found")
        for other in sorted({"flipkart", "myntra", "amazon"} - {platform}):
            twin = next((c for c in catalog if c["platform"] == other and same_company(c["brand"], own["brand"])
                         and len(tokens(own["name"]) & tokens(c["name"])) >= 0.7 * len(tokens(own["name"]))), None)
            self.step(f"{other.title()}: same product", "done" if twin else "skip",
                      twin["name"][:50] if twin else "not listed in catalog")
        if not rivals:
            raise sites.PriceError("No competitors found for this product.")

        # live prices now, where the page can be read
        now = store.now()
        live = 0
        for r in [own, *rivals]:
            if r["platform"] in LIVE_PRICES and r.get("url") and r is not own:
                try:
                    r["price_now"] = sites.fetch(r["url"])["price"]
                    live += 1
                except sites.PriceError:
                    r["price_now"] = None
                time.sleep(sites.PAUSE_SECONDS)
        own["price_now"] = own.get("price") if platform in LIVE_PRICES else None
        self.step("Live prices", detail=f"{live + (1 if own['price_now'] else 0)} of {len(rivals) + 1} read now"
                  + ("" if platform in LIVE_PRICES else f" · {platform} pages blocked"))

        # attach history we already hold for any of these listings
        hist_db = db_history(con, {r["listing_id"] for r in [own, *rivals]})
        with_hist = 0
        for r in [own, *rivals]:
            h = dict(r.get("history") or [])
            h.update(dict(hist_db.get(r["listing_id"], [])))
            r["history"] = sorted(h.items())
            with_hist += bool(r["history"])
        days = max((len(r["history"]) for r in [own, *rivals]), default=0)
        self.step("Price history", detail=f"{with_hist} of {len(rivals) + 1} listings · up to {days} days")

        pid = self.register(con, own, rivals, category, now)
        self.step("Registered and audited", detail=f"product #{pid}")
        return {"product_id": pid, "steps": self.steps, "existing": False}

    def register(self, con, own: dict, rivals: list[dict], category: str, now: str) -> int:
        ckey = re.sub(r"[^a-z0-9]+", "-", (category or "other").lower()).strip("-") or "other"
        con.execute("INSERT OR IGNORE INTO categories VALUES (?, ?, ?)", (ckey, category or "Other", json.dumps([own["platform"]])))

        def entry(x):
            src = x.get("source") if x.get("history") and x.get("source") == "pricehistoryapp.com" else None
            e = {"platform": x["platform"], "name": x["name"], "brand": x["brand"], "source_url": x.get("url"),
                 "listing_id": x["listing_id"], "price": x.get("price_now") or x.get("price"), "found_by": "agent"}
            if src or x.get("history"):
                e["history_source"] = src or "PriceGuard"
                e["history_from"] = x["history"][0][0]
            return e

        own_l, comp_l = [entry(own)], [entry(r) for r in rivals]
        cur = con.execute(
            "INSERT INTO products (name, category, platforms, own, competitors, status, last_checked, created) "
            "VALUES (?, ?, ?, ?, ?, 'not_checked', ?, ?)",
            (f"{own['brand']} · {category}", ckey, json.dumps([own["platform"]]), json.dumps(own_l), json.dumps(comp_l), now, now))
        pid = cur.lastrowid
        rows = []
        for x, e in zip([own, *rivals], own_l + comp_l):
            rows += [(pid, f"{d}T12:00:00+00:00", e["listing_id"], float(p)) for d, p in x["history"]]
            if x.get("price_now"):
                rows.append((pid, now, e["listing_id"], float(x["price_now"])))
        con.executemany("INSERT OR REPLACE INTO product_readings VALUES (?, ?, ?, ?)", rows)
        con.commit()
        return pid


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(1)
    try:
        res = Agent().run(" ".join(sys.argv[1:]))
        print(f"\nOpen: http://localhost:5174/#/app/products?id={res['product_id']}")
    except sites.PriceError as e:
        print(f"Stopped: {e}")
