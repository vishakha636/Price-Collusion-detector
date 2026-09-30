// Seller self-audit: is MY pricing software coordinating with my rivals?
//
// Input: my price history plus up to 5 rivals, read at the same moments --
// either uploaded from the repricer's own log (CSV) or collected live.
// Output: one status, the evidence behind it, and what to change.
//
// The CCI's 2025 market study on AI and competition recommends that firms
// self-audit their pricing algorithms; this is that audit, run on prices.
// It reuses the pairwise check in analyze.js and adds direction -- who
// follows whom -- because a seller can only change their own software.

import { NEED, analyzePair, changeEvents } from './analyze.js'

const DAY = 864e5
const poss = (name) => (/s$/i.test(name) ? `${name}’` : `${name}’s`)

export const STATUS = {
  red: { label: 'High risk', color: '#d92d20', short: 'Your pricing looks coordinated with a rival.' },
  amber: { label: 'Review', color: '#e07b00', short: 'Some coordination signs. Review your rules.' },
  green: { label: 'Compliant', color: '#12a150', short: 'Your pricing looks independent.' },
  collecting: { label: 'Collecting', color: '#94a3b8', short: 'Not enough history yet.' },
}

/**
 * How often `follower` answered `leader`'s moves in direction `dir` within the
 * window. `pairs` keeps every leader move with its reply (or null) -- the
 * evidence chain behind the counts.
 */
function follows(leader, follower, dir, windowDays) {
  const w = windowDays * DAY
  const moves = leader.filter((e) => Math.sign(e.pct) === dir)
  const lags = [], pairs = []
  for (const e of moves) {
    const reply = follower.find((f) => Math.sign(f.pct) === dir && f.t >= e.t && f.t - e.t <= w) || null
    if (reply) lags.push((reply.t - e.t) / DAY)
    pairs.push({ lead: e, reply, lag: reply ? (reply.t - e.t) / DAY : null })
  }
  return { n: moves.length, k: lags.length, lags, pairs }
}

// score weights: following rival rises weighs most -- it is the behaviour a
// seller can switch off
export const WEIGHTS = { copy: 45, theyCopy: 20, gap: 20, match: 15 }

/** How much the verdict can be trusted, from how much evidence there is. */
function confidenceOf(level, days, moves, responses) {
  if (level === 'collecting') return { level: 'none', label: 'Needs more data', days, moves, responses }
  const lvl = days >= 60 && moves >= 20 && responses >= 8 ? 'high'
    : days >= 21 && moves >= 8 && responses >= 3 ? 'medium' : 'low'
  return { level: lvl, label: { high: 'Sure', medium: 'Fairly sure', low: 'Not sure yet' }[lvl], days, moves, responses }
}

/**
 * @param series  [{name, points: [{t, price, src?}]}] -- index 0 is the seller's own product
 * @param opts    {windowDays, marketMove?: (t, dir) => bool, excludeMarket?: bool}
 *                marketMove flags sale-day / market-wide moves; with excludeMarket
 *                they are left out of every "who followed whom" count.
 */
