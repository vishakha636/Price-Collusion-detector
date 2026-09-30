import { useEffect, useRef, useState } from 'react'
import { api } from './common'

/** Compact, factual summary of an audit — the only thing the AI sees. */
export function aiContext(audit, extra = {}) {
  return {
    product: audit.me.name,
    level: audit.level,
    status: audit.status.label,
    days_covered: Math.round(audit.span),
    snapshots: audit.points,
    stats: audit.stats,
    rivals: audit.ranking.map((r) => ({
      name: r.name,
      score: r.score,
      follow: r.iFollowUp.n ? `copied ${r.iFollowUp.k}/${r.iFollowUp.n} of their rises` : null,
      they_follow: r.theyFollowUp.n ? `they copied ${r.theyFollowUp.k}/${r.theyFollowUp.n} of yours` : null,
      cuts_matched: r.iMatchCut.n ? `${r.iMatchCut.k}/${r.iMatchCut.n}` : null,
      shared_seller: r.sharedSeller?.name || null,
    })),
    evidence: audit.evidence.filter((e) => e.w > 0).map((e) => e.text),
    confidence: audit.confidence && { level: audit.confidence.level, days: audit.confidence.days, price_moves: audit.confidence.moves },
    market_wide_moves: audit.market && { count: audit.market.moves, excluded_from_counts: audit.market.excluded },
    signal_points: audit.ranking.filter((r) => r.why).map((r) => ({ rival: r.name, ...Object.fromEntries(r.why.map((w) => [w.key, Math.round(w.points)])) })),
    fixes: audit.fixes,
    ...extra,
  }
}

const QUICK = ['Why this status?', 'Which competitor?', 'What to change?', 'Sale effect?']

// **bold**, bullets and line breaks only — enough for model output
function Md({ text }) {
  return text.split('\n').map((line, i) => {
    const bullet = /^\s*[-*•]\s+/.test(line)
    const html = line.replace(/^\s*[-*•]\s+/, '').replace(/^#+\s*/, '')
      .split(/(\*\*[^*]+\*\*|_[^_]+_)/g)
      .map((part, j) => part.startsWith('**') ? <b key={j}>{part.slice(2, -2)}</b>
        : part.startsWith('_') && part.endsWith('_') ? <i key={j}>{part.slice(1, -1)}</i> : part)
    if (!line.trim()) return <div key={i} className="ai-gap" />
    return bullet ? <div key={i} className="ai-li">{html}</div> : <p key={i}>{html}</p>
  })
}

export default function Analyst({ audit, extra }) {
  const [msgs, setMsgs] = useState([])       // {role: 'me'|'ai', text, source}
  const [busy, setBusy] = useState(false)
  const [lang, setLang] = useState('en')
  const [q, setQ] = useState('')
  const [ai, setAi] = useState(null)
  const end = useRef()

  useEffect(() => { api('/ai/status').then(setAi).catch(() => setAi(null)) }, [])
  useEffect(() => { setMsgs([]) }, [audit.me.name, audit.rivals.length])   // new product, not every 60 s data refresh
  useEffect(() => { end.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }) }, [msgs])

  const send = async (mode, question = '') => {
    if (busy) return
    const label = question || { explain: 'Explain this result', memo: 'Draft a compliance memo' }[mode]
    const history = msgs.map((m) => ({ role: m.role, text: m.text }))
    setMsgs((m) => [...m, { role: 'me', text: label }])
    setBusy(true); setQ('')
    try {
      const r = await api('/ai', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode, question, history, lang, context: aiContext(audit, extra) }),
      })
      setMsgs((m) => [...m, { role: 'ai', text: r.text, source: r.source, mode }])
    } catch {
      setMsgs((m) => [...m, { role: 'ai', text: 'Tracker offline — start `python -m tracker.server`.', source: 'error' }])
    }
    setBusy(false)
  }

  const printMemo = (text) => {
    const f = document.createElement('iframe')
    f.style.cssText = 'position:fixed;width:0;height:0;border:0'
    document.body.appendChild(f)
    const body = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>')
      .split('\n').map((l) => (/^\s*[-*•]\s+/.test(l) ? `<li>${l.replace(/^\s*[-*•]\s+/, '')}</li>` : `<p>${l}</p>`)).join('')
    f.contentDocument.write(`<html><head><title>Compliance memo · ${audit.me.name}</title><style>
      body{font:14px/1.55 system-ui,sans-serif;color:#0f172a;margin:48px}h1{font-size:20px;color:#1d4ed8;margin:0 0 4px}
      .m{color:#64748b;font-size:12px;margin-bottom:24px}li{margin:3px 0 3px 18px}p{margin:6px 0}</style></head><body>
      <h1>PriceGuard · Compliance memo</h1><div class="m">${audit.me.name} · ${new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })} · status: ${audit.status.label}</div>
      ${body}</body></html>`)
    f.contentDocument.close()
    setTimeout(() => { f.contentWindow.print(); setTimeout(() => f.remove(), 1000) }, 200)
  }

  return (
    <div className="a-card ai-card">
      <div className="ai-head">
        <h3>AI analyst</h3>
        <span className={`ai-conn ${ai?.connected ? 'on' : ''}`}>{ai?.connected ? ai.model : 'built-in'}</span>
        <div className="ai-lang">
          {[['en', 'English'], ['hi', 'हिंदी']].map(([k, l]) => (
            <button key={k} data-on={lang === k} onClick={() => setLang(k)}>{l}</button>
          ))}
        </div>
      </div>

      {msgs.length === 0 && (
        <div className="ai-start">
          <button className="btn ghost" onClick={() => send('explain')}>Explain</button>
          <button className="btn ghost" onClick={() => send('memo')}>Compliance memo</button>
        </div>
      )}

      <div className="ai-log">
        {msgs.map((m, i) => (
          <div key={i} className={`ai-msg ${m.role}`}>
            {m.role === 'ai' ? <Md text={m.text} /> : m.text}
            {m.role === 'ai' && m.source !== 'error' && (
              <div className="ai-foot">
                <span>{m.source === 'gemini' ? 'Gemini' : 'Built-in'}</span>
                {m.mode === 'memo' && <button className="a-link" onClick={() => printMemo(m.text)}>Print</button>}
              </div>
            )}
          </div>
        ))}
        {busy && <div className="ai-msg ai ai-typing"><span /><span /><span /></div>}
        <div ref={end} />
      </div>

      <div className="ai-quick">
        {QUICK.map((x) => <button key={x} onClick={() => send('chat', x)} disabled={busy}>{x}</button>)}
      </div>
      <form className="ai-ask" onSubmit={(e) => { e.preventDefault(); if (q.trim()) send('chat', q.trim()) }}>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Ask a question" />
        <button className="btn" disabled={busy || !q.trim()}>Ask</button>
      </form>
    </div>
  )
}
