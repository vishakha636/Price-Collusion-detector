// Small statistics helpers. Kept dependency-free so the dashboard stays a
// static build with no analysis backend.

export const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0)

export const std = (xs) => {
  if (xs.length < 2) return 0
  const m = mean(xs)
  return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / (xs.length - 1))
}

export const quantile = (xs, q) => {
  if (!xs.length) return 0
  const s = [...xs].sort((a, b) => a - b)
  const i = (s.length - 1) * q
  const lo = Math.floor(i)
  const hi = Math.ceil(i)
  return lo === hi ? s[lo] : s[lo] + (s[hi] - s[lo]) * (i - lo)
}

/**
 * Area under the ROC curve for one feature separating two groups, computed via
 * the Mann-Whitney U statistic (with tie correction from average ranks).
 *
 * Returned as |AUC - 0.5| * 2 + direction, i.e. `sep` in [0,1] where 0 means
 * the feature carries no signal and 1 means it separates the classes perfectly.
 * Rank-based, so it is immune to the wildly different scales across features.
 */
export const aucSeparation = (pos, neg) => {
  const n1 = pos.length
  const n2 = neg.length
  if (!n1 || !n2) return { auc: 0.5, sep: 0 }
  const all = [
    ...pos.map((v) => ({ v, p: 1 })),
    ...neg.map((v) => ({ v, p: 0 })),
  ].sort((a, b) => a.v - b.v)

  // average ranks within ties
  let i = 0
  const ranks = new Array(all.length)
  while (i < all.length) {
    let j = i
    while (j + 1 < all.length && all[j + 1].v === all[i].v) j++
    const r = (i + j) / 2 + 1
    for (let x = i; x <= j; x++) ranks[x] = r
    i = j + 1
  }
  let rankSumPos = 0
  all.forEach((d, idx) => { if (d.p === 1) rankSumPos += ranks[idx] })
  const u = rankSumPos - (n1 * (n1 + 1)) / 2
  const auc = u / (n1 * n2)
  return { auc, sep: Math.abs(auc - 0.5) * 2 }
}

export const fmt = (x, d = 3) =>
  x === null || x === undefined || Number.isNaN(x) ? '--' : Number(x).toFixed(d)

export const REGIMES = {
  q_myopic: {
    name: 'Myopic Q-learners',
    cls: 'competitive',
    color: '#22d3ee',
    blurb: 'gamma = 0. Only chase this period’s profit.',
  },
  br_noisy: {
    name: 'Noisy best-response',
    cls: 'competitive',
    color: '#60a5fa',
    blurb: 'Rule-based. Static best reply + mistakes.',
  },
  q_patient: {
    name: 'Patient Q-learners',
    cls: 'collusive',
    color: '#fbbf24',
    blurb: 'gamma ≈ 0.95. Value future profit.',
  },
  grim_cartel: {
    name: 'Grim-trigger cartel',
    cls: 'collusive',
    color: '#f87171',
    blurb: 'Rule-based. Explicit cartel + punishment.',
  },
}

export const REGIME_ORDER = ['q_myopic', 'br_noisy', 'q_patient', 'grim_cartel']

export const CLS_COLOR = { competitive: '#22d3ee', collusive: '#fbbf24' }

/**
 * Features that are scale-free but still leak the simulation's construction.
 *
 * `level_over_min` compares the typical price to the cheapest price observed.
 * Because the action grid is built to span exactly [p_Nash, p_monopoly], a
 * collusive run sits at the top of its grid while its trembles reach down to
 * the competitive price -- so the ratio recovers p_monopoly/p_Nash almost by
 * construction and scores AUC 0.99 for the wrong reason. Real scraped prices
 * are not drawn from such a grid, so it is excluded from headline claims and
 * shown flagged rather than dropped silently.
 */
export const LEVEL_SENSITIVE = new Set(['level_over_min'])

// Human-readable names + one-line rationale for every detector feature.
export const FEATURE_INFO = {
  price_corr: ['Price correlation', 'Do the two sellers’ price levels move together?'],
  diff_corr: ['Change correlation', 'Do their period-to-period changes move together?'],
  sync_change_rate: ['Synchronised changes', 'Share of changes where both move in the same period.'],
  rel_gap_mean: ['Mean relative gap', 'Average price gap, scaled by the price level.'],
  rel_gap_max: ['Max relative gap', 'Largest gap seen, scaled by the price level.'],
  gap_zero_frac: ['Exact price matching', 'Fraction of periods with identical prices.'],
  cv_mean: ['Coefficient of variation', 'Volatility relative to level (unit-free).'],
  rel_step_mean: ['Mean relative step', 'Typical size of a price move.'],
  change_freq: ['Change frequency', 'How often a seller repricing at all.'],
  autocorr1: ['Lag-1 autocorrelation', 'How persistent a seller’s own price is.'],
  entropy: ['Price entropy', 'How many distinct price points get used.'],
  state_hhi: ['Joint-state HHI', 'Concentration of (p0,p1) pairs — lock-in to a cycle.'],
  n_states_frac: ['Distinct states', 'Variety of price pairs visited.'],
  retaliation_rate: ['Retaliation rate', 'Does the rival cut back after being undercut?'],
  undercut_frac: ['Undercut frequency', 'How often one seller sits below the other.'],
  rebound_after_low: ['Rebound after low', 'Does price snap back up after cheap spells?'],
  level_over_min: ['Level over floor', 'Typical price vs the cheapest price observed.'],
  level_over_median_gap: ['Interdecile spread', 'P90-P10 spread, scaled by level.'],
  lead_lag_strength: ['Price leadership', 'Does one seller systematically move first?'],
}
