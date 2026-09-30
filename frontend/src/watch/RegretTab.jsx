import { useRef, useState } from 'react'
import { rupees } from './common'
import { REGRET_BENCH, REGRET_CUT, RECORDS_TEMPLATE, parseRecords, regretTest } from './regret'

const LEVEL = {
  independent: { label: 'Independent', color: '#16a34a' },
  review: { label: 'Review', color: '#d97706' },
  risk: { label: 'Risk', color: '#dc2626' },
}
const pct = (x) => `${(x * 100).toFixed(1)}%`

/**
 * Regret test on the company's own records (price, units, cost, rival price).
 * Method validated on 200 simulated markets: see sim/regret.py.
 */
export default function RegretTab() {
  const [res, setRes] = useState(null)
  const [err, setErr] = useState(null)
  const [drag, setDrag] = useState(false)
  const input = useRef()

  const read = async (f) => {
    if (!f) return
    const { rows, error } = parseRecords(await f.text())
    if (error) { setErr(error); setRes(null); return }
    const r = regretTest(rows)
    if (r.level === 'insufficient') { setErr(r.reason ? `Can’t test: ${r.reason}.` : 'Need at least 20 periods.'); setRes(null); return }
    setErr(null); setRes({ ...r, file: f.name })
  }
  const template = () => {
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob([RECORDS_TEMPLATE], { type: 'text/csv' }))
    a.download = 'pricing-records-template.csv'
    a.click()
  }

  const L = res && LEVEL[res.level]
  const scale = 0.2                                   // bar spans 0–20% of profit
  const at = (x) => `${Math.min(100, (x / scale) * 100)}%`

  return (
    <div>
      <div className={`a-drop${drag ? ' on' : ''}`} onClick={() => input.current.click()}
        onDragOver={(e) => { e.preventDefault(); setDrag(true) }} onDragLeave={() => setDrag(false)}
        onDrop={(e) => { e.preventDefault(); setDrag(false); read(e.dataTransfer.files[0]) }}>
        <div className="a-drop-icon">⤓</div>
        <b>Drop your pricing records</b>
        <span>price · units · cost · rival price</span>
        <input ref={input} type="file" accept=".csv,.txt,.tsv" hidden onChange={(e) => read(e.target.files[0])} />
      </div>
      <div className="a-row">
        <button className="a-link" onClick={template}>Template</button>
        <span className="rg-valid">✓ 97% accurate on 200 test markets</span>
      </div>
      {err && <div className="a-err">{err}</div>}

      {res && (
        <div className="rg-result">
          <div className="rg-head">
            <div>
              <div className="rg-k">Profit left on the table</div>
              <div className="rg-v" style={{ color: L.color }}>{pct(res.regret)}</div>
            </div>
            <span className="pill rg-pill" style={{ '--c': L.color }}>{L.label}</span>
          </div>

          <div className="rg-bar">
            <div className="rg-zone ok" style={{ width: at(REGRET_CUT.review) }} />
            <div className="rg-zone mid" style={{ left: at(REGRET_CUT.review), width: `calc(${at(REGRET_CUT.risk)} - ${at(REGRET_CUT.review)})` }} />
            <div className="rg-zone bad" style={{ left: at(REGRET_CUT.risk), right: 0 }} />
            <div className="rg-mark" style={{ left: at(res.regret) }} />
          </div>
          <div className="rg-scale">
            <span style={{ left: at(REGRET_BENCH.competitive) }}>competitive</span>
            <span style={{ left: at(REGRET_BENCH.collusive) }}>colluding</span>
            <span className="end">20%+</span>
          </div>

          <table className="a-table rg-tbl">
            <thead><tr><th>You charged</th><th>Periods</th><th>Better price</th><th>Missed</th></tr></thead>
            <tbody>
              {res.gainByPrice.filter((g) => g.gain > 0.001).slice(0, 4).map((g) => (
                <tr key={g.price}>
                  <td><b>{rupees(g.price)}</b></td>
                  <td>{g.periods}</td>
                  <td>{rupees(g.better)}</td>
                  <td>{pct(g.gain)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="a-muted">{res.periods} periods · {res.pricesUsed} prices · {res.file}</div>
        </div>
      )}
    </div>
  )
}
