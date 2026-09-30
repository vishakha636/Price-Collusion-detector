"""
SQLite storage for watched product pairs and every price reading.

One *round* = both products of a pair read back to back, stored with the same
timestamp, so the analysis always compares prices seen at the same moment.
Nothing is ever overwritten: the history is the evidence.
"""

from __future__ import annotations

import datetime as dt
import json
import sqlite3
from pathlib import Path

DB_PATH = Path(__file__).resolve().parent.parent / "data" / "price_watch.db"

SCHEMA = """
CREATE TABLE IF NOT EXISTS pairs (
    id        INTEGER PRIMARY KEY,
    site      TEXT NOT NULL,
    url_a     TEXT NOT NULL,
    url_b     TEXT NOT NULL,
    name_a    TEXT, brand_a TEXT,
    name_b    TEXT, brand_b TEXT,
    created   TEXT NOT NULL,
    active    INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS readings (
    pair_id   INTEGER NOT NULL REFERENCES pairs(id),
    round_ts  TEXT NOT NULL,
    side      TEXT NOT NULL CHECK (side IN ('a', 'b')),
    price     REAL,
    mrp       REAL,
    in_stock  INTEGER,
    error     TEXT,
    PRIMARY KEY (pair_id, round_ts, side)
);
-- A watched market = one site search, re-run every collection round. Each
-- run stores every product seen, so each brand builds up its own history.
CREATE TABLE IF NOT EXISTS markets (
    id        INTEGER PRIMARY KEY,
    site      TEXT NOT NULL,
    query     TEXT NOT NULL,
    created   TEXT NOT NULL,
    active    INTEGER NOT NULL DEFAULT 1
);
-- A self-audit = the seller's own product (idx 0) plus up to 5 rivals.
CREATE TABLE IF NOT EXISTS audits (
    id        INTEGER PRIMARY KEY,
    site      TEXT NOT NULL,
    products  TEXT NOT NULL,          -- JSON list of {url, name, brand}; index 0 = yours
    created   TEXT NOT NULL,
    active    INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS audit_readings (
    audit_id  INTEGER NOT NULL REFERENCES audits(id),
    round_ts  TEXT NOT NULL,
    idx       INTEGER NOT NULL,
    price     REAL,
    error     TEXT,
    PRIMARY KEY (audit_id, round_ts, idx)
);
CREATE TABLE IF NOT EXISTS market_readings (
    market_id  INTEGER NOT NULL REFERENCES markets(id),
    round_ts   TEXT NOT NULL,
    product_id TEXT NOT NULL,
    brand      TEXT, name TEXT, url TEXT,
    price      REAL, mrp REAL,
    PRIMARY KEY (market_id, round_ts, product_id)
);
"""


def now() -> str:
    return dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds")


def connect(path: Path = DB_PATH) -> sqlite3.Connection:
    path.parent.mkdir(parents=True, exist_ok=True)
    # timeout: the collector and the API use separate connections; wait for a
    # short write by the other instead of failing with "database is locked"
    con = sqlite3.connect(path, check_same_thread=False, timeout=30)
    con.row_factory = sqlite3.Row
    con.executescript(SCHEMA)
    return con


def add_pair(con, site, a: dict, b: dict) -> int:
    cur = con.execute(
        "INSERT INTO pairs (site, url_a, url_b, name_a, brand_a, name_b, brand_b, created) "
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        (site, a["url"], b["url"], a["name"], a.get("brand"), b["name"], b.get("brand"), now()),
    )
    con.commit()
    return cur.lastrowid


def add_reading(con, pair_id: int, round_ts: str, side: str, info: dict | None, error: str | None = None):
    con.execute(
        "INSERT OR REPLACE INTO readings VALUES (?, ?, ?, ?, ?, ?, ?)",
        (pair_id, round_ts, side,
         info and info["price"], info and info.get("mrp"),
         None if info is None else int(bool(info.get("in_stock", True))), error),
    )
    con.commit()


def list_pairs(con, active_only=True) -> list[dict]:
    q = "SELECT * FROM pairs" + (" WHERE active = 1" if active_only else "") + " ORDER BY id DESC"
    return [dict(r) for r in con.execute(q)]


