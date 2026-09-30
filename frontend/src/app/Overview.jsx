import { useEffect, useState } from 'react'
import { api } from '../watch/common'
import { productsPath, viewLabel } from '../watch/settings'
import { IconAlert, IconBox, IconPlus, IconPulse, IconUsers } from './icons'

const BADGE = {
  risk: { label: 'Risk', color: '#dc2626' },
  review: { label: 'Review', color: '#d97706' },
  compliant: { label: 'Compliant', color: '#16a34a' },
  not_checked: { label: 'Collecting', color: '#94a3b8' },
}
const PLAT = { flipkart: 'Flipkart', myntra: 'Myntra', amazon: 'Amazon.in' }
const ago = (t) => {
  if (!t) return '—'
  const s = (Date.now() - Date.parse(t)) / 1000
  return s < 90 ? 'Just now' : s < 3600 ? `${Math.round(s / 60)} min ago` : s < 86400 ? `${Math.round(s / 3600)} h ago` : `${Math.round(s / 86400)} d ago`
}

export default function Overview({ onAlerts }) {
  const [list, setList] = useState(null)
  const [down, setDown] = useState(false)

  useEffect(() => {
    const load = () => api(productsPath()).then((d) => {
      setList(d.products); setDown(false)
      onAlerts?.(d.products.filter((p) => p.status === 'risk').length)
    }).catch(() => setDown(true))
    load()
    const id = setInterval(load, 60000)
    return () => clearInterval(id)
  }, [onAlerts])

  const products = list || []
  const comps = products.reduce((s, p) => s + p.competitors.length, 0)
  const prices = products.reduce((s, p) => s + Object.values(p.readings).reduce((a, r) => a + r.length, 0), 0)
  const alerts = products.filter((p) => p.status === 'risk' || p.status === 'review').length

  const KPIS = [
    { label: 'Products monitored', value: products.length, icon: IconBox },
    { label: 'Competitors tracked', value: comps, icon: IconUsers },
    { label: `Prices · ${viewLabel()}`, value: prices.toLocaleString('en-IN'), icon: IconPulse },
    { label: 'Alerts', value: alerts, icon: IconAlert, warn: alerts > 0 },
  ]

  return (
    <>
      {down && <div className="banner bad">Tracker offline — run <code>python -m tracker.server</code></div>}
      <div className="kpis">
        {KPIS.map(({ label, value, icon: Icon, warn }) => (
          <div className={`kpi${warn ? ' warn' : ''}`} key={label}>
            <div className="kpi-icon"><Icon /></div>
            <div><span>{label}</span><b>{list ? value : '…'}</b></div>
          </div>
        ))}
      </div>

      <div className="card">
        <div className="card-head">
          <h2>Products</h2>
          <a className="btn sm" href="#/app/products?new=1"><IconPlus size={16} /> Add product</a>
        </div>
        {list && products.length === 0 ? (
          <div className="empty">
            <IconBox size={36} />
            <p>No products yet</p>
            <a className="btn" href="#/app/products?new=1">Add your first product</a>
          </div>
        ) : (
          <table className="tbl">
            <thead><tr><th>Product</th><th>Platforms</th><th>Competitors</th><th>Status</th><th>Last checked</th></tr></thead>
            <tbody>
              {products.map((p) => {
                const b = BADGE[p.status] || BADGE.not_checked
                return (
                  <tr key={p.id} onClick={() => { window.location.hash = `#/app/products?id=${p.id}` }}>
                    <td><b>{p.name}</b></td>
                    <td>{p.platforms.map((x) => PLAT[x] || x).join(', ')}</td>
                    <td>{p.competitors.length}</td>
                    <td><span className="pill" style={{ '--c': b.color }}>{b.label}</span></td>
                    <td className="muted">{ago(p.last_checked)}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>
    </>
  )
}
