import { useMemo } from 'react'
import { REGIMES, REGIME_ORDER, quantile, mean } from '../lib/stats'

/**
 * Strip plot of the collusion index by regime, with a box summary per row.
 *
 * This is the chart that shows the labels mean something economically: every
 * run is placed on the 0 (Bertrand-Nash) to 1 (perfect cartel) scale. It also
 * shows the honest part -- myopic Q-learners do NOT sit at zero, so the two
 * Q-learning regimes partly overlap on price level alone.
 */
export default function DeltaStrip({ runs, selected, onSelect }) {
  const W = 860
  const rowH = 74
  const padL = 152
  const padR = 28
  const padT = 30
  const H = padT + REGIME_ORDER.length * rowH + 42

  const domain = useMemo(() => {
    const ds = runs.map((r) => r.delta)
    return [Math.min(-0.1, ...ds) - 0.03, Math.max(1.0, ...ds) + 0.03]
  }, [runs])

  const x = (d) => padL + ((d - domain[0]) / (domain[1] - domain[0])) * (W - padL - padR)

  const rows = REGIME_ORDER.map((reg) => {
    const rs = runs.filter((r) => r.regime === reg)
    const ds = rs.map((r) => r.delta)
    return {
      reg,
      rs,
      q1: quantile(ds, 0.25),
      med: quantile(ds, 0.5),
      q3: quantile(ds, 0.75),
      lo: quantile(ds, 0.05),
      hi: quantile(ds, 0.95),
      avg: mean(ds),
    }
  })

  const gridTicks = [0, 0.25, 0.5, 0.75, 1.0]

  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto' }}>
      {/* reference bands: 0 = competitive, 1 = perfect cartel */}
      <rect x={x(domain[0])} y={padT - 8} width={x(0) - x(domain[0])} height={H - padT - 26}
        fill="#e8f6fa" />
      <rect x={x(1)} y={padT - 8} width={x(domain[1]) - x(1)} height={H - padT - 26}
        fill="#fff6e5" />

      {gridTicks.map((t) => (
        <g key={t}>
          <line x1={x(t)} x2={x(t)} y1={padT - 8} y2={H - 34}
            stroke={t === 0 || t === 1 ? '#c5d0de' : '#e6ebf2'}
            strokeDasharray={t === 0 || t === 1 ? '' : '3 4'} />
          <text className="tick" x={x(t)} y={H - 18} textAnchor="middle">{t}</text>
        </g>
      ))}
      <text className="tick" x={x(0)} y={padT - 14} textAnchor="middle" fill="#0891b2">
        Bertrand-Nash
      </text>
      <text className="tick" x={x(1)} y={padT - 14} textAnchor="middle" fill="#e07b00">
        perfect cartel
      </text>
      <text className="axis-label" x={(padL + W - padR) / 2} y={H - 2} textAnchor="middle">
        collusion index  Δ  =  (profit − profit_Nash) / (profit_monopoly − profit_Nash)
      </text>

      {rows.map((row, i) => {
        const yc = padT + i * rowH + rowH / 2
        const meta = REGIMES[row.reg]
        return (
          <g key={row.reg}>
            <text x={padL - 14} y={yc - 5} textAnchor="end"
              style={{ font: '600 12.5px var(--sans)', fill: 'var(--text)' }}>
              {meta.name}
            </text>
            <text x={padL - 14} y={yc + 11} textAnchor="end"
              style={{ font: '400 10.5px var(--mono)', fill: 'var(--text-faint)' }}>
              {meta.cls} · n={row.rs.length}
            </text>

            {/* box + whiskers */}
            <line x1={x(row.lo)} x2={x(row.hi)} y1={yc + 20} y2={yc + 20}
              stroke={meta.color} strokeOpacity=".45" />
            <rect x={x(row.q1)} y={yc + 14} width={Math.max(x(row.q3) - x(row.q1), 1)} height={12}
              fill={meta.color} fillOpacity=".16" stroke={meta.color} strokeOpacity=".5" rx="2" />
            <line x1={x(row.med)} x2={x(row.med)} y1={yc + 13} y2={yc + 27}
              stroke={meta.color} strokeWidth="2" />

            {/* one dot per run, deterministically jittered */}
            {row.rs.map((r, j) => {
              const jit = (((j * 2654435761) % 1000) / 1000 - 0.5) * 22
              const on = selected === r.run_id
              return (
                <circle
                  key={r.run_id}
                  cx={x(r.delta)}
                  cy={yc - 8 + jit * 0.55}
                  r={on ? 5 : 3}
                  fill={meta.color}
                  fillOpacity={on ? 1 : 0.5}
                  stroke={on ? '#fff' : 'none'}
                  strokeWidth={on ? 1.5 : 0}
                  style={{ cursor: 'pointer' }}
                  onClick={() => onSelect(r.run_id)}
                >
                  <title>{`${r.run_id}\nΔ = ${r.delta.toFixed(3)}\nprice/Nash = ${r.price_over_nash.toFixed(3)}`}</title>
                </circle>
              )
            })}

            <text x={W - padR} y={yc - 12} textAnchor="end"
              style={{ font: '600 12px var(--mono)', fill: meta.color }}>
              Δ̄ {row.avg.toFixed(3)}
            </text>
          </g>
        )
      })}
    </svg>
  )
}
