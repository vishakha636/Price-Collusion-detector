import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { STATUS } from './audit'
import { api, rupees } from './common'
import Analyst from './Analyst'
import Explain from './Explain'
import { marketDays } from './marketDays'
import { auditProduct } from './productAudit'
import { getSettings, productsPath, viewLabel } from './settings'
import { auditKey, getReminder, listRuns, saveRun, setReminder } from './history'
import Register from './Register'
import { Result, printReport } from './SelfAudit'
import { rivalLine, sureLine, verdictLine } from './plain'
import './products.css'

// audit level -> stored product status
const TO_STATUS = { red: 'risk', amber: 'review', green: 'compliant', collecting: 'not_checked' }
const BADGE = {
  risk: { label: 'Risk', color: '#d92d20' },
  review: { label: 'Review', color: '#e07b00' },
  compliant: { label: 'Compliant', color: '#12a150' },
  not_checked: { label: 'Not yet checked', color: '#94a3b8' },
}
const PLAT = { flipkart: 'Flipkart', myntra: 'Myntra', amazon: 'Amazon.in' }

const ago = (t) => {
  if (!t) return '—'
  const s = (Date.now() - Date.parse(t)) / 1000
  if (s < 90) return 'Just now'
  if (s < 3600) return `${Math.round(s / 60)} min ago`
  if (s < 86400) return `${Math.round(s / 3600)} h ago`
  return `${Math.round(s / 86400)} d ago`
}

// earliest reading, and whether prices before registration were imported
const since = (p) => {
  const t = Math.min(...Object.values(p.readings).map((r) => Date.parse(r[0]?.t)).filter(Boolean))
  return Number.isFinite(t) ? new Date(t).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) : '—'
}
const importedFrom = (p) => p.own.find((o) => o.history_source)?.history_source

const latest = (p, x) => { const r = p.readings[x.listing_id] || []; return r[r.length - 1]?.price }

const RANK = { red: 3, amber: 2, green: 1, collecting: 0 }
const worst = (list) => list.reduce((w, x) => (RANK[x.audit.level] > RANK[w] ? x.audit.level : w), 'collecting')

// ---------------------------------------------------------------------------