export function runAudit(series, opts = {}) {
  const win = opts.windowDays ?? NEED.windowDays
  const mkt = opts.marketMove || null
  const excl = !!(mkt && opts.excludeMarket)
  const flag = (evs) => evs.map((e) => ({ ...e, market: !!mkt?.(e.t, Math.sign(e.pct)) }))
  const keep = (e) => !(excl && e.market)
  const srcMap = (s) => new Map(s.points.map((p) => [+new Date(p.t), p.src || null]))
  const me = series[0]
  const times = [...new Set(series.flatMap((s) => s.points.map((p) => +new Date(p.t))))].sort((a, b) => a - b)
  const at = (s) => new Map(s.points.map((p) => [+new Date(p.t), p.price]))
  const mine = at(me)

  const mySrc = srcMap(me)
  const rivals = series.slice(1).map((r) => {
    const theirs = at(r), theirSrc = srcMap(r)
    const rounds = times.map((t) => ({ t, a: mine.get(t) ?? null, b: theirs.get(t) ?? null }))
    const evMeAll = flag(changeEvents(rounds, 'a')).map((e) => ({ ...e, src: mySrc.get(e.t) }))
    const evThemAll = flag(changeEvents(rounds, 'b')).map((e) => ({ ...e, src: theirSrc.get(e.t) }))
    const result = analyzePair(rounds, { a: me.name, b: r.name },
      { windowDays: win, keepEvent: excl ? (e) => !mkt(e.t, Math.sign(e.pct)) : null })
    const evMe = evMeAll.filter(keep), evThem = evThemAll.filter(keep)
    // evidence chain: every rival move (and every rise of yours) with the reply, if any;
    // built from all moves so excluded sale-day moves stay visible, marked as such
    const chain = [
      ...follows(evThemAll, evMeAll, 1, win).pairs.map((x) => ({ ...x, kind: 'rise', leader: 'them' })),
      ...follows(evThemAll, evMeAll, -1, win).pairs.map((x) => ({ ...x, kind: 'cut', leader: 'them' })),
      ...follows(evMeAll, evThemAll, 1, win).pairs.map((x) => ({ ...x, kind: 'rise', leader: 'you' })),
    ].map((x) => ({ ...x, market: x.lead.market || !!x.reply?.market, excluded: excl && (x.lead.market || !!x.reply?.market) }))
      .sort((a, b) => b.lead.t - a.lead.t)
    return {
      name: r.name, rounds, result, chain,
      iFollowUp: follows(evThem, evMe, 1, win),      // they raise, I raise
      theyFollowUp: follows(evMe, evThem, 1, win),   // I raise, they raise
      iMatchCut: follows(evThem, evMe, -1, win),     // they cut, I cut
      frozen: result.signs.find((s) => s.id === 'frozen_gap'),
      nChanges: evMe.length + evThem.length,
      theirChanges: evThemAll.length,
      marketMoves: evMeAll.filter((e) => e.market).length + evThemAll.filter((e) => e.market).length,
    }
  })
  // 0–100: how closely your software tracks this rival. Following their rises
  // weighs most -- it is the behaviour a seller can switch off.
  const rate = ({ k, n }) => (n >= 2 ? k / n : 0)
  const met = ({ k, n }) => n >= 2 && k / n >= 0.6
  for (const r of rivals) {
    const signOf = (id) => r.result.signs.find((s) => s.id === id)
    const gap = signOf('frozen_gap'), mb = signOf('match_not_beat')
    // "why": each signal's measurement, the rule it is judged by, and its points
    r.why = [
      { key: 'copy', label: `You followed ${poss(r.name)} price rises`, measured: r.iFollowUp, rule: 'flag at 6 in 10',
        met: met(r.iFollowUp), points: WEIGHTS.copy * rate(r.iFollowUp), max: WEIGHTS.copy },
      { key: 'theyCopy', label: `${r.name} followed your price rises`, measured: r.theyFollowUp, rule: 'flag at 6 in 10',
        met: met(r.theyFollowUp), points: WEIGHTS.theyCopy * rate(r.theyFollowUp), max: WEIGHTS.theyCopy },
      { key: 'gap', label: gap?.title.includes('exactly') ? 'Always the same price' : 'Kept the same price gap', detail: gap?.detail || 'Not measured yet',
        rule: 'gap moves < 2%', met: !!gap?.strong, points: gap?.strong ? WEIGHTS.gap : 0, max: WEIGHTS.gap },
      { key: 'match', label: 'Matched their discounts, never went lower', detail: mb?.detail || 'Too few discounts to judge',
        rule: 'flag at 6 in 10', met: !!mb?.strong, points: mb?.strong ? WEIGHTS.match : 0, max: WEIGHTS.match },
    ]
    r.score = r.result.status === 'ready'
      ? Math.round(Math.min(100, r.why.reduce((s, x) => s + x.points, 0)))
      : null
  }

  const ready = rivals.filter((r) => r.result.status === 'ready')
  const rank = { red: 3, amber: 2, green: 1, collecting: 0 }
  const level = ready.length
    ? ready.reduce((w, r) => (rank[r.result.level] > rank[w] ? r.result.level : w), 'green')
    : 'collecting'

  // Same seller behind rival listings (e.g. one retailer selling two brands):
  // a single repricer may be setting both prices -- the "hub" in hub-and-spoke.
  const sellerOf = (s) => new Map(s.points.filter((p) => p.seller).map((p) => [+new Date(p.t), p.seller]))
  const mySellers = sellerOf(me)
  for (const r of rivals) {
    const theirs = sellerOf(series.find((x) => x.name === r.name))
    let same = 0, both = 0, name = null
    for (const [t, s] of mySellers) {
      if (!theirs.has(t)) continue
      both++
      if (theirs.get(t) === s) { same++; name = s }
    }
    r.sharedSeller = both >= 5 && same / both >= 0.5 ? { name, share: same / both } : null
  }

  // evidence, strongest first, in the seller's own terms
  const evidence = []
  for (const r of rivals) {
    if (r.sharedSeller) evidence.push({ w: 1, rival: r.name, text: `Same seller as ${r.name}: ${r.sharedSeller.name}` })
  }
  for (const r of ready) {
    const { iFollowUp: f, theyFollowUp: g, iMatchCut: c } = r
    if (f.n >= 2 && f.k / f.n >= 0.6) evidence.push({ w: 3, rival: r.name, text: `Followed ${poss(r.name)} price rises (${f.k} of ${f.n})` })
    if (g.n >= 2 && g.k / g.n >= 0.6) evidence.push({ w: 2, rival: r.name, text: `${r.name} followed your price rises (${g.k} of ${g.n})` })
    if (r.frozen?.strong) {
      evidence.push({ w: 2, rival: r.name, text: r.frozen.title.includes('exactly')
        ? `Always the same price as ${r.name}` : `Kept the same price gap to ${r.name}` })
    }
    const mb = r.result.signs.find((s) => s.id === 'match_not_beat')
    if (mb?.strong) evidence.push({ w: 2, rival: r.name, text: `Matched ${poss(r.name)} discounts, never went lower` })
    if (c.n >= 1 && c.k === 0 && f.k === 0) evidence.push({ w: 0, rival: r.name, text: `Independent of ${r.name}` })
  }
  evidence.sort((a, b) => b.w - a.w)

  // what to change -- only for problems actually found
  const fixes = []
  const has = (pred) => ready.some(pred)
  if (has((r) => r.iFollowUp.n >= 2 && r.iFollowUp.k / r.iFollowUp.n >= 0.6)) {
    fixes.push('Stop following competitors’ price rises')
  }
  if (has((r) => r.result.signs.some((s) => s.id === 'match_not_beat' && s.strong))) {
    fixes.push('Turn off the “match competitor price” rule')
  }
  if (has((r) => r.frozen?.strong)) {
    fixes.push('Remove rules that keep a fixed gap to a competitor')
  }
  if (has((r) => r.theyFollowUp.n >= 2 && r.theyFollowUp.k / r.theyFollowUp.n >= 0.6)) {
    fixes.push('Don’t announce price rises in advance')
  }
  if (rivals.some((r) => r.sharedSeller)) fixes.push('Shared seller — check one repricer isn’t pricing both')
  if (level === 'red' || level === 'amber') {
    fixes.push('Check you don’t share repricing software with this competitor')
    fixes.push('Keep this report on file')
  }
  if (level === 'green') fixes.push('No change needed')

  const span = times.length > 1 ? (times[times.length - 1] - times[0]) / DAY : 0
  const gaps = times.slice(1).map((t, i) => (t - times[i]) / DAY).sort((a, b) => a - b)
  const medianGap = gaps.length ? gaps[Math.floor(gaps.length / 2)] : null

  // headline numbers
  const up = ready.reduce((a, r) => ({ k: a.k + r.iFollowUp.k, n: a.n + r.iFollowUp.n }), { k: 0, n: 0 })
  const lags = ready.flatMap((r) => [...r.iFollowUp.lags, ...r.iMatchCut.lags])
  const stats = {
    followRate: up.n ? Math.round((100 * up.k) / up.n) : null,         // % of rival rises you copied
    reactionDays: lags.length ? lags.reduce((s, x) => s + x, 0) / lags.length : null,
    flagged: ready.filter((r) => r.result.level === 'red' || r.result.level === 'amber').length,
    rivals: rivals.length,
    changes: changeEvents(times.map((t) => ({ t, a: mine.get(t) ?? null })), 'a').length,
  }
  const ranking = [...rivals].sort((a, b) => (b.score ?? -1) - (a.score ?? -1))

  const moves = stats.changes + rivals.reduce((s, r) => s + r.theirChanges, 0)
  const responses = ready.reduce((s, r) => s + r.iFollowUp.n + r.iMatchCut.n + r.theyFollowUp.n, 0)
  const confidence = confidenceOf(level, Math.round(span), moves, responses)
  const market = { excluded: excl, moves: rivals.reduce((s, r) => s + r.marketMoves, 0) }

  return { level, status: STATUS[level], me, rivals, ranking, evidence, fixes, span, points: times.length, medianGap, stats,
    confidence, market, windowDays: win }
}

