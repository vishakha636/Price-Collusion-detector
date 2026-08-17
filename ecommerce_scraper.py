"""
ecommerce_scraper.py
--------------------
Scrapes product pricing and seller information for e-commerce items (e.g. Amazon)
by ASIN, search keywords/queries, category presets, or file input.

Supports:
  1. Automatic product discovery using search queries via --search
  2. Category presets via --category (cables, power, audio, wearables, peripherals, storage, smarthome, all)
  3. Multiple ASINs passed directly via --asins
  4. Reading ASINs or search keywords from a file via --file
  5. Built-in expanded catalog of products across popular tech categories
  6. Selenium (--no-headless or headless) with requests fallback

Usage Examples:
  - Automatic search query scraping (finds & scrapes top N products per keyword):
      python ecommerce_scraper.py --search "type c cable" "power bank" --max-products 5 --out ecommerce_prices.csv

  - Scrape products by category preset:
      python ecommerce_scraper.py --category audio --max-products 5

  - Multi-ASIN manual scraping:
      python ecommerce_scraper.py --asins B098NS6PVG B08N5WRWNW B07W5JKF96 --out ecommerce_prices.csv

  - File input (containing ASINs or keywords line by line):
      python ecommerce_scraper.py --file products.txt --out ecommerce_prices.csv

  - Run with browser GUI visible:
      python ecommerce_scraper.py --search "wireless mouse" --no-headless
"""

import argparse
import csv
import datetime as dt
import re
import sys
import time
from pathlib import Path

import requests
from bs4 import BeautifulSoup

# Try importing Selenium; fall back to requests if unavailable
try:
    from selenium import webdriver
    from selenium.webdriver.chrome.options import Options
    from selenium.webdriver.chrome.service import Service
    from selenium.webdriver.common.by import By
    from webdriver_manager.chrome import ChromeDriverManager
    SELENIUM_AVAILABLE = True
except ImportError:
    SELENIUM_AVAILABLE = False


HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
        "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
    ),
    "Accept-Language": "en-US,en;q=0.9",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
}

REQUEST_DELAY_SECONDS = 2.0

CATEGORY_PRESETS = {
    "cables": [
        "type c fast charging cable",
        "hdmi 2.1 cable 4k 120hz",
        "lightning to usb c cable",
        "cat 6 ethernet patch cable",
    ],
    "power": [
        "power bank 20000mah",
        "power bank 10000mah fast charge",
        "fast charger adapter 65w gan",
        "wireless charger pad 15w",
    ],
    "audio": [
        "bluetooth wireless earbuds",
        "noise cancelling over ear headphones",
        "portable bluetooth speaker",
        "neckband bluetooth earphones",
    ],
    "wearables": [
        "smartwatch fitness tracker",
        "smart band activity tracker",
    ],
    "peripherals": [
        "wireless optical mouse",
        "mechanical gaming keyboard",
        "usb c hub multiports adapter",
    ],
    "storage": [
        "micro sd card 128gb",
        "external hard drive 1tb",
        "portable nvme ssd 1tb",
    ],
    "smarthome": [
        "smart wifi plug 16a",
        "security camera 1080p indoor",
        "ring light with tripod stand",
        "gaming headset with microphone",
        "adjustable phone stand holder",
    ],
}

DEFAULT_SEARCH_QUERIES = [
    query for category_queries in CATEGORY_PRESETS.values() for query in category_queries
]

DEFAULT_ASINS = [
    "B098NS6PVG",
    "B084DTMYWK",
    "B082LZGK39",
    "B0DBTV5QF5",
    "B0CZ43567W",
    "B0DZHJT3JB",
    "B09KH58JZR",
    "B0C5XVM3V1",
    "B0GXV5X15P",
    "B0DCZ3WDTB",
    "B0D96JNKFN",
    "B0GXBBD73Q",
    "B0D78XSMSM",
    "B0BF57RN3K",
]


def create_driver(headless: bool = True):
    """Initializes and returns a Selenium Chrome WebDriver."""
    if not SELENIUM_AVAILABLE:
        return None

    options = Options()
    if headless:
        options.add_argument("--headless=new")
    options.add_argument("--no-sandbox")
    options.add_argument("--disable-dev-shm-usage")
    options.add_argument("--disable-blink-features=AutomationControlled")
    options.add_argument(f"user-agent={HEADERS['User-Agent']}")

    try:
        service = Service(ChromeDriverManager().install())
        driver = webdriver.Chrome(service=service, options=options)
        return driver
    except Exception as e:
        print(f"[warn] Failed to initialize Selenium WebDriver: {e}", file=sys.stderr)
        return None