def get_pair(con, pair_id: int) -> dict | None:
    r = con.execute("SELECT * FROM pairs WHERE id = ?", (pair_id,)).fetchone()
    return dict(r) if r else None


def rounds(con, pair_id: int) -> list[dict]:
    """Readings pivoted to one row per round: {t, a, b, err_a, err_b}."""
    out: dict[str, dict] = {}
    for r in con.execute(
        "SELECT round_ts, side, price, error FROM readings WHERE pair_id = ? ORDER BY round_ts", (pair_id,)
    ):
        row = out.setdefault(r["round_ts"], {"t": r["round_ts"], "a": None, "b": None})
        row[r["side"]] = r["price"]
        if r["error"]:
            row[f"err_{r['side']}"] = r["error"]
    return list(out.values())


def deactivate(con, pair_id: int):
    con.execute("UPDATE pairs SET active = 0 WHERE id = ?", (pair_id,))
    con.commit()


# --- markets -------------------------------------------------------------------

def add_market(con, site: str, query: str) -> int:
    cur = con.execute("INSERT INTO markets (site, query, created) VALUES (?, ?, ?)", (site, query, now()))
    con.commit()
    return cur.lastrowid


def add_market_scan(con, market_id: int, round_ts: str, products: list[dict]):
    con.executemany(
        "INSERT OR REPLACE INTO market_readings VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        [(market_id, round_ts, p["id"], p["brand"], p["name"], p["url"], p["price"], p.get("mrp"))
         for p in products],
    )
    con.commit()


def list_markets(con) -> list[dict]:
    return [dict(r) for r in con.execute("SELECT * FROM markets WHERE active = 1 ORDER BY id DESC")]


def market_history(con, market_id: int) -> dict:
    """{rounds: [ts...], products: {id: {brand, name, url, prices: {ts: price}, mrp}}}"""
    rounds, products = [], {}
    for r in con.execute(
        "SELECT * FROM market_readings WHERE market_id = ? ORDER BY round_ts", (market_id,)
    ):
        if not rounds or rounds[-1] != r["round_ts"]:
            rounds.append(r["round_ts"])
        p = products.setdefault(r["product_id"], {
            "id": r["product_id"], "brand": r["brand"], "name": r["name"], "url": r["url"], "prices": {},
        })
        p["prices"][r["round_ts"]] = r["price"]
        p["mrp"] = r["mrp"]
    return {"rounds": rounds, "products": list(products.values())}


def deactivate_market(con, market_id: int):
    con.execute("UPDATE markets SET active = 0 WHERE id = ?", (market_id,))
    con.commit()


# --- self-audits ---------------------------------------------------------------

def add_audit(con, site: str, products: list[dict]) -> int:
    meta = [{"url": p["url"], "name": p["name"], "brand": p.get("brand")} for p in products]
    cur = con.execute("INSERT INTO audits (site, products, created) VALUES (?, ?, ?)",
                      (site, json.dumps(meta), now()))
    con.commit()
    return cur.lastrowid


def add_audit_round(con, audit_id: int, round_ts: str, results: list):
    con.executemany(
        "INSERT OR REPLACE INTO audit_readings VALUES (?, ?, ?, ?, ?)",
        [(audit_id, round_ts, i, None if isinstance(r, Exception) else r["price"],
          str(r) if isinstance(r, Exception) else None) for i, r in enumerate(results)],
    )
    con.commit()


def list_audits(con) -> list[dict]:
    out = []
    for r in con.execute("SELECT * FROM audits WHERE active = 1 ORDER BY id DESC"):
        a = dict(r)
        a["products"] = json.loads(a["products"])
        rounds: dict[str, dict] = {}
        for x in con.execute(
            "SELECT round_ts, idx, price FROM audit_readings WHERE audit_id = ? ORDER BY round_ts", (a["id"],)
        ):
            rounds.setdefault(x["round_ts"], {"t": x["round_ts"], "prices": [None] * len(a["products"])})
            rounds[x["round_ts"]]["prices"][x["idx"]] = x["price"]
        a["rounds"] = list(rounds.values())
        out.append(a)
    return out


def deactivate_audit(con, audit_id: int):
    con.execute("UPDATE audits SET active = 0 WHERE id = ?", (audit_id,))
    con.commit()
