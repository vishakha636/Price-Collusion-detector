import { useMemo, useState } from 'react'
import { CartesianGrid, Line, LineChart, ReferenceDot, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { STATUS, runAudit } from './audit'
import { rupees } from './common'
import { auditOpts } from './productAudit'
import { WINDOW_OPTIONS, getSettings } from './settings'
import { SIGN } from './plain'

// Detection -> explanation -> evidence, for one audit:
//   Why?            each signal's measurement, rule and points, per rival
//   Would it hold?  the verdict re-run with other settings (counterfactual)
//   Investigate     you vs one rival: chart with matched moves, and every move behind the counts

const SIG_COLOR = { copy: '#dc2626', theyCopy: '#f97316', gap: '#7c3aed', match: '#0891b2' }
const CONF_COLOR = { high: '#12a150', medium: '#e07b00', low: '#94a3b8', none: '#94a3b8' }
const day = (t) => new Date(t).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: '2-digit' })
const move = (who, e) => `${who} ${e.to > e.from ? 'raised' : 'cut'} ${rupees(e.from)} → ${rupees(e.to)}`

export function ConfidenceChip({ c }) {
  if (!c) return null
  const title = c.level === 'none' ? 'Not enough price history to judge yet'
    : `${c.days} days · ${c.moves} price moves · ${c.responses} rival moves checked`
  return <span className="x-conf" style={{ '--c': CONF_COLOR[c.level] }} title={title}>{c.label}</span>
}

