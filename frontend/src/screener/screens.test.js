// Run with: npm test   (plain Node, no extra dependencies)
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { CASES } from './cases.js'
import { parseRows, screenCase, screenTender } from './screens.js'

const ids = (r) => r.flags.map((f) => f.id)
const byId = Object.fromEntries(CASES.map((c) => [c.id, c]))

test('identical bids to the paisa are red', () => {
  const r = screenTender({ bids: [
    { bidder: 'A', amount: 17147.54 }, { bidder: 'B', amount: 17147.54 }, { bidder: 'C', amount: 17147.54 },
  ] })
  assert.equal(r.level, 'red')
  assert.ok(ids(r).includes('identical'))
})

test('one paisa apart is no longer identical, but still nearly identical', () => {
  const r = screenTender({ bids: [
    { bidder: 'A', amount: 17147.54 }, { bidder: 'B', amount: 17147.55 }, { bidder: 'C', amount: 19000 },
  ] })
  assert.ok(!ids(r).includes('identical'))
  assert.ok(ids(r).includes('near_identical'))
})

test('widely spread independent bids raise no flag', () => {
  const r = screenTender({ bids: [
    { bidder: 'A', amount: 100 }, { bidder: 'B', amount: 112 }, { bidder: 'C', amount: 127 },
  ] })
  assert.equal(r.level, 'green')
})

test('cover bidding: winner far below a tight cluster of losers', () => {
  const r = screenTender({ bids: [
    { bidder: 'W', amount: 200 }, { bidder: 'X', amount: 235 }, { bidder: 'Y', amount: 236 }, { bidder: 'Z', amount: 234 },
  ] })
  assert.ok(ids(r).includes('cover_gap'))
})

test('benchmark jump uses either a value or a stated percentage', () => {
  assert.ok(ids(screenTender({ benchmark: { value: 100 }, bids: [{ bidder: 'A', amount: 130 }, { bidder: 'B', amount: 150 }] }))
    .includes('benchmark_jump'))
  assert.ok(ids(screenTender({ benchmark: { pctAbove: 33 }, bids: [{ bidder: 'A', amount: 1 }, { bidder: 'B', amount: 2 }] }))
    .includes('benchmark_jump'))
})

// --- the real CCI cases -------------------------------------------------------

test('Railways feed valves (CCI: guilty) screens red', () => {
  assert.equal(screenCase(byId.railways.tenders).level, 'red')
})

test('Aluminium Phosphide (CCI: guilty) flags repeated identical bids', () => {
  const r = screenCase(byId.aluminium.tenders)
  assert.equal(r.level, 'red')
  assert.ok(r.patterns.some((p) => p.id === 'repeated_identical'))
})

test('Delhi Jal Board PAC (CCI: guilty) is caught without any identical bid', () => {
  const r = screenCase(byId.djb_pac.tenders)
  assert.ok(!r.results.some((t) => ids(t).includes('identical')))
  assert.equal(r.level, 'red')
  assert.ok(r.patterns.some((p) => p.id === 'persistent_band'))
  assert.ok(r.patterns.some((p) => p.id === 'always_last' && p.detail.startsWith('GACL')))
})

test('Delhi Jal Board chlorine (CCI: cleared) is flagged far more weakly than the cartels', () => {
  const lc = screenCase(byId.djb_chlorine.tenders)
  const alp = screenCase(byId.aluminium.tenders)
  // A screen should still send this to investigation -- the CCI did investigate it.
  assert.equal(lc.level, 'red')
  assert.ok(lc.counts.red < alp.counts.red)
  assert.ok(!lc.patterns.some((p) => p.id === 'persistent_band' || p.id === 'repeated_identical'))
})

test('every case has a source URL and a recorded outcome', () => {
  for (const c of CASES) {
    assert.match(c.url, /^https:\/\/(www\.)?cci\.gov\.in\//)
    assert.equal(typeof c.outcome.guilty, 'boolean')
  }
})

// --- pasted input ----------------------------------------------------------------

test('parseRows reads commas, tabs, ₹ and Indian thousand separators', () => {
  const { tenders, errors } = parseRows(
    'tender,bidder,amount\nT1,A,"₹17,147.54"\nT1\tB\t17147.54\nT2,A,Rs 1,00,000,2020-01-05',
  )
  assert.deepEqual(errors, [])
  assert.equal(tenders.length, 2)
  assert.equal(tenders[0].bids[0].amount, 17147.54)
  assert.equal(tenders[0].bids[1].amount, 17147.54)
  assert.equal(tenders[1].bids[0].amount, 100000)
  assert.equal(tenders[1].date, '2020-01-05')
})
