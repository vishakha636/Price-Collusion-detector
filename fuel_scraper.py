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
    python fuel_scraper.py --cities Mumbai Delhi Bengaluru Chennai --out fuel_prices.csv

Notes:
    - Fuel price aggregator sites change their HTML periodically.
    - Before relying on this in your pipeline, run once with
      --debug to dump the raw HTML and confirm the CSS selectors
      below still match. Adjust SELECTORS if the site has changed.
    - Run this once a day via cron (prices update ~6 AM IST).
"""

import argparse
import csv
import datetime as dt
import time
import sys
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

# Aggregator that lists IOCL/BPCL/HPCL/private prices per city in one table.
# Verify this URL pattern still works before your first real run -
# site structures change; treat this as a starting skeleton.
FUEL_AGGREGATOR_URL_TEMPLATE = "https://www.goodreturns.in/petrol-price-in-{city}.html"

# The sellers you're comparing per city
FUEL_SELLERS = ["IOCL", "BPCL", "HPCL"]

REQUEST_DELAY_SECONDS = 2.0  # be polite - one request per city per run


# ---------------------------------------------------------------------------
# SCRAPER
# ---------------------------------------------------------------------------

def fetch_city_page(city: str, debug: bool = False) -> str:
    url = FUEL_AGGREGATOR_URL_TEMPLATE.format(city=city.lower())
    resp = requests.get(url, headers=HEADERS, timeout=15)
    resp.raise_for_status()
    if debug:
        debug_path = Path(f"debug_{city.lower()}.html")
        debug_path.write_text(resp.text, encoding="utf-8")
        print(f"[debug] saved raw HTML -> {debug_path}")
    return resp.text


def parse_prices(html: str, city: str) -> list[dict]:
    """
    Parses daily petrol price for a city from the aggregator page and creates
    records for each PSU seller (IOCL, BPCL, HPCL).
    """
    soup = BeautifulSoup(html, "html.parser")
    records = []
    today = dt.date.today().isoformat()
    now_iso = dt.datetime.now().isoformat()

    price = None

    # Method 1: Main price card element `#fp-price` or `.fp-price-big`
    price_el = soup.find(id="fp-price") or soup.find(class_="fp-price-big")
    if price_el:
        price = _extract_price(price_el.get_text(" ", strip=True))

    # Method 2: Intro summary block `#gr_intro_content`
    if not price:
        intro_el = soup.find(id="gr_intro_content")
        if intro_el:
            price = _extract_price(intro_el.get_text(" ", strip=True))

    # Method 3: Meta description tag fallback
    if not price:
        meta = soup.find("meta", {"name": "description"})
        if meta and meta.get("content"):
            price = _extract_price(meta["content"])

    if price is not None:
        for seller in FUEL_SELLERS:
            records.append({
                "date": today,
                "timestamp": now_iso,
                "seller": seller,
                "product_id": "petrol",
                "product_name": "Petrol (95 octane)",
                "price": price,
                "city": city,
                "source": "fuel_psu",
            })

    return records


def _extract_price(text: str) -> float | None:
    """Pulls the first plausible rupee price (e.g. 96.72 or 111.38) out of a text blob."""
    import re
    match = re.search(r"(\d{2,3}\.\d{1,2})", text)
    if match:
        return float(match.group(1))
    return None


def scrape_all(cities: list[str], debug: bool = False) -> list[dict]:
    all_records = []
    for city in cities:
        print(f"Fetching {city}...")
        try:
            html = fetch_city_page(city, debug=debug)
            records = parse_prices(html, city)
            print(f"  -> {len(records)} price records found")
            all_records.extend(records)
        except requests.RequestException as e:
            print(f"  [warn] failed to fetch {city}: {e}", file=sys.stderr)
        time.sleep(REQUEST_DELAY_SECONDS)
    return all_records


def save_csv(records: list[dict], out_path: str):
    if not records:
        print("[warn] no records collected, nothing to save")
        return
    fieldnames = ["date", "timestamp", "seller", "product_id",
                  "product_name", "price", "city", "source"]
    write_header = not Path(out_path).exists()
    with open(out_path, "a", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        if write_header:
            writer.writeheader()
        writer.writerows(records)
    print(f"Saved {len(records)} records -> {out_path}")


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Scrape daily fuel prices by city")
    parser.add_argument("--cities", nargs="+", default=[
        "Mumbai", "Delhi", "Bengaluru", "Chennai", "Kolkata", "Hyderabad"
    ])
    parser.add_argument("--out", default="fuel_prices.csv")
    parser.add_argument("--debug", action="store_true",
                         help="Save raw HTML per city for selector debugging")
    args = parser.parse_args()

    records = scrape_all(args.cities, debug=args.debug)
    save_csv(records, args.out)