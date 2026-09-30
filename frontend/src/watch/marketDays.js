// Market-wide moves: days when a large share of ALL tracked listings on a
// store changed price in the same direction -- a site sale starting or
// ending, a GST change, a platform fee change. Rivals moving together on such
// a day says nothing about coordination between them, so the audit can
// discount those moves.
//
// Rule (measured on our registered listings): on an ordinary day ~6-9% of a
// store's listings move the same way; on the top 1-5% of days, 30%+ do.

const DAY = 864e5
export const MARKET = {
  share: 0.3,        // at least this share of active listings moved the same way...
  minMoved: 5,       // ...and at least this many listings
  minActive: 10,     // only judge days with enough listings observed
  pct: 1,            // a "move" is a change of more than 1%
  carryDays: 3,      // a price stays valid this many days after it was read
}

const dayKey = (t) => new Date(t).toISOString().slice(0, 10)

/**
 * @param products  registered products as returned by /api/products
 * @returns {days: {platform: {day: {dir, share, moved, active}}}, isMarketMove(platform, t, dir)}
 */
export function marketDays(products) {
  // one daily series per listing, per platform (a listing can sit in several products)
  const byPlat = {}
  for (const p of products || []) {
    for (const x of [...p.own, ...p.competitors]) {
      const plat = x.platform
      const m = (byPlat[plat] ||= new Map())
      if (m.has(x.listing_id)) continue
      const daily = new Map()
      for (const r of p.readings[x.listing_id] || []) if (r.price != null) daily.set(dayKey(r.t), r.price)
      m.set(x.listing_id, daily)
    }
  }

  const days = {}
  for (const [plat, listings] of Object.entries(byPlat)) {
    const all = [...new Set([...listings.values()].flatMap((d) => [...d.keys()]))].sort()
    if (!all.length) continue
    const count = new Map()                          // day -> {active, up, dn}
    const bump = (d, k) => { const c = count.get(d) || { active: 0, up: 0, dn: 0 }; c[k]++; count.set(d, c) }
    for (const daily of listings.values()) {
      const ds = [...daily.keys()].sort()
      let prev = null, prevT = null
      for (let t = Date.parse(ds[0]), end = Date.parse(ds[ds.length - 1]); t <= end; t += DAY) {
        const d = dayKey(t)
        const p = daily.get(d)
        if (p != null) {
          if (prev != null && (t - prevT) / DAY <= MARKET.carryDays + 1) {
            const pct = ((p - prev) / prev) * 100
            if (pct > MARKET.pct) bump(d, 'up')
            else if (pct < -MARKET.pct) bump(d, 'dn')
          }
          prev = p; prevT = t
        }
        if (prev != null && (t - prevT) / DAY <= MARKET.carryDays) bump(d, 'active')
      }
    }
    const out = {}
    for (const [d, c] of count) {
      if (c.active < MARKET.minActive) continue
      for (const [k, dir] of [['up', 1], ['dn', -1]]) {
        if (c[k] >= MARKET.minMoved && c[k] / c.active >= MARKET.share) {
          out[d] = { dir, share: c[k] / c.active, moved: c[k], active: c.active }
        }
      }
    }
    days[plat] = out
  }

  // a move counts as market-wide if it fell on such a day, or one day after
  // (the tracker may read a sale-day change a day late)
  const isMarketMove = (plat, t, dir) => {
    const d = days[plat]
    if (!d) return false
    for (const off of [0, -1]) {
      const hit = d[dayKey(+new Date(t) + off * DAY)]
      if (hit && hit.dir === dir) return true
    }
    return false
  }
  return { days, isMarketMove }
}
