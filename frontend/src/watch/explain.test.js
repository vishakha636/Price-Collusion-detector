// Tests for the audit explanation: score breakdown, evidence chain,
// confidence, and discounting market-wide (sale-day) moves.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { runAudit } from './audit.js'
import { marketDays } from './marketDays.js'

const DAY = 864e5
const t0 = Date.parse('2026-01-01T06:00:00Z')
const s = (name, prices) => ({ name, points: prices.map((price, i) => ({ t: t0 + i * DAY, price })) })
const steps = (n, pairs) => { const out = []; for (let i = 0; i < n; i++) out.push(pairs.filter(([d]) => d <= i).pop()[1]); return out }

// rival raises on days 5, 12, 19; I follow one day later each time, with a drifting gap
const rival = steps(28, [[0, 1000], [5, 1100], [12, 1200], [19, 1300]])
const mine = steps(28, [[0, 900], [6, 960], [13, 1030], [20, 1080]])

test('why: signal points add up to the rival score', () => {
  const r = runAudit([s('Mine', mine), s('Rival', rival)])
  const x = r.rivals[0]
  assert.equal(x.iFollowUp.k, 3)
  assert.equal(Math.round(x.why.reduce((a, w) => a + w.points, 0)), x.score)
  assert.ok(x.why.find((w) => w.key === 'copy').met)
})

test('evidence chain keeps each rival move with your reply, prices and lag', () => {
  const r = runAudit([s('Mine', mine), s('Rival', rival)])
  const rises = r.rivals[0].chain.filter((c) => c.leader === 'them' && c.kind === 'rise')
  assert.equal(rises.length, 3)
  assert.ok(rises.every((c) => c.reply && c.lag === 1))
  assert.deepEqual([rises[2].lead.from, rises[2].lead.to, rises[2].reply.from, rises[2].reply.to], [1000, 1100, 900, 960])
})

test('moves on market-wide days can be excluded -> the verdict clears', () => {
  const saleDays = new Set([5, 6, 12, 13, 19, 20].map((d) => t0 + d * DAY))
  const marketMove = (t) => saleDays.has(+new Date(t))
  const flagged = runAudit([s('Mine', mine), s('Rival', rival)], { marketMove })
  const cleared = runAudit([s('Mine', mine), s('Rival', rival)], { marketMove, excludeMarket: true })
  assert.notEqual(flagged.level, 'green')
  assert.equal(cleared.level, 'green')
  assert.equal(cleared.rivals[0].iFollowUp.n, 0)
  assert.ok(cleared.rivals[0].chain.every((c) => c.excluded))   // still shown, marked excluded
  assert.equal(flagged.market.moves, 6)
})

test('confidence reflects how much evidence there is', () => {
  assert.equal(runAudit([s('Mine', [1, 2, 3]), s('Rival', [1, 2, 3])]).confidence.level, 'none')
  const r = runAudit([s('Mine', mine), s('Rival', rival)])
  assert.equal(r.confidence.level, 'low')             // 27 days but only 6 price moves (medium needs 8)
  assert.equal(r.confidence.days, 27)
  assert.equal(r.confidence.moves, 6)
})

test('marketDays: a day when most listings on a store drop is market-wide', () => {
  const listings = Array.from({ length: 12 }, (_, i) => ({ platform: 'flipkart', listing_id: `L${i}`, brand: `B${i}`, name: `B${i}` }))
  const readings = {}
  listings.forEach((l, i) => {
    readings[l.listing_id] = Array.from({ length: 10 }, (_, d) => ({
      t: new Date(t0 + d * DAY).toISOString(), price: d >= 5 && i < 10 ? 90 : 100,
    }))
  })
  const m = marketDays([{ own: [listings[0]], competitors: listings.slice(1), readings }])
  const day5 = new Date(t0 + 5 * DAY).toISOString().slice(0, 10)
  assert.equal(m.days.flipkart[day5].dir, -1)
  assert.equal(Object.keys(m.days.flipkart).length, 1)
  assert.ok(m.isMarketMove('flipkart', t0 + 6 * DAY, -1))    // read a day late still counts
  assert.ok(!m.isMarketMove('flipkart', t0 + 7 * DAY, -1))
  assert.ok(!m.isMarketMove('flipkart', t0 + 5 * DAY, 1))    // wrong direction
})

test('fixed gap needs the gap to hold while both prices moved, not one flat stretch', async () => {
  const { analyzePair } = await import('./analyze.js')
  // both flat for 25 days, then a few moves at the very end (never "settled")
  const a = [...Array(27).fill(700), 690]
  const b = [...Array(25).fill(2800), 2750, 2700, 2700]
  const rounds = a.map((v, i) => ({ t: t0 + i * DAY, a: v, b: b[i] }))
  const res = analyzePair(rounds, { a: 'Mine', b: 'Rival' })
  assert.equal(res.status, 'ready')
  assert.ok(!res.signs.some((x) => x.id === 'frozen_gap' && x.strong))
})

test('rivalLine works for every kind of warning sign (fixed gap has no counts)', async () => {
  const { rivalLine } = await import('./plain.js')
  const mk = (key, extra = {}) => ({
    result: { status: 'ready', level: 'amber', signs: [] },
    why: [{ key, met: true, label: key === 'gap' ? 'Kept the same price gap' : key, ...extra }],
  })
  assert.equal(rivalLine(mk('gap')).text, 'Fixed price gap')
  assert.equal(rivalLine(mk('match')).text, 'Match discounts, never lower')
  assert.equal(rivalLine(mk('copy', { measured: { k: 2, n: 3 } })).text, 'You followed their rises · 2/3')
  assert.equal(rivalLine(null).tone, 'wait')
})
