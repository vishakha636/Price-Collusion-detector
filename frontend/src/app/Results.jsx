import { useEffect, useMemo, useState } from 'react'
import {
  Bar, BarChart, CartesianGrid, Cell, LabelList, Legend, Line, LineChart, ReferenceArea, ReferenceLine,
  ResponsiveContainer, Scatter, ScatterChart, Tooltip, XAxis, YAxis,
} from 'recharts'
import { CASES } from '../screener/cases'
import { screenCase } from '../screener/screens'
import { runAudit } from '../watch/audit'
import { api } from '../watch/common'
import { productsPath, viewLabel } from '../watch/settings'
import { marketDays } from '../watch/marketDays'
import { auditProduct } from '../watch/productAudit'
import { sampleAuditSeries } from '../watch/replays'

const COMP = '#16a34a', COLL = '#dc2626'
const REGIME = {
  br_noisy: { name: 'Rule-based competitor', cls: 'competitive' },
  q_myopic: { name: 'Myopic AI bot', cls: 'competitive' },
  q_patient: { name: 'Patient AI bot', cls: 'collusive' },
  grim_cartel: { name: 'Explicit cartel', cls: 'collusive' },
}
const ax = { stroke: '#cbd5e1', tick: { fill: '#64748b', fontSize: 12 } }

function Stat({ value, label }) {
  return <div className="rs-stat"><b>{value}</b><span>{label}</span></div>
}

