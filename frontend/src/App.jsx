import { useEffect, useState } from 'react'
import DeltaStrip from './components/DeltaStrip'
import ImpulseResponse from './components/ImpulseResponse'
import LearningCurve from './components/LearningCurve'
import PricePath from './components/PricePath'
import { CLS_COLOR, REGIMES, REGIME_ORDER, fmt, mean } from './lib/stats'
import './theme.css'

function Stat({ k, v, n }) {
  return (
    <div className="stat">
      <div className="k">{k}</div>
      <div className="v">{v}</div>
      {n && <div className="n">{n}</div>}
    </div>
  )
}

function Section({ num, title, sub, children }) {
  return (
    <section>
      <h2><span className="num">{num}</span>{title}</h2>
      {sub && <p className="sub">{sub}</p>}
      {children}
    </section>
  )
}

export default function App() {
  const [data, setData] = useState(null)
  const [err, setErr] = useState(null)
  const [sel, setSel] = useState(null)

  useEffect(() => {
    fetch(`${import.meta.env.BASE_URL}dashboard.json`)
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status} loading dashboard.json`)
        return r.json()
      })
      .then((d) => {
        setData(d)
        const patient = d.runs.filter((r) => r.regime === 'q_patient')
        const pick = patient.length
          ? patient.reduce((a, b) => (b.delta > a.delta ? b : a))
          : d.runs[0]
        setSel(pick.run_id)
      })
      .catch((e) => setErr(e.message))
  }, [])

  if (err) {
    return (
      <div className="err">
        {`Could not load the dataset.\n${err}\n\n`}
        {'Generate it first, from the project root:\n  python -m sim.generate_dataset\n'}
        {'then copy data/dashboard.json into frontend/public/.'}
      </div>
    )
  }
  if (!data) return <div className="loading">Loading simulation dataset…</div>

  const { meta, runs } = data
  const run = runs.find((r) => r.run_id === sel) ?? runs[0]

  const byRegime = REGIME_ORDER.map((reg) => ({
    reg, rs: runs.filter((r) => r.regime === reg),
  }))
  const nColl = runs.filter((r) => r.label === 'collusive').length
  const anchors = meta.baseline_anchors
  const qMyopic = byRegime.find((b) => b.reg === 'q_myopic').rs
  const qPatient = byRegime.find((b) => b.reg === 'q_patient').rs

  return (
    <div className="wrap">
      <header className="masthead">
        <div className="eyebrow">Algorithmic collusion · simulation &amp; dataset · stage 1</div>
        <h1>Do pricing bots learn to collude on their own?</h1>
      </header>

      <div className="stats">
        <Stat k="markets simulated" v={meta.n_runs}
          n={`${nColl} collusive · ${meta.n_runs - nColl} competitive`} />
        <Stat k="periods per bot run" v={`${(meta.periods_per_q_run / 1000).toFixed(0)}k`}
          n="trained to policy convergence" />
        <Stat k="mean Δ, patient bots" v={fmt(mean(qPatient.map((r) => r.delta)), 3)}
          n="Calvano et al. (2020) report ≈0.85" />
        <Stat k="mean Δ, myopic bots" v={fmt(mean(qMyopic.map((r) => r.delta)), 3)}
          n="competitive control" />
      </div>

      <Section num="01" title="The two anchors everything is measured against">
        <div className="panel">
          <div className="stats">
            <Stat k="Bertrand-Nash price" v={fmt(anchors.p_nash, 4)}
              n={`per-firm profit ${fmt(anchors.profit_nash, 4)}`} />
            <Stat k="monopoly price" v={fmt(anchors.p_monopoly, 4)}
              n={`per-firm profit ${fmt(anchors.profit_monopoly, 4)}`} />
          </div>
          <p className="note">
            Matching the values reported in Calvano, Calzolari, Denicolò &amp; Pastorello
            (<i>AER</i> 2020).
          </p>
        </div>
      </Section>

      <Section num="02" title="Bots learning to collude, over 600,000 periods">
        <div className="panel">
          <div className="legend">
            {['q_myopic', 'q_patient'].map((reg) => (
              <span className="chip" key={reg}>
                <span className="dot" style={{ background: REGIMES[reg].color }} />
                {REGIMES[reg].name} — {REGIMES[reg].blurb}
              </span>
            ))}
          </div>
          <LearningCurve runs={runs} meta={meta} />
        </div>
      </Section>

      <Section num="03" title="Where every simulated market landed">
        <div className="panel">
          <DeltaStrip runs={runs} selected={sel} onSelect={setSel} />
        </div>
      </Section>

      <Section num="04" title="Inspecting one market">
        <div className="panel" style={{ marginBottom: 20 }}>
          <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
            <select value={sel ?? ''} onChange={(e) => setSel(e.target.value)}>
              {REGIME_ORDER.map((reg) => (
                <optgroup key={reg} label={`${REGIMES[reg].name} (${REGIMES[reg].cls})`}>
                  {runs.filter((r) => r.regime === reg).map((r) => (
                    <option key={r.run_id} value={r.run_id}>
                      {r.run_id} — Δ {fmt(r.delta, 3)}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
            <span className="tag" style={{
              color: CLS_COLOR[run.label], background: `${CLS_COLOR[run.label]}1c`,
              border: `1px solid ${CLS_COLOR[run.label]}44`, padding: '5px 8px',
            }}>{run.label}</span>
            <span className="chip">{REGIMES[run.regime].name}</span>
            <span className="chip">Δ {fmt(run.delta, 3)}</span>
            <span className="chip">price/Nash {fmt(run.price_over_nash, 3)}</span>
            {run.gamma !== null && <span className="chip">γ {fmt(run.gamma, 2)}</span>}
            <span className="chip">grid {run.k} prices</span>
            <span className="chip">tremble {fmt(run.tremble * 100, 1)}%</span>
          </div>
        </div>

        <div className="grid-2">
          <div className="panel">
            <div style={{ fontWeight: 600, marginBottom: 2 }}>Observed price series</div>
            <div style={{ color: 'var(--text-dim)', fontSize: 12.5, marginBottom: 12 }}>
              Frozen policies executing — {meta.plot_tail} of {meta.tail_periods} periods shown.
            </div>
            <PricePath run={run} />
          </div>
          <div className="panel">
            <div style={{ fontWeight: 600, marginBottom: 2 }}>Defection probe</div>
            <div style={{ color: 'var(--text-dim)', fontSize: 12.5, marginBottom: 12 }}>
              Seller A forced to the competitive price at period 0, then both revert to policy.
            </div>
            <ImpulseResponse run={run} />
          </div>
        </div>
      </Section>
    </div>
  )
}