/**
 * Parse a repricer log. Two layouts are accepted:
 *   wide:  date, <your product>, <rival 1>, <rival 2>, ...
 *   long:  date, product, price
 * Returns {series: [{name, points}], errors}. Column order decides "yours"
 * in the wide layout; the UI lets the user pick it anyway.
 */
export function parseLog(text) {
  const rows = text.split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith('#'))
  if (rows.length < 2) return { series: [], errors: ['The file needs a header row and at least one data row.'] }
  // tab-separated (pasted from Excel) or CSV with "quoted, fields"
  const split = (l) => {
    if (l.includes('\t')) return l.split('\t').map((c) => c.trim())
    const out = []
    let cur = '', q = false
    for (const ch of l) {
      if (ch === '"') q = !q
      else if (ch === ',' && !q) { out.push(cur.trim()); cur = '' }
      else cur += ch
    }
    out.push(cur.trim())
    return out
  }
  const head = split(rows[0]).map((h) => h.toLowerCase())
  const num = (v) => {
    const x = Number(String(v).replace(/₹|rs\.?|inr|,|\s/gi, ''))
    return Number.isFinite(x) && String(v).trim() !== '' ? x : null
  }
  const date = (v) => {
    const s = String(v).trim()
    const dmy = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})(.*)$/)   // 16/11/2012 (Indian order)
    const iso = dmy ? `${dmy[3]}-${dmy[2].padStart(2, '0')}-${dmy[1].padStart(2, '0')}${dmy[4] || ''}` : s
    const t = Date.parse(iso.length === 10 ? `${iso}T00:00:00` : iso)
    return Number.isFinite(t) ? t : null
  }
  const errors = []
  const series = new Map()
  const add = (name, t, p) => {
    if (!series.has(name)) series.set(name, [])
    series.get(name).push({ t, price: p })
  }

  if (head.includes('product') && head.includes('price')) {
    const iD = head.findIndex((h) => /date|time/.test(h)), iP = head.indexOf('product'), iV = head.indexOf('price')
    rows.slice(1).forEach((l, n) => {
      const c = split(l), t = date(c[iD]), p = num(c[iV])
      if (t == null || p == null) return errors.push(`Row ${n + 2} skipped`)
      add(c[iP], t, p)
    })
  } else {
    const names = split(rows[0]).slice(1)
    // keep the header's column order (first = yours), even if a column starts empty
    names.forEach((name) => { if (!series.has(name)) series.set(name, []) })
    rows.slice(1).forEach((l, n) => {
      const c = split(l), t = date(c[0])
      if (t == null) return errors.push(`Row ${n + 2}: unreadable date`)
      names.forEach((name, i) => { const p = num(c[i + 1]); if (p != null) add(name, t, p) })
    })
  }
  const out = [...series.entries()].filter(([, points]) => points.length)
    .map(([name, points]) => ({ name, points: points.sort((a, b) => a.t - b.t) }))
  if (out.length < 2) errors.unshift('Need your product and at least one rival.')
  return { series: out, errors: errors.slice(0, 5) }
}

export const TEMPLATE = `date,Your product,Rival 1,Rival 2
2026-01-01,1299,1349,1199
2026-01-02,1299,1349,1199
`
