// Tests for the market scan and market watch. Products here are hand-written
// fixtures, not scraped data.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { isCharm, marketPairs, scanMarket } from './market.js'

const P = (brand, price, mrp = null, id = `${brand}-${price}`) => ({ id, brand, name: `${brand} item`, price, mrp })

test('charm prices are the ones ending in 9', () => {
  assert.ok(isCharm(999) && isCharm(1299) && isCharm(449))
  assert.ok(!isCharm(1000) && !isCharm(795))
})

test('many brands, spread prices -> low risk', () => {
  const ps = 'ABCDEFGHIJ'.split('').map((b, i) => P(b, 500 + i * 137))
  const s = scanMarket(ps)
  assert.equal(s.riskLevel, 'low')
  assert.equal(s.samePrice.length, 0)
})

test('three brands, same non-charm prices -> high risk', () => {
  const ps = [P('A', 1000), P('B', 1000), P('C', 1000), P('A', 1500), P('B', 1500), P('C', 1500, null, 'C2'), P('A', 2000)]
  const s = scanMarket(ps)
  assert.equal(s.riskLevel, 'high')
  assert.equal(s.samePrice[0].brands.length, 3)
})

test('uniform discount across brands is reported', () => {
  const ps = ['A', 'B', 'C', 'D'].map((b, i) => P(b, 500 + i * 50, (500 + i * 50) * 2))
  const s = scanMarket(ps)
  assert.equal(s.sameDiscount[0].pct, 50)
  assert.equal(s.sameDiscount[0].brands.length, 4)
})

test('market watch: two brands in lockstep light up red, an independent one does not', () => {
  const day = (i) => new Date(Date.parse('2026-01-01T06:00:00Z') + i * 864e5).toISOString()
  const rounds = Array.from({ length: 25 }, (_, i) => day(i))
  const step = (i) => (i < 5 ? 1000 : i < 10 ? 1100 : i < 15 ? 1000 : i < 20 ? 1200 : 1100)
  const series = (f) => Object.fromEntries(rounds.map((t, i) => [t, f(i)]))
  const history = {
    rounds,
    products: [
      { id: 'a', brand: 'Alpha', name: 'a', prices: series(step) },
      { id: 'b', brand: 'Beta', name: 'b', prices: series((i) => Math.round(step(Math.max(0, i - 1)) * 1.3)) },
      { id: 'c', brand: 'Gamma', name: 'c', prices: series((i) => (i < 12 ? 800 : 760)) },
    ],
  }
  const m = marketPairs(history)
  const idx = Object.fromEntries(m.brands.map((b, i) => [b.brand, i]))
  assert.equal(m.cells[idx.Alpha][idx.Beta].result.level, 'red')
  assert.notEqual(m.cells[idx.Alpha][idx.Gamma].result.level, 'red')
  assert.equal(m.red, 1)
})
