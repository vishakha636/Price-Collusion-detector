// Coordinated-pricing check for two rival products watched over time.
//
// Input is the tracker's reading history: one row per collection round, with
// both products' prices read in the same round. Output is a plain-English
// verdict plus the evidence behind it.
//
// The three signs are the ones that separate *coordination* from ordinary
// competition. Rivals cutting together proves little -- a site-wide sale does
// that. What competition does NOT produce is (1) rivals raising prices in step,
// (2) answering a price cut by matching it rather than beating it, and (3) a
// price gap that stays frozen while both prices move.
//
// Deliberately no machine-learning model here: the classifier in this project
// was trained on simulated bots whose prices change every period, and real
// shop prices sit still for days. Rules a teacher can check by eye are more
// honest than a score from a model applied outside its training data.

const DAY = 24 * 3600 * 1000

export const NEED = {
  days: 14,          // minimum span of history before any verdict
  changes: 3,        // minimum number of price changes (either product)
  windowDays: 2,     // a "response" must come within this many days
  matchPts: 2,       // a cut is "matched" if within 2 percentage points
  gapCv: 0.02,       // gap "frozen" if the price ratio varies < 2%
}

const pctChange = (a, b) => ((b - a) / a) * 100

/** Collapse rounds to price-change events per product. */
export function changeEvents(rounds, side) {
  const ev = []
  let prev = null
  for (const r of rounds) {
    const p = r[side]
    if (p == null) continue
    if (prev != null && Math.abs(p - prev.p) > 1e-9) {
      ev.push({ t: r.t, from: prev.p, to: p, pct: pctChange(prev.p, p) })
    }
    prev = { p, t: r.t }
  }
  return ev
}

/**
 * For each event of `lead`, find a same-direction event of `follow` within the
 * window. An event that is itself a reply to the rival (rival moved the same
 * way shortly before) is not counted as a new lead -- otherwise every matched
 * pair would also show up as one unanswered move.
 */
function responses(lead, follow, dir, windowDays, skipTies = false) {
  const out = []
  const w = windowDays * DAY
  for (const e of lead) {
    if (Math.sign(e.pct) !== dir) continue
    // skipTies: on the second (reverse) pass, a same-moment move by both was
    // already counted once from the other side.
    const isReply = follow.some((f) => Math.sign(f.pct) === dir && (skipTies ? f.t <= e.t : f.t < e.t) && e.t - f.t <= w)
    if (isReply) continue
    const reply = follow.find((f) => Math.sign(f.pct) === dir && f.t >= e.t && f.t - e.t <= w)
    out.push({ lead: e, reply })
  }
  return out
}

