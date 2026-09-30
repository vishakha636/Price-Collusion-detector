import { useMemo, useState } from 'react'
import { NEED } from './analyze'
import { LIGHT } from './common'
import { marketPairs, scanMarket } from './market'
import PairCard from './PairCard'

/**
 * One watched market: a grid of every pair of top brands. Each cell runs the
 * over-time check on those two brands' prices; click a cell to see why.
 */
export default function MarketCard({ market, onRemove }) {
  const m = useMemo(() => marketPairs(market), [market])
  const latest = useMemo(() => {
    const t = market.rounds[market.rounds.length - 1]
    const products = market.products.filter((p) => p.prices[t] != null).map((p) => ({ ...p, price: p.prices[t] }))
    return products.length ? scanMarket(products) : null
  }, [market])
  const [sel, setSel] = useState(null)
  const cell = sel && m.cells[sel[0]][sel[1]]
  const siteLabel = market.site === 'myntra' ? 'Myntra' : 'Flipkart'
  const pct = Math.min(100, Math.round((100 * m.days) / NEED.days))

  return (
    <div className="panel market">
      <div className="pair-head">
        <div className="who">
          <span className="brand a">“{market.query}”</span>
          <span className="chip">{siteLabel}</span>
          {latest && <span className="chip">risk {latest.risk}/100</span>}
        </div>
        {onRemove && <button className="rm" title="Stop watching" onClick={() => onRemove(market.id)}>×</button>}
      </div>

      <div className="progress" style={{ marginTop: 12 }}>
        <div className="bar"><div style={{ width: `${pct}%` }} /></div>
        <div className="dim">
          Checked {m.rounds} time{m.rounds === 1 ? '' : 's'} over {m.days} day{m.days === 1 ? '' : 's'}.{' '}
          {m.ready
            ? `${m.red} pair${m.red === 1 ? '' : 's'} likely coordinating, ${m.amber} with some signs.`
            : `Each pair gets a verdict after ${NEED.days} days and ${NEED.changes} price changes.`}
        </div>
      </div>

      <div className="matrix-wrap">
        <table className="matrix">
          <thead>
            <tr><th />{m.brands.map((b) => <th key={b.brand} title={b.name}><span>{b.brand}</span></th>)}</tr>
          </thead>
          <tbody>
            {m.brands.map((a, i) => (
              <tr key={a.brand}>
                <th title={a.name}>{a.brand}</th>
                {m.brands.map((b, j) => {
                  const c = m.cells[i][j]
                  if (!c) return <td key={b.brand} className="diag" />
                  const lvl = c.result.level
                  return (
                    <td key={b.brand} data-on={sel && sel[0] === i && sel[1] === j}
                      style={{ '--c': LIGHT[lvl].color }} data-level={lvl}
                      title={`${a.brand} vs ${b.brand}: ${LIGHT[lvl].label}`}
                      onClick={() => setSel([i, j])}>
                      <span />
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
        <div className="matrix-legend">
          {['red', 'amber', 'green', 'collecting'].map((k) => (
            <span key={k}><i style={{ background: LIGHT[k].color }} />{LIGHT[k].label}</span>
          ))}
          <div className="dim" style={{ marginTop: 8 }}>
            Each brand is represented by its longest-tracked product. Click any square.
          </div>
        </div>
      </div>

      {cell && (
        <div style={{ marginTop: 16 }}>
          <PairCard pair={{
            id: `${market.id}-${sel}`, site: siteLabel,
            brand_a: cell.a.brand, brand_b: cell.b.brand, name_a: cell.a.name, name_b: cell.b.name,
            rounds: cell.rounds,
          }} />
        </div>
      )}
    </div>
  )
}
