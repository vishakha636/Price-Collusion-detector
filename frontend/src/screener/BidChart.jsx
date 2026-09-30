import {
  CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts'
import { axisStyle as axis, chartTooltip } from '../lib/chartStyle'
import { inr } from './screens'

const PALETTE = ['#0f2a4a', '#0c56a8', '#0891b2', '#e07b00', '#12a150', '#c11574']

/**
 * Every bidder's quote, tender by tender. When bidders quote the same price
 * their dots land on top of each other -- which is the whole point of the
 * picture -- so tenders with identical bids get a red ring as well.
 */
export default function BidChart({ tenders, results, height = 280 }) {
  const bidders = [...new Set(tenders.flatMap((t) => t.bids.map((b) => b.bidder)))]
  const color = Object.fromEntries(bidders.map((b, i) => [b, PALETTE[i % PALETTE.length]]))
  const identical = new Set(
    results.filter((r) => r.flags.some((f) => f.id === 'identical')).map((r) => r.tender.id),
  )

  const data = results.map(({ tender }) => {
    const row = { label: tender.label || tender.id, _id: tender.id }
    for (const b of tender.bids) row[b.bidder] = b.amount
    return row
  })
  const all = tenders.flatMap((t) => t.bids.map((b) => b.amount))
  const lo = Math.min(...all), hi = Math.max(...all)
  // Round the axis to a tidy step so ticks read ₹9,000 / ₹10,000, not ₹9,245.
  const span = (hi - lo) * 1.2 || hi * 0.1
  const step = 10 ** Math.floor(Math.log10(span)) / (span / 10 ** Math.floor(Math.log10(span)) < 3 ? 4 : 2)
  const yMin = Math.max(0, Math.floor((lo - span * 0.08) / step) * step)
  const yMax = Math.ceil((hi + span * 0.08) / step) * step
  const every = Math.ceil((yMax - yMin) / step / 6)
  const ticks = []
  for (let v = yMin; v <= yMax + 1e-9; v += step * every) ticks.push(v)

  const dot = (bidder) => function RingDot({ cx, cy, payload, value }) {
    if (value == null || cx == null) return null
    const hit = identical.has(payload._id)
    return (
      <g key={`${bidder}-${payload._id}`}>
        {hit && <circle cx={cx} cy={cy} r={9} fill="none" stroke="#d92d20" strokeWidth={1.6} />}
        <circle cx={cx} cy={cy} r={3.6} fill={color[bidder]} stroke="#ffffff" strokeWidth={1} />
      </g>
    )
  }

  return (
    <>
      <div className="legend">
        {bidders.map((b) => (
          <span className="chip" key={b}><span className="dot" style={{ background: color[b] }} />{b}</span>
        ))}
        {identical.size > 0 && (
          <span className="chip"><span className="ring" />identical bids</span>
        )}
      </div>
      <ResponsiveContainer width="100%" height={height}>
        <LineChart data={data} margin={{ top: 10, right: 16, bottom: 8, left: 8 }}>
          <CartesianGrid stroke="#e6ebf2" vertical={false} />
          <XAxis dataKey="label" {...axis} interval="preserveStartEnd" />
          <YAxis domain={[yMin, yMax]} {...axis} width={70} ticks={ticks}
            tickFormatter={(v) => inr(Math.round(v))} />
          <Tooltip {...chartTooltip} formatter={(v, name) => [inr(v), name]} />
          {bidders.map((b) => (
            <Line key={b} dataKey={b} name={b} stroke={color[b]} strokeWidth={1.5} strokeOpacity={0.55}
              connectNulls dot={dot(b)} activeDot={{ r: 5 }} isAnimationActive={false} />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </>
  )
}
