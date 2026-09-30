import { useEffect, useMemo, useState } from 'react'
import { runAudit } from '../watch/audit'
import { api } from '../watch/common'
import { marketDays } from '../watch/marketDays'
import { auditOpts } from '../watch/productAudit'
import { getSettings } from '../watch/settings'

// Status timeline: every product's stored prices are re-audited in a rolling
// window, one step per week. A change becomes an alert once the new status
// holds for two consecutive weeks, so one-off blips don't raise alarms.
const STEP = 7 * 86400e3
const LOOKBACK = 26 * STEP                      // last six months
const LEVEL = {
  red: { label: 'Risk', color: '#d92d20' },
  amber: { label: 'Review', color: '#e07b00' },
  green: { label: 'Compliant', color: '#12a150' },
  collecting: { label: 'Collecting', color: '#94a3b8' },
}
const RANK = { collecting: 0, green: 1, amber: 2, red: 3 }

function timeline(p, winMs, market) {
  const mine = p.own[0]
  const all = [mine, ...p.competitors.filter((c) => c.platform === mine.platform)]
  const pts = all.map((x) => (p.readings[x.listing_id] || []).map((r) => ({ t: r.t, ms: Date.parse(r.t), price: r.price })))
  const last = Math.max(...pts.flat().map((r) => r.ms))
  if (!Number.isFinite(last)) return []
  const events = []
  let prev = null                                  // last confirmed audit
  let pending = null                               // a different level seen once, awaiting confirmation
  for (let end = last - LOOKBACK; end <= last; end += STEP) {
    const series = all.map((x, i) => ({
      name: x === mine ? `You (${mine.brand})` : x.brand,
      points: pts[i].filter((r) => r.ms > end - winMs && r.ms <= end),
    }))
    const a = runAudit(series, auditOpts(market, mine.platform))
    if (a.level === 'collecting') continue
    if (!prev) { prev = a; continue }
    if (a.level === prev.level) { pending = null; continue }
    if (!pending || pending.a.level !== a.level) { pending = { a, t: end }; continue }
    // two weeks in a row at the new level: confirmed change, dated when it first appeared
    const up = RANK[a.level] > RANK[prev.level]
    events.push({
      id: `${p.id}-${pending.t}`, p, t: pending.t, from: prev.level, to: a.level, up,
      why: (up ? pending.a.evidence.find((e) => e.w > 0)?.text : prev.evidence.find((e) => e.w > 0)?.text) || null,
    })
    prev = a; pending = null
  }
  return events
}

export default function Alerts() {
  const [list, setList] = useState(null)
  const [down, setDown] = useState(false)
  const [filter, setFilter] = useState('all')

  useEffect(() => { api('/products').then((d) => setList(d.products)).catch(() => setDown(true)) }, [])

  const events = useMemo(() => {
    if (!list) return null
    const winMs = (getSettings().viewDays || 30) * 86400e3
    const market = marketDays(list)
    return list.flatMap((p) => timeline(p, winMs, market)).sort((a, b) => b.t - a.t)
  }, [list])

  const shown = (events || []).filter((e) => filter === 'all' || (filter === 'up' ? e.up : !e.up))
  const up = (events || []).filter((e) => e.up).length

  return (
    <div className="pg">
      {down && <div className="banner bad">Tracker offline — run <code>python -m tracker.server</code></div>}
      <div className="al-top">
        <div className="al-stats">
          <div><b>{events ? events.length : '…'}</b><span>status changes · 6 months</span></div>
          <div><b style={{ color: '#e07b00' }}>{events ? up : '…'}</b><span>escalations</span></div>
          <div><b style={{ color: '#12a150' }}>{events ? events.length - up : '…'}</b><span>cleared</span></div>
        </div>
        <div className="a-tabs">
          {[['all', 'All'], ['up', 'Escalations'], ['down', 'Cleared']].map(([k, l]) => (
            <button key={k} data-on={filter === k} onClick={() => setFilter(k)}>{l}</button>
          ))}
        </div>
      </div>

      <div className="a-card">
        {!events && !down && <div className="a-muted">Loading…</div>}
        {events && shown.length === 0 && <div className="a-muted">No status changes.</div>}
        <ul className="al-list">
          {shown.map((e) => (
            <li key={e.id} onClick={() => { window.location.hash = `#/app/products?id=${e.p.id}` }}>
              <span className="al-dot" style={{ '--c': LEVEL[e.to].color }} />
              <div className="al-body">
                <div><b>{e.p.name}</b> <span className="al-move">
                  <span style={{ color: LEVEL[e.from].color }}>{LEVEL[e.from].label}</span> → <span style={{ color: LEVEL[e.to].color }}>{LEVEL[e.to].label}</span>
                </span></div>
                {e.why && <div className="al-why">{e.up ? e.why : `No longer: ${e.why}`}</div>}
              </div>
              <time>{new Date(e.t).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}</time>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}
