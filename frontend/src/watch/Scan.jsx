import { useMemo, useState } from 'react'
import {
  CartesianGrid, ResponsiveContainer, Scatter, ScatterChart, Tooltip, XAxis, YAxis, ZAxis,
} from 'recharts'
import { axisStyle as axis, chartTooltip } from '../lib/chartStyle'
import { PALETTE, rupees } from './common'
import { scanMarket } from './market'

const RISK = {
  low: { label: 'Low', color: '#12a150' },
  medium: { label: 'Medium', color: '#e07b00' },
  high: { label: 'High', color: '#d92d20' },
}

function Meter({ value, color }) {
  return <div className="meter"><div style={{ width: `${Math.round(value * 100)}%`, background: color }} /></div>
}

function RiskCard({ s }) {
  const r = RISK[s.riskLevel]
  return (
    <div className="panel risk" style={{ '--c': r.color }}>
      <div className="vk">Price-fixing risk</div>
      <div className="risk-main">
        <div className="risk-num">{s.risk}<small>/100</small></div>
        <div className="risk-label">{r.label}</div>
      </div>
      <div className="gauge"><div style={{ left: `${s.risk}%` }} /></div>
      <div className="risk-parts">
        <div><span>Few brands dominate</span><Meter value={s.concScore} color={r.color} /></div>
        <div><span>Same prices</span><Meter value={s.clusScore} color={r.color} /></div>
      </div>
    </div>
  )
}

function Ladder({ s }) {
  // one row per brand (top 10 by number of listings), one dot per product
  const top = s.brands.slice(0, 10)
  const color = Object.fromEntries(top.map((b, i) => [b.brand, PALETTE[i % PALETTE.length]]))
  const shared = new Set(s.samePrice.map((g) => g.price))
  const data = top.flatMap((b) => b.items.map((p) => ({
    brand: b.brand, price: p.price, name: p.name, shared: shared.has(Math.round(p.price)),
  })))
  const dot = ({ cx, cy, payload }) => (
    <g>
      {payload.shared && <circle cx={cx} cy={cy} r={9} fill="none" stroke="#d92d20" strokeWidth={1.5} />}
      <circle cx={cx} cy={cy} r={5} fill={color[payload.brand]} fillOpacity={0.9} stroke="#ffffff" />
    </g>
  )
  return (
    <ResponsiveContainer width="100%" height={Math.max(220, top.length * 34 + 50)}>
      <ScatterChart margin={{ top: 8, right: 20, bottom: 16, left: 8 }}>
        <CartesianGrid stroke="#e6ebf2" horizontal={false} />
        <XAxis type="number" dataKey="price" {...axis} tickFormatter={(v) => rupees(v)} domain={['auto', 'auto']}
          label={{ value: 'price', position: 'insideBottom', offset: -8, fill: '#7a8898', fontSize: 11 }} />
        <YAxis type="category" dataKey="brand" {...axis} width={120} allowDuplicatedCategory={false}
          tick={{ ...axis.tick, fontSize: 11.5 }} />
        <ZAxis range={[60, 60]} />
        <Tooltip {...chartTooltip} cursor={{ strokeDasharray: '3 3' }}
          content={({ payload }) => {
            const p = payload?.[0]?.payload
            if (!p) return null
            return (
              <div style={{ ...chartTooltip.contentStyle, padding: '8px 10px', maxWidth: 280 }}>
                <b>{p.brand}</b> · {rupees(p.price)}
                <div style={{ color: '#56667a', fontSize: 11 }}>{p.name.slice(0, 80)}</div>
                {p.shared && <div style={{ color: '#b42318', fontSize: 11 }}>Another brand has this exact price</div>}
              </div>
            )
          }} />
        <Scatter data={data} shape={dot} isAnimationActive={false} />
      </ScatterChart>
    </ResponsiveContainer>
  )
}

