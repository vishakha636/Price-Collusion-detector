"""
run_pipeline.py
---------------
End-to-end execution pipeline for Price Collusion Detector:
1. Scrapes daily fuel PSU prices (Control Dataset) -> fuel_prices.csv
2. Scrapes daily e-commerce prices (Treatment Dataset) -> ecommerce_prices.csv
3. Normalizes & merges datasets into unified schema -> combined_prices.csv

Usage:
    python run_pipeline.py
"""

import subprocess
import sys


def run_step(step_name: str, cmd: list[str]):
    print(f"\n=======================================================")
    print(f" STEP: {step_name}")
    print(f" Command: {' '.join(cmd)}")
    print(f"=======================================================")
    res = subprocess.run(cmd)
    if res.returncode != 0:
        print(f"[error] Step '{step_name}' failed with exit code {res.returncode}", file=sys.stderr)
        sys.exit(res.returncode)


if __name__ == "__main__":
    python_bin = sys.executable

    # Step 1: Scrape Fuel PSU Prices
    run_step("1. Scrape Fuel PSU Prices", [
        python_bin, "fuel_scraper.py",
        "--cities", "Mumbai", "Delhi", "Bengaluru", "Chennai", "Kolkata",
        "--out", "fuel_prices.csv"
    ])

    # Step 2: Scrape E-Commerce Product Prices
    run_step("2. Scrape E-commerce Product Prices", [
        python_bin, "ecommerce_scraper.py",
        "--file", "products.txt",
        "--max-products", "5",
        "--out", "ecommerce_prices.csv"
    ])

    # Step 3: Normalize & Combine Datasets
    run_step("3. Normalize & Combine Datasets", [
        python_bin, "normalize_schema.py",
        "--fuel", "fuel_prices.csv",
        "--ecommerce", "ecommerce_prices.csv",
        "--out", "combined_prices.csv"
    ])

    print("\n=======================================================")
    print(" [SUCCESS] Pipeline execution complete!")
    print(" Combined dataset generated -> combined_prices.csv")
    print("=======================================================\n")
