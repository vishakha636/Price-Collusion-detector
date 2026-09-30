import { useMemo } from 'react'
import { FEATURE_INFO, REGIMES } from '../lib/stats'

/**
 * Any two detector features plotted against each other, one point per market.
 * Useful for seeing that the classes are separable in feature space *without*
 * using price level -- and for seeing exactly which runs sit on the boundary.
 */
export default function FeatureScatter({ runs, fx, fy, selected, onSelect }) {
  const W = 560
  const H = 400
  const pad = { l: 62, r: 16, t: 16, b: 52 }

  const dom = useMemo(() => {
    const ex = (f) => {
      const vs = runs.map((r) => r[f]).filter(Number.isFinite)
      const lo = Math.min(...vs)
      const hi = Math.max(...vs)
      const p = (hi - lo) * 0.06 || 0.01
      return [lo - p, hi + p]
    }
    return { x: ex(fx), y: ex(fy) }
  }, [runs, fx, fy])

  const sx = (v) => pad.l + ((v - dom.x[0]) / (dom.x[1] - dom.x[0])) * (W - pad.l - pad.r)
  const sy = (v) => H - pad.b - ((v - dom.y[0]) / (dom.y[1] - dom.y[0])) * (H - pad.t - pad.b)

  const ticks = (d) => Array.from({ length: 5 }, (_, i) => d[0] + ((d[1] - d[0]) * i) / 4)
  const nm = (f) => (FEATURE_INFO[f] ?? [f])[0]

  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto' }}>
      {ticks(dom.y).map((t, i) => (
        <g key={`y${i}`}>
          <line x1={pad.l} x2={W - pad.r} y1={sy(t)} y2={sy(t)} stroke="#e6ebf2" />
          <text className="tick" x={pad.l - 8} y={sy(t) + 3.5} textAnchor="end">
            {t.toFixed(2)}
          </text>
        </g>
      ))}
      {ticks(dom.x).map((t, i) => (
        <g key={`x${i}`}>
          <line x1={sx(t)} x2={sx(t)} y1={pad.t} y2={H - pad.b} stroke="#e6ebf2" />
          <text className="tick" x={sx(t)} y={H - pad.b + 16} textAnchor="middle">
            {t.toFixed(2)}
          </text>
        </g>
      ))}

      <text className="axis-label" x={(pad.l + W - pad.r) / 2} y={H - 12} textAnchor="middle">
        {nm(fx)}
      </text>
      <text className="axis-label" transform={`rotate(-90 14 ${(pad.t + H - pad.b) / 2})`}
        x={14} y={(pad.t + H - pad.b) / 2} textAnchor="middle">
        {nm(fy)}
      </text>

      {runs.map((r) => {
        const on = selected === r.run_id
        const meta = REGIMES[r.regime]
        return (
          <circle key={r.run_id} cx={sx(r[fx])} cy={sy(r[fy])} r={on ? 6 : 4}
            fill={meta.color} fillOpacity={on ? 1 : 0.55}
            stroke={on ? '#fff' : meta.color} strokeWidth={on ? 1.6 : 0.6}
            style={{ cursor: 'pointer' }} onClick={() => onSelect(r.run_id)}>
            <title>{`${r.run_id}\n${nm(fx)} = ${r[fx]?.toFixed(3)}\n${nm(fy)} = ${r[fy]?.toFixed(3)}\nΔ = ${r.delta.toFixed(3)}`}</title>
          </circle>
        )
      })}
    </svg>
  )
}
