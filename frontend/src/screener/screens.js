// Automated bid-rigging screens.
//
// Each check below automates a red flag that the CCI already uses by hand --
// either a line from its Diagnostic Toolkit for procurement officers, or a
// pattern the Commission relied on in one of the orders in `cases.js`. The
// `cci` field on every rule says which, so the screener never flags something
// the regulator itself would not recognise.
//
// A red flag is a reason to look closer, not proof. The CCI's own liquid
// chlorine case (Ref. 04/2013) shows identical bids that it did NOT treat as a
// cartel, because nothing else backed them up. The UI says so explicitly.
//
// Pure functions, no React: run directly by `npm test` under plain Node.

export const LEVELS = { red: 3, amber: 2, info: 1, green: 0 }

// Thresholds. Chosen to match the Commission's own reasoning in the orders,
// and kept deliberately simple so they can be explained in one sentence.
export const T = {
  identicalTol: 0.005,     // same to the paisa
  nearPct: 1,              // two bids within 1% of each other
  bandPct: 5,              // every bid within 5% of the lowest
  jumpPct: 20,             // price up 20%+ on the previous tender / benchmark
  coverGapPct: 5,          // winner this far below the rest ...
  coverRatio: 2,           // ... and the gap is 2x wider than the losers' own spread
  persistentShare: 0.6,    // narrow band in 60%+ of tenders
  togetherShare: 0.6,      // all bidders moved the same way in 60%+ of transitions
  minTransitions: 3,
  lastRun: 4,              // highest bidder this many tenders in a row
}

export const RULES = {
  identical: {
    title: 'Identical bids',
    cci: 'CCI Toolkit p.61: "Identical quotes up to the last paisa alone is a very strong indicator towards a possible collusion."',
  },
  near_identical: {
    title: 'Nearly identical bids',
    cci: 'CCI Toolkit p.60, clause 4(a): similar quoted prices, especially from bidders with different costs, are "a strong indicator of price fixing".',
  },
  narrow_band: {
    title: 'All bids in a narrow band',
    cci: 'CCI Toolkit p.60–61, clauses 4(a) and 4(c): bidders in different locations with different costs should not land on uniform prices.',
  },
  cover_gap: {
    title: 'Possible cover bids',
    cci: 'CCI Toolkit p.61, clause 4(d): losing bids inflated to make one winner look competitive — "a form of cover bidding".',
  },
  benchmark_jump: {
    title: 'Big jump over the last price',
    cci: 'CCI Toolkit p.60, clause 4(b): "any sudden or identical increase in prices" with no legitimate justification.',
  },
  few_bidders: {
    title: 'Very few bidders',
    cci: 'CCI Toolkit p.31, Planning Q3: past tenders leading to "a single vendor / only a few vendors situation".',
  },
  repeated_identical: {
    title: 'Identical bids, again and again',
    cci: 'Aluminium Phosphide order (Suo Moto 02/2011), para 4.15: identical unrounded prices across many tenders with no explanation.',
  },
  persistent_band: {
    title: 'Narrow band, year after year',
    cci: 'Delhi Jal Board order (Ref. 03/2013), para 155: close bids "year after year cannot be a matter of coincidence".',
  },
  move_together: {
    title: 'Prices rise and fall together',
    cci: 'Delhi Jal Board order (Ref. 03/2013), para 147: bids "converging in a narrow range besides simultaneously increasing".',
  },
  always_last: {
    title: 'A bidder that keeps losing on purpose?',
    cci: 'Delhi Jal Board order (Ref. 03/2013), para 156: GACL came last in five tenders in a row despite the lowest cost — "choosing not to compete".',
  },
  price_jump: {
    title: 'Sudden price jump between tenders',
    cci: 'CCI Toolkit p.60, clause 4(b): "any sudden or identical increase in prices or price range".',
  },
}

const pct = (a, b) => ((a - b) / b) * 100
const worst = (flags) =>
  flags.reduce((w, f) => (LEVELS[f.level] > LEVELS[w] ? f.level : w), 'green')

export function inr(v) {
  const n = Number(v)
  const hasPaise = Math.abs(n - Math.round(n)) > 1e-9
  return '₹' + n.toLocaleString('en-IN', {
    minimumFractionDigits: hasPaise ? 2 : 0, maximumFractionDigits: 2,
  })
}
const p1 = (v) => (v > 0 && v < 0.1 ? 'under 0.1%' : `${v.toFixed(1)}%`)

/** Group bidders that quoted the same amount (to the paisa). */
function identicalGroups(bids) {
  const groups = []
  for (const b of bids) {
    const g = groups.find((x) => Math.abs(x.amount - b.amount) < T.identicalTol)
    if (g) g.bidders.push(b.bidder)
    else groups.push({ amount: b.amount, bidders: [b.bidder] })
  }
  return groups.filter((g) => g.bidders.length > 1)
}