export default function Scan({ result, onWatchMarket, onWatchPair, watched }) {
  const s = useMemo(() => scanMarket(result.products), [result])
  const [picked, setPicked] = useState([])
  const [showAll, setShowAll] = useState(false)
  const [busy, setBusy] = useState(null)
  const [err, setErr] = useState(null)
  const siteLabel = result.site === 'myntra' ? 'Myntra' : 'Flipkart'
  const rows = [...result.products].sort((a, b) => a.price - b.price)
  const shown = showAll ? rows : rows.slice(0, 12)

  const toggle = (id) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id].slice(-2)))
  const run = async (what, fn) => {
    setBusy(what); setErr(null)
    try { await fn() } catch (e) { setErr(e.message) }
    setBusy(null)
  }

  return (
    <section className="scan">
      <div className="scan-head">
        <div>
          <h2>“{result.query}” on {siteLabel}</h2>
          <div className="dim">
            {s.n} products · {s.brands.length} brands
          </div>
        </div>
        <button className="go" disabled={!!busy || watched} onClick={() => run('market', onWatchMarket)}>
          {watched ? '✓ Watching' : busy === 'market' ? 'Starting…' : 'Watch this market'}
        </button>
      </div>
      {err && <div className="bad" style={{ marginBottom: 12 }}>{err}</div>}

      <div className="scan-top">
        <RiskCard s={s} />
        <div className="panel stats-card">
          <div className="stat2"><span>Cheapest</span><b>{rupees(s.min)}</b></div>
          <div className="stat2"><span>Typical</span><b>{rupees(s.median)}</b></div>
          <div className="stat2"><span>Avg. discount</span><b>{s.avgDiscount}%</b></div>
          <div className="stat2"><span>Top 3 brands</span><b>{Math.round(s.top3 * 100)}%</b></div>
        </div>
      </div>

      <div className="grid-2" style={{ marginTop: 20 }}>
        <div className="panel">
          <div className="ptitle">Prices by brand</div>
          <div className="psub"><span className="ring" /> same price as another brand</div>
          <Ladder s={s} />
        </div>
        <div className="panel">
          <div className="ptitle">Findings</div>
          <div className="signs">
            {s.findings.map((f, i) => (
              <div className="sign" key={i} data-on={f.level === 'amber'}>
                <div className="sh"><span className="mark">{f.level === 'amber' ? '!' : 'i'}</span>{f.title}</div>
                <div className="sd">{f.detail}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="panel" style={{ marginTop: 20 }}>
        <div className="ptitle">Products</div>
        <div className="psub">Tick two to compare</div>
        <div className="tbl-wrap">
          <table className="prod-tbl">
            <thead><tr><th /><th>Brand</th><th>Product</th><th>Price</th><th>MRP</th><th>Off</th></tr></thead>
            <tbody>
              {shown.map((p) => (
                <tr key={p.id} data-sel={picked.includes(p.id)} onClick={() => toggle(p.id)}>
                  <td><input type="checkbox" readOnly checked={picked.includes(p.id)} /></td>
                  <td className="strong">{p.brand}</td>
                  <td className="pname">
                    <a href={p.url} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>
                      {p.name.slice(0, 70)}{p.name.length > 70 && '…'}
                    </a>
                  </td>
                  <td className="strong">{rupees(p.price)}</td>
                  <td>{rupees(p.mrp)}</td>
                  <td>{p.mrp ? `${Math.round((1 - p.price / p.mrp) * 100)}%` : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {rows.length > 12 && (
          <button className="tab" style={{ marginTop: 10 }} onClick={() => setShowAll(!showAll)}>
            {showAll ? 'Show fewer' : `Show all ${rows.length}`}
          </button>
        )}
      </div>

      {picked.length === 2 && (() => {
        const [a, b] = picked.map((id) => result.products.find((p) => p.id === id))
        return (
          <div className="pickbar">
            <span><b>{a.brand}</b> {rupees(a.price)} <span className="dim">vs</span> <b>{b.brand}</b> {rupees(b.price)}</span>
            <button className="go" disabled={!!busy}
              onClick={() => run('pair', async () => { await onWatchPair(a.url, b.url); setPicked([]) })}>
              {busy === 'pair' ? 'Starting…' : 'Compare'}
            </button>
          </div>
        )
      })()}
    </section>
  )
}