def fetch_url(url: str, driver=None) -> str | None:
    """Fetches a URL using Selenium driver if available, otherwise requests."""
    if driver:
        try:
            driver.get(url)
            time.sleep(2.0)
            return driver.page_source
        except Exception as e:
            print(f"  [warn] Selenium fetch failed for {url}: {e}, falling back to requests...", file=sys.stderr)

    try:
        resp = requests.get(url, headers=HEADERS, timeout=15)
        resp.raise_for_status()
        return resp.text
    except requests.RequestException as e:
        print(f"  [warn] Failed to fetch {url}: {e}", file=sys.stderr)
        return None


def discover_asins_from_search(query: str, domain: str = "amazon.in",
                                max_products: int = 10, pages: int = 1,
                                driver=None) -> tuple[list[str], dict[str, str]]:
    """
    Searches Amazon for a keyword query and discovers product ASINs and titles.
    """
    discovered_asins = []
    title_map = {}
    print(f"\n[search] Discovering ASINs for query: '{query}' (up to {max_products} products across {pages} page(s))...")

    for page in range(1, pages + 1):
        if len(discovered_asins) >= max_products:
            break

        search_url = f"https://www.{domain}/s?k={query.replace(' ', '+')}&page={page}"
        html = fetch_url(search_url, driver=driver)
        if not html:
            continue

        soup = BeautifulSoup(html, "html.parser")
        items = soup.find_all("div", {"data-component-type": "s-search-result"})

        for item in items:
            asin = item.get("data-asin")
            if asin and asin not in discovered_asins:
                discovered_asins.append(asin)
                h2 = item.find("h2")
                if h2:
                    title_map[asin] = h2.get_text(" ", strip=True)
                if len(discovered_asins) >= max_products:
                    break

        time.sleep(REQUEST_DELAY_SECONDS)

    print(f"  -> Discovered {len(discovered_asins)} unique ASIN(s): {', '.join(discovered_asins)}")
    return discovered_asins, title_map


def extract_price(text: str) -> float | None:
    """Parses numeric price from currency text (e.g. ₹99.00 -> 99.0)."""
    if not text:
        return None
    cleaned = text.replace(",", "").replace("₹", "").replace("$", "").strip()
    match = re.search(r"(\d+(?:\.\d{1,2})?)", cleaned)
    if match:
        try:
            return float(match.group(1))
        except ValueError:
            return None
    return None


def extract_title(soup: BeautifulSoup, fallback: str = "") -> str:
    """Extracts product title using multiple CSS/HTML selectors and meta tags."""
    title_el = soup.find(id="productTitle") or soup.find(id="title")
    if title_el and title_el.get_text(strip=True):
        return title_el.get_text(" ", strip=True)

    meta = (
        soup.find("meta", {"property": "og:title"}) or
        soup.find("meta", {"name": "title"}) or
        soup.find("meta", {"name": "twitter:title"})
    )
    if meta and meta.get("content"):
        content = meta["content"].strip()
        if content:
            return content

    t_tag = soup.find("title")
    if t_tag and t_tag.get_text(strip=True):
        raw_title = t_tag.get_text(" ", strip=True)
        cleaned = raw_title.replace("Amazon.in: Buy", "").replace("Amazon.in:", "").replace(": Amazon.in", "").strip()
        if cleaned:
            return cleaned

    return fallback or "Amazon Product"


