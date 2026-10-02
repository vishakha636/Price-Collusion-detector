"""
Tiny JSON API for the Price Watch page. Standard library only.

    python -m tracker.server            # http://localhost:8765
    python -m tracker.server --every 6  # collect every 6 hours (default)

Endpoints
    GET    /api/categories         categories with their platforms (ready / agent not ready)
    POST   /api/discover           {"name", "platforms"} -> your listing + competitors per platform
    GET    /api/products           registered products with price history (?days=30: last 30 days only)
    POST   /api/products           register {name, category, platforms, own, competitors}
    PATCH  /api/products/<id>      {"status": compliant|review|risk|not_checked}
    DELETE /api/products/<id>      stop monitoring
    POST   /api/agent              {query: product link or name} -> start the product agent
    GET    /api/agent/<id>         its progress: steps so far, status, product_id
    GET    /api/ai/status          {connected, model}: is a Gemini key configured
    POST   /api/ai                 {mode: explain|memo|chat, context, question, history, lang} -> {text, source}
    GET    /api/audits             seller self-audits with their price history
    POST   /api/audits             {"urls": [yours, rival1, ...]} start a self-audit
    DELETE /api/audits/<id>        stop an audit
    GET    /api/sites              supported sites
    GET    /api/scan?site=&q=      search a site now and return every product
    GET    /api/markets            watched markets with their price history
    POST   /api/markets            {"site": ..., "query": ...} watch a search
    DELETE /api/markets/<id>       stop watching a market
    GET    /api/preview?url=...    read one product now (name, brand, price)
    GET    /api/pairs              watched pairs with their price history
    POST   /api/pairs              {"url_a": ..., "url_b": ...} start watching
    DELETE /api/pairs/<id>         stop watching (history is kept)
    POST   /api/collect            run a collection round now

The verdict itself is computed in the browser (frontend/src/watch/analyze.js)
so the rules live in one place and are covered by the frontend tests.
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import re
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

from . import agent, ai, collect, products, sites, store

CON = store.connect()
products.init(CON)
LOCK = threading.Lock()   # sqlite connection is shared across handler threads
STATE = {"last_round": None, "every_hours": 6.0}
JOBS: dict[int, dict] = {}   # agent runs: id -> {query, steps, status, product_id, error}


def run_agent(job_id: int, query: str):
    job = JOBS[job_id]
    ag = agent.Agent(log=lambda m: print(f"[agent {job_id}] {m}", flush=True))
    ag.steps = job["steps"]                     # the UI polls this list while the agent works
    con = store.connect()
    try:
        res = ag.run(query, con)
        job.update(status="done", product_id=res["product_id"], existing=res.get("existing", False))
    except sites.PriceError as e:
        job.update(status="error", error=str(e))
    except Exception as e:                      # never leave the UI waiting forever
        job.update(status="error", error=f"{type(e).__name__}: {e}")
    finally:
        con.close()


def pair_payload(p: dict) -> dict:
    return {**p, "rounds": store.rounds(CON, p["id"])}


class Handler(BaseHTTPRequestHandler):
    def _send(self, code: int, body):
        data = json.dumps(body).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(data)

    def _body(self) -> dict:
        n = int(self.headers.get("Content-Length") or 0)
        return json.loads(self.rfile.read(n) or b"{}")

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, PATCH, DELETE, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()

    def do_GET(self):
        u = urlparse(self.path)
        if u.path == "/api/sites":
            return self._send(200, {"sites": sites.SITES, **STATE})
        if u.path == "/api/preview":
            url = (parse_qs(u.query).get("url") or [""])[0]
            try:
                return self._send(200, sites.fetch(url))
            except sites.PriceError as e:
                return self._send(400, {"error": str(e)})
        if u.path == "/api/pairs":
            with LOCK:
                return self._send(200, {"pairs": [pair_payload(p) for p in store.list_pairs(CON)], **STATE})
        if u.path == "/api/categories":
            with LOCK:
                return self._send(200, {"categories": products.categories(CON)})
        m = re.fullmatch(r"/api/agent/(\d+)", u.path)
        if m:
            job = JOBS.get(int(m.group(1)))
            return self._send(200, job) if job else self._send(404, {"error": "no such run"})
        if u.path == "/api/ai/status":
            return self._send(200, ai.status())
        if u.path == "/api/products":
            with LOCK:
                days = (parse_qs(u.query).get("days") or [""])[0]
                return self._send(200, {"products": products.list_products(CON, int(days) if days.isdigit() else None), **STATE})
        if u.path == "/api/audits":
            with LOCK:
                return self._send(200, {"audits": store.list_audits(CON), **STATE})
        if u.path == "/api/scan":
            qs = parse_qs(u.query)
            site, q = (qs.get("site") or [""])[0], (qs.get("q") or [""])[0]
            try:
                return self._send(200, {"site": site, "query": q, "at": store.now(), "products": sites.search(site, q)})
            except sites.PriceError as e:
                return self._send(400, {"error": str(e)})
        if u.path == "/api/markets":
            with LOCK:
                return self._send(200, {"markets": [
                    {**m, **store.market_history(CON, m["id"])} for m in store.list_markets(CON)], **STATE})
        return self._send(404, {"error": "not found"})

    def do_POST(self):
        u = urlparse(self.path)
        if u.path == "/api/agent":
            q = (self._body().get("query") or "").strip()
            if not q:
                return self._send(400, {"error": "Paste a product link or name."})
            jid = max(JOBS, default=0) + 1
            JOBS[jid] = {"id": jid, "query": q, "steps": [], "status": "running", "product_id": None, "error": None}
            threading.Thread(target=run_agent, args=(jid, q), daemon=True).start()
            return self._send(202, JOBS[jid])
        if u.path == "/api/ai":
            b = self._body()
            if not isinstance(b.get("context"), dict):
                return self._send(400, {"error": "Missing audit context."})
            return self._send(200, ai.ask(b.get("mode", "explain"), b["context"], (b.get("question") or "")[:1000],
                                          b.get("history") or [], b.get("lang", "en")))
        if u.path == "/api/pairs":
            body = self._body()
            ua, ub = body.get("url_a", "").strip(), body.get("url_b", "").strip()
            if not ua or not ub:
                return self._send(400, {"error": "Paste two product links."})
            sa, sb = sites.site_of(ua), sites.site_of(ub)
            if sa != sb:
                return self._send(400, {"error": "Both products must be on the same site."})
            got = sites.fetch_many([ua, ub])
            errs = [f"Product {s}: {g}" for s, g in zip("12", got) if isinstance(g, sites.PriceError)]
            if errs:
                return self._send(400, {"error": " ".join(errs)})
            a, b = got
            if a["url"] == b["url"]:
                return self._send(400, {"error": "That is the same product twice."})
            with LOCK:
                pid = store.add_pair(CON, a["site"], a, b)
                ts = store.now()
                store.add_reading(CON, pid, ts, "a", a)
                store.add_reading(CON, pid, ts, "b", b)
                return self._send(201, pair_payload(store.get_pair(CON, pid)))
        if u.path == "/api/discover":
            body = self._body()
            name, plats = body.get("name", "").strip(), body.get("platforms") or []
            if not name or not plats:
                return self._send(400, {"error": "Enter a product name and pick at least one platform."})
            with LOCK:
                ready = {p["key"] for c in products.categories(CON) for p in c["platforms"] if p["ready"]}
            if any(p not in ready for p in plats):
                return self._send(400, {"error": "That platform's agent is not ready."})
            with LOCK:
                cat = next((c["label"] for c in products.categories(CON) if c["key"] == body.get("category")), "")
            return self._send(200, {"results": products.discover(name, plats, cat)})
        if u.path == "/api/products":
            b = self._body()
            if not b.get("name") or not b.get("own") or not b.get("competitors"):
                return self._send(400, {"error": "Need your listing and at least one competitor."})
            with LOCK:
                pid = products.register(CON, b["name"].strip(), b.get("category", ""), b.get("platforms", []),
                                        b["own"], b["competitors"])
                return self._send(201, products.get_product(CON, pid))
        if u.path == "/api/audits":
            urls = [x.strip() for x in self._body().get("urls", []) if x and x.strip()]
            if len(urls) < 2:
                return self._send(400, {"error": "Add your product and at least one rival."})
            if len(urls) > 6:
                return self._send(400, {"error": "Up to 5 rivals."})
            if len({sites.site_of(x) for x in urls}) != 1:
                return self._send(400, {"error": "All products must be on the same site."})
            got = sites.fetch_many(urls)
            errs = [f"{'Your product' if i == 0 else f'Rival {i}'}: {g}"
                    for i, g in enumerate(got) if isinstance(g, sites.PriceError)]
            if errs:
                return self._send(400, {"error": " ".join(errs)})
            with LOCK:
                aid = store.add_audit(CON, got[0]["site"], got)
                store.add_audit_round(CON, aid, store.now(), got)
                return self._send(201, next(a for a in store.list_audits(CON) if a["id"] == aid))
        if u.path == "/api/markets":
            body = self._body()
            site, q = body.get("site", ""), body.get("query", "").strip()
            with LOCK:
                existing = next((m for m in store.list_markets(CON)
                                 if m["site"] == site and m["query"].lower() == q.lower()), None)
                if existing:
                    return self._send(200, {**existing, **store.market_history(CON, existing["id"])})
            try:
                found = sites.search(site, q)
            except sites.PriceError as e:
                return self._send(400, {"error": str(e)})
            with LOCK:
                mid = store.add_market(CON, site, q)
                store.add_market_scan(CON, mid, store.now(), found)
                m = next(m for m in store.list_markets(CON) if m["id"] == mid)
                return self._send(201, {**m, **store.market_history(CON, mid)})
        if u.path == "/api/collect":
            n = run_round()
            return self._send(200, {"collected": n, **STATE})
        return self._send(404, {"error": "not found"})

    def do_PATCH(self):
        m = re.fullmatch(r"/api/products/(\d+)", urlparse(self.path).path)
        if not m:
            return self._send(404, {"error": "not found"})
        try:
            with LOCK:
                products.set_status(CON, int(m.group(1)), self._body().get("status", ""))
        except ValueError:
            return self._send(400, {"error": "bad status"})
        return self._send(200, {"ok": True})

    def do_DELETE(self):
        path = urlparse(self.path).path
        m = re.fullmatch(r"/api/(pairs|markets|audits|products)/(\d+)", path)
        if not m:
            return self._send(404, {"error": "not found"})
        drop = {"pairs": store.deactivate, "markets": store.deactivate_market, "audits": store.deactivate_audit,
                "products": products.deactivate}
        with LOCK:
            drop[m.group(1)](CON, int(m.group(2)))
        return self._send(200, {"ok": True})

    def log_message(self, fmt, *args):
        print(f"[api] {self.address_string()} {fmt % args}")


ROUND_LOCK = threading.Lock()   # one collection round at a time


def run_round() -> int:
    """One collection round on its own connection, so the API stays responsive
    during the minutes of fetching (the shared connection is not held)."""
    with ROUND_LOCK:
        con = store.connect()
        try:
            n = collect.collect_all(con)
        finally:
            con.close()
        STATE["last_round"] = store.now()
        return n


def last_collected() -> float | None:
    """Unix time of the newest live reading, so a restart does not reset the clock."""
    with LOCK:
        row = CON.execute("SELECT MAX(round_ts) FROM product_readings").fetchone()
    try:
        return dt.datetime.fromisoformat(row[0]).timestamp() if row and row[0] else None
    except ValueError:
        return None


def scheduler(every_hours: float):
    """Collect every `every_hours` while the server runs. After a restart the
    first round starts as soon as one is due (1 minute in), not 6 hours later."""
    last = last_collected()
    due = time.time() + 60 if last is None else max(time.time() + 60, last + every_hours * 3600)
    while True:
        print(f"[scheduler] next collection in {(due - time.time()) / 60:.0f} min", flush=True)
        # check the wall clock every minute: one long sleep() stops counting while
        # the laptop sleeps, which pushed rounds back by hours
        while time.time() < due:
            time.sleep(60)
        try:
            n = run_round()
            print(f"[scheduler] collected {n} price(s)", flush=True)
        except Exception as e:  # keep the scheduler alive through one bad round
            print(f"[scheduler] round failed: {e}", flush=True)
        due = time.time() + every_hours * 3600


def main():
    # Windows consoles default to a code page without ₹; never let a log line crash a request
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(encoding="utf-8", errors="replace")
        except (AttributeError, ValueError):
            pass
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=8765)
    ap.add_argument("--every", type=float, default=6.0, help="hours between collection rounds")
    args = ap.parse_args()
    STATE["every_hours"] = args.every
    threading.Thread(target=scheduler, args=(args.every,), daemon=True).start()
    print(f"Price Watch API on http://localhost:{args.port}  (collecting every {args.every} h)")
    ThreadingHTTPServer(("127.0.0.1", args.port), Handler).serve_forever()


if __name__ == "__main__":
    main()
