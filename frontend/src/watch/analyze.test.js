// Scenario tests for the coordinated-pricing check. The price paths here are
// hand-written test fixtures, not market data.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { analyzePair } from './analyze.js'
import { REPLAYS } from './replays.js'

const DAY = 24 * 3600 * 1000
const t0 = Date.parse('2026-01-01T06:00:00Z')

/** Build one reading per day from per-day price arrays. */
const days = (a, b) => a.map((pa, i) => ({ t: t0 + i * DAY, a: pa, b: b[i] }))
const fill = (n, v) => Array(n).fill(v)

test('too little history -> collecting, never a verdict', () => {
  const r = analyzePair(days([100, 90, 100, 90], [200, 180, 200, 180]))
  assert.equal(r.status, 'collecting')
  assert.equal(r.signs.length, 0)
})

test('flat prices for weeks -> still collecting (nothing to judge)', () => {
  const r = analyzePair(days(fill(30, 999), fill(30, 1299)))
  assert.equal(r.status, 'collecting')
})

test('rises in step, matched cuts, fixed gap -> red', () => {
  // A leads, B follows one day later, always keeping B = 1.3 x A.
  const a = [...fill(5, 1000), ...fill(5, 1100), ...fill(5, 1000), ...fill(5, 1200), ...fill(5, 1100)]
  const b = a.map((p, i) => Math.round((i > 0 ? a[i - 1] : a[0]) * 1.3))
  const r = analyzePair(days(a, b), { a: 'A', b: 'B' })
  assert.equal(r.status, 'ready')
  assert.equal(r.level, 'red')
  assert.ok(r.signs.find((s) => s.id === 'rise_together').strong)
  assert.ok(r.signs.find((s) => s.id === 'match_not_beat').strong)
})

test('undercutting price war -> not red', () => {
  // Each cut is answered by a bigger cut; nobody follows rises.
  const a = [...fill(4, 1000), ...fill(4, 950), ...fill(4, 950), ...fill(4, 850), ...fill(4, 1000)]
  const b = [...fill(5, 1300), ...fill(4, 1200), ...fill(4, 1200), ...fill(4, 1050), ...fill(3, 1050)]
  const r = analyzePair(days(a, b))
  assert.equal(r.status, 'ready')
  assert.notEqual(r.level, 'red')
  const m = r.signs.find((s) => s.id === 'match_not_beat')
  if (m) assert.equal(m.strong, false)
})

test('independent changes on different days -> green', () => {
  const a = [...fill(6, 1000), ...fill(6, 1049), ...fill(6, 999), ...fill(6, 1049)]
  const b = [...fill(3, 1500), ...fill(10, 1399), ...fill(11, 1449)]
  const r = analyzePair(days(a, b))
  assert.equal(r.status, 'ready')
  assert.equal(r.level, 'green')
})

// --- real CCI case ---------------------------------------------------------------

test('airline fuel surcharge cartel (CCI: guilty) replays as red, each rise counted once', () => {
  for (const r of REPLAYS) {
    const x = analyzePair(r.rounds, { a: r.brand_a, b: r.brand_b }, { windowDays: r.windowDays })
    assert.equal(x.level, 'red', r.id)
    const rise = x.signs.find((s) => s.id === 'rise_together')
    assert.match(rise.detail, /^3 of 3 /, r.id)
  }
})
