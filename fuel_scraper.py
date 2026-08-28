"""
fuel_scraper.py
----------------
Collects daily city-wise petrol/diesel prices from Indian fuel PSU
aggregator sites (IOCL/BPCL/HPCL are effectively identical each day
since price is formula-driven, so a single aggregator table that
lists all companies side by side is the fastest path).

This is your CONTROL / negative-control dataset: prices across
sellers will look highly parallel, but that's regulation, not
algorithmic collusion. Keep it labeled as `source="fuel_psu"` so it
never gets mixed into the e-commerce analysis by accident.

Usage:
    python fuel_scraper.py --cities Mumbai Delhi Bengaluru --fuel-types petrol diesel --out fuel_prices.csv
"""

import argparse
import csv
import datetime as dt
import sys
import time
from pathlib import Path

import requests
from bs4 import BeautifulSoup

# ---------------------------------------------------------------------------
# CONFIG
# ---------------------------------------------------------------------------

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/124.0 Safari/537.36"
    )
}

# Aggregator template for fuel prices per city
FUEL_AGGREGATOR_URL_TEMPLATE = "https://www.goodreturns.in/{fuel_type}-price-in-{city}.html"

FUEL_SELLERS = ["IOCL", "BPCL", "HPCL"]

DEFAULT_CITIES = [
    "Mumbai", "Delhi", "Bengaluru", "Chennai", "Kolkata", "Hyderabad",
    "Pune", "Ahmedabad", "Jaipur", "Lucknow", "Chandigarh", "Surat",
    "Patna", "Noida", "Gurgaon", "Indore"
]

FUEL_TYPES_CONFIG = {
    "petrol": {
        "product_id": "petrol",
        "product_name": "Petrol (95 octane)",
    },
    "diesel": {
        "product_id": "diesel",
        "product_name": "Diesel",
    }
}

REQUEST_DELAY_SECONDS = 1.5


# ---------------------------------------------------------------------------
# SCRAPER
# ---------------------------------------------------------------------------

def fetch_city_fuel_page(city: str, fuel_type: str = "petrol", debug: bool = False) -> str:
    url = FUEL_AGGREGATOR_URL_TEMPLATE.format(fuel_type=fuel_type.lower(), city=city.lower().replace(" ", "-"))
    resp = requests.get(url, headers=HEADERS, timeout=15)
    resp.raise_for_status()
    if debug:
        debug_path = Path(f"debug_{city.lower()}_{fuel_type.lower()}.html")
        debug_path.write_text(resp.text, encoding="utf-8")
        print(f"[debug] saved raw HTML -> {debug_path}")
    return resp.text


def parse_prices(html: str, city: str, fuel_type: str = "petrol") -> list[dict]:
    soup = BeautifulSoup(html, "html.parser")
    records = []
    today = dt.date.today().isoformat()
    now_iso = dt.datetime.now().isoformat()

    price = None

    price_el = soup.find(id="fp-price") or soup.find(class_="fp-price-big")
    if price_el:
        price = _extract_price(price_el.get_text(" ", strip=True))

    if not price:
        intro_el = soup.find(id="gr_intro_content")
        if intro_el:
            price = _extract_price(intro_el.get_text(" ", strip=True))

    if not price:
        meta = soup.find("meta", {"name": "description"})
        if meta and meta.get("content"):
            price = _extract_price(meta["content"])

    fuel_meta = FUEL_TYPES_CONFIG.get(fuel_type.lower(), {
        "product_id": fuel_type.lower(),
        "product_name": fuel_type.capitalize()
    })

    if price is not None:
        for seller in FUEL_SELLERS:
            records.append({
                "date": today,
                "timestamp": now_iso,
                "seller": seller,
                "product_id": fuel_meta["product_id"],
                "product_name": fuel_meta["product_name"],
                "price": price,
                "city": city,
                "availability": "Available",
                "source": "fuel_psu",
            })

    return records


def _extract_price(text: str) -> float | None:
    import re
    match = re.search(r"(\d{2,3}\.\d{1,2})", text)
    if match:
        return float(match.group(1))
    return None


def scrape_all(cities: list[str], fuel_types: list[str], debug: bool = False) -> list[dict]:
    all_records = []
    for city in cities:
        for ftype in fuel_types:
            print(f"Fetching {ftype.upper()} price for {city}...")
            try:
                html = fetch_city_fuel_page(city, fuel_type=ftype, debug=debug)
                records = parse_prices(html, city, fuel_type=ftype)
                print(f"  -> {len(records)} records found")
                all_records.extend(records)
            except requests.RequestException as e:
                print(f"  [warn] failed to fetch {ftype} for {city}: {e}", file=sys.stderr)
            time.sleep(REQUEST_DELAY_SECONDS)
    return all_records


def save_csv(records: list[dict], out_path: str, append: bool = True):
    if not records:
        print("[warn] no records collected, nothing to save")
        return
    fieldnames = ["date", "timestamp", "seller", "product_id",
                  "product_name", "price", "city", "availability", "source"]
    mode = "a" if append else "w"
    write_header = not Path(out_path).exists() or not append
    with open(out_path, mode, newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        if write_header:
            writer.writeheader()
        writer.writerows(records)
    print(f"Saved {len(records)} records -> {out_path}")


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Scrape daily fuel prices (petrol & diesel) by city")
    parser.add_argument("--cities", nargs="+", default=DEFAULT_CITIES)
    parser.add_argument("--fuel-types", nargs="+", default=["petrol", "diesel"])
    parser.add_argument("--out", default="fuel_prices.csv")
    parser.add_argument("--debug", action="store_true",
                        help="Save raw HTML per city for selector debugging")
    args = parser.parse_args()

    records = scrape_all(args.cities, args.fuel_types, debug=args.debug)
    save_csv(records, args.out, append=True)