// Tests for the seller self-audit.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { parseLog, runAudit } from './audit.js'
import { sampleAuditSeries } from './replays.js'

const DAY = 864e5
const t0 = Date.parse('2026-01-01T06:00:00Z')
const fill = (n, v) => Array(n).fill(v)
const s = (name, prices) => ({ name, points: prices.map((price, i) => ({ t: t0 + i * DAY, price })) })

test('real CCI case replayed as a repricer log -> High risk, "you followed" evidence', () => {
  const x = sampleAuditSeries()
  const r = runAudit(x.series, { windowDays: x.windowDays })
  assert.equal(r.level, 'red')
  assert.equal(r.evidence[0].text, 'Followed Jet Airways’ price rises (3 of 3)')
  assert.ok(r.fixes.includes('Stop following competitors’ price rises'))
})

test('independent pricing -> Compliant', () => {
  const me = [...fill(6, 1000), ...fill(6, 1049), ...fill(6, 999), ...fill(6, 1049)]
  const rival = [...fill(3, 1500), ...fill(10, 1399), ...fill(11, 1449)]
  const r = runAudit([s('Mine', me), s('Rival', rival)])
  assert.equal(r.level, 'green')
  assert.deepEqual(r.fixes, ['No change needed'])
})

test('too little history -> Collecting', () => {
  assert.equal(runAudit([s('Mine', [1, 2, 3]), s('Rival', [1, 2, 3])]).level, 'collecting')
})

test('parseLog: long layout with Indian dates and ₹ amounts', () => {
  const { series, errors } = parseLog('date,product,price\n16/11/2012,Mine,"₹1,299"\n16/11/2012,Rival,1349\n17/11/2012,Mine,1299')
  assert.deepEqual(errors, [])
  assert.equal(series.length, 2)
  assert.equal(series[0].points[0].price, 1299)
  assert.equal(new Date(series[0].points[0].t).getMonth(), 10)
})

test('parseLog: wide layout keeps column order (first = yours)', () => {
  const { series } = parseLog('date,My shoe,Rival A,Rival B\n2026-01-01,999,1049,899\n2026-01-02,1049,1049,899')
  assert.deepEqual(series.map((x) => x.name), ['My shoe', 'Rival A', 'Rival B'])
})

test('headline stats and rival ranking on the real case', () => {
  const x = sampleAuditSeries()
  const r = runAudit(x.series, { windowDays: x.windowDays })
  assert.equal(r.stats.followRate, 83)          // 5 of 6 rival rises copied
  assert.equal(r.stats.flagged, 2)
  assert.ok(r.stats.reactionDays > 0 && r.stats.reactionDays <= 7)
  assert.ok(r.ranking[0].score >= r.ranking[1].score)
})

test('shared seller across rival listings is reported as evidence, not as a verdict', () => {
  const pts = (prices, seller) => prices.map((price, i) => ({ t: t0 + i * DAY, price, seller }))
  const me = [...fill(6, 1000), ...fill(6, 1049), ...fill(6, 999), ...fill(6, 1049)]
  const rival = [...fill(3, 1500), ...fill(10, 1399), ...fill(11, 1449)]
  const r = runAudit([{ name: 'Mine', points: pts(me, 'Cocoblu Retail') }, { name: 'Rival', points: pts(rival, 'Cocoblu Retail') }])
  assert.equal(r.level, 'green')
  assert.ok(r.evidence.some((e) => e.text === 'Same seller as Rival: Cocoblu Retail'))
  assert.ok(r.fixes.some((f) => f.startsWith('Shared seller')))
})

test('parseLog: wide layout keeps "yours" first even when your column starts empty', () => {
  const { series } = parseLog('date,Mine,Rival\n2026-01-01,,1349\n2026-01-02,1299,1349')
  assert.equal(series[0].name, 'Mine')
  assert.equal(series[0].points.length, 1)
})
