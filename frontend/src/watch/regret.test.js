// Tests for the regret test. Transcripts are generated from a known logit
// demand (the simulator's market model), so the right answer is known.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { parseRecords, regretTest } from './regret.js'

// Calvano baseline market: a = 2, mu = 0.25, cost 1, market size 1000 buyers
const share = (p, r) => {
  const e0 = Math.exp((2 - p) / 0.25), e1 = Math.exp((2 - r) / 0.25), eo = 1
  return e0 / (e0 + e1 + eo)
}
const GRID = Array.from({ length: 15 }, (_, i) => +(1.43 + 0.036 * i).toFixed(3))   // ~Nash..monopoly
const bestReply = (r) => GRID.reduce((b, p) => ((p - 1) * share(p, r) > (b - 1) * share(b, r) ? p : b), GRID[0])

function rng(seed) { let s = seed; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32) }

function transcript(policy, seed) {
  const rand = rng(seed)
  return Array.from({ length: 300 }, () => {
    const rival = GRID[Math.floor(rand() * GRID.length)]
    const price = rand() < 0.03 ? GRID[Math.floor(rand() * GRID.length)] : policy(rival)   // 3% trembles, as in the simulation
    return { price, rival, cost: 1, units: Math.round(1000 * share(price, rival)) }
  })
}

test('a seller that best-responds to its rival shows low regret', () => {
  const r = regretTest(transcript(bestReply, 1))
  assert.equal(r.level, 'independent', `regret ${r.regret}`)
})

test('a seller holding the monopoly price regardless of the rival shows high regret', () => {
  const r = regretTest(transcript(() => GRID[GRID.length - 1], 2))
  assert.equal(r.level, 'risk', `regret ${r.regret}`)
  assert.ok(r.gainByPrice[0].better < r.gainByPrice[0].price, 'the better alternative is a lower price')
})

test('too few periods or a price that never changes -> insufficient', () => {
  assert.equal(regretTest(transcript(bestReply, 3).slice(0, 10)).level, 'insufficient')
  assert.equal(regretTest(transcript(() => 1.6, 4).map((x) => ({ ...x, price: 1.6 }))).level, 'insufficient')
})

test('parseRecords reads flexible headers and rupee amounts', () => {
  const { rows, error } = parseRecords('date,my_price,units_sold,COGS,competitor_price\n2026-01-01,"₹1,299",42,820,1349')
  assert.equal(error, undefined)
  assert.deepEqual(rows[0], { price: 1299, units: 42, cost: 820, rival: 1349 })
})