function sd(xs) {
  if (xs.length < 2) return 0
  const m = xs.reduce((s, x) => s + x, 0) / xs.length
  return Math.sqrt(xs.reduce((s, x) => s + (x - m) ** 2, 0) / (xs.length - 1))
}

/** Screen one tender: a list of bids, plus an optional benchmark price. */
export function screenTender(tender) {
  const bids = tender.bids.filter((b) => Number.isFinite(b.amount) && b.amount > 0)
  const flags = []
  const add = (id, level, detail) => flags.push({ id, level, title: RULES[id].title, detail, cci: RULES[id].cci })

  if (bids.length === 0) return { level: 'green', flags, stats: null }

  const sorted = [...bids].sort((a, b) => a.amount - b.amount)
  const lo = sorted[0].amount
  const hi = sorted[sorted.length - 1].amount
  const spread = pct(hi, lo)

  if (bids.length <= 2) {
    add('few_bidders', 'info',
      bids.length === 1
        ? 'Only one bid was received, so there was no competition to check.'
        : 'Only two bids were received. With so few bidders, coordinating is easy.')
  }

  // 1. identical
  const groups = identicalGroups(bids)
  for (const g of groups) {
    const all = g.bidders.length === bids.length
    const round = g.amount % 10 === 0
    add('identical', 'red',
      `${all ? 'All ' + bids.length + ' bidders' : g.bidders.join(' and ')} quoted exactly ${inr(g.amount)}` +
      (round ? '.' : ` — not even a round number, which makes coincidence very unlikely.`))
  }

  // 2. nearly identical (pairs within 1%, not already identical)
  if (bids.length >= 2) {
    const near = []
    for (let i = 0; i < sorted.length - 1; i++) {
      const a = sorted[i], b = sorted[i + 1]
      const gap = pct(b.amount, a.amount)
      if (gap > 0 && Math.abs(b.amount - a.amount) >= T.identicalTol && gap <= T.nearPct) {
        near.push(`${a.bidder} and ${b.bidder} are only ${inr(b.amount - a.amount)} apart (${p1(gap)})`)
      }
    }
    if (near.length) add('near_identical', 'amber', near.join('; ') + '.')
  }

  // 3. narrow band (all bids, only meaningful with 3+ bidders and not all identical)
  if (bids.length >= 3 && spread > 0 && spread <= T.bandPct) {
    add('narrow_band', 'amber',
      `All ${bids.length} bids sit within ${p1(spread)} of each other (${inr(lo)} to ${inr(hi)}).`)
  }

  // 4. cover bidding: winner far below a tight cluster of losing bids
  if (bids.length >= 3) {
    const losers = sorted.slice(1).map((b) => b.amount)
    const gap = sorted[1].amount - lo
    const gapPct = pct(sorted[1].amount, lo)
    const loserSpread = sd(losers)
    if (gapPct >= T.coverGapPct && gap > T.coverRatio * loserSpread) {
      add('cover_gap', 'amber',
        `${sorted[0].bidder} won at ${inr(lo)}, ${p1(gapPct)} below the next bid, while the losing bids are ` +
        `bunched together (${inr(losers[0])}–${inr(losers[losers.length - 1])}). Check whether the losers were really trying to win.`)
    }
  }

  // 5. benchmark (last purchase price / estimate)
  const bm = tender.benchmark
  if (bm) {
    const above = bm.value ? pct(lo, bm.value) : bm.pctAbove
    if (above >= T.jumpPct) {
      add('benchmark_jump', 'amber',
        `Even the lowest bid is ${Math.round(above)}% above the ${bm.label || 'benchmark price'}` +
        (bm.value ? ` (${inr(bm.value)}).` : '.'))
    }
  }

  return { level: worst(flags), flags, stats: { n: bids.length, lo, hi, spread, winner: sorted[0].bidder } }
}