function Detail({ p, market, onBack, onRemove }) {
  const audits = useMemo(() => auditProduct(p, market), [p, market])
  const [plat, setPlat] = useState(audits[0]?.platform)
  const cur = audits.find((a) => a.platform === plat) || audits[0]
  const [hist, setHist] = useState(null)
  const [more, setMore] = useState(false)          // "See full details" open?
  const moreRef = useRef(), aiRef = useRef()
  const openMore = () => { setMore(true); setTimeout(() => moreRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50) }
  const source = cur && `${PLAT[cur.platform] || cur.platform} · ${importedFrom(p) ? viewLabel() : 'live tracking'}`

  useEffect(() => {
    if (!cur) return
    const hkey = `product:${p.id}:${cur.platform}|` + auditKey(cur.audit)
    const prev = saveRun(hkey, cur.audit, `${PLAT[cur.platform] || cur.platform} · live tracking`)
    setHist({ hkey, prev, runs: listRuns(hkey), reminder: getReminder(hkey) })
  }, [cur, p.id])

  return (
    <div>
      <div className="p-detail-head">
        <button className="a-link" onClick={onBack}>← Products</button>
        <div className="p-title">
          <span className="p-chip p-cap">{p.category.replace(/-/g, " ")}</span>
          {p.platforms.map((x) => <span key={x} className="p-chip">{PLAT[x] || x}</span>)}
        </div>
        <button className="a-link danger" onClick={() => onRemove(p.id)}>Stop monitoring</button>
      </div>

      {audits.length > 1 && (
        <div className="a-tabs p-plat-tabs">
          {audits.map((a) => (
            <button key={a.platform} data-on={a.platform === cur.platform} onClick={() => setPlat(a.platform)}>
              {PLAT[a.platform] || a.platform} · {STATUS[a.audit.level].label}
            </button>
          ))}
        </div>
      )}

      {cur && (
        <div className="p-verdict" style={{ '--c': cur.audit.status.color }}>
          <div className="p-verdict-badge">{cur.audit.status.label}</div>
          <div className="p-verdict-text">
            <b>{verdictLine(cur.audit)}</b>
            <span>{sureLine(cur.audit.confidence)}</span>
          </div>
          <div className="p-verdict-actions">
            <button className="btn ghost" onClick={() => printReport(cur.audit, { source }, null, null)}>Report</button>
            <button className="btn ghost" onClick={() => aiRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })}>Ask AI</button>
            <button className="btn ghost" onClick={openMore}>Details</button>
          </div>
        </div>
      )}

      <div className="p-vs">
        {p.own.map((o) => (
          <div key={o.listing_id} className="p-own">
            <div className="p-lbl">Your product</div>
            <div className="p-own-brand">{o.brand}</div>
            <a className="p-own-name" href={o.source_url} target="_blank" rel="noreferrer">{o.name}</a>
            <div className="p-own-meta">
              <b>{rupees(latest(p, o))}</b>
              <span>{PLAT[o.platform] || o.platform}</span>
              <span>{(p.readings[o.listing_id] || []).length} prices</span>
            </div>
          </div>
        ))}
        <div className="p-vs-mark">vs</div>
        <div className="p-rivals">
          <div className="p-lbl">Competitors · {p.competitors.length}</div>
          <div className="p-rival-grid">
            {p.competitors.map((c) => {
              const r = cur?.audit.rivals.find((x) => x.name === (c.brand || c.name.split(' ')[0]))
              const line = rivalLine(r)
              return (
                <a key={c.listing_id} className="p-rival" data-tone={line.tone} href={c.source_url} target="_blank" rel="noreferrer">
                  <div className="p-rival-top"><b>{c.brand}</b><span className="p-rival-price">{rupees(latest(p, c))}</span></div>
                  <div className="p-rival-line">{line.text}</div>
                </a>
              )
            })}
          </div>
        </div>
      </div>
      {importedFrom(p) && (
        <div className="p-src">{viewLabel()} · past prices: {importedFrom(p)}</div>
      )}

      <div className="p-more" ref={moreRef}>
        <button className="p-more-toggle" onClick={() => setMore(!more)} aria-expanded={more}>
          <span>{more ? '▾' : '▸'} Details</span>
        </button>
      </div>
      {more && <>
      {cur && hist && (
        <Result audit={cur.audit} meta={{ source }}
          prev={hist.prev} runs={hist.runs} reminder={hist.reminder} hkey={hist.hkey}
          onToggleReminder={(k, on) => setHist({ ...hist, reminder: setReminder(k, p.name, on) })} />
      )}

      {cur && <Explain audit={cur.audit} series={cur.series} market={market} plat={cur.platform} sourceName={importedFrom(p)} />}

      <div className="a-card" style={{ marginTop: 18 }}>
        <h3>Listings</h3>
        <table className="a-table">
          <thead><tr><th>Platform</th><th>Brand</th><th>First</th><th>Latest</th><th>Prices</th></tr></thead>
          <tbody>
            {[...p.own.map((o) => ({ ...o, mine: true })), ...p.competitors].map((c) => {
              const r = p.readings[c.listing_id] || []
              return (
                <tr key={c.listing_id} className={c.mine ? 'p-mine' : ''}>
                  <td>{PLAT[c.platform] || c.platform}</td>
                  <td>{c.mine && <span className="p-you">You</span>}<a href={c.source_url} target="_blank" rel="noreferrer">{c.brand}</a> <span className="a-muted">{c.name.slice(0, 44)}</span></td>
                  <td>{rupees(r[0]?.price)}</td>
                  <td><b>{rupees(r[r.length - 1]?.price)}</b></td>
                  <td>{r.length}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      </>}

      <div ref={aiRef}>
        {cur && <Analyst audit={cur.audit} extra={{ platform: PLAT[cur.platform] || cur.platform, category: p.category, window: viewLabel(), response_window_days: getSettings().windowDays }} />}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------

export default function Products({ query = {}, onAlerts }) {
  const [list, setList] = useState(null)
  const [market, setMarket] = useState(null)     // market-wide (sale) days per store
  const [down, setDown] = useState(false)
  // list | register | detail -- deep links: ?new=1 opens the wizard, ?id=N a product
  const [mode, setMode] = useState(query.new ? 'register' : query.id ? 'detail' : 'list')
  const [openId, setOpenId] = useState(query.id ? Number(query.id) : null)
  useEffect(() => {
    if (query.new) setMode('register')
    else if (query.id) { setOpenId(Number(query.id)); setMode('detail') }
  }, [query.new, query.id])

  const load = useCallback(async () => {
    try {
      const d = await api(productsPath())
      const m = marketDays(d.products)
      // compute each product's status from its price history, persist changes
      for (const p of d.products) {
        const s = TO_STATUS[worst(auditProduct(p, m))]
        if (s !== p.status && !(s === 'not_checked' && p.status === 'not_checked')) {
          api(`/products/${p.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: s }) }).catch(() => {})
          p.status = s
        }
      }
      setMarket(m); setList(d.products); setDown(false)
      onAlerts?.(d.products.filter((p) => p.status === 'risk').length)
    } catch { setDown(true) }
  }, [onAlerts])
  useEffect(() => { load(); const id = setInterval(load, 60000); return () => clearInterval(id) }, [load])

  const remove = async (id) => { await api(`/products/${id}`, { method: 'DELETE' }); setMode('list'); load() }
  const open = list?.find((p) => p.id === openId)
  const alerts = (list || []).filter((p) => p.status === 'risk').length

  return (
    <div className="pg">
      {down && <div className="banner bad">Tracker offline — run <code>python -m tracker.server</code></div>}

      {mode === 'register' && (
        <Register onCancel={() => { setMode('list'); window.location.hash = '#/app/products' }}
          onDone={async (p) => { await load(); setOpenId(p.id); setMode('list'); window.location.hash = '#/app/products' }} />
      )}

      {mode === 'detail' && open && <Detail p={open} market={market} onBack={() => { setMode('list'); window.location.hash = '#/app/products' }} onRemove={remove} />}

      {mode === 'list' && (
        <>
          <div className="p-head">
            <span />
            <button className="btn" onClick={() => setMode('register')}>+ Add product</button>
          </div>
          {alerts > 0 && <div className="banner bad">High risk: {alerts} product{alerts > 1 ? "s" : ""}</div>}
          <div className="a-card">
            {list && list.length === 0 ? (
              <div className="p-empty">
                <p>No products yet</p>
                <button className="btn" onClick={() => setMode('register')}>Add your first product</button>
              </div>
            ) : (
              <table className="a-table p-table">
                <thead><tr><th>Your product</th><th>Competitors watched</th><th>Platform</th><th>Prices</th><th>Status</th><th>Last checked</th></tr></thead>
                <tbody>
                  {(list || []).map((p) => {
                    const b = BADGE[p.status] || BADGE.not_checked
                    return (
                      <tr key={p.id} className="p-row" data-new={p.id === openId}
                        onClick={() => { setOpenId(p.id); setMode('detail') }}>
                        <td className="p-cell-own">
                          <b>{p.own[0]?.brand || p.name}</b>
                          <span>{(p.own[0]?.name || '').slice(0, 48)}</span>
                          <span className="p-cap">{p.category.replace(/-/g, " ")}</span>
                        </td>
                        <td className="p-cell-rivals">
                          {p.competitors.slice(0, 4).map((c) => <span key={c.listing_id} className="p-rtag">{c.brand}</span>)}
                          {p.competitors.length > 4 && <span className="p-rtag more">+{p.competitors.length - 4}</span>}
                        </td>
                        <td>{p.platforms.map((x) => PLAT[x] || x).join(', ')}</td>
                        <td>{Object.values(p.readings).reduce((s, r) => s + r.length, 0)}</td>
                        <td><span className="a-pill" style={{ '--c': b.color }}>{b.label}</span></td>
                        <td>{ago(p.last_checked)}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            )}
          </div>
        </>
      )}
    </div>
  )
}
