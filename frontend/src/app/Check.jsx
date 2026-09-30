import { useEffect, useRef, useState } from 'react'
import { api } from '../watch/common'
import { marketDays } from '../watch/marketDays'
import { sureLine, verdictLine, rivalLine } from '../watch/plain'
import { auditProduct } from '../watch/productAudit'
import { printReport } from '../watch/SelfAudit'
import { productsPath } from '../watch/settings'

// Paste a product link -> the agent (tracker/agent.py) finds competitors,
// collects prices, attaches history and registers the product. This page
// shows each step as it happens, then the result.

const DOT = { done: '#16a34a', warn: '#d97706', skip: '#d1d5db', running: '#2563eb' }

export default function Check() {
  const [q, setQ] = useState('')
  const [job, setJob] = useState(null)
  const [result, setResult] = useState(null)       // {p, audit}
  const [err, setErr] = useState(null)
  const timer = useRef()

  useEffect(() => () => clearInterval(timer.current), [])

  const start = async (e) => {
    e.preventDefault()
    if (!q.trim()) return
    setErr(null); setResult(null)
    try {
      const j = await api('/agent', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ query: q.trim() }) })
      setJob(j)
      clearInterval(timer.current)
      timer.current = setInterval(async () => {
        const s = await api(`/agent/${j.id}`).catch(() => null)
        if (!s) return
        setJob(s)
        if (s.status !== 'running') {
          clearInterval(timer.current)
          if (s.status === 'done') {
            const d = await api(productsPath())
            const p = d.products.find((x) => x.id === s.product_id)
            if (p) setResult({ p, audit: auditProduct(p, marketDays(d.products))[0]?.audit })
          }
        }
      }, 800)
    } catch {
      setErr('Tracker offline — run python -m tracker.server')
    }
  }

  const running = job?.status === 'running'
  return (
    <div className="pg ck">
      <form className="ck-form" onSubmit={start}>
        <input value={q} onChange={(e) => setQ(e.target.value)} disabled={running}
          placeholder="Flipkart or Myntra product link" />
        <button className="btn" disabled={running || !q.trim()}>{running ? 'Checking…' : 'Check'}</button>
      </form>
      <div className="ck-note">Myntra: live competitor search · Flipkart, Amazon.in: PriceGuard catalog</div>
      {err && <div className="banner bad">{err}</div>}

      {job && (
        <div className="a-card ck-steps">
          <ol>
            {job.steps.map((s, i) => (
              <li key={i}>
                <span className="ck-dot" style={{ '--c': DOT[s.status] || DOT.done }} />
                <b>{s.text}</b>{s.detail && <span>{s.detail}</span>}
              </li>
            ))}
            {running && <li className="ck-live"><span className="ck-dot" style={{ '--c': DOT.running }} /><b>Working…</b></li>}
          </ol>
          {job.status === 'error' && <div className="banner bad">{job.error}</div>}
        </div>
      )}

      {result?.audit && (
        <div className="a-card ck-result">
          <div className="p-verdict" style={{ '--c': result.audit.status.color, border: 0, padding: 0, margin: 0 }}>
            <div className="p-verdict-badge">{result.audit.status.label}</div>
            <div className="p-verdict-text">
              <b>{verdictLine(result.audit)}</b>
              <span>{sureLine(result.audit.confidence)}</span>
            </div>
            <div className="p-verdict-actions">
              <button className="btn ghost" onClick={() => printReport(result.audit, { source: result.p.platforms[0] }, null, null)}>Report</button>
              <a className="btn" href={`#/app/products?id=${result.p.id}`}>Open product</a>
            </div>
          </div>
          <table className="a-table ck-table">
            <thead><tr><th>Competitor</th><th>Price</th><th>Prices held</th><th>Reading</th></tr></thead>
            <tbody>
              {result.p.competitors.map((c) => {
                const r = result.audit.rivals.find((x) => x.name === (c.brand || c.name.split(' ')[0]))
                const rd = result.p.readings[c.listing_id] || []
                return (
                  <tr key={c.listing_id}>
                    <td><b>{c.brand}</b> <span className="a-muted">{c.name.slice(0, 40)}</span></td>
                    <td>{c.price ? `₹${Math.round(c.price).toLocaleString('en-IN')}` : '—'}</td>
                    <td>{rd.length}</td>
                    <td>{rivalLine(r).text}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          {job?.existing && <div className="ck-note">Already monitored · existing product opened</div>}
        </div>
      )}
    </div>
  )
}
