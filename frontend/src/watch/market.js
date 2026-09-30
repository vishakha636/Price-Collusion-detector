// Market-level analysis for a site search.
//
// scanMarket():   instant, from one search. It cannot see collusion (that
//                 needs prices over time), but it can say how *easy* collusion
//                 would be here -- few dominant brands, rivals parked on the
//                 same price, uniform discounts. Competition authorities call
//                 these structural screens.
// marketPairs():  once a market has been watched for a while, runs the
//                 over-time check (analyze.js) on every pair of top brands.

import { analyzePair } from './analyze.js'

const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b)
  return s.length ? (s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : null
}

/** Prices ending in 9 (₹499, ₹1,299, ₹999) are everyday "charm pricing". */
export const isCharm = (p) => Math.round(p) % 10 === 9

export function scanMarket(products) {
  const n = products.length
  const byBrand = new Map()
  for (const p of products) {
    if (!byBrand.has(p.brand)) byBrand.set(p.brand, [])
    byBrand.get(p.brand).push(p)
  }
  const brands = [...byBrand.entries()]
    .map(([brand, items]) => ({ brand, items, share: items.length / n, median: median(items.map((i) => i.price)) }))
    .sort((a, b) => b.items.length - a.items.length || a.median - b.median)

  // concentration of listings (not sales -- a site search shows listings)
  const top3 = brands.slice(0, 3).reduce((s, b) => s + b.share, 0)
  const hhi = Math.round(brands.reduce((s, b) => s + (b.share * 100) ** 2, 0))

  // identical prices across different brands
  const byPrice = new Map()
  for (const p of products) {
    const k = Math.round(p.price)
    if (!byPrice.has(k)) byPrice.set(k, [])
    byPrice.get(k).push(p)
  }
  const samePrice = [...byPrice.entries()]
    .map(([price, items]) => ({ price, items, brands: [...new Set(items.map((i) => i.brand))] }))
    .filter((g) => g.brands.length >= 2)
    .sort((a, b) => b.brands.length - a.brands.length || a.price - b.price)
  const inShared = samePrice.reduce((s, g) => s + g.items.length, 0)
  const sharedNonCharm = samePrice.filter((g) => !isCharm(g.price))

  // identical discount % across brands
  const withDisc = products.filter((p) => p.mrp && p.mrp > p.price)
  const byDisc = new Map()
  for (const p of withDisc) {
    const d = Math.round((1 - p.price / p.mrp) * 100)
    if (!byDisc.has(d)) byDisc.set(d, new Set())
    byDisc.get(d).add(p.brand)
  }
  const sameDiscount = [...byDisc.entries()]
    .map(([pct, set]) => ({ pct, brands: [...set] }))
    .filter((g) => g.brands.length >= 3)
    .sort((a, b) => b.brands.length - a.brands.length)
  const avgDiscount = withDisc.length
    ? Math.round(withDisc.reduce((s, p) => s + (1 - p.price / p.mrp), 0) / withDisc.length * 100) : 0

  const prices = products.map((p) => p.price)
  const clustering = n ? inShared / n : 0
  const charmShare = n ? products.filter((p) => isCharm(p.price)).length / n : 0

  // "How easy would collusion be here?" -- 0..100
  const concScore = Math.min(1, Math.max(0, (top3 - 0.3) / 0.5))           // 30% → 0, 80% → 1
  const clusScore = Math.min(1, clustering / 0.5) * (sharedNonCharm.length ? 1 : 0.6)
  const risk = Math.round(100 * (0.55 * concScore + 0.45 * clusScore))
  const riskLevel = risk >= 60 ? 'high' : risk >= 35 ? 'medium' : 'low'

  const findings = []
  const f = (level, title, detail) => findings.push({ level, title, detail })

  const list = (xs, k = 3) => xs.slice(0, k).join(', ') + (xs.length > k ? ` +${xs.length - k}` : '')

  f(top3 >= 0.6 ? 'amber' : 'info', `Top 3 brands hold ${Math.round(top3 * 100)}%`,
    list(brands.map((b) => b.brand)))

  if (samePrice.length) {
    const g = samePrice[0]
    f(sharedNonCharm.length ? 'amber' : 'info',
      `${samePrice.length} price${samePrice.length > 1 ? 's' : ''} shared by rival brands`,
      `₹${g.price.toLocaleString('en-IN')}: ${list(g.brands)}` + (sharedNonCharm.length ? '' : ' · common ₹…9 pricing'))
  } else {
    f('info', 'No shared prices', 'Every brand prices differently')
  }

  if (sameDiscount.length) {
    const g = sameDiscount[0]
    f(g.brands.length >= 4 ? 'amber' : 'info', `${g.brands.length} brands at ${g.pct}% off`, list(g.brands))
  }

  return {
    n, brands, top3, hhi, samePrice, sameDiscount, avgDiscount, clustering, charmShare,
    min: Math.min(...prices), max: Math.max(...prices), median: median(prices),
    risk, riskLevel, concScore, clusScore, findings,
  }
}

/**
 * Over-time check for a watched market. Each top brand is represented by the
 * product seen in the most rounds (so it has the longest history); every pair
 * of those products goes through analyzePair().
 */
export function marketPairs(history, maxBrands = 6) {
  const { rounds, products } = history
  // Brands are ranked by how many listings they have (the brands that
  // dominate the search), then by how long their product has been tracked.
  const reps = new Map()
  const listings = new Map()
  for (const p of products) {
    listings.set(p.brand, (listings.get(p.brand) || 0) + 1)
    const seen = Object.keys(p.prices).length
    const cur = reps.get(p.brand)
    if (!cur || seen > cur.seen) reps.set(p.brand, { ...p, seen })
  }
  const top = [...reps.values()]
    .sort((a, b) => listings.get(b.brand) - listings.get(a.brand) || b.seen - a.seen || a.brand.localeCompare(b.brand))
    .slice(0, maxBrands)

  const cells = top.map((a, i) => top.map((b, j) => {
    if (i === j) return null
    const rs = rounds.map((t) => ({ t, a: a.prices[t] ?? null, b: b.prices[t] ?? null }))
    return { a, b, rounds: rs, result: analyzePair(rs, { a: a.brand, b: b.brand }) }
  }))
  // each pair appears twice in the matrix (a,b and b,a), hence the / 2 below
  const ready = cells.flat().filter((c) => c && c.result.status === 'ready')
  const days = rounds.length > 1 ? (Date.parse(rounds[rounds.length - 1]) - Date.parse(rounds[0])) / 864e5 : 0
  return {
    brands: top, cells, days: Math.floor(days), rounds: rounds.length,
    red: ready.filter((c) => c.result.level === 'red').length / 2,
    amber: ready.filter((c) => c.result.level === 'amber').length / 2,
    ready: ready.length > 0,
  }
}
