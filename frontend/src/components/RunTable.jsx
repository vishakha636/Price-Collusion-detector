import { useMemo, useState } from 'react'
import { CLS_COLOR, REGIMES, fmt } from '../lib/stats'

const COLS = [
  { k: 'run_id', h: 'run', d: 0, t: 'Run identifier' },
  { k: 'label', h: 'label', d: 0, t: 'Ground-truth class' },
  { k: 'delta', h: 'Δ', d: 3, t: 'Collusion index: 0 = Nash, 1 = perfect cartel' },
  { k: 'avg_price', h: 'price', d: 3, t: 'Mean observed price' },
  { k: 'price_over_nash', h: 'p/Nash', d: 3, t: 'Mean price relative to the Nash price' },
  { k: 'punish_depth', h: 'punish', d: 3, t: 'How far the rival cut after a forced defection' },
  { k: 'recovery_steps', h: 'recov', d: 0, t: 'Periods to return to the pre-shock level (-1 = never)' },
  { k: 'price_corr', h: 'corr', d: 3, t: 'Correlation between the two sellers’ prices' },
  { k: 'state_hhi', h: 'HHI', d: 3, t: 'Concentration of joint price states' },
  { k: 'retaliation_rate', h: 'retal', d: 3, t: 'Rate at which undercutting is met with a price cut' },
  { k: 'gamma', h: 'γ', d: 2, t: 'Discount factor (Q-learning runs only)' },
  { k: 'k', h: 'grid', d: 0, t: 'Number of prices in the action grid' },
  { k: 'converged', h: 'conv', d: 0, t: 'Did the greedy policy freeze?' },
]

export default function RunTable({ runs, selected, onSelect }) {
  const [sort, setSort] = useState({ k: 'delta', dir: -1 })

  const sorted = useMemo(() => {
    const { k, dir } = sort
    return [...runs].sort((a, b) => {
      const x = a[k]
      const y = b[k]
      if (typeof x === 'string' || typeof x === 'boolean') {
        return String(x).localeCompare(String(y)) * dir
      }
      return ((x ?? -Infinity) - (y ?? -Infinity)) * dir
    })
  }, [runs, sort])

  const click = (k) =>
    setSort((s) => (s.k === k ? { k, dir: -s.dir } : { k, dir: -1 }))

  return (
    <div className="tbl-wrap" style={{ maxHeight: 460, overflowY: 'auto' }}>
      <table>
        <thead>
          <tr>
            {COLS.map((c) => (
              <th key={c.k} onClick={() => click(c.k)} title={c.t}>
                {c.h}{sort.k === c.k ? (sort.dir === -1 ? ' ↓' : ' ↑') : ''}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sorted.map((r) => (
            <tr key={r.run_id} data-sel={selected === r.run_id}
              onClick={() => onSelect(r.run_id)}>
              {COLS.map((c) => {
                const v = r[c.k]
                if (c.k === 'run_id') {
                  return (
                    <td key={c.k} className="strong">
                      <span className="dot" style={{
                        background: REGIMES[r.regime].color, display: 'inline-block',
                        marginRight: 7, verticalAlign: 'middle',
                      }} />
                      {v}
                    </td>
                  )
                }
                if (c.k === 'label') {
                  return (
                    <td key={c.k}>
                      <span className="tag" style={{
                        color: CLS_COLOR[v],
                        background: `${CLS_COLOR[v]}1c`,
                        border: `1px solid ${CLS_COLOR[v]}44`,
                      }}>{v}</span>
                    </td>
                  )
                }
                if (typeof v === 'boolean') return <td key={c.k}>{v ? 'yes' : 'no'}</td>
                if (v === null || v === undefined) return <td key={c.k}>--</td>
                return (
                  <td key={c.k} className={c.k === 'delta' ? 'strong' : ''}>
                    {typeof v === 'number' ? fmt(v, c.d) : v}
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
