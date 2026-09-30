import { useMemo } from 'react'
import {
  CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts'
import { axisStyle as axis, chartTooltip } from '../lib/chartStyle'
import { analyzePair } from './analyze'
import { LIGHT, rupees } from './common'

const short = (p, side) => p[`brand_${side}`] || (p[`name_${side}`] || '').split(/[ ,]/).slice(0, 3).join(' ')

function PairChart({ pair }) {
  // Replays share one unit (e.g. ₹/kg), so plot the real values: identical
  // prices then sit exactly on top of each other. Live pairs are different
  // products at different price levels, so plot % change since day one.
  const absolute = !!pair.unit
  const rows = pair.rounds.filter((r) => r.a != null || r.b != null)
  const baseA = rows.find((r) => r.a != null)?.a
  const baseB = rows.find((r) => r.b != null)?.b
  const long = rows.length > 1 && new Date(rows[rows.length - 1].t) - new Date(rows[0].t) > 120 * 864e5
  const data = rows.map((r) => ({
    t: new Date(r.t).toLocaleDateString('en-IN', long ? { month: 'short', year: '2-digit' } : { day: 'numeric', month: 'short' }),
    A: r.a == null ? null : absolute ? r.a : ((r.a - baseA) / baseA) * 100,
    B: r.b == null ? null : absolute ? r.b : ((r.b - baseB) / baseB) * 100,
    pa: r.a, pb: r.b,
  }))
  const nameA = short(pair, 'a'), nameB = short(pair, 'b')
  const fmtY = absolute ? (v) => `₹${v}` : (v) => `${v > 0 ? '+' : ''}${v.toFixed(0)}%`
  return (
    <ResponsiveContainer width="100%" height={200}>
      <LineChart data={data} margin={{ top: 8, right: 12, bottom: 4, left: 0 }}>
        <CartesianGrid stroke="#e6ebf2" vertical={false} />
        <XAxis dataKey="t" {...axis} interval="preserveStartEnd" minTickGap={30} />
        <YAxis {...axis} width={48} tickFormatter={fmtY} domain={absolute ? [0, 'auto'] : ['auto', 'auto']} />
        {!absolute && <ReferenceLine y={0} stroke="#c5d0de" />}
        <Tooltip {...chartTooltip}
          formatter={(v, k, item) => [
            absolute ? `${rupees(v)} ${pair.unit.replace('₹ ', '')}`
              : `${rupees(k === nameA ? item.payload.pa : item.payload.pb)}  (${v > 0 ? '+' : ''}${Number(v).toFixed(1)}%)`, k]} />
        <Line type="stepAfter" dataKey="A" name={nameA} stroke="#0f2a4a" strokeWidth={2} dot={false}
          connectNulls isAnimationActive={false} />
        <Line type="stepAfter" dataKey="B" name={nameB} stroke="#0c56a8" strokeWidth={2} dot={false}
          strokeDasharray={absolute ? '6 4' : undefined}
          connectNulls isAnimationActive={false} />
      </LineChart>
    </ResponsiveContainer>
  )
}

export default function PairCard({ pair, onRemove }) {
  const names = { a: short(pair, 'a'), b: short(pair, 'b') }
  const r = useMemo(() => analyzePair(pair.rounds, names, { windowDays: pair.windowDays }), [pair])  // eslint-disable-line react-hooks/exhaustive-deps
  const light = LIGHT[r.level]
  const last = [...pair.rounds].reverse().find((x) => x.a != null || x.b != null)
  const p = r.progress
  const pct = Math.min(100, Math.round(100 * Math.min(p.days / p.needDays, p.changes / p.needChanges)))

  return (
    <div className="panel pair">
      <div className="pair-head">
        <div className="who">
          <span className="brand a">{names.a}</span>
          <span className="vs-s">vs</span>
          <span className="brand b">{names.b}</span>
          <span className="chip">{pair.site}</span>
        </div>
        {onRemove && <button className="rm" title="Stop watching" onClick={() => onRemove(pair.id)}>×</button>}
      </div>

      <div className="verdict" style={{ '--c': light.color }}>
        <span className="bulb" />
        <div>
          <div className="vl">{light.label}</div>
          <div className="vs2">{r.summary}</div>
        </div>
      </div>

      {pair.cci && (
        <div className="cci-box">
          <div className="vk">What the CCI decided</div>
          <div className="cci-row">
            <span className="outcome guilty">Guilty — cartel</span>
            <span className="dim">{pair.cci.penalty}</span>
          </div>
          <p>{pair.cci.finding}</p>
          <div className="dim">
            {pair.cci.caseNo}, final order {pair.cci.orderDate} ·{' '}
            <a href={pair.cci.url} target="_blank" rel="noreferrer">read the order ↗</a>
            {' '}· rates from the table at para 113 of the{' '}
            <a href={pair.cci.urlFirst} target="_blank" rel="noreferrer">2015 order ↗</a>
          </div>
        </div>
      )}

      {r.status === 'collecting' && (
        <div className="progress">
          <div className="bar"><div style={{ width: `${pct}%` }} /></div>
          <div className="dim">
            {p.days} of {p.needDays} days · {p.changes} of {p.needChanges} price changes · {p.readings} readings
          </div>
        </div>
      )}

      <div className="now">
        <div><span className="dim">{names.a} {pair.cci ? 'final rate' : 'now'}</span><b>{rupees(last?.a)}</b></div>
        <div><span className="dim">{names.b} {pair.cci ? 'final rate' : 'now'}</span><b>{rupees(last?.b)}</b></div>
      </div>

      <PairChart pair={pair} />
      <div className="dim cap">
        {pair.unit
          ? `Surcharge in ${pair.unit}. Where you see only one line, the two airlines were charging exactly the same.`
          : 'Price change since we started watching. Lines moving in step = prices moving together.'}
      </div>

      {r.signs.length > 0 && (
        <div className="signs">
          {r.signs.map((s) => (
            <div className="sign" key={s.id} data-on={s.strong}>
              <div className="sh"><span className="mark">{s.strong ? '!' : '✓'}</span>{s.title}</div>
              <div className="sd">{s.detail}</div>
              <div className="sw">{s.why}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
