// One place that turns a registered product into audit input, so every page
// (Products, Validation, Alerts) audits it the same way.
import { runAudit } from './audit'
import { getSettings } from './settings'

export const youLabel = (o) => `You (${o.brand || o.name.split(' ')[0]})`

/** Series for one platform: your listing first, then that platform's rivals. Each price
 *  carries its source: imported history (before registration) or collected live. */
export function productSeries(p, plat, filter = () => true) {
  const mine = p.own.find((o) => o.platform === plat)
  if (!mine) return null
  const imported = p.own.some((o) => o.history_source)
  return [mine, ...p.competitors.filter((c) => c.platform === plat)].map((x) => ({
    name: x === mine ? youLabel(mine) : x.brand || x.name.split(' ')[0],
    listing: x,
    points: (p.readings[x.listing_id] || []).filter(filter).map((r) => ({
      t: r.t, price: r.price, src: imported && r.t < p.created ? 'imported' : 'live',
    })),
  }))
}

/** Audit options from Settings, plus the store's market-wide days (see marketDays.js). */
export function auditOpts(market, plat, overrides = {}) {
  const st = getSettings()
  return {
    windowDays: st.windowDays,
    marketMove: market ? (t, dir) => market.isMarketMove(plat, t, dir) : null,
    excludeMarket: st.excludeMarket,
    ...overrides,
  }
}

/** One audit per platform the product is listed on. */
export function auditProduct(p, market, overrides) {
  return p.platforms.map((plat) => {
    const series = productSeries(p, plat)
    return series && { platform: plat, series, audit: runAudit(series, auditOpts(market, plat, overrides)) }
  }).filter(Boolean)
}
