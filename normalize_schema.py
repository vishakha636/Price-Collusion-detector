"""
normalize_schema.py
-------------------
Combines and normalizes pricing datasets from fuel aggregator scrapers
(control dataset) and e-commerce scrapers (treatment dataset) into a
unified schema for price collusion analysis.

Usage:
    python normalize_schema.py --fuel fuel_prices.csv --ecommerce ecommerce_prices.csv --out combined_prices.csv
"""

import argparse
import csv
import sys
from pathlib import Path

REQUIRED_COLUMNS = [
    "date", "timestamp", "seller", "product_id",
    "product_name", "price", "city", "availability", "source"
]


def load_csv(filepath: str) -> list[dict]:
    p = Path(filepath)
    if not p.exists():
        print(f"[warn] File not found: {filepath}", file=sys.stderr)
        return []

    records = []
    with open(p, "r", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        for row in reader:
            records.append(row)
    return records


def _parse_price_float(val) -> float:
    if not val or val == "price":
        return 0.0
    try:
        return float(val)
    except (ValueError, TypeError):
        return 0.0


def normalize_fuel_records(records: list[dict]) -> list[dict]:
    normalized = []
    for r in records:
        if r.get("seller") == "seller" or r.get("price") == "price":
            continue
        norm = {
            "date": r.get("date", ""),
            "timestamp": r.get("timestamp", ""),
            "seller": r.get("seller", ""),
            "product_id": r.get("product_id", "petrol"),
            "product_name": r.get("product_name", "Petrol"),
            "price": _parse_price_float(r.get("price")),
            "city": r.get("city", ""),
            "availability": r.get("availability", "Available"),
            "source": r.get("source", "fuel_psu"),
        }
        normalized.append(norm)
    return normalized


def normalize_ecommerce_records(records: list[dict]) -> list[dict]:
    normalized = []
    for r in records:
        if r.get("seller") == "seller" or r.get("price") == "price":
            continue
        norm = {
            "date": r.get("date", ""),
            "timestamp": r.get("timestamp", ""),
            "seller": r.get("seller", ""),
            "product_id": r.get("product_id", ""),
            "product_name": r.get("product_name", ""),
            "price": _parse_price_float(r.get("price")),
            "city": r.get("city", "Online"),
            "availability": r.get("availability", "In stock"),
            "source": r.get("source", "ecommerce_amazon"),
        }
        normalized.append(norm)
    return normalized


def save_combined_csv(records: list[dict], out_path: str):
    if not records:
        print("[warn] No records to save in combined dataset.", file=sys.stderr)
        return

    with open(out_path, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=REQUIRED_COLUMNS)
        writer.writeheader()
        writer.writerows(records)

    print(f"[success] Saved {len(records)} normalized records -> {out_path}")


def summarize(records: list[dict]):
    print("\n" + "=" * 55)
    print("      DATASET NORMALIZATION & SUMMARY REPORT")
    print("=" * 55)
    print(f"Total Normalized Records: {len(records)}")

    sources = {}
    sellers = set()
    products = set()

    for r in records:
        src = r.get("source", "unknown")
        sources[src] = sources.get(src, 0) + 1
        if r.get("seller"):
            sellers.add(r.get("seller"))
        if r.get("product_id"):
            products.add(r.get("product_id"))

    print("\nRecords by Source:")
    for src, count in sources.items():
        print(f"  - {src}: {count} records")

    print(f"\nUnique Sellers ({len(sellers)}): {', '.join(sorted(sellers))}")
    print(f"Unique Products ({len(products)}): {len(products)} products tracked")
    print("=" * 55 + "\n")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Normalize & combine fuel and e-commerce datasets")
    parser.add_argument("--fuel", default="fuel_prices.csv", help="Input fuel dataset CSV")
    parser.add_argument("--ecommerce", default="ecommerce_prices.csv", help="Input e-commerce dataset CSV")
    parser.add_argument("--out", default="combined_prices.csv", help="Output combined CSV path")
    args = parser.parse_args()

    fuel_raw = load_csv(args.fuel)
    ecom_raw = load_csv(args.ecommerce)

    fuel_norm = normalize_fuel_records(fuel_raw)
    ecom_norm = normalize_ecommerce_records(ecom_raw)

    combined = fuel_norm + ecom_norm

    save_combined_csv(combined, args.out)
    summarize(combined)
