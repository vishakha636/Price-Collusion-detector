import {
  CartesianGrid, Line, LineChart, ReferenceArea, ReferenceLine,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts'
import { axisStyle as axis, chartTooltip, thinTicks } from '../lib/chartStyle'
import { fmt } from '../lib/stats'

/**
 * The defection probe -- the most diagnostic experiment in the project.
 *
 * At step 0 seller A is forced to undercut to the competitive price. Both then
 * revert to their own learned policies. A market held up by a reward-punishment
 * scheme reacts unmistakably: the rival cuts price too (punishment), then both
 * climb back to the pre-shock level (forgiveness). A genuinely competitive
 * market has nothing to punish and nothing to return to.
 */
export default function ImpulseResponse({ run, height = 250 }) {
  const [ir0, ir1] = run.ir
  const data = ir0.map((v, i) => ({ t: i, A: v, B: ir1[i] }))

  const lo = Math.min(run.p_nash, ...ir0, ...ir1)
  const hi = Math.max(run.p_monopoly, ...ir0, ...ir1)
  const pad = (hi - lo) * 0.12 || 0.05
  const rec = run.recovery_steps

  return (
    <>
      <ResponsiveContainer width="100%" height={height}>
        <LineChart data={data} margin={{ top: 8, right: 68, bottom: 20, left: 4 }}>
          <CartesianGrid stroke="#e6ebf2" vertical={false} />
          {rec > 0 && (
            <ReferenceArea x1={0} x2={rec} fill="#d92d20" fillOpacity={0.07} />
          )}
          <XAxis dataKey="t" {...axis} ticks={thinTicks(data, 10)}
            label={{ value: 'periods since forced undercut', position: 'insideBottom',
              offset: -12, fill: '#7a8898', fontSize: 11, fontFamily: 'var(--mono)' }} />
          <YAxis domain={[lo - pad, hi + pad]} {...axis} width={48}
            tickFormatter={(v) => v.toFixed(2)} />
          <Tooltip {...chartTooltip} formatter={(v) => Number(v).toFixed(4)} />

          <ReferenceLine x={0} stroke="#d92d20" strokeWidth={1.5}
            label={{ value: 'A defects', position: 'insideTopLeft', fill: '#d92d20',
              fontSize: 10.5, fontFamily: 'var(--mono)', offset: 8 }} />
          <ReferenceLine y={run.p_nash} stroke="#0891b2" strokeDasharray="5 4" strokeOpacity={0.7}
            label={{ value: 'Nash', position: 'right', fill: '#0891b2', fontSize: 10.5,
              fontFamily: 'var(--mono)' }} />
          <ReferenceLine y={run.p_monopoly} stroke="#e07b00" strokeDasharray="5 4" strokeOpacity={0.7}
            label={{ value: 'monopoly', position: 'right', fill: '#e07b00', fontSize: 10.5,
              fontFamily: 'var(--mono)' }} />

          <Line type="stepAfter" dataKey="A" name="seller A (defector)" dot={{ r: 2 }}
            stroke="#d92d20" strokeWidth={1.6} isAnimationActive={false} />
          <Line type="stepAfter" dataKey="B" name="seller B (rival)" dot={{ r: 2 }}
            stroke="#0f2a4a" strokeWidth={1.6} isAnimationActive={false} />
        </LineChart>
      </ResponsiveContainer>

      <div className="legend" style={{ marginTop: 10, marginBottom: 0 }}>
        <span className="chip">
          <span className="dot" style={{ background: '#d92d20' }} />
          punishment depth {fmt(run.punish_depth * 100, 1)}%
        </span>
      </div>
    </>
  )
}
