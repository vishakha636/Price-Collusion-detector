"""
AI compliance analyst: explains an audit result, answers questions about it
and drafts a compliance memo, using Google Gemini when a key is configured.

The model only sees the audit summary built by the app (status, rivals,
evidence, numbers) and is told to use nothing else, so answers stay tied to
the measured data. Without a key, or if the call fails, a built-in
explanation generated from the same summary is returned instead.

Key: GEMINI_API_KEY in the environment or in a .env file at the project root
(never sent to the browser). Optional GEMINI_MODEL (default below).
"""

from __future__ import annotations

import codecs
import json
import os
from pathlib import Path

import requests

# (IPv4-only networking is set up in tracker/__init__.py)

ROOT = Path(__file__).resolve().parent.parent
DEFAULT_MODEL = "gemini-2.5-flash"
URL = "https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"


def _env(name: str) -> str | None:
    if os.environ.get(name):
        return os.environ[name].strip()
    f = ROOT / ".env"
    if f.exists():
        raw = f.read_bytes()      # Notepad / PowerShell may save UTF-16 or add a BOM
        text = raw.decode("utf-16") if raw[:2] in (codecs.BOM_UTF16_LE, codecs.BOM_UTF16_BE) else raw.decode("utf-8-sig", errors="ignore")
        for line in text.splitlines():
            k, _, v = line.partition("=")
            if k.strip() == name and v.strip():
                return v.strip().strip('"').strip("'")
    return None


def status() -> dict:
    return {"connected": bool(_env("GEMINI_API_KEY")), "model": _env("GEMINI_MODEL") or DEFAULT_MODEL}


SYSTEM = """You are PriceGuard's compliance analyst. PriceGuard audits whether a seller's
automated pricing is moving in step with rival brands in a way the Competition
Commission of India (CCI) could see as tacit collusion (Section 3, Competition
Act 2002; CCI's 2025 market study on AI and competition).

Rules:
- Use ONLY the audit data given. Never invent numbers, dates, brands or cases.
- A flag is a signal to review, not proof of collusion. Say so when relevant.
- Common causes of innocent co-movement: platform sale events, shared costs,
  the same repricing tool with default settings.
- Be short and concrete. Plain words, no jargon. Use bullet points.
- If asked something the data cannot answer, say what extra data would help."""

TASKS = {
    "explain": "Explain this result to the seller in 4-6 short bullets: the verdict, the main reason, which rival matters most, and what to do next.",
    "memo": ("Write a one-page internal compliance memo for management. Sections: Summary, Findings "
             "(with the numbers), Risk assessment, Recommended actions, Note on limitations. Formal, concise."),
    "chat": "Answer the seller's question using the audit data.",
}


def _prompt(mode: str, context: dict, question: str, lang: str) -> str:
    lang_line = "Reply in simple Hindi (Devanagari)." if lang == "hi" else "Reply in English."
    q = f"\n\nSeller's question: {question}" if question else ""
    return f"{TASKS.get(mode, TASKS['chat'])} {lang_line}\n\nAudit data (JSON):\n{json.dumps(context, ensure_ascii=False)}{q}"


def _gemini(prompt: str, history: list[dict]) -> str:
    key, model = _env("GEMINI_API_KEY"), _env("GEMINI_MODEL") or DEFAULT_MODEL
    contents = [{"role": "model" if h.get("role") == "ai" else "user", "parts": [{"text": h.get("text", "")}]}
                for h in history[-8:] if h.get("text")]
    contents.append({"role": "user", "parts": [{"text": prompt}]})
    r = requests.post(URL.format(model=model), headers={"x-goog-api-key": key}, timeout=(10, 45), json={
        "system_instruction": {"parts": [{"text": SYSTEM}]},
        "contents": contents,
        "generationConfig": {"temperature": 0.3, "maxOutputTokens": 1200},
    })
    r.raise_for_status()
    parts = r.json()["candidates"][0]["content"]["parts"]
    return "".join(p.get("text", "") for p in parts).strip()


# --- built-in fallback --------------------------------------------------------------

VERDICT = {"red": "Collusion risk", "amber": "Needs review", "green": "Compliant", "collecting": "Not enough data yet"}


def builtin(mode: str, context: dict, question: str = "") -> str:
    lvl = context.get("level", "collecting")
    me = context.get("product", "Your product")
    rivals = sorted(context.get("rivals", []), key=lambda r: -(r.get("score") or 0))
    ev = [e for e in context.get("evidence", []) if e]
    fixes = [f for f in context.get("fixes", []) if f]
    s = context.get("stats", {})
    lines = [f"**{VERDICT.get(lvl, lvl)}** — {me} vs {', '.join(r['name'] for r in rivals) or 'no rivals'}"
             f" · {context.get('window') or str(context.get('days_covered', '?')) + ' days'}."]
    if lvl == "collecting":
        lines.append("- Too few price changes to judge yet. The tracker keeps collecting; check back in a week.")
        return "\n".join(lines)
    if rivals:
        top = rivals[0]
        lines.append(f"- Closest rival: **{top['name']}** (score {top.get('score', 0)}/100"
                     + (f", {top['follow']}" if top.get("follow") else "") + ").")
    if s.get("followRate") is not None:
        lines.append(f"- {s['followRate']}% of rival price rises were matched; {s.get('changes', 0)} price change{'' if s.get('changes') == 1 else 's'} in total.")
    lines += [f"- {e}" for e in ev[:3]]
    if lvl == "green":
        lines.append("- No action needed. Keep pricing decisions independent and documented.")
    else:
        lines.append("- A flag means _review_, not proof. Check for sale events or a shared repricing tool first.")
        lines += [f"- Fix: {f}" for f in fixes[:2]]
    if mode == "memo":
        lines = ["**Compliance memo — " + me + "**", "", "**Summary**", lines[0], "", "**Findings**", *lines[1:],
                 "", "**Limitations**", "- Screening result from public prices only; costs and stock are not observed."]
    if mode == "chat" and question:
        lines.append("\n_Connect Gemini (Settings) for free-form answers to questions._")
    return "\n".join(lines)


def ask(mode: str, context: dict, question: str = "", history: list | None = None, lang: str = "en") -> dict:
    st = status()
    if st["connected"]:
        try:
            return {"text": _gemini(_prompt(mode, context, question, lang), history or []), "source": "gemini", "model": st["model"]}
        except (requests.RequestException, KeyError, IndexError, ValueError) as e:
            return {"text": builtin(mode, context, question), "source": "built-in", "error": f"Gemini unavailable: {type(e).__name__}"}
    return {"text": builtin(mode, context, question), "source": "built-in"}