export function analyzePair(rounds, names = { a: 'Product 1', b: 'Product 2' }, opts = {}) {
  // Announced price lists (e.g. airline surcharge circulars) can use a wider
  // response window than prices scraped daily from a shop.
  const win = opts.windowDays ?? NEED.windowDays
  // opts.keepEvent: drop some moves (e.g. market-wide sale-day moves) from the
  // response checks; all moves still count for data sufficiency and the gap check
  const keep = opts.keepEvent || (() => true)
  const rs = rounds
    .filter((r) => r.a != null || r.b != null)
    .map((r) => ({ ...r, t: typeof r.t === 'number' ? r.t : Date.parse(r.t) }))
    .sort((x, y) => x.t - y.t)
  const both = rs.filter((r) => r.a != null && r.b != null)

  const span = rs.length > 1 ? (rs[rs.length - 1].t - rs[0].t) / DAY : 0
  const evA = changeEvents(rs, 'a')
  const evB = changeEvents(rs, 'b')
  const nChanges = evA.length + evB.length

  const progress = {
    days: Math.floor(span), needDays: NEED.days,
    changes: nChanges, needChanges: NEED.changes, readings: rs.length,
  }

  if (span < NEED.days || nChanges < NEED.changes) {
    const waitingFor = []
    if (span < NEED.days) waitingFor.push(`${Math.ceil(NEED.days - span)} more day${NEED.days - span > 1 ? 's' : ''} of prices`)
    if (nChanges < NEED.changes) waitingFor.push(`${NEED.changes - nChanges} more price change${NEED.changes - nChanges > 1 ? 's' : ''}`)
    return {
      status: 'collecting', level: 'collecting', progress, signs: [],
      summary: `Still collecting. Needs ${waitingFor.join(' and ')} before it can say anything fair.`,
      events: { a: evA, b: evB },
    }
  }

  const signs = []
  const add = (id, strong, title, detail, why) => signs.push({ id, strong, title, detail, why })

  // 1. price rises answered by a rise from the rival
  const kA = evA.filter(keep), kB = evB.filter(keep)
  const ups = [...responses(kA, kB, 1, win), ...responses(kB, kA, 1, win, true)]
  const upsMatched = ups.filter((x) => x.reply)
  if (ups.length >= 2) {
    const share = upsMatched.length / ups.length
    add('rise_together', share >= 0.6,
      'They raise prices together',
      `${upsMatched.length} of ${ups.length} price rises were followed by the other one also raising its price within ${win} days.`,
      'In a competitive market, if one brand gets more expensive, the rival gains customers by staying put. Following the rise up gives that advantage away.')
  }

  // 2. price cuts answered by matching (not beating) the cut
  const cuts = [...responses(kA, kB, -1, win), ...responses(kB, kA, -1, win, true)]
  const answered = cuts.filter((x) => x.reply)
  if (answered.length >= 2) {
    const matched = answered.filter((x) => Math.abs(x.reply.pct - x.lead.pct) <= NEED.matchPts)
    const beaten = answered.filter((x) => x.reply.pct < x.lead.pct - NEED.matchPts)
    add('match_not_beat', matched.length / answered.length >= 0.6 && beaten.length === 0,
      'They match each other’s cuts, but never beat them',
      `When one brand cut its price and the other responded, the response was the same size ${matched.length} of ${answered.length} times` +
        (beaten.length ? ` and a bigger cut ${beaten.length} time${beaten.length > 1 ? 's' : ''}.` : ', and it was never a bigger cut.'),
      'A rival that wants customers undercuts. Matching exactly says "I will not let you gain, but I will not start a price war either".')
  }

  // 3. frozen price gap while both prices move
  // Measured only on settled readings (no change by either in the response
  // window), so a one-day lag while the follower catches up does not count.
  const allEv = [...evA, ...evB]
  const settled = both.filter((r) => !allEv.some((e) => e.t <= r.t && r.t - e.t < win * DAY))
  // the gap must have held while BOTH prices actually moved: the settled readings
  // need at least two different prices for each product, not one flat stretch
  const levels = (k) => new Set(settled.map((r) => r[k])).size
  if (settled.length >= 5 && levels('a') >= 2 && levels('b') >= 2) {
    const ratios = settled.map((r) => r.b / r.a)
    const m = ratios.reduce((s, x) => s + x, 0) / ratios.length
    const cv = Math.sqrt(ratios.reduce((s, x) => s + (x - m) ** 2, 0) / ratios.length) / m
    const same = cv < 0.001 && Math.abs(m - 1) < 0.005
    add('frozen_gap', cv < NEED.gapCv,
      same ? 'They charge exactly the same price' : 'The gap between their prices hardly moves',
      same
        ? `Both prices changed, and once each change had settled the two were identical every time.`
        : `Both prices changed, yet ${names.b} stayed about ${m >= 1 ? (m * 100 - 100).toFixed(0) + '% above' : (100 - m * 100).toFixed(0) + '% below'} ${names.a} the whole time (variation ${(cv * 100).toFixed(1)}%).`,
      'Independent sellers react to their own costs and stock, so the gap between them drifts. A gap that stays fixed looks like a shared rule.')
  }

  const strong = signs.filter((s) => s.strong)
  const level = strong.length >= 2 ? 'red' : strong.length === 1 ? 'amber' : 'green'
  const summary = {
    red: `Strong signs of coordinated pricing between ${names.a} and ${names.b}.`,
    amber: `One sign of coordinated pricing. Worth watching longer.`,
    green: `Prices look independent. No sign of coordination so far.`,
  }[level]

  return { status: 'ready', level, progress, signs, summary, events: { a: evA, b: evB } }
}
