import { useState } from 'react'
import {
  CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer,
  Tooltip, XAxis, YAxis,
} from 'recharts'
import { axisStyle as axis, chartTooltip, thinTicks } from '../lib/chartStyle'

/**
 * The observed price series for one run -- what a regulator scraping this
 * market would actually see. Learning is already over here: these are the
 * frozen policies being executed, with occasional off-policy trembles.
 */
export default function PricePath({ run, height = 250 }) {
  // Converged bots often settle into a 2-period cycle, which at 200 periods
  // reads as solid hatching. A narrower window makes the actual cycle visible.
  const [win, setWin] = useState(60)
  const [p0all, p1all] = run.tail
  const p0 = p0all.slice(-win)
  const p1 = p1all.slice(-win)
  const off = p0all.length - p0.length
  const data = p0.map((v, i) => ({ t: off + i, A: v, B: p1[i] }))

  const lo = Math.min(run.p_nash, ...p0, ...p1)
  const hi = Math.max(run.p_monopoly, ...p0, ...p1)
  const pad = (hi - lo) * 0.12 || 0.05

  return (
    <>
    <div className="tabs" style={{ marginBottom: 8 }}>
      {[40, 60, 120, 200].map((w) => (
        <button key={w} className="tab" data-on={win === w} onClick={() => setWin(w)}
          style={{ padding: '4px 9px', fontSize: 11.5 }}>
          {w}p
        </button>
      ))}
    </div>
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={data} margin={{ top: 8, right: 68, bottom: 20, left: 4 }}>
        <CartesianGrid stroke="#e6ebf2" vertical={false} />
        <XAxis dataKey="t" {...axis}
          ticks={thinTicks(data, 8)}
          label={{ value: 'observed period', position: 'insideBottom', offset: -12,
            fill: '#7a8898', fontSize: 11, fontFamily: 'var(--mono)' }} />
        <YAxis domain={[lo - pad, hi + pad]} {...axis} width={48}
          tickFormatter={(v) => v.toFixed(2)} />
        <Tooltip {...chartTooltip} formatter={(v) => Number(v).toFixed(4)} />

        <ReferenceLine y={run.p_nash} stroke="#0891b2" strokeDasharray="5 4" strokeOpacity={0.75}
          label={{ value: 'Nash', position: 'right', fill: '#0891b2', fontSize: 10.5,
            fontFamily: 'var(--mono)' }} />
        <ReferenceLine y={run.p_monopoly} stroke="#e07b00" strokeDasharray="5 4" strokeOpacity={0.75}
          label={{ value: 'monopoly', position: 'right', fill: '#e07b00', fontSize: 10.5,
            fontFamily: 'var(--mono)' }} />

        {/* Animation off: a 200-point step series animating on every re-render is
            noise, and it makes the chart unreadable for the first second. */}
        <Line type="stepAfter" dataKey="A" name="seller A" dot={false}
          stroke="#0f2a4a" strokeWidth={1.4} isAnimationActive={false} />
        <Line type="stepAfter" dataKey="B" name="seller B" dot={false}
          stroke="#0c56a8" strokeWidth={1.4} strokeOpacity={0.9} isAnimationActive={false} />
      </LineChart>
    </ResponsiveContainer>
    </>
  )
}
