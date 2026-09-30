import { FEATURE_INFO, fmt } from '../lib/stats'

const scoreColor = (auc) =>
  auc >= 0.9 ? '#12a150' : auc >= 0.75 ? '#e07b00' : '#d92d20'

function ScoreRow({ label, note, scores }) {
  return (
    <div style={{
      display: 'grid', gridTemplateColumns: '1fr auto auto', gap: 14,
      alignItems: 'baseline', padding: '10px 0',
      borderBottom: '1px solid var(--line-soft)',
    }}>
      <div>
        <div style={{ fontSize: 13, fontWeight: 500 }}>{label}</div>
        {note && (
          <div style={{ color: 'var(--text-faint)', fontSize: 11.5, marginTop: 2 }}>
            {note}
          </div>
        )}
      </div>
      {['logistic', 'grad_boost'].map((m) => (
        <div key={m} style={{ textAlign: 'right', minWidth: 92 }}>
          <div style={{
            font: '600 15px var(--mono)', color: scoreColor(scores[m]?.auc ?? 0),
          }}>
            {fmt(scores[m]?.auc, 3)}
          </div>
          <div style={{ color: 'var(--text-faint)', fontSize: 10.5, fontFamily: 'var(--mono)' }}>
            {m === 'logistic' ? 'logistic' : 'boosted'}
          </div>
        </div>
      ))}
    </div>
  )
}

/**
 * Baseline detector results. Deliberately includes the evaluation that fails --
 * a dataset paper that only reports its best split is not evidence of anything.
 */
export default function ModelReport({ report }) {
  if (!report) {
    return (
      <div className="panel" style={{ color: 'var(--text-dim)' }}>
        No model report found. Generate it with{' '}
        <code>python -m sim.train_baseline</code>.
      </div>
    )
  }

  const imp = report.permutation_importance ?? []
  const maxImp = Math.max(...imp.map((d) => Math.abs(d.mean)), 1e-9)
  const top = imp.slice(0, 8)

  return (
    <>
      <div className="grid-2">
        <div className="panel">
          <div style={{ fontWeight: 600, marginBottom: 3 }}>Can the labels be recovered?</div>
          <div style={{ color: 'var(--text-dim)', fontSize: 12.5, marginBottom: 10 }}>
            ROC AUC. Two model families, dynamics-only features unless stated.
          </div>

          <ScoreRow label="All 200 markets" note="stratified 5-fold CV"
            scores={report.in_distribution?.dynamics_only ?? {}} />
          <ScoreRow label="Myopic vs patient Q-learners only"
            note="hardest split — price level deliberately confounded"
            scores={report.q_only ?? {}} />
          <ScoreRow label="All markets, including the flagged level proxy"
            note="for comparison only — not a deployable number"
            scores={report.in_distribution?.with_level_proxy ?? {}} />

          <p className="note">
            <b>Reference point.</b> The measure the economics literature uses —
            price relative to Nash — scores AUC{' '}
            {fmt(report.level_benchmark_auc, 3)} on this dataset. It is also
            impossible to compute without knowing marginal cost. Reaching{' '}
            {fmt(report.in_distribution?.dynamics_only?.logistic?.auc, 3)} from price
            dynamics alone is the point of the exercise.
          </p>
        </div>

        <div className="panel">
          <div style={{ fontWeight: 600, marginBottom: 3 }}>
            Does it transfer across mechanisms?
          </div>
          <div style={{ color: 'var(--text-dim)', fontSize: 12.5, marginBottom: 10 }}>
            Train on one pair of generating mechanisms, test on the other. This is
            the number that predicts behaviour on real data.
          </div>

          <ScoreRow label="Train Q-learning → test rule-based"
            note="80 rule-based markets held out entirely"
            scores={report.transfer?.q_to_rule ?? {}} />
          <ScoreRow label="Train rule-based → test Q-learning"
            note="120 Q-learning markets held out entirely"
            scores={report.transfer?.rule_to_q ?? {}} />

          <p className="note" style={{ borderLeftColor: 'var(--danger)', background: '#fdecea' }}>
            <b>Negative result, reported as found.</b> Training on the rule-based
            controls and testing on the learned markets collapses to AUC{' '}
            {fmt(report.transfer?.rule_to_q?.logistic?.auc, 3)} — at or below chance.
            A hand-written grim-trigger cartel and an autonomously learned one do
            <b> not</b> share a signature: the scripted cartel is identifiable mainly
            because both sellers post identical prices, which is not how the
            Q-learners sustain their supra-competitive outcome. The reverse direction
            works far better. Stage 2 therefore has to train on learned collusion and
            widen the mechanism pool — not assume one cartel model covers the others.
          </p>
        </div>
      </div>

      <div className="panel">
        <div style={{ fontWeight: 600, marginBottom: 3 }}>
          What the boosted model actually uses
        </div>
        <div style={{ color: 'var(--text-dim)', fontSize: 12.5, marginBottom: 14 }}>
          Permutation importance (drop in AUC when a feature is shuffled), 30 repeats.
        </div>
        {top.map((d) => {
          const [name] = FEATURE_INFO[d.feature] ?? [d.feature]
          return (
            <div key={d.feature} style={{
              display: 'grid', gridTemplateColumns: '220px 1fr 76px',
              gap: 12, alignItems: 'center', marginBottom: 7,
            }}>
              <div style={{ fontSize: 12.5, color: 'var(--text-dim)', textAlign: 'right' }}>
                {name}
              </div>
              <div style={{ background: '#eef2f7', borderRadius: 3, height: 13 }}>
                <div style={{
                  width: `${Math.max((Math.abs(d.mean) / maxImp) * 100, 0.6)}%`,
                  height: '100%', borderRadius: 3, background: '#0c56a8', opacity: 0.8,
                }} />
              </div>
              <div style={{
                font: '500 11.5px var(--mono)', color: 'var(--text-faint)', textAlign: 'right',
              }}>
                {d.mean >= 0.0005 ? `+${d.mean.toFixed(3)}` : '≈0'}
              </div>
            </div>
          )
        })}
        <p className="note">
          <b>A caveat on this dataset, not a result to celebrate.</b> Importance is
          concentrated almost entirely in the between-seller price gap; shuffling
          any other feature barely moves AUC. That means the boosted model found one
          shortcut that happens to work here, and the remaining features are largely
          redundant given it. The gap between sellers is partly a function of how wide
          the simulated price grid is, so it is the next thing that needs stress-testing
          against grid width and seller count before any of this is pointed at real data.
        </p>
      </div>
    </>
  )
}
