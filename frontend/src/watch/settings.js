// Workspace settings, kept in this browser (localStorage).
//   viewDays     how many recent days of prices the app shows and audits
//   windowDays   a rival's move counts as "followed" if matched within this many days
//   excludeMarket  leave sale-day / market-wide moves out of the follow counts

const KEY = 'pg.settings'
export const DEFAULTS = { viewDays: 30, windowDays: 2, excludeMarket: true }
export const VIEW_OPTIONS = [30, 90, 365, 0]          // 0 = all history
export const WINDOW_OPTIONS = [1, 2, 3]

export function getSettings() {
  try { return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) || '{}') } } catch { return { ...DEFAULTS } }
}

export function saveSettings(patch) {
  const s = { ...getSettings(), ...patch }
  localStorage.setItem(KEY, JSON.stringify(s))
  return s
}

/** `/products` query for the configured window. */
export const productsPath = () => {
  const d = getSettings().viewDays
  return d ? `/products?days=${d}` : '/products'
}

export const viewLabel = (d = getSettings().viewDays) => (d ? `last ${d} days` : 'all history')