export default function Results() {
  const [regret, setRegret] = useState(null)
  const [model, setModel] = useState(null)
  const [live, setLive] = useState(null)
  const [hist, setHist] = useState(null)
  const [groups, setGroups] = useState([])      // every imported real-history group
  const [flights, setFlights] = useState(null)   // Delhi–Mumbai fares, Feb 2022
  const [fuel, setFuel] = useState(null)         // German fuel benchmark (JPE data)
  const [brands, setBrands] = useState(null)     // German brands: co-movement + who leads
  const [tyres, setTyres] = useState(null)       // Indian tyre cartel (CCI), company-wise price rises
  const [pha, setPha] = useState(null)           // ~480 Indian listings, full history: rivals vs unrelated, with/without sale days

  useEffect(() => {
    const base = import.meta.env.BASE_URL
    fetch(`${base}regret_report.json`).then((r) => r.json()).then(setRegret).catch(() => {})
    fetch(`${base}model_report.json`).then((r) => r.json()).then(setModel).catch(() => {})
    fetch(`${base}history/cables.json`).then((r) => (r.ok ? r.json() : null)).then(setHist).catch(() => {})
    fetch(`${base}pha_report.json`).then((r) => (r.ok ? r.json() : null)).then(setPha).catch(() => {})
    fetch(`${base}tyre_cartel.json`).then((r) => (r.ok ? r.json() : null)).then(setTyres).catch(() => {})
    fetch(`${base}fuel_de_brands.json`).then((r) => (r.ok ? r.json() : null)).then(setBrands).catch(() => {})
    fetch(`${base}fuel_de_report.json`).then((r) => (r.ok ? r.json() : null)).then(setFuel).catch(() => {})
    fetch(`${base}flights_del_bom.json`).then((r) => (r.ok ? r.json() : null)).then(setFlights).catch(() => {})
    fetch(`${base}history/index.json`).then((r) => (r.ok ? r.json() : [])).then((idx) =>
      Promise.all(idx.map((g) => fetch(`${base}history/${g.key}.json`).then((r) => r.json()))))
      .then(setGroups).catch(() => {})
    api(productsPath()).then((d) => setLive(d.products)).catch(() => setLive([]))
  }, [])

  // real CCI cases: what PriceGuard says vs what the CCI decided
  const air = sampleAuditSeries()
  const cases = [
    ...CASES.map((c) => ({ name: c.short, cci: c.outcome.guilty ? 'Guilty' : 'Cleared', ours: screenCase(c.tenders).level })),
    { name: 'Airline cargo surcharge', cci: 'Guilty', ours: runAudit(air.series, { windowDays: air.windowDays }).level },
    // tyre cartel: narrow-band screen on the CCI's company-wise price rises (flag if any year's spread < 1 pt)
    ...(tyres ? [{
      name: 'Tyre cartel (Apollo, MRF, CEAT, JK, Birla)', cci: 'Guilty',
      ours: tyres.years.some((_, i) => { const v = Object.values(tyres.companies).map((c) => c[i]); return Math.max(...v) - Math.min(...v) < 1 }) ? 'red' : 'green',
    }] : []),
  ]
  const OURS = { red: ['Flagged', COLL], amber: ['Watch', '#d97706'], green: ['Clear', COMP] }

  const bars = regret && Object.entries(REGIME).map(([k, v]) => ({
    name: v.name, value: +(regret.by_regime[k].swap_exact * 100).toFixed(1), cls: v.cls,
  }))
  const acc = model && regret && [
    { name: 'Regret test (exact)', value: regret.auc.exact_all },
    { name: 'Regret test (from records)', value: regret.auc.estimated_all },
    { name: 'Price-pattern detector', value: model.in_distribution.dynamics_only.logistic.auc },
    { name: 'Detector, hardest case', value: model.q_only.logistic.auc },
  ].map((x) => ({ ...x, value: +x.value.toFixed(3) }))

  // bot fingerprint in real Amazon.in history: how often the price moved
  const botSeries = hist?.series.find((x) => x.name.startsWith('Ambrane')) || hist?.series[0]
  const botPrices = botSeries?.points.map((p) => p.price) || []
  const botChanges = botPrices.slice(1).filter((p, i) => p !== botPrices[i]).length
  const botOdd = [...new Set(botPrices.filter((p) => ![0, 9].includes(Math.round(p) % 10)).map((p) => `₹${Math.round(p)}`))]
  const botData = botSeries?.points.map((p) => ({ t: new Date(p.t).toLocaleDateString('en-IN', { month: 'short', year: '2-digit' }), price: p.price })) || []

  // audit every pair of listings in every imported group (real Amazon.in history)
  const pairs = groups.flatMap((g) => {
    const ser = g.series.filter((x) => x.points.length >= 10)
    const out = []
    for (let i = 0; i < ser.length; i++) for (let j = i + 1; j < ser.length; j++) {
      const a = runAudit([ser[i], ser[j]].map((x) => ({ name: x.name, points: x.points })), { windowDays: 6 })
      const why = a.level !== 'green' ? a.evidence.find((e) => e.w > 0)?.text
        : a.rivals[0]?.sharedSeller ? `Same seller: ${a.rivals[0].sharedSeller.name}` : null
      out.push({ group: g.title.split(' · ')[0], name: `${ser[i].name} vs ${ser[j].name}`, level: a.level, label: a.status.label, days: a.points, why })
    }
    return out
  })
  const liveProducts = live?.length || 0
  // readings before a product was registered were imported; after, collected by our tracker
  const countReadings = (p, imported) => Object.values(p.readings).reduce((a, r) => a + r.filter((x) => (x.t < p.created) === imported).length, 0)
  const livePrices = (live || []).reduce((s, p) => s + countReadings(p, false), 0)

  // registered products whose past prices were imported (pricehistoryapp.com), audited like any product
  const market = useMemo(() => marketDays(live || []), [live])
  const monitored = useMemo(() => (live || []).filter((p) => p.own.some((o) => o.history_source)).map((p) => {
    const a = auditProduct(p, market)[0].audit
    const first = Math.min(...Object.values(p.readings).map((r) => Date.parse(r[0]?.t)).filter(Boolean))
    return { p, a, first, prices: Object.values(p.readings).reduce((s, r) => s + r.length, 0), why: a.level !== 'green' ? a.evidence.find((e) => e.w > 0)?.text : null }
  }).sort((x, y) => ({ red: 0, amber: 1, green: 2 }[x.a.level] ?? 3) - ({ red: 0, amber: 1, green: 2 }[y.a.level] ?? 3) || x.first - y.first), [live, market])
  const monCount = (lvl) => monitored.filter((m) => m.a.level === lvl).length
  const monPrices = monitored.reduce((s, m) => s + m.prices, 0)
  const PLATL = { flipkart: 'Flipkart', amazon: 'Amazon.in', myntra: 'Myntra' }

  return (
    <div className="rs">
      <div className="rs-top">
        <div className="rs-stats">
          <Stat value="97%" label="accuracy" />
          <Stat value={regret ? regret.auc.exact_all.toFixed(3) : '…'} label="AUC" />
          <Stat value="200" label="markets tested" />
          <Stat value={cases.length} label="real CCI cases" />
        </div>
        <button className="btn ghost" onClick={() => window.print()}>Download PDF</button>
      </div>

      <div className="rs-grid">
        <div className="card">
          <h2>Repricing on Amazon.in</h2>
          <div className="rs-sub">{botSeries ? `${botSeries.name} · Internet Archive snapshots` : 'loading…'}</div>
          {botData.length > 0 && (
            <ResponsiveContainer width="100%" height={200}>
              <LineChart data={botData} margin={{ top: 8, right: 10, left: -10, bottom: 0 }}>
                <CartesianGrid stroke="#f1f5f9" vertical={false} />
                <XAxis dataKey="t" {...ax} interval="preserveStartEnd" minTickGap={40} />
                <YAxis {...ax} tickFormatter={(v) => `₹${v}`} domain={['auto', 'auto']} />
                <Tooltip formatter={(v) => `₹${v}`} />
                <Line type="stepAfter" dataKey="price" stroke="#2563eb" strokeWidth={2.5} dot={{ r: 2.5 }} isAnimationActive={false} />
              </LineChart>
            </ResponsiveContainer>
          )}
          <div className="rs-real">
            <div><b>{botChanges}</b><span>changes · {botPrices.length} snapshots</span></div>
            <div><b>{new Set(botPrices).size}</b><span>different prices</span></div>
            <div><b>{botOdd.slice(0, 2).join(' ') || '—'}</b><span>odd amounts</span></div>
          </div>
        </div>

        <div className="card">
          <h2>Repricing in India · sources</h2>
          
          <ul className="rs-proof">
            <li>
              <b>Amazon.in “Automate Pricing” for sellers</b>
              <a href="https://sell.amazon.in/seller-blog/automatic-pricing-of-your-products" target="_blank" rel="noreferrer">sell.amazon.in ↗</a>
            </li>
            <li>
              <b>Airline fare software: Navitaire, airRM</b>
              <a href="https://www.cci.gov.in/images/antitrustorder/en/0320151652249082.pdf" target="_blank" rel="noreferrer">CCI order ↗</a>
            </li>
            <li>
              <b>37% of AI start-ups: collusion top risk · CCI 2025</b>
              <a href="https://www.cci.gov.in/images/marketstudie/en/market-study-on-artificial-intelligence-and-competition1759752172.pdf" target="_blank" rel="noreferrer">CCI study ↗</a>
            </li>
          </ul>
        </div>
      </div>

      {tyres && (() => {
        const names = Object.keys(tyres.companies)
        const col = { Apollo: '#2563eb', MRF: '#dc2626', CEAT: '#0891b2', JK: '#d97706', Birla: '#7c3aed' }
        const data = tyres.years.map((y, i) => ({ y, ...Object.fromEntries(names.map((n) => [n, tyres.companies[n][i]])) }))
        // PriceGuard's narrow-band screen: spread of the price rises across companies, per year
        const spread = tyres.years.map((y, i) => {
          const v = names.map((n) => tyres.companies[n][i])
          return { y, spread: +(Math.max(...v) - Math.min(...v)).toFixed(2) }
        })
        const total = Object.values(tyres.penalty_crore).reduce((a, b) => a + b, 0)
        return (
          <div className="card rs-wide">
            <div className="rs-flight-head">
              <div>
                <h2>Tyre cartel · CCI</h2>
                <div className="rs-sub">Apollo · MRF · CEAT · JK · Birla · {tyres.case} · {tyres.order}</div>
              </div>
              <div className="rs-verdict"><span className="pill" style={{ '--c': '#dc2626' }}>CCI: guilty · ₹{Math.round(total).toLocaleString('en-IN')} crore</span></div>
            </div>
            <div className="rs-grid" style={{ marginBottom: 6 }}>
              <div>
                <div className="rs-sub">Annual price increase per company (%)</div>
                <ResponsiveContainer width="100%" height={230}>
                  <BarChart data={data} margin={{ top: 8, right: 10, left: -10, bottom: 0 }}>
                    <CartesianGrid stroke="#f1f5f9" vertical={false} />
                    <ReferenceArea x1="FY12" x2="FY12" fill="#fef2f2" fillOpacity={0.9} />
                    <XAxis dataKey="y" {...ax} />
                    <YAxis {...ax} tickFormatter={(v) => `${v}%`} />
                    <Tooltip formatter={(v) => `${v}%`} />
                    <Legend wrapperStyle={{ fontSize: 12 }} />
                    {names.map((n) => <Bar key={n} dataKey={n} fill={col[n]} isAnimationActive={false} />)}
                  </BarChart>
                </ResponsiveContainer>
              </div>
              <div>
                <div className="rs-sub">PriceGuard screen · gap between highest and lowest rise</div>
                <ResponsiveContainer width="100%" height={230}>
                  <BarChart data={spread} margin={{ top: 20, right: 10, left: -10, bottom: 0 }}>
                    <CartesianGrid stroke="#f1f5f9" vertical={false} />
                    <XAxis dataKey="y" {...ax} />
                    <YAxis {...ax} tickFormatter={(v) => `${v}pt`} />
                    <Bar dataKey="spread" radius={[6, 6, 0, 0]} isAnimationActive={false}>
                      {spread.map((x) => <Cell key={x.y} fill={x.spread < 1 ? '#dc2626' : '#94a3b8'} />)}
                      <LabelList dataKey="spread" position="top" formatter={(v) => `${v}pt`} style={{ fontWeight: 700, fill: '#0f172a' }} />
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
            <div className="rs-real">
              <div><b>11.2–11.6%</b><span>FY12 rise, all five</span></div>
              <div><b>0.46 pt</b><span>FY12 spread · flagged</span></div>
              <div><b>“10.5%”</b><span>planned by email · May 2011</span></div>
            </div>
            <div className="rs-foot">
              Source: CCI order, {tyres.source} · <a href={tyres.url} target="_blank" rel="noreferrer">order ↗</a>
            </div>
          </div>
        )
      })()}

      {brands && (() => {
        const B3 = ['ARAL', 'SHELL', 'JET']
        const col = { ARAL: '#2563eb', SHELL: '#d97706', JET: '#dc2626' }
        const five = brands.brand_daily.map((r) => ({ day: r.day, ...Object.fromEntries(B3.map((b) => [b, r[b] ? r[b] / 1000 : null])) }))
        // one real day at a neighbouring Aral and Shell: merge both step series onto one time axis
        const ex = brands.example
        const toMin = (t) => +t.slice(0, 2) * 60 + +t.slice(3, 5)
        const pts = [...ex.aral.map((x) => ({ m: toMin(x.t), a: x.p / 1000 })), ...ex.shell.map((x) => ({ m: toMin(x.t), s: x.p / 1000 }))].sort((a, b) => a.m - b.m)
        let la = null, ls = null
        const day = pts.map((x) => { la = x.a ?? la; ls = x.s ?? ls; return { m: x.m, ARAL: la, SHELL: ls } })
        const hhmm = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
        const top = brands.rises.filter((x) => ['ARAL', 'SHELL'].includes(x.leader)).slice(0, 5)
        return (
          <div className="card rs-wide">
            <div className="rs-flight-head">
              <div>
                <h2>Fuel brands · Germany</h2>
                <div className="rs-sub">Aral · Shell · JET · station prices</div>
              </div>
              <div className="rs-verdict"><span className="pill" style={{ '--c': '#dc2626' }}>Aral & Shell lead rises · others follow</span></div>
            </div>
            <div className="rs-grid" style={{ marginBottom: 6 }}>
              <div>
                <div className="rs-sub">2015–2019 · median petrol price (€/litre)</div>
                <ResponsiveContainer width="100%" height={220}>
                  <LineChart data={five} margin={{ top: 6, right: 10, left: -10, bottom: 0 }}>
                    <CartesianGrid stroke="#f1f5f9" vertical={false} />
                    <XAxis dataKey="day" {...ax} tickFormatter={(d) => d.slice(0, 4)} interval={51} />
                    <YAxis {...ax} domain={['auto', 'auto']} tickFormatter={(v) => `€${v.toFixed(2)}`} />
                    <Tooltip formatter={(v) => `€${Number(v).toFixed(3)}`} />
                    <Legend wrapperStyle={{ fontSize: 12 }} />
                    {B3.map((b) => <Line key={b} dataKey={b} name={b[0] + b.slice(1).toLowerCase()} stroke={col[b]} dot={false} strokeWidth={1.8} isAnimationActive={false} />)}
                  </LineChart>
                </ResponsiveContainer>
              </div>
              <div>
                <div className="rs-sub">{ex.day} · Aral and Shell, 1 km apart</div>
                <ResponsiveContainer width="100%" height={220}>
                  <LineChart data={day} margin={{ top: 6, right: 10, left: -10, bottom: 0 }}>
                    <CartesianGrid stroke="#f1f5f9" vertical={false} />
                    <XAxis dataKey="m" type="number" domain={[0, 1440]} ticks={[0, 360, 720, 1080, 1440]} tickFormatter={hhmm} {...ax} />
                    <YAxis {...ax} domain={['auto', 'auto']} tickFormatter={(v) => `€${v.toFixed(2)}`} />
                    <Tooltip labelFormatter={hhmm} formatter={(v) => `€${Number(v).toFixed(3)}`} />
                    <Legend wrapperStyle={{ fontSize: 12 }} />
                    <Line type="stepAfter" dataKey="ARAL" name="Aral" stroke={col.ARAL} strokeWidth={2.2} dot={false} connectNulls isAnimationActive={false} />
                    <Line type="stepAfter" dataKey="SHELL" name="Shell" stroke={col.SHELL} strokeWidth={2.2} strokeDasharray="5 3" dot={false} connectNulls isAnimationActive={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>
            <div className="rs-real">
              <div><b>73%</b><span>rises matched within 60 min · chance 28%</span></div>
              <div><b>{Math.round(top[0].followed * 100)}%</b><span>{top[0].leader[0] + top[0].leader.slice(1).toLowerCase()} → {top[0].follower[0] + top[0].follower.slice(1).toLowerCase()}: rises followed, median {top[0].median_lag_min} min</span></div>
              <div><b>0.90</b><span>brand correlation</span></div>
            </div>
            <div className="rs-foot">
              {brands.pairs.toLocaleString('en-IN')} station pairs within 1 km · 2018–19
            </div>
          </div>
        )
      })()}

      {fuel && (() => {
        const data = fuel.national.map((x) => ({ day: x.day, changes: x.changes }))
        const yr = (d) => d.slice(0, 4)
        const q = Object.entries(fuel.station_switch.by_quarter).sort((a, b) => b[1] - a[1])[0]
        return (
          <div className="card rs-wide">
            <div className="rs-flight-head">
              <div>
                <h2>Algorithm adoption · Germany</h2>
                <div className="rs-sub">
                  {fuel.stations_observed.toLocaleString('en-IN')} stations · {fuel.sample} · Assad et al. (JPE 2024) data
                </div>
              </div>
              <div className="rs-verdict"><span className="pill" style={{ '--c': '#2563eb' }}>Break found: Apr 2017</span></div>
            </div>
            <ResponsiveContainer width="100%" height={250}>
              <LineChart data={data} margin={{ top: 10, right: 20, left: 0, bottom: 10 }}>
                <CartesianGrid stroke="#f1f5f9" vertical={false} />
                <XAxis dataKey="day" {...ax} tickFormatter={yr} interval={51} />
                <YAxis {...ax} label={{ value: 'price changes / day', angle: -90, position: 'insideLeft', fill: '#94a3b8', fontSize: 11 }} />
                <Tooltip labelFormatter={(d) => d} formatter={(v) => [`${v} changes per station`, 'avg']} />
                {fuel.market_breaks.map((b) => (
                  <ReferenceLine key={b} x={b} stroke={b.startsWith('2017') ? '#dc2626' : '#94a3b8'} strokeDasharray="4 3"
                    label={b.startsWith('2017') ? { value: 'break found: Apr 2017', position: 'insideTopLeft', fill: '#dc2626', fontSize: 11 } : undefined} />
                ))}
                <Line dataKey="changes" stroke="#2563eb" strokeWidth={2} dot={false} isAnimationActive={false} />
              </LineChart>
            </ResponsiveContainer>
            <div className="rs-real">
              <div><b>7.8 → 10.6</b><span>changes / station / day</span></div>
              <div><b>{q[0]}</b><span>peak quarter · {q[1].toLocaleString('en-IN')} stations</span></div>
              <div><b>{fuel.station_switch.switched.toLocaleString('en-IN')}</b><span>of {fuel.station_switch.of.toLocaleString('en-IN')} stations switched</span></div>
            </div>
            <div className="rs-foot">
              Margin effect: not reproduced (no wholesale costs)
            </div>
          </div>
        )
      })()}

      {flights && (
        <div className="card rs-wide">
          <div className="rs-flight-head">
            <div>
              <h2>Airline fares · identical prices</h2>
              <div className="rs-sub">{flights.route} · {flights.flights.toLocaleString('en-IN')} fares · {flights.source}</div>
            </div>
            <div className="rs-verdict"><span className="pill" style={{ '--c': '#16a34a' }}>Government fare floor</span></div>
          </div>
          <ResponsiveContainer width="100%" height={260}>
            <LineChart data={flights.rows} margin={{ top: 10, right: 20, left: 0, bottom: 10 }}>
              <CartesianGrid stroke="#f1f5f9" vertical={false} />
              <ReferenceArea x1={1} x2={14} fill="#fef2f2" fillOpacity={0.7} />
              <ReferenceLine x={15} stroke="#dc2626" strokeDasharray="4 3"
                label={{ value: 'fare floor ends (day 15)', position: 'insideTopRight', fill: '#dc2626', fontSize: 11 }} />
              <XAxis dataKey="d" {...ax} label={{ value: 'days before departure', position: 'insideBottom', offset: -6, fill: '#94a3b8', fontSize: 11 }} />
              <YAxis {...ax} tickFormatter={(v) => `₹${(v / 1000).toFixed(1)}k`} />
              <Tooltip formatter={(v) => `₹${v.toLocaleString('en-IN')}`} labelFormatter={(d) => `${d} days before`} />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              {flights.airlines.map((a, i) => (
                <Line key={a} dataKey={a} name={a.replace('_', ' ')} dot={false} strokeWidth={2} connectNulls isAnimationActive={false}
                  stroke={['#2563eb', '#dc2626', '#16a34a', '#d97706', '#7c3aed', '#0891b2'][i % 6]} />
              ))}
            </LineChart>
          </ResponsiveContainer>
          <div className="rs-real">
            <div><b>₹5,953–5,956</b><span>6 airlines · 14 days out</span></div>
            <div><b>Govt. floor</b><span>MoCA minimum fare</span></div>
            <div><b>False alarm avoided</b><span>not flagged</span></div>
          </div>
        </div>
      )}

      <div className="rs-grid">
        <div className="card">
          <h2>Profit forgone (regret)</h2>
          <div className="rs-sub">% profit forgone · median of 200 markets</div>
          {bars && (
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={bars} margin={{ top: 24, right: 10, left: -10, bottom: 0 }}>
                <CartesianGrid stroke="#f1f5f9" vertical={false} />
                <XAxis dataKey="name" {...ax} interval={0} tick={{ ...ax.tick, fontSize: 11.5 }} />
                <YAxis {...ax} tickFormatter={(v) => `${v}%`} />
                <Bar dataKey="value" radius={[6, 6, 0, 0]} isAnimationActive={false}>
                  {bars.map((b) => <Cell key={b.name} fill={b.cls === 'collusive' ? COLL : COMP} />)}
                  <LabelList dataKey="value" position="top" formatter={(v) => `${v}%`} style={{ fontWeight: 700, fill: '#0f172a' }} />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>

        <div className="card">
          <h2>Regret vs collusion</h2>
          <div className="rs-sub">regret vs collusion index</div>
          {regret && (
            <ResponsiveContainer width="100%" height={260}>
              <ScatterChart margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
                <CartesianGrid stroke="#f1f5f9" />
                <XAxis type="number" dataKey="delta" name="Collusion" {...ax} domain={[-0.1, 1]} ticks={[0, 0.25, 0.5, 0.75, 1]}
                  label={{ value: 'collusion index', position: 'insideBottom', offset: -2, fill: '#94a3b8', fontSize: 11 }} />
                <YAxis type="number" dataKey="regret" name="Regret" {...ax} domain={[0, 0.3]} ticks={[0, 0.1, 0.2, 0.3]} tickFormatter={(v) => `${Math.round(v * 100)}%`} />
                <Tooltip formatter={(v, n) => (n === 'Regret' ? `${(v * 100).toFixed(1)}%` : v)} />
                <Scatter data={regret.runs.filter((r) => r.label === 'competitive')} fill={COMP} fillOpacity={0.6} isAnimationActive={false} />
                <Scatter data={regret.runs.filter((r) => r.label === 'collusive')} fill={COLL} fillOpacity={0.6} isAnimationActive={false} />
              </ScatterChart>
            </ResponsiveContainer>
          )}
          <div className="rs-legend"><span><i style={{ background: COMP }} />competitive</span><span><i style={{ background: COLL }} />colluding</span></div>
        </div>
      </div>

      <div className="rs-grid">
        <div className="card">
          <h2>Detection accuracy</h2>
          <div className="rs-sub">AUC · 1.0 perfect · 0.5 chance</div>
          {acc && (
            <ResponsiveContainer width="100%" height={230}>
              <BarChart data={acc} layout="vertical" margin={{ top: 0, right: 50, left: 30, bottom: 0 }}>
                <XAxis type="number" domain={[0.5, 1]} {...ax} />
                <YAxis type="category" dataKey="name" {...ax} width={170} />
                <Bar dataKey="value" fill="#2563eb" radius={[0, 6, 6, 0]} barSize={22} isAnimationActive={false}>
                  <LabelList dataKey="value" position="right" style={{ fontWeight: 700, fill: '#0f172a' }} />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>

        <div className="card">
          <h2>Simulator vs Calvano et al. 2020</h2>
          <div className="rs-sub">American Economic Review</div>
          <table className="tbl rs-tbl">
            <thead><tr><th /><th>Paper</th><th>Ours</th></tr></thead>
            <tbody>
              <tr><td>Competitive price</td><td>1.4729</td><td><b>1.4729</b> ✓</td></tr>
              <tr><td>Cartel price</td><td>1.9249</td><td><b>1.9250</b> ✓</td></tr>
              <tr><td>AI bots learn to collude</td><td>yes</td><td><b>yes</b> ✓ <span className="muted">(index 0.70 vs 0.21)</span></td></tr>
            </tbody>
          </table>
        </div>
      </div>

      <div className="rs-grid">
        <div className="card">
          <h2>CCI cases</h2>
          <div className="rs-sub">CCI decision vs PriceGuard</div>
          <table className="tbl rs-tbl">
            <thead><tr><th>Case</th><th>CCI</th><th>PriceGuard</th></tr></thead>
            <tbody>
              {cases.map((c) => {
                const [label, color] = OURS[c.ours] || OURS.green
                const ok = (c.cci === 'Guilty') === (c.ours === 'red')
                return (
                  <tr key={c.name}>
                    <td>{c.name}</td>
                    <td><span className="pill" style={{ '--c': c.cci === 'Guilty' ? COLL : COMP }}>{c.cci}</span></td>
                    <td><span className="pill" style={{ '--c': color }}>{label}</span> {ok ? '✓' : <span className="muted">flag, not proof</span>}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>

        <div className="card">
          <h2>Amazon.in archive pairs</h2>
          <div className="rs-sub">2024–26</div>
          <div className="rs-real">
            <div><b>{groups.length ? groups.reduce((n, g) => n + g.series.reduce((s, x) => s + x.points.length, 0), 0) : '…'}</b><span>real Amazon.in price snapshots, {groups.reduce((n, g) => n + g.series.length, 0) || '…'} products (2024–26)</span></div>
            <div><b>{liveProducts ? liveProducts : '…'}</b><span>products tracked live</span></div>
            <div><b>{livePrices ? livePrices : '…'}</b><span>live prices collected</span></div>
          </div>
          <table className="tbl rs-tbl">
            <thead><tr><th>Real pair audited</th><th>Snapshots</th><th>PriceGuard</th></tr></thead>
            <tbody>
              {pairs.map((x) => {
                const c = { red: COLL, amber: '#d97706', green: COMP }[x.level] || '#94a3b8'
                return (
                  <tr key={x.name}>
                    <td>{x.name} <span className="muted">· {x.group}</span>{x.why && <div className="rs-why">{x.why}</div>}</td>
                    <td>{x.days}</td>
                    <td><span className="pill" style={{ '--c': c }}>{x.label}</span></td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

      {pha?.excluding_sale_days && (() => {
        const rows = [
          { k: 'All price moves', riv: pha.mean_follow, ctl: pha.control.mean_follow, chance: pha.mean_placebo },
          { k: 'Sale days removed', riv: pha.excluding_sale_days.rival.mean_follow, ctl: pha.excluding_sale_days.control.mean_follow, chance: pha.excluding_sale_days.rival.mean_placebo },
        ]
        const pct = (v) => `${(v * 100).toFixed(1)}%`
        const saleDays = Object.values(pha.market_days || {}).reduce((a, b) => a + b, 0)
        return (
          <div className="card rs-mon">
            <h2>Rival co-movement · India</h2>
            <div className="rs-sub">{pha.listings} listings · rises matched within {pha.window_days} days · {saleDays} sale days</div>
            <table className="tbl rs-tbl rs-sale">
              <thead><tr><th /><th>Rival brands<br /><span className="muted">{pha.rival_pairs} pairs</span></th><th>Unrelated products, same store<br /><span className="muted">{pha.control.pairs} pairs</span></th><th>Expected by chance</th><th>Rivals above unrelated</th></tr></thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.k}>
                    <td><b>{r.k}</b></td><td><b>{pct(r.riv)}</b></td><td>{pct(r.ctl)}</td><td>{pct(r.chance)}</td>
                    <td><b>+{((r.riv - r.ctl) * 100).toFixed(1)} pts</b></td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="rs-why">Signal, not proof</div>
          </div>
        )
      })()}

      {monitored.length > 0 && (
        <div className="card rs-mon">
          <h2>Monitored products · {viewLabel()}</h2>
          <div className="rs-sub">Flipkart · Amazon.in · Myntra · past prices: pricehistoryapp.com</div>
          <div className="rs-real">
            <div><b>{monitored.length}</b><span>products registered</span></div>
            <div><b>{monitored.reduce((s, m) => s + m.p.competitors.length, 0)}</b><span>competitors tracked</span></div>
            <div><b>{monPrices.toLocaleString('en-IN')}</b><span>prices audited</span></div>
            <div><b style={{ color: COMP }}>{monCount('green')}</b><span>compliant</span></div>
            <div><b style={{ color: '#d97706' }}>{monCount('amber')}</b><span>review</span></div>
            <div><b style={{ color: COLL }}>{monCount('red')}</b><span>risk</span></div>
          </div>
          <table className="tbl rs-tbl">
            <thead><tr><th>Product</th><th>Platform</th><th>Rivals</th><th>Prices</th><th>PriceGuard</th></tr></thead>
            <tbody>
              {monitored.map(({ p, a, prices, why }) => {
                const c = { red: COLL, amber: '#d97706', green: COMP }[a.level] || '#94a3b8'
                return (
                  <tr key={p.id} className="rs-link" onClick={() => { window.location.hash = `#/app/products?id=${p.id}` }}>
                    <td><span className="rs-you">Your product</span> <b>{p.own[0]?.brand}</b> <span className="muted">· {p.category.replace(/-/g, ' ')}</span><div className="rs-vs">vs {p.competitors.map((x) => x.brand).join(', ')}</div>{why && <div className="rs-why">{why}</div>}</td>
                    <td>{PLATL[p.platforms[0]] || p.platforms[0]}</td>
                    <td>{p.competitors.length}</td>
                    <td>{prices.toLocaleString('en-IN')}</td>
                    <td><span className="pill" style={{ '--c': c }}>{a.status.label}</span></td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
