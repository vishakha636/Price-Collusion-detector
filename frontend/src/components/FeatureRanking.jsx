import { useMemo } from 'react'
import { FEATURE_INFO, LEVEL_SENSITIVE, aucSeparation } from '../lib/stats'

/**
 * How well each scale-free feature separates collusive from competitive runs,
 * measured by rank AUC. Bars point right when the feature runs HIGHER in
 * collusive markets and left when it runs higher in competitive ones.
 *
 * None of these features touches marginal cost, profit, or the Nash/monopoly
 * anchors -- that is deliberate, because on real scraped data none of those are
 * observable. This chart is the evidence that a cost-free detector is possible.
 */
export default function FeatureRanking({ runs, features }) {
  const rows = useMemo(() => {
    const coll = runs.filter((r) => r.label === 'collusive')
    const comp = runs.filter((r) => r.label === 'competitive')
    return features
      .map((f) => {
        const { auc, sep } = aucSeparation(coll.map((r) => r[f]), comp.map((r) => r[f]))
        return { f, auc, sep, higherIn: auc >= 0.5 ? 'collusive' : 'competitive' }
      })
      .sort((a, b) => b.sep - a.sep)
  }, [runs, features])

  const W = 860
  const rowH = 24
  const padL = 208
  const padR = 92
  const padT = 34
  const H = padT + rows.length * rowH + 12
  const mid = padL + (W - padL - padR) / 2
  const half = (W - padL - padR) / 2

  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto' }}>
      {[0.25, 0.5, 0.75, 1].map((t) => (
        <g key={t}>
          <line x1={mid - half * t} x2={mid - half * t} y1={padT - 6} y2={H - 6}
            stroke="#e6ebf2" strokeDasharray="3 4" />
          <line x1={mid + half * t} x2={mid + half * t} y1={padT - 6} y2={H - 6}
            stroke="#e6ebf2" strokeDasharray="3 4" />
        </g>
      ))}
      <line x1={mid} x2={mid} y1={padT - 10} y2={H - 6} stroke="#c5d0de" />

      <text className="tick" x={mid - half} y={padT - 16} textAnchor="start" fill="#0891b2">
        ← higher when competitive
      </text>
      <text className="tick" x={mid + half} y={padT - 16} textAnchor="end" fill="#e07b00">
        higher when collusive →
      </text>

      {rows.map((r, i) => {
        const y = padT + i * rowH
        const [name, why] = FEATURE_INFO[r.f] ?? [r.f, '']
        const w = r.sep * half
        const right = r.higherIn === 'collusive'
        const flagged = LEVEL_SENSITIVE.has(r.f)
        const color = flagged ? '#56667a' : right ? '#e07b00' : '#0891b2'
        return (
          <g key={r.f}>
            <title>
              {`${name}\n${why}\nAUC = ${r.auc.toFixed(3)}  ·  separation = ${r.sep.toFixed(3)}`
                + (flagged ? '\n\nEXCLUDED: inflated by the price-grid construction.' : '')}
            </title>
            {i % 2 === 0 && (
              <rect x={0} y={y - 3} width={W} height={rowH - 2} fill="#ffffff" fillOpacity="0.014" />
            )}
            <text x={padL - 12} y={y + 12} textAnchor="end"
              style={{
                font: '500 12px var(--sans)',
                fill: flagged ? 'var(--text-faint)' : 'var(--text-dim)',
              }}>
              {flagged ? `${name} ⚠` : name}
            </text>
            <rect x={right ? mid : mid - w} y={y + 2} width={Math.max(w, 1)} height={rowH - 10}
              fill={color} fillOpacity={flagged ? 0.28 : 0.7} rx="2"
              stroke={flagged ? '#56667a' : 'none'} strokeDasharray={flagged ? '3 3' : ''}
              strokeWidth={flagged ? 1 : 0} />
            <text x={W - padR + 10} y={y + 12}
              style={{ font: '500 11px var(--mono)', fill: 'var(--text-faint)' }}>
              AUC {r.auc.toFixed(2)}
            </text>
          </g>
        )
      })}
    </svg>
  )
}