def parse_product_page(html: str, asin: str, domain: str = "amazon.in", fallback_title: str = "") -> list[dict]:
    """
    Parses product details and seller offers from Amazon product page HTML.
    """
    soup = BeautifulSoup(html, "html.parser")
    today = dt.date.today().isoformat()
    now_iso = dt.datetime.now().isoformat()
    records = []

    # 1. Product Title
    title = extract_title(soup, fallback=fallback_title)

    # 2. Main Price (Buy Box price)
    price = None
    price_selectors = [
        ".a-price .a-offscreen",
        "#corePrice_feature_div .a-offscreen",
        "#corePriceDisplay_desktop_feature_div .a-offscreen",
        "#priceblock_ourprice",
        "#priceblock_dealprice",
        ".a-price-whole",
    ]
    for sel in price_selectors:
        el = soup.select_one(sel)
        if el:
            parsed = extract_price(el.get_text(" ", strip=True))
            if parsed:
                price = parsed
                break

    # 3. Seller / Merchant Name
    seller = "Amazon / Direct"
    merchant_selectors = [
        "#merchant-info",
        "#sellerProfileTriggerId",
        "#tabular-buybox .tabular-buybox-text[merchant_name]",
        "div[data-feature-name='merchantInfo']",
    ]
    for sel in merchant_selectors:
        el = soup.select_one(sel)
        if el:
            raw_text = el.get_text(" ", strip=True)
            if "Sold by" in raw_text:
                parts = raw_text.split("Sold by")[-1].strip()
                seller = parts.split("and")[0].split(".")[0].strip()
                break
            elif raw_text:
                seller = raw_text
                break

    # 4. Availability
    avail = "In Stock"
    avail_el = soup.find(id="availability")
    if avail_el:
        avail_text = avail_el.get_text(" ", strip=True)
        if avail_text:
            avail = avail_text

    # Primary Buy Box offer record
    if price is not None:
        records.append({
            "date": today,
            "timestamp": now_iso,
            "seller": seller,
            "product_id": asin,
            "product_name": title,
            "price": price,
            "city": "Online",
            "availability": avail,
            "source": "ecommerce_amazon",
        })

    # 5. Check additional seller offers if present in page tabular buybox
    tabular_rows = soup.select("#tabular-buybox tr, div.olp-touch-link")
    for row in tabular_rows:
        row_text = row.get_text(" ", strip=True)
        if "Sold by" in row_text:
            m_name = row_text.split("Sold by")[-1].strip().split(" ")[0]
            m_price = extract_price(row_text)
            if m_name and m_price and m_name != seller:
                records.append({
                    "date": today,
                    "timestamp": now_iso,
                    "seller": m_name,
                    "product_id": asin,
                    "product_name": title,
                    "price": m_price,
                    "city": "Online",
                    "availability": avail,
                    "source": "ecommerce_amazon",
                })

    return records


def scrape_asins(asins: list[str], title_map: dict[str, str] = None,
                 headless: bool = True, domain: str = "amazon.in",
                 debug: bool = False, delay: float = REQUEST_DELAY_SECONDS,
                 driver=None) -> list[dict]:
    """Scrapes pricing and seller information for given list of ASINs."""
    all_records = []
    total = len(asins)
    title_map = title_map or {}

    print(f"\n[scrape] Starting product scraping for {total} ASIN(s)...")
    for idx, asin in enumerate(asins, 1):
        url = f"https://www.{domain}/dp/{asin}"
        print(f"[{idx}/{total}] Fetching ASIN {asin} ({url})...")
        html = fetch_url(url, driver=driver)

        if not html:
            print(f"  [warn] Could not fetch page for ASIN {asin}", file=sys.stderr)
            continue

        if debug:
            debug_path = Path(f"debug_asin_{asin.lower()}.html")
            debug_path.write_text(html, encoding="utf-8")
            print(f"  [debug] Saved raw HTML -> {debug_path}")

        fallback_title = title_map.get(asin, "")
        records = parse_product_page(html, asin=asin, domain=domain, fallback_title=fallback_title)
        print(f"  -> {len(records)} seller offer record(s) found")
        all_records.extend(records)

        time.sleep(delay)

    return all_records


