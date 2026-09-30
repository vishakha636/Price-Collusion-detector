// Calibrated (swap) regret test on a firm's own pricing records.
//
// The same method as sim/regret.py ("estimated" version), which scored 0.993
// AUC separating colluding from competitive agents across 200 simulated
// markets. Needs the firm's own data -- price, units sold, unit cost -- plus
// the rival's price each period; scraped prices alone are not enough.
//
// For every price the firm actually used, ask: holding the rival's price
// fixed, would some other price have earned more in those same periods?
// A seller optimising for itself leaves ~nothing on the table; an algorithm
// that holds prices up to avoid a price war leaves a lot.

// The demand curve fitted from records alone overstates regret; across the
// 200 simulated markets, exact regret ~= 0.464 x estimate (median error about
// 1 percentage point). Results are reported on the calibrated (exact) scale.
export const CALIBRATION = 0.464
// Thresholds (calibrated scale) from the simulation study: risk = the cut that
// separates colluding from competitive markets best (97% accuracy); review = 2.3%.
export const REGRET_CUT = { review: 0.023, risk: 0.042 }
export const REGRET_BENCH = { competitive: 0.016, collusive: 0.12 }   // simulation medians

/** Least squares for ln q = b0 + b1 p + b2 r (3x3 normal equations). */
function fitDemand(p, r, q) {
  const X = p.map((_, i) => [1, p[i], r[i]])
  const y = q.map((v) => Math.log(Math.max(v, 1e-9)))
  const A = [[0, 0, 0], [0, 0, 0], [0, 0, 0]], b = [0, 0, 0]
  X.forEach((row, n) => row.forEach((xi, i) => {
    b[i] += xi * y[n]
    row.forEach((xj, j) => { A[i][j] += xi * xj })
  }))
  // Gaussian elimination with partial pivoting
  const M = A.map((row, i) => [...row, b[i]])
  for (let c = 0; c < 3; c++) {
    let piv = c
    for (let r2 = c + 1; r2 < 3; r2++) if (Math.abs(M[r2][c]) > Math.abs(M[piv][c])) piv = r2
    ;[M[c], M[piv]] = [M[piv], M[c]]
    if (Math.abs(M[c][c]) < 1e-12) return null
    for (let r2 = 0; r2 < 3; r2++) {
      if (r2 === c) continue
      const f = M[r2][c] / M[c][c]
      for (let k = c; k < 4; k++) M[r2][k] -= f * M[c][k]
    }
  }
  const coef = M.map((row, i) => row[3] / row[i])
  return { coef, q: (pp, rr) => Math.exp(coef[0] + coef[1] * pp + coef[2] * rr) }
}

/**
 * @param rows [{price, units, cost, rival}]  one row per period
 * @returns {regret, level, pricesUsed, grid, fit, periods, gainByPrice}
 */
export function regretTest(rows) {
  const data = rows.filter((r) => [r.price, r.units, r.cost, r.rival].every(Number.isFinite) && r.units > 0)
  if (data.length < 20) return { level: 'insufficient', periods: data.length }
  const p = data.map((r) => r.price), r = data.map((x) => x.rival), q = data.map((x) => x.units)
  const own = [...new Set(p)]
  if (own.length < 2) return { level: 'insufficient', periods: data.length, reason: 'price never changed' }

  const fit = fitDemand(p, r, q)
  if (!fit || fit.coef[1] >= 0) return { level: 'insufficient', periods: data.length, reason: 'demand does not fall with price' }

  // candidate prices: every price used, plus a 15-step grid over the observed range
  const lo = Math.min(...p, ...r), hi = Math.max(...p, ...r)
  const grid = [...new Set([...own, ...Array.from({ length: 15 }, (_, i) => +(lo + ((hi - lo) * i) / 14).toFixed(2))])].sort((a, b) => a - b)

  const profit = (price, rival, cost) => (price - cost) * fit.q(price, rival)
  const realised = data.map((d) => profit(d.price, d.rival, d.cost))
  const avg = realised.reduce((s, x) => s + x, 0) / data.length

  let total = 0
  const gainByPrice = []
  for (const used of own) {
    const idx = data.map((d, i) => (d.price === used ? i : -1)).filter((i) => i >= 0)
    let best = 0, bestAlt = used
    for (const alt of grid) {
      const gain = idx.reduce((s, i) => s + profit(alt, data[i].rival, data[i].cost) - realised[i], 0)
      if (gain > best) { best = gain; bestAlt = alt }
    }
    total += best
    gainByPrice.push({ price: used, periods: idx.length, better: bestAlt, gain: CALIBRATION * best / Math.max(avg * data.length, 1e-9) })
  }
  const raw = total / data.length / Math.max(avg, 1e-9)
  const regret = CALIBRATION * raw
  const level = regret >= REGRET_CUT.risk ? 'risk' : regret >= REGRET_CUT.review ? 'review' : 'independent'
  return { regret, raw, level, periods: data.length, pricesUsed: own.length, grid, fit: fit.coef, gainByPrice: gainByPrice.sort((a, b) => b.gain - a.gain) }
}

/** CSV: date, price, units, cost, rival_price (header names flexible). */
export function parseRecords(text) {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith('#'))
  if (lines.length < 2) return { rows: [], error: 'Need a header row and data rows.' }
  const head = lines[0].toLowerCase().split(/,|\t/).map((h) => h.trim())
  const col = (re) => head.findIndex((h) => re.test(h))
  const iP = col(/^(your_)?price|^my_price|^own/), iU = col(/unit|qty|quantity|sold|sales/), iC = col(/cost|cogs/), iR = col(/rival|competitor/)
  if ([iP, iU, iC, iR].some((i) => i < 0)) return { rows: [], error: 'Columns needed: price, units, cost, rival_price' }
  const num = (v) => Number(String(v ?? '').replace(/[₹,\s"]/g, ''))
  const rows = lines.slice(1).map((l) => l.split(/,(?=(?:[^"]*"[^"]*")*[^"]*$)|\t/)).map((c) => ({
    price: num(c[iP]), units: num(c[iU]), cost: num(c[iC]), rival: num(c[iR]),
  }))
  return { rows }
}

export const RECORDS_TEMPLATE = `date,price,units,cost,rival_price
2026-01-01,1299,42,820,1349
2026-01-02,1299,40,820,1299
`
