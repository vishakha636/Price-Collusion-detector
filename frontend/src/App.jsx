import { useEffect, useMemo, useState } from 'react'
import DeltaStrip from './components/DeltaStrip'
import FeatureRanking from './components/FeatureRanking'
import FeatureScatter from './components/FeatureScatter'
import ImpulseResponse from './components/ImpulseResponse'
import LearningCurve from './components/LearningCurve'
import ModelReport from './components/ModelReport'
import PricePath from './components/PricePath'
import RealData from './components/RealData'
import RunTable from './components/RunTable'
import {
  CLS_COLOR, FEATURE_INFO, LEVEL_SENSITIVE, REGIMES, REGIME_ORDER,
  aucSeparation, fmt, mean,
} from './lib/stats'
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
  const [report, setReport] = useState(null)
  const [real, setReal] = useState(null)
  const [err, setErr] = useState(null)
  const [sel, setSel] = useState(null)
  const [filter, setFilter] = useState('all')
  const [fx, setFx] = useState('state_hhi')
  const [fy, setFy] = useState('retaliation_rate')

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

    // The model report and real-data payload are optional -- the dashboard is
    // still useful without either.
    fetch(`${import.meta.env.BASE_URL}model_report.json`)
      .then((r) => (r.ok ? r.json() : null))
      .then(setReport)
      .catch(() => setReport(null))

    fetch(`${import.meta.env.BASE_URL}real_data.json`)
      .then((r) => (r.ok ? r.json() : null))
      .then(setReal)
      .catch(() => setReal(null))
  }, [])

  // Every hook must run on every render, so this sits above the early returns
  // and guards on `data` itself rather than being skipped while loading.
  const featStats = useMemo(() => {
    if (!data) return null
    const coll = data.runs.filter((r) => r.label === 'collusive')
    const comp = data.runs.filter((r) => r.label === 'competitive')
    const of = (f) => aucSeparation(coll.map((r) => r[f]), comp.map((r) => r[f]))
    // Headline claims use only features that survive the grid-artefact check.
    const best = data.meta.feature_names
      .filter((f) => !LEVEL_SENSITIVE.has(f))
      .map((f) => ({ f, ...of(f) }))
      .sort((a, b) => b.sep - a.sep)[0]
    return { best, level: of('price_over_nash') }
  }, [data])

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
  const shown = filter === 'all' ? runs : runs.filter((r) => r.label === filter)
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
        <p className="lede">
          Independent reinforcement-learning pricing agents, with no communication and no
          instruction to cooperate, are simulated to the point of convergence. Patient agents
          reliably settle above the competitive price and defend that level by punishing
          defection. This is the <strong>labelled training set</strong> for a collusion
          detector — built by simulation because no ground-truth dataset of algorithmic
          collusion exists anywhere.
        </p>
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
        <Stat k="detector AUC, cost-free" v={fmt(
          report?.in_distribution?.dynamics_only?.logistic?.auc ?? featStats.best.sep, 3)}
          n="5-fold CV · price dynamics only" />
        <Stat k="observed periods / run" v={meta.tail_periods}
          n="post-training, scraped-like" />
      </div>

      <Section num="01" title="The two anchors everything is measured against"
        sub="Both endpoints are solved analytically from the demand model, so every simulated
             market has an exact competitive price and an exact perfect-cartel price. The
             collusion index Δ places a run between them: Δ=0 is Bertrand-Nash, Δ=1 is a
             perfect cartel.">
        <div className="panel">
          <div className="stats">
            <Stat k="Bertrand-Nash price" v={fmt(anchors.p_nash, 4)}
              n={`per-firm profit ${fmt(anchors.profit_nash, 4)}`} />
            <Stat k="monopoly price" v={fmt(anchors.p_monopoly, 4)}
              n={`per-firm profit ${fmt(anchors.profit_monopoly, 4)}`} />
            <Stat k="discrete-grid Nash" v={fmt(meta.discrete_nash, 4)}
              n="closest attainable competitive price" />
            <Stat k="calibration" v="Calvano et al." n="a=2, a₀=0, μ=0.25, c=1, n=2" />
          </div>
          <p className="note">
            <b>Validation.</b> On the published baseline calibration this solver returns
            p_Nash = 1.4729 and p_monopoly = 1.9250, matching the values reported in
            Calvano, Calzolari, Denicolò &amp; Pastorello (<i>AER</i> 2020) to four decimals.
            Individual runs randomise μ and the demand intercept, so each market has its own
            anchors.
          </p>
        </div>
      </Section>

      <Section num="02" title="Bots learning to collude, over 600,000 periods"
        sub="Mean market price during training, normalised by each run's own Nash price and
             averaged within regime. Both groups start from identical random play; the only
             difference is how much they value future profit.">
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
          <p className="note">
            The patient agents are never told to cooperate, never communicate, and cannot see
            each other's profits. They observe only last period's prices. The gap that opens up
            here is learned purely from experience — which is exactly why this behaviour falls
            outside an agreement-based definition of cartel conduct.
          </p>
        </div>
      </Section>

      <Section num="03" title="Where every simulated market landed"
        sub="One dot per market. Click any dot to inspect that run below. Two mechanisms
             generate each label, so a classifier cannot succeed by learning to recognise
             'a Q-learning artefact' instead of collusion.">
        <div className="panel">
          <DeltaStrip runs={runs} selected={sel} onSelect={setSel} />
          <p className="note">
            <b>The finding that shapes the whole detector.</b> Myopic Q-learners do
            <b> not</b> sit at Δ=0 — they average{' '}
            {fmt(mean(qMyopic.map((r) => r.delta)), 2)}, because memory-1 agents converge to
            price <i>cycles</i> rather than to a fixed point (only{' '}
            {fmt(100 * mean(qMyopic.map((r) => (r.state_hhi > 0.9 ? 1 : 0))), 0)}% lock onto a
            single price pair). Competitive bots therefore also price above Nash. Price level
            alone cannot separate the classes — and on real data, where marginal cost is
            unobservable, it is not even measurable. Hence the feature design in section 05.
          </p>
        </div>
      </Section>

      <Section num="04" title="Inspecting one market"
        sub="The left panel is what a regulator scraping this market would see. The right panel
             is an experiment only possible in simulation: force one seller to undercut, then
             watch what the rival does.">
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

      <Section num="05" title="Which cost-free signals actually carry the signal"
        sub="Rank AUC for each feature separating collusive from competitive markets. Every
             feature here is computable from a scraped price series alone — no marginal cost,
             no profits, no equilibrium anchors — because that is the only kind of feature a
             deployed detector could ever use.">
        <div className="panel">
          <div className="tabs">
            {[['all', 'All markets'], ['collusive', 'Collusive only'],
              ['competitive', 'Competitive only']].map(([v, l]) => (
              <button key={v} className="tab" data-on={filter === v}
                onClick={() => setFilter(v)}>{l}</button>
            ))}
            <span style={{ flex: 1 }} />
            <span className="chip">{shown.length} markets in view</span>
          </div>
          <FeatureRanking runs={runs} features={meta.feature_names} />
          <p className="note">
            <b>Why this matters.</b> Price level relative to Nash — the measure the economics
            literature uses — scores AUC {fmt(featStats.level.auc, 3)} here, but it is
            <b> unusable in practice</b> because it needs marginal cost. The best cost-free
            dynamics feature is{' '}
            {(FEATURE_INFO[featStats.best.f] ?? [featStats.best.f])[0].toLowerCase()}, at AUC{' '}
            {fmt(Math.max(featStats.best.auc, 1 - featStats.best.auc), 3)}
            {featStats.best.auc < 0.5 && ' (inverted — colluding sellers stay closer together)'}.
          </p>
          <p className="note" style={{ borderLeftColor: '#8b9bb0', background: '#141a22' }}>
            <b>One feature is flagged and excluded ⚠.</b> <i>Level over floor</i> scores
            AUC 0.99, but only because the simulated price grid is constructed to span
            exactly [Nash, monopoly]: a collusive market sits at the top of its grid while
            its trembles reach down to the competitive price, so the ratio recovers
            p_monopoly/p_Nash almost by definition. Real scraped prices come from no such
            grid. It is greyed out above, excluded from every headline number and from model
            training — kept visible because a discarded feature is part of the method, not an
            embarrassment.
          </p>
        </div>
      </Section>

      <Section num="06" title="Feature space"
        sub="Any two features, one point per market. Colour is the generating mechanism.
             Click a point to load that run into section 04.">
        <div className="grid-2">
          <div className="panel">
            <div style={{ display: 'flex', gap: 8, marginBottom: 14, flexWrap: 'wrap' }}>
              <select value={fx} onChange={(e) => setFx(e.target.value)}>
                {meta.feature_names.map((f) => (
                  <option key={f} value={f}>x: {(FEATURE_INFO[f] ?? [f])[0]}</option>
                ))}
              </select>
              <select value={fy} onChange={(e) => setFy(e.target.value)}>
                {meta.feature_names.map((f) => (
                  <option key={f} value={f}>y: {(FEATURE_INFO[f] ?? [f])[0]}</option>
                ))}
              </select>
            </div>
            <FeatureScatter runs={runs} fx={fx} fy={fy} selected={sel} onSelect={setSel} />
          </div>
          <div className="panel">
            <div style={{ fontWeight: 600, marginBottom: 12 }}>The four generating mechanisms</div>
            {byRegime.map(({ reg, rs }) => (
              <div key={reg} style={{
                borderLeft: `2px solid ${REGIMES[reg].color}`, paddingLeft: 13,
                marginBottom: 16,
              }}>
                <div style={{ fontWeight: 600, fontSize: 13.5 }}>
                  {REGIMES[reg].name}
                  <span className="tag" style={{
                    marginLeft: 8, color: CLS_COLOR[REGIMES[reg].cls],
                    background: `${CLS_COLOR[REGIMES[reg].cls]}1c`,
                    border: `1px solid ${CLS_COLOR[REGIMES[reg].cls]}44`,
                  }}>{REGIMES[reg].cls}</span>
                </div>
                <div style={{ color: 'var(--text-dim)', fontSize: 12.5, marginTop: 3 }}>
                  {meta.regimes[reg]}
                </div>
                <div style={{
                  color: 'var(--text-faint)', fontSize: 11.5, marginTop: 5,
                  fontFamily: 'var(--mono)',
                }}>
                  n={rs.length} · Δ̄ {fmt(mean(rs.map((r) => r.delta)), 3)} · punish̄{' '}
                  {fmt(mean(rs.map((r) => r.punish_depth)), 3)}
                </div>
              </div>
            ))}
            <p className="note" style={{ marginTop: 0 }}>
              The rule-based pair is the control group. If a detector trained only on
              Q-learning runs still flags the grim-trigger cartel and clears the noisy
              best-responders, it has learned collusive <i>dynamics</i> rather than the
              fingerprint of one particular algorithm.
            </p>
          </div>
        </div>
      </Section>

      <Section num="07" title="Does a detector actually work on this dataset?"
        sub="A baseline classifier trained on the cost-free features, evaluated three ways.
             The point of stage 1 is a dataset that supports this test — including the split
             where it fails.">
        <ModelReport report={report} />
      </Section>

      <Section num="08" title="The same features, applied to real Indian price data"
        sub="Scraped fuel-PSU and Amazon.in prices from the collection pipeline
             (github.com/vishakha636/Price-Collusion-detector), pushed through the exact
             feature extractor the model was trained on — and an honest account of what
             five days of data can and cannot support.">
        <RealData real={real} />
      </Section>

      <Section num="09" title="The dataset"
        sub={`${meta.n_runs} markets × ${meta.feature_names.length} cost-free features, plus
              ground-truth labels and economic diagnostics. Click a row to inspect it.`}>
        <div className="panel">
          <RunTable runs={shown} selected={sel} onSelect={setSel} />
          <p className="note">
            Written to <code>data/run_summary.csv</code> (one row per market),{' '}
            <code>data/price_series.csv</code> ({(meta.n_runs * meta.tail_periods).toLocaleString()}{' '}
            observed price observations), and <code>data/dashboard.json</code>.
            Generated {meta.generated_at}.
          </p>
        </div>
      </Section>

      <footer style={{
        marginTop: 44, paddingTop: 20, borderTop: '1px solid var(--line)',
        color: 'var(--text-faint)', fontSize: 12.5,
      }}>
        Stage 1 of 3 — simulation, labelled dataset, and a baseline detector, with the real
        scraped data wired through the same feature extractor. Next: retrain on learned
        collusion only (section 07), fix the all-offers scraping so e-commerce yields
        simultaneous seller pairs, and add SHAP explanations per flagged market.
      </footer>
    </div>
  )
}
