"""
generate_historical_fuel.py
-----------------------------
Generates daily historical fuel pricing data (petrol and diesel) across
multiple cities and PSU sellers (IOCL, BPCL, HPCL) over a given time window (e.g., 90 days).

This creates a high-volume control dataset to evaluate price parallelism,
lead-lag correlation, and collusion detection models.

Usage:
    python generate_historical_fuel.py --days 90 --out fuel_prices.csv
"""

import argparse
import csv
import datetime as dt
import random
from pathlib import Path

# City-wise baseline prices reflecting state VAT and freight variations (in INR)
CITY_BASELINES = {
    "Mumbai": {"petrol": 104.21, "diesel": 92.15},
    "Delhi": {"petrol": 94.72, "diesel": 87.62},
    "Bengaluru": {"petrol": 102.86, "diesel": 88.94},
    "Chennai": {"petrol": 100.75, "diesel": 92.34},
    "Kolkata": {"petrol": 103.94, "diesel": 90.76},
    "Hyderabad": {"petrol": 107.41, "diesel": 95.65},
    "Pune": {"petrol": 104.08, "diesel": 90.61},
    "Ahmedabad": {"petrol": 94.44, "diesel": 90.11},
    "Jaipur": {"petrol": 104.88, "diesel": 90.36},
    "Lucknow": {"petrol": 94.65, "diesel": 87.76},
    "Chandigarh": {"petrol": 94.24, "diesel": 82.40},
    "Surat": {"petrol": 94.31, "diesel": 89.98},
    "Patna": {"petrol": 105.18, "diesel": 92.04},
    "Noida": {"petrol": 94.66, "diesel": 87.75},
    "Gurgaon": {"petrol": 94.98, "diesel": 87.85},
    "Indore": {"petrol": 106.50, "diesel": 91.89},
}

FUEL_SELLERS = ["IOCL", "BPCL", "HPCL"]
FUEL_TYPES_META = {
    "petrol": {"product_id": "petrol", "product_name": "Petrol (95 octane)"},
    "diesel": {"product_id": "diesel", "product_name": "Diesel"},
}


def generate_historical_records(days: int = 90, seed: int = 42) -> list[dict]:
    random.seed(seed)
    today = dt.date.today()
    start_date = today - dt.timedelta(days=days - 1)

    records = []

    # Track city-level fuel prices over time with shared trend shifts
    current_prices = {
        city: {ftype: CITY_BASELINES[city][ftype] for ftype in ["petrol", "diesel"]}
        for city in CITY_BASELINES
    }

    for day_idx in range(days):
        current_date = start_date + dt.timedelta(days=day_idx)
        date_str = current_date.isoformat()
        timestamp_str = f"{date_str}T06:00:00.000000"

        # Occasional macro fuel price revision (every ~12 days on average)
        if day_idx > 0 and random.random() < 0.08:
            petrol_shift = round(random.choice([-1.20, -0.80, -0.50, 0.40, 0.75, 1.10]), 2)
            diesel_shift = round(random.choice([-1.00, -0.60, -0.30, 0.35, 0.65, 0.90]), 2)

            for city in current_prices:
                current_prices[city]["petrol"] = max(80.0, round(current_prices[city]["petrol"] + petrol_shift, 2))
                current_prices[city]["diesel"] = max(70.0, round(current_prices[city]["diesel"] + diesel_shift, 2))

        for city, fprices in current_prices.items():
            for ftype, price in fprices.items():
                meta = FUEL_TYPES_META[ftype]
                for seller in FUEL_SELLERS:
                    records.append({
                        "date": date_str,
                        "timestamp": timestamp_str,
                        "seller": seller,
                        "product_id": meta["product_id"],
                        "product_name": meta["product_name"],
                        "price": price,
                        "city": city,
                        "availability": "Available",
                        "source": "fuel_psu",
                    })

    return records


def save_historical_csv(records: list[dict], out_path: str, overwrite: bool = True):
    p = Path(out_path)
    fieldnames = ["date", "timestamp", "seller", "product_id",
                  "product_name", "price", "city", "availability", "source"]

    mode = "w" if overwrite else "a"
    write_header = overwrite or not p.exists()

    with open(out_path, mode, newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        if write_header:
            writer.writeheader()
        writer.writerows(records)

    print(f"[success] Generated {len(records)} historical records ({out_path})")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Generate historical daily fuel price time series")
    parser.add_argument("--days", type=int, default=90, help="Number of historical days to generate")
    parser.add_argument("--out", default="fuel_prices.csv", help="Output file path")
    parser.add_argument("--append", action="store_true", help="Append instead of overwrite output file")
    args = parser.parse_args()

    recs = generate_historical_records(days=args.days)
    save_historical_csv(recs, args.out, overwrite=not args.append)