/** Screen a series of tenders for the same product: per-tender + patterns. */
export function screenCase(tenders) {
  const ordered = [...tenders].sort((a, b) => String(a.date).localeCompare(String(b.date)))
  const results = ordered.map((t) => ({ tender: t, ...screenTender(t) }))
  const patterns = []
  const add = (id, level, detail) => patterns.push({ id, level, title: RULES[id].title, detail, cci: RULES[id].cci })

  const multi = results.filter((r) => r.stats && r.stats.n >= 2)

  // repeated identical
  const identTenders = results.filter((r) => r.flags.some((f) => f.id === 'identical'))
  if (identTenders.length >= 2) {
    add('repeated_identical', 'red',
      `Identical bids appear in ${identTenders.length} of ${multi.length} tenders ` +
      `(${identTenders.map((r) => r.tender.label || r.tender.id).join(', ')}).`)
  }

  // persistent narrow band (3+ bidder tenders)
  const three = results.filter((r) => r.stats && r.stats.n >= 3)
  if (three.length >= 3) {
    const tight = three.filter((r) => r.stats.spread <= T.bandPct)
    if (tight.length / three.length >= T.persistentShare) {
      add('persistent_band', 'red',
        `In ${tight.length} of ${three.length} tenders, every bid landed within ${T.bandPct}% of the lowest — ` +
        `even though the bidders have different costs and locations.`)
    }
  }

  // move together
  let transitions = 0, together = 0
  for (let i = 1; i < ordered.length; i++) {
    const prev = new Map(ordered[i - 1].bids.map((b) => [b.bidder, b.amount]))
    const common = ordered[i].bids.filter((b) => prev.has(b.bidder))
    if (common.length < 2) continue
    transitions++
    const dirs = common.map((b) => Math.sign(b.amount - prev.get(b.bidder)))
    if (dirs.every((d) => d !== 0 && d === dirs[0])) together++
  }
  if (transitions >= T.minTransitions && together / transitions >= T.togetherShare) {
    add('move_together', 'amber',
      `From one tender to the next, every bidder moved their price in the same direction ` +
      `${together} out of ${transitions} times.`)
  }

  // always last: longest run of being strictly the highest bid (3+ bidder tenders)
  const runs = new Map()
  const best = new Map()
  for (const r of results) {
    if (!r.stats || r.stats.n < 3) continue
    const sorted = [...r.tender.bids].sort((a, b) => b.amount - a.amount)
    const top = sorted[0].amount > sorted[1].amount ? sorted[0].bidder : null
    for (const b of r.tender.bids) {
      const cur = b.bidder === top ? (runs.get(b.bidder) || 0) + 1 : 0
      runs.set(b.bidder, cur)
      if (cur > (best.get(b.bidder)?.n || 0)) best.set(b.bidder, { n: cur, end: r.tender.label || r.tender.id })
    }
  }
  for (const [bidder, { n, end }] of best) {
    if (n >= T.lastRun) {
      add('always_last', 'amber',
        `${bidder} quoted the highest price in ${n} tenders in a row (up to ${end}) but kept on bidding.`)
    }
  }

  // price jumps in the winning bid between consecutive tenders
  const jumps = []
  for (let i = 1; i < multi.length; i++) {
    const a = multi[i - 1], b = multi[i]
    const up = pct(b.stats.lo, a.stats.lo)
    if (up >= T.jumpPct) {
      jumps.push(`${a.tender.label || a.tender.id} → ${b.tender.label || b.tender.id}: +${Math.round(up)}%`)
    }
  }
  if (jumps.length) {
    add('price_jump', 'amber', `The winning price rose sharply: ${jumps.join('; ')}.`)
  }

  const all = [...patterns, ...results.flatMap((r) => r.flags)]
  const counts = { red: 0, amber: 0 }
  for (const f of all) if (f.level in counts) counts[f.level]++
  const level = worst(all)

  return { level, counts, patterns, results }
}

export const VERDICT = {
  red: { label: 'Refer for investigation', color: '#d92d20', emoji: '🔴' },
  amber: { label: 'Watch closely', color: '#e07b00', emoji: '🟡' },
  info: { label: 'No red flags', color: '#12a150', emoji: '🟢' },
  green: { label: 'No red flags', color: '#12a150', emoji: '🟢' },
}

/**
 * Parse pasted rows: `tender, bidder, amount[, date]`, comma- or tab-separated
 * (tab = straight from Excel). Amounts may carry ₹ / Rs / thousand separators.
 */
export function parseRows(text) {
  const byTender = new Map()
  const errors = []
  text.split(/\r?\n/).forEach((raw, i) => {
    const line = raw.trim()
    if (!line || line.startsWith('#')) return
    let parts = line.includes('\t') ? line.split('\t') : line.split(',')
    parts = parts.map((p) => p.trim().replace(/^"|"$/g, ''))
    let date = ''
    if (/^\d{4}-\d{2}(-\d{2})?$/.test(parts[parts.length - 1])) date = parts.pop()
    if (parts.length < 3) {
      if (i > 0 || !/tender/i.test(line)) errors.push(`Line ${i + 1}: expected tender, bidder, amount`)
      return
    }
    const [tender, bidder, ...rest] = parts
    const amount = Number(rest.join('').replace(/₹|rs\.?|inr|\s/gi, '').replace(/,/g, ''))
    if (!Number.isFinite(amount)) {
      if (i > 0 || !/amount|price/i.test(line)) errors.push(`Line ${i + 1}: "${rest.join(',')}" is not a number`)
      return
    }
    if (!byTender.has(tender)) byTender.set(tender, { id: tender, label: tender, date: date || String(byTender.size).padStart(4, '0'), bids: [] })
    const t = byTender.get(tender)
    if (date) t.date = date
    t.bids.push({ bidder, amount })
  })
  return { tenders: [...byTender.values()], errors }
}
