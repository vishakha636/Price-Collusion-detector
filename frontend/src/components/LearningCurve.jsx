import {
  CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer,
  Tooltip, XAxis, YAxis,
} from 'recharts'
import { axisStyle as axis, chartTooltip, thinTicks } from '../lib/chartStyle'
import { REGIMES, REGIME_ORDER, mean } from '../lib/stats'

/**
 * Mean market price over the course of training, averaged within each regime.
 *
 * This is the "bots learning to collude" chart. Both Q-learning regimes start
 * from the same random play, and the patient ones climb away from the
 * competitive level while the myopic ones do not -- nobody told either of them
 * to do that, and they never communicate.
 */
export default function LearningCurve({ runs, meta, height = 290 }) {
  const qRuns = runs.filter((r) => r.regime.startsWith('q_'))
  if (!qRuns.length) return null

  const n = qRuns[0].curve.length
  const periods = meta.periods_per_q_run

  const byRegime = {}
  REGIME_ORDER.filter((r) => r.startsWith('q_')).forEach((reg) => {
    const rs = qRuns.filter((r) => r.regime === reg)
    if (rs.length) {
      // Prices are normalised to each run's own Nash level before averaging,
      // because every run has a slightly different randomised calibration.
      byRegime[reg] = Array.from({ length: n }, (_, i) =>
        mean(rs.map((r) => r.curve[i] / r.p_nash)))
    }
  })

  const data = Array.from({ length: n }, (_, i) => {
    const row = { t: Math.round((i + 0.5) * (periods / n)) }
    Object.entries(byRegime).forEach(([reg, arr]) => { row[reg] = arr[i] })
    return row
  })

  const monoRatio = mean(qRuns.map((r) => r.p_monopoly / r.p_nash))

  // Both anchors are kept inside the domain: the interesting quantity is not
  // just the gap between the two regimes but how far up towards monopoly the
  // patient agents actually got.
  const all = Object.values(byRegime).flat()
  const lo = Math.min(1, ...all)
  const hi = Math.max(monoRatio, ...all)
  const pad = (hi - lo) * 0.08 || 0.02

  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={data} margin={{ top: 10, right: 74, bottom: 22, left: 4 }}>
        <CartesianGrid stroke="#172230" vertical={false} />
        <XAxis dataKey="t" {...axis}
          ticks={thinTicks(data, 7)}
          tickFormatter={(v) => `${Math.round(v / 1000)}k`}
          label={{ value: 'training period', position: 'insideBottom', offset: -12,
            fill: '#5b6a7d', fontSize: 11, fontFamily: 'var(--mono)' }} />
        <YAxis domain={[lo - pad, hi + pad]} {...axis} width={52}
          tickFormatter={(v) => `${v.toFixed(2)}x`} />
        <Tooltip {...chartTooltip}
          labelFormatter={(v) => `period ${Number(v).toLocaleString()}`}
          formatter={(v, k) => [`${Number(v).toFixed(4)}x Nash`, REGIMES[k]?.name ?? k]} />

        <ReferenceLine y={1} stroke="#22d3ee" strokeDasharray="5 4" strokeOpacity={0.75}
          label={{ value: 'Nash', position: 'right', fill: '#22d3ee', fontSize: 10.5,
            fontFamily: 'var(--mono)' }} />
        <ReferenceLine y={monoRatio} stroke="#fbbf24" strokeDasharray="5 4" strokeOpacity={0.75}
          label={{ value: 'monopoly', position: 'right', fill: '#fbbf24', fontSize: 10.5,
            fontFamily: 'var(--mono)' }} />

        {Object.keys(byRegime).map((reg) => (
          <Line key={reg} type="monotone" dataKey={reg} dot={false}
            stroke={REGIMES[reg].color} strokeWidth={2} isAnimationActive={false} />
        ))}
      </LineChart>
    </ResponsiveContainer>
  )
}
