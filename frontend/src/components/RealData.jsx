import {
  CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts'
import { axisStyle as axis, chartTooltip } from '../lib/chartStyle'
import { FEATURE_INFO, LEVEL_SENSITIVE, fmt } from '../lib/stats'

const CITY_COLORS = ['#22d3ee', '#a78bfa', '#fbbf24', '#34d399', '#f87171']

const BLOCKER_STYLE = {
  'duplicated series': { c: '#f87171', bg: '#1d1114' },
  'collection design': { c: '#fbbf24', bg: '#1d1710' },
  'series length': { c: '#34d399', bg: '#0f1c17' },
}

function Gate({ n, title, pass, children }) {
  const c = pass ? '#34d399' : 'var(--danger)'
  return (
    <div style={{
      border: `1px solid ${pass ? '#34d39933' : '#f8717133'}`,
      background: pass ? '#0f1c17' : '#1a1114',
      borderRadius: 10, padding: '14px 16px', marginBottom: 12,
    }}>
      <div style={{ display: 'flex', gap: 10, alignItems: 'baseline', marginBottom: 6 }}>
        <span style={{
          font: '600 10px/1 var(--mono)', color: c, border: `1px solid ${c}55`,
          padding: '4px 6px', borderRadius: 4,
        }}>
          GATE {n} · {pass ? 'PASS' : 'FAIL'}
        </span>
        <span style={{ fontWeight: 600, fontSize: 13.5 }}>{title}</span>
      </div>
      <div style={{ color: 'var(--text-dim)', fontSize: 12.5 }}>{children}</div>
    </div>
  )
}

/**
 * The detector's feature extraction applied to the real scraped Indian price
 * data -- and the finding that neither source can yet support it, for two
 * different reasons that need two different fixes.
 */
export default function RealData({ real }) {
  if (!real) {
    return (
      <div className="panel" style={{ color: 'var(--text-dim)' }}>
        No real-data payload found. Clone the scraping repo into <code>external/</code>,
        then run <code>python -m sim.real_data</code>.
      </div>
    )
  }

  const { meta, readiness, markets } = real
  const fuel = markets.filter((m) => m.source === 'fuel_psu')
  const obs = readiness.observed_max_periods

  const dates = fuel.length ? fuel[0].dates : []
  const chart = dates.map((d, i) => {
    const row = { d: d.slice(5) }
    fuel.forEach((m) => { row[m.city] = m.series[m.sellers[0]][i] })
    return row
  })

  return (
    <>
      <div className="stats" style={{ marginBottom: 20 }}>
        <div className="stat">
          <div className="k">scraped observations</div>
          <div className="v">{meta.n_rows}</div>
          <div className="n">{meta.n_dates} daily snapshots</div>
        </div>
        <div className="stat">
          <div className="k">markets inspected</div>
          <div className="v">{readiness.n_markets_inspected}</div>
          <div className="n">≥2 seller labels, same product &amp; city</div>
        </div>
        <div className="stat">
          <div className="k">genuinely comparable</div>
          <div className="v" style={{ color: 'var(--danger)' }}>{readiness.n_markets}</div>
          <div className="n">{readiness.n_markets_degenerate} degenerate</div>
        </div>
        <div className="stat">
          <div className="k">risk scores reported</div>
          <div className="v" style={{ color: 'var(--danger)' }}>0</div>
          <div className="n">deliberately — see below</div>
        </div>
      </div>

      {/* ---- the two gates ---- */}
      <div className="panel">
        <div style={{ fontWeight: 600, marginBottom: 3 }}>
          Two things must be true before the detector can run
        </div>
        <div style={{ color: 'var(--text-dim)', fontSize: 12.5, marginBottom: 14 }}>
          The model compares two sellers priced independently and simultaneously on
          the same product, over a long enough window. Neither condition holds yet.
        </div>

        <Gate n={1} title="A genuine multi-seller panel exists" pass={readiness.n_markets > 0}>
          Of {readiness.n_markets_inspected} candidate markets,{' '}
          <b>{readiness.n_markets}</b> contain two sellers whose prices were
          independently observed. All {readiness.n_markets_degenerate} fuel markets
          are <b>degenerate</b>: the three PSU labels hold copies of a single parsed
          number. E-commerce contributes none, because the Buy Box yields one seller
          per product per day.
        </Gate>

        <Gate n={2} title={`Series reach ${meta.detector_periods} periods`} pass={obs >= meta.detector_periods}>
          The longest observed series is <b>{obs} periods</b> against{' '}
          {meta.trained_on_periods} the model trained on. Even if Gate 1 passed, only{' '}
          <b>{readiness.features_defined_at_observed} of {readiness.features_total}</b>{' '}
          features would be mathematically defined at {obs} periods.
        </Gate>
      </div>

      {/* ---- per-source diagnosis ---- */}
      <div className="panel">
        <div style={{ fontWeight: 600, marginBottom: 3 }}>
          Why each source fails, and what would fix it
        </div>
        <div style={{ color: 'var(--text-dim)', fontSize: 12.5, marginBottom: 14 }}>
          The two sources fail for different reasons and need different remedies.
          Distinguishing them is the useful output of this stage.
        </div>
        {meta.source_diagnostics.map((d) => {
          const st = BLOCKER_STYLE[d.blocker] ?? BLOCKER_STYLE['collection design']
          return (
            <div key={d.source} style={{
              borderLeft: `2px solid ${st.c}`, paddingLeft: 14, marginBottom: 16,
            }}>
              <div style={{ display: 'flex', gap: 9, alignItems: 'baseline', flexWrap: 'wrap' }}>
                <span style={{ fontWeight: 600, fontFamily: 'var(--mono)', fontSize: 13 }}>
                  {d.source}
                </span>
                <span className="tag" style={{
                  color: st.c, background: `${st.c}1c`, border: `1px solid ${st.c}44`,
                }}>
                  blocker: {d.blocker}
                </span>
              </div>
              <div style={{ color: 'var(--text-dim)', fontSize: 12.5, marginTop: 5 }}>
                {d.verdict}
              </div>
              <div style={{
                color: 'var(--text-faint)', fontSize: 11.5, marginTop: 5,
                fontFamily: 'var(--mono)',
              }}>
                {d.n_products} products · {d.n_products_multi_seller} with ≥2 sellers ·
                best same-date overlap {d.max_pair_overlap_days}d ·
                {' '}{d.independent_pairs} independent / {d.duplicate_pairs} duplicate pairs
              </div>
            </div>
          )
        })}

        <p className="note" style={{ borderLeftColor: '#f87171', background: '#1d1114' }}>
          <b>The fuel “finding” is an artefact of data construction, not a market
          observation.</b> In <code>fuel_scraper.py</code> a single city price is read
          off an aggregator page and then written once per PSU label:
          {' '}<code>for seller in FUEL_SELLERS: …"price": price</code>. So IOCL, BPCL
          and HPCL are three copies of one number. Price correlation 1.000 and exact
          price matching 1.000 on those pairs are <i>arithmetic identities</i> — a
          column compared with itself — and would appear no matter what the real
          market did. Any dashboard reporting that as detected collusion between three
          named state-owned companies would be both statistically void and defamatory.
          Collecting more days cannot fix it; the scraper needs a source that lists
          each PSU's price separately.
        </p>
        <p className="note" style={{ borderLeftColor: '#fbbf24', background: '#1d1710' }}>
          <b>E-commerce needs a design change, not more days.</b> On an Amazon product
          page the recorded seller is whoever holds the Buy Box, so each ASIN yields
          exactly one seller per day. Of {meta.by_source.ecommerce_amazon?.products ?? 216}{' '}
          products, 8 ever show a second seller — and those appear on <i>different</i>{' '}
          days, because the Buy Box changed hands, not because two rivals were seen at
          once. Best same-date overlap across all products is 1 day. The fix is to
          scrape the all-offers listing per ASIN (the “Other sellers on Amazon” panel),
          capturing every seller's price in one snapshot.
        </p>
      </div>

      {/* ---- what the real data does show ---- */}
      <div className="panel">
        <div style={{ fontWeight: 600, marginBottom: 3 }}>
          What the fuel data legitimately shows: city-level petrol prices
        </div>
        <div style={{ color: 'var(--text-dim)', fontSize: 12.5, marginBottom: 12 }}>
          One line per city over {meta.n_dates} days. This is real scraped data and the
          city-level movement is meaningful — it is only the <i>per-seller</i> split
          that is duplicated.
        </div>
        <ResponsiveContainer width="100%" height={260}>
          <LineChart data={chart} margin={{ top: 8, right: 16, bottom: 20, left: 4 }}>
            <CartesianGrid stroke="#172230" vertical={false} />
            <XAxis dataKey="d" {...axis}
              label={{ value: 'date (2026)', position: 'insideBottom', offset: -12,
                fill: '#5b6a7d', fontSize: 11, fontFamily: 'var(--mono)' }} />
            <YAxis {...axis} width={56} domain={['dataMin - 0.6', 'dataMax + 0.6']}
              tickFormatter={(v) => `₹${Number(v).toFixed(1)}`} />
            <Tooltip {...chartTooltip} formatter={(v) => `₹${Number(v).toFixed(2)}`} />
            {fuel.map((m, i) => (
              <Line key={m.city} type="monotone" dataKey={m.city} dot={{ r: 3 }}
                stroke={CITY_COLORS[i % CITY_COLORS.length]} strokeWidth={1.8}
                isAnimationActive={false} />
            ))}
          </LineChart>
        </ResponsiveContainer>
        <div className="legend" style={{ marginTop: 12, marginBottom: 0 }}>
          {fuel.map((m, i) => (
            <span className="chip" key={m.city}>
              <span className="dot" style={{ background: CITY_COLORS[i % CITY_COLORS.length] }} />
              {m.city} · ₹{fmt(m.mean_price, 2)} avg
            </span>
          ))}
        </div>

        {meta.data_quality?.map((q) => (
          <p key={q.source} className="note"
            style={{ borderLeftColor: '#fbbf24', background: '#1d1710' }}>
            <b>Second data-quality flag: {q.issue}.</b>{' '}
            {q.groups.map((g) => g.join(', ')).join(' — and — ')} return the same price
            on every observed date, which is why only three distinct lines appear above
            for five cities. {q.detail}. Worth verifying against the aggregator pages
            before the fuel series is used for anything, since only{' '}
            {5 - q.groups.reduce((a, g) => a + g.length - 1, 0)} of 5 cities carry
            independent information.
          </p>
        ))}
      </div>

      {/* ---- feature availability ---- */}
      <div className="panel">
        <div style={{ fontWeight: 600, marginBottom: 3 }}>
          Feature availability at {obs} observed periods
        </div>
        <div style={{ color: 'var(--text-dim)', fontSize: 12.5, marginBottom: 14 }}>
          Structural minimum periods per estimator. Green means the formula is defined
          at {obs} periods — not that the estimate is reliable, which needs{' '}
          {meta.reliable_periods}+.
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {meta.feature_requirements.map((f) => {
            const flagged = LEVEL_SENSITIVE.has(f.feature)
            const on = obs >= f.min_periods && !flagged
            return (
              <span key={f.feature} className="chip" title={
                `${(FEATURE_INFO[f.feature] ?? [f.feature])[0]}\nneeds ${f.min_periods} periods`
                + (flagged ? '\nexcluded: grid artefact' : '')}
                style={{
                  color: flagged ? 'var(--text-faint)' : on ? '#34d399' : 'var(--text-faint)',
                  borderColor: on ? '#34d39944' : 'var(--line)',
                  background: on ? '#34d3990e' : 'var(--panel)',
                  textDecoration: flagged ? 'line-through' : 'none',
                }}>
                {on ? '✓' : '×'} {(FEATURE_INFO[f.feature] ?? [f.feature])[0]}
                <span style={{ color: 'var(--text-faint)', marginLeft: 2 }}>
                  ({f.min_periods}p)
                </span>
              </span>
            )
          })}
        </div>

        <p className="note">
          <b>Where this leaves stage 3.</b> The pipeline itself is sound: real scraped
          prices go in and the same feature vector the model was trained on comes out,
          so nothing structural stands between the simulation and real data. Three
          concrete unblocking steps, in priority order — (1) parse each PSU's price
          separately, or drop the per-seller split and keep fuel purely as a
          city-level series; (2) switch the e-commerce scraper to the all-offers
          listing so rival sellers are captured in one snapshot; (3) run the collector
          for roughly {meta.detector_periods} periods, which is{' '}
          {readiness.days_at_4_scrapes_per_day} days at four snapshots a day. Only
          after (1) and (2) does collecting more data start to buy anything.
        </p>
      </div>
    </>
  )
}