function Why({ audit, onInvestigate }) {
  const ready = audit.ranking.filter((r) => r.result.status === 'ready')
  if (!ready.length) return <div className="a-muted">Too little data</div>
  return (
    <div className="x-why">
      {ready.map((r) => {
        const st = STATUS[r.result.level]
        return (
          <div key={r.name} className="x-rival">
            <div className="x-rival-head">
              <b>{r.name}</b>
              <span className="a-pill" style={{ '--c': st.color }}>{st.label}</span>
              <span className="x-score">{r.score}/100</span>
              <button className="a-link" onClick={() => onInvestigate(r.name)}>Prices →</button>
            </div>
            <div className="x-bar" title="Score = sum of signal points">
              {r.why.filter((w) => w.points > 0).map((w) => (
                <div key={w.key} style={{ width: `${w.points}%`, background: SIG_COLOR[w.key] }} />
              ))}
            </div>
            <table className="x-sig">
              <tbody>
                {r.why.map((w) => (
                  <tr key={w.key} data-met={w.met}>
                    <td><span className="x-dot" style={{ '--c': SIG_COLOR[w.key] }} />{w.met ? '✓' : '–'}</td>
                    <td title={w.detail || ''}>{w.label}</td>
                    <td className="x-meas">{w.measured ? (w.measured.n ? `${w.measured.k}/${w.measured.n} (${Math.round(100 * w.measured.k / w.measured.n)}%)` : 'no moves') : w.met ? 'yes' : 'no'}</td>
                    <td className="x-rule">{w.rule}</td>
                    <td className="x-pts">+{Math.round(w.points)} <span>/ {w.max}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="x-verdict-rule">
              Warning signs {r.result.signs.filter((s) => s.strong).length}/3 · 1 = Review · 2+ = High risk
              {r.result.signs.filter((s) => s.strong).map((s) => <div key={s.id} className="x-signfound" title={s.detail}>{SIGN[s.id]}</div>)}
            </div>
          </div>
        )
      })}
    </div>
  )
}

function Survive({ series, market, plat, audit }) {
  const st = getSettings()
  const grid = useMemo(() => WINDOW_OPTIONS.map((w) => ({
    w,
    all: runAudit(series, auditOpts(market, plat, { windowDays: w, excludeMarket: false })).level,
    net: runAudit(series, auditOpts(market, plat, { windowDays: w, excludeMarket: true })).level,
  })), [series, market, plat])
  const cells = grid.flatMap((g) => [g.all, g.net])
  const same = cells.filter((l) => l === audit.level).length
  const flag = (l) => l === 'red' || l === 'amber'
  const saleOnly = grid.find((g) => g.w === st.windowDays)
  const summary = audit.level === 'collecting' ? 'Too little data'
    : same === cells.length ? `${STATUS[audit.level].label} in ${cells.length}/${cells.length} checks`
    : flag(saleOnly.all) && !flag(saleOnly.net) ? 'Sale effect · clears when sale days are ignored'
    : `${STATUS[audit.level].label} in ${same}/${cells.length} checks`
  return (
    <div>
      <div className={`x-survive-sum ${same === cells.length ? 'ok' : ''}`}>{summary}</div>
      <table className="x-grid">
        <thead><tr><th>Response within</th><th>With sale days</th><th>Without sale days</th></tr></thead>
        <tbody>
          {grid.map((g) => (
            <tr key={g.w}>
              <td>{g.w} day{g.w > 1 ? 's' : ''}</td>
              {[['all', false], ['net', true]].map(([k, ex]) => (
                <td key={k} data-cur={g.w === st.windowDays && ex === st.excludeMarket}>
                  <span className="a-pill" style={{ '--c': STATUS[g[k]].color }}>{STATUS[g[k]].label}</span>
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <div className="x-note">Outlined: current settings · sale day: 30%+ of store listings move together · {audit.market.moves} sale-day changes</div>
    </div>
  )
}

function Investigate({ audit, rivalName, onPick, sourceName }) {
  const r = audit.rivals.find((x) => x.name === rivalName) || audit.ranking[0]
  const [all, setAll] = useState(false)
  if (!r) return null
  const data = r.rounds.map((x) => ({ t: x.t, you: x.a, them: x.b }))
  const replies = r.chain.filter((c) => c.reply && !c.excluded)
  const saleT = [...new Set(r.chain.filter((c) => c.market).map((c) => c.lead.t))]
  const rows = all ? r.chain : r.chain.slice(0, 12)
  const src = (e) => (e?.src === 'imported' ? sourceName || 'imported' : 'PriceGuard')
  return (
    <div>
      <div className="a-tabs x-pick">
        {audit.ranking.map((x) => <button key={x.name} data-on={x.name === r.name} onClick={() => onPick(x.name)}>{x.name}</button>)}
      </div>
      <ResponsiveContainer width="100%" height={240}>
        <LineChart data={data} margin={{ top: 10, right: 12, left: -8, bottom: 0 }}>
          <CartesianGrid stroke="#f1f5f9" vertical={false} />
          <XAxis dataKey="t" type="number" domain={['dataMin', 'dataMax']} scale="time" tickFormatter={day}
            stroke="#cbd5e1" tick={{ fill: '#64748b', fontSize: 11 }} minTickGap={40} />
          <YAxis stroke="#cbd5e1" tick={{ fill: '#64748b', fontSize: 11 }} tickFormatter={(v) => `₹${v}`} domain={['auto', 'auto']} />
          <Tooltip labelFormatter={day} formatter={(v, k) => [rupees(v), k === 'you' ? audit.me.name : r.name]} />
          {saleT.map((t) => <ReferenceLine key={t} x={t} stroke="#cbd5e1" strokeDasharray="3 3" />)}
          <Line type="stepAfter" dataKey="them" stroke="#94a3b8" strokeWidth={2} dot={false} connectNulls isAnimationActive={false} />
          <Line type="stepAfter" dataKey="you" stroke="#2563eb" strokeWidth={2.5} dot={false} connectNulls isAnimationActive={false} />
          {replies.map((c, i) => (
            <ReferenceDot key={i} x={c.reply.t} y={c.reply.to} r={5} stroke="#fff" strokeWidth={1.5}
              fill={c.kind === 'rise' ? (c.leader === 'them' ? '#dc2626' : '#f97316') : '#0891b2'} />
          ))}
        </LineChart>
      </ResponsiveContainer>
      <div className="x-legend">
        <span><i style={{ background: '#2563eb' }} />{audit.me.name}</span>
        <span><i style={{ background: '#94a3b8' }} />{r.name}</span>
        <span><b style={{ background: '#dc2626' }} />you followed their rise</span>
        <span><b style={{ background: '#f97316' }} />they followed yours</span>
        <span><b style={{ background: '#0891b2' }} />you matched their discount</span>
        <span><i className="dash" />sale day</span>
      </div>

      <table className="a-table x-chain">
        <thead><tr><th>Date</th><th>Change</th><th>Response · {audit.windowDays} d</th><th>Source</th></tr></thead>
        <tbody>
          {rows.map((c, i) => {
            const leadWho = c.leader === 'them' ? r.name : 'You'
            const replyWho = c.leader === 'them' ? 'You' : r.name
            return (
              <tr key={i} data-hit={!!c.reply && !c.excluded} data-ex={c.excluded}>
                <td>{day(c.lead.t)}</td>
                <td>{move(leadWho, c.lead)}{c.market && <span className="x-tag">{c.excluded ? 'sale day · ignored' : 'sale day'}</span>}</td>
                <td>{c.reply ? <>{move(replyWho, c.reply)} <span className="a-muted">· +{Math.round(c.lag * 10) / 10} d</span></> : <span className="a-muted">—</span>}</td>
                <td className="a-muted">{src(c.lead)}</td>
              </tr>
            )
          })}
          {!r.chain.length && <tr><td colSpan={4} className="a-muted">No price changes</td></tr>}
        </tbody>
      </table>
      {r.chain.length > 12 && <button className="a-link" onClick={() => setAll(!all)}>{all ? 'Show fewer' : `Show all ${r.chain.length} moves`}</button>}
    </div>
  )
}

export default function Explain({ audit, series, market, plat, sourceName }) {
  const [tab, setTab] = useState('why')
  const [rival, setRival] = useState(null)
  const investigate = (name) => { setRival(name); setTab('evidence') }
  return (
    <div className="a-card x-card">
      <div className="x-head">
        <h3>Breakdown</h3>
        <ConfidenceChip c={audit.confidence} />
        {audit.market.excluded && audit.market.moves > 0 && (
          <span className="x-tag">{audit.market.moves} sale-day changes ignored</span>
        )}
        <div className="a-tabs x-tabs">
          {[['why', 'Signals'], ['survive', 'Sale check'], ['evidence', 'Price changes']].map(([k, l]) => (
            <button key={k} data-on={tab === k} onClick={() => setTab(k)}>{l}</button>
          ))}
        </div>
      </div>
      {tab === 'why' && <Why audit={audit} onInvestigate={investigate} />}
      {tab === 'survive' && <Survive audit={audit} series={series} market={market} plat={plat} />}
      {tab === 'evidence' && <Investigate audit={audit} rivalName={rival} onPick={setRival} sourceName={sourceName} />}
    </div>
  )
}