def save_csv(records: list[dict], out_path: str):
    """Saves parsed records to CSV file."""
    if not records:
        print("[warn] No records collected, nothing to save.")
        return
    fieldnames = [
        "date", "timestamp", "seller", "product_id",
        "product_name", "price", "city", "availability", "source"
    ]
    write_header = not Path(out_path).exists()
    with open(out_path, "a", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        if write_header:
            writer.writeheader()
        writer.writerows(records)
    print(f"\n[success] Saved {len(records)} record(s) -> {out_path}")


def load_input_file(filepath: str) -> tuple[list[str], list[str]]:
    """Reads ASINs or search queries from a text or CSV file."""
    asins = []
    search_queries = []
    p = Path(filepath)
    if not p.exists():
        print(f"[error] Input file not found: {filepath}", file=sys.stderr)
        sys.exit(1)

    for line in p.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        # Check if line looks like an ASIN (10 alphanumeric chars starting with B or 0-9)
        if re.match(r"^[A-Z0-9]{10}$", line, re.IGNORECASE):
            asins.append(line.upper())
        else:
            search_queries.append(line)

    return asins, search_queries


# ---------------------------------------------------------------------------
# CLI ENTRYPOINT
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description="Scrape daily e-commerce prices by ASIN, search keywords, category presets, or file input"
    )
    parser.add_argument("--asins", nargs="+", default=[],
                        help="List of ASINs to scrape (e.g. --asins B098NS6PVG B08N5WRWNW)")
    parser.add_argument("--search", nargs="+", default=[],
                        help="Search keywords/queries to discover and scrape products (e.g. --search 'type c cable' 'power bank')")
    parser.add_argument("--category", choices=["all", "cables", "power", "audio", "wearables", "peripherals", "storage", "smarthome"], default=None,
                        help="Predefined product category preset to scrape")
    parser.add_argument("--file", default=None,
                        help="Path to file containing ASINs or search queries (one per line)")
    parser.add_argument("--max-products", type=int, default=5,
                        help="Maximum products to scrape per search query (default: 5)")
    parser.add_argument("--pages", type=int, default=1,
                        help="Number of search result pages to scan per query (default: 1)")
    parser.add_argument("--out", default="ecommerce_prices.csv",
                        help="Output CSV filename (default: ecommerce_prices.csv)")
    parser.add_argument("--no-headless", action="store_true",
                        help="Run browser in visible UI mode (non-headless)")
    parser.add_argument("--domain", default="amazon.in",
                        help="Amazon domain to scrape (default: amazon.in)")
    parser.add_argument("--delay", type=float, default=REQUEST_DELAY_SECONDS,
                        help="Delay in seconds between requests")
    parser.add_argument("--debug", action="store_true",
                        help="Save raw HTML per ASIN for debugging")
    args = parser.parse_args()

    # Collect target ASINs and search queries
    target_asins = list(args.asins)
    search_queries = list(args.search)

    if args.category:
        if args.category == "all":
            search_queries.extend(DEFAULT_SEARCH_QUERIES)
        elif args.category in CATEGORY_PRESETS:
            search_queries.extend(CATEGORY_PRESETS[args.category])

    input_file = args.file
    if not input_file and not target_asins and not search_queries and Path("products.txt").exists():
        input_file = "products.txt"
        print("[info] Using default input configuration file: products.txt")

    if input_file:
        file_asins, file_queries = load_input_file(input_file)
        target_asins.extend(file_asins)
        search_queries.extend(file_queries)

    # Default fallback if nothing specified
    if not target_asins and not search_queries:
        print("[info] No ASINs, search queries, or input file provided. Defaulting to expanded built-in product catalog.")
        target_asins = list(DEFAULT_ASINS)
        search_queries = list(DEFAULT_SEARCH_QUERIES)

    headless = not args.no_headless
    driver = None
    if SELENIUM_AVAILABLE:
        print(f"[info] Initializing Chrome WebDriver (headless={headless})...")
        driver = create_driver(headless=headless)

    all_title_map = {}

    try:
        # Discover ASINs from search queries
        for query in search_queries:
            discovered, discovered_titles = discover_asins_from_search(
                query=query,
                domain=args.domain,
                max_products=args.max_products,
                pages=args.pages,
                driver=driver
            )
            target_asins.extend(discovered)
            all_title_map.update(discovered_titles)

        # Deduplicate ASINs preserving order
        unique_asins = []
        for asin in target_asins:
            asin_clean = asin.strip().upper()
            if asin_clean and asin_clean not in unique_asins:
                unique_asins.append(asin_clean)

        print(f"\n[summary] Total unique products to scrape: {len(unique_asins)}")

        # Scrape all discovered ASINs
        records = scrape_asins(
            asins=unique_asins,
            title_map=all_title_map,
            headless=headless,
            domain=args.domain,
            debug=args.debug,
            delay=args.delay,
            driver=driver
        )

        save_csv(records, args.out)

    finally:
        if driver:
            driver.quit()
