// Tests for audit history and reminders (localStorage stubbed for Node).
import assert from 'node:assert/strict'
import { beforeEach, test } from 'node:test'

const store = new Map()
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
}
const { auditKey, dueReminders, getReminder, listRuns, saveRun, setReminder } = await import('./history.js')

const audit = (level, followRate, points) => ({
  level, points,
  me: { name: 'My shoe' },
  rivals: [{ name: 'Rival B' }, { name: 'Rival A' }],
  stats: { followRate, reactionDays: 1.5, flagged: level === 'green' ? 0 : 1, rivals: 2 },
})

beforeEach(() => store.clear())

test('key ignores rival order', () => {
  const a = audit('red', 80, 10)
  const b = { ...a, rivals: [{ name: 'Rival A' }, { name: 'Rival B' }] }
  assert.equal(auditKey(a), auditKey(b))
})

test('second run returns the first as "previous" for before/after', () => {
  const k = auditKey(audit('red', 80, 90))
  assert.equal(saveRun(k, audit('red', 80, 90)), null)
  const prev = saveRun(k, audit('amber', 56, 120))
  assert.equal(prev.level, 'red')
  assert.equal(prev.followRate, 80)
  assert.equal(listRuns(k).length, 2)
})

test('re-opening the same data does not log a duplicate run', () => {
  const k = 'x'
  saveRun(k, audit('red', 80, 90))
  saveRun(k, audit('red', 80, 90))
  assert.equal(listRuns(k).length, 1)
})

test('collecting audits are not logged', () => {
  saveRun('y', audit('collecting', null, 1))
  assert.equal(listRuns('y').length, 0)
})

test('monthly reminder: set, due in ~30 days, clear', () => {
  const r = setReminder('k', 'My shoe', true)
  assert.ok(Math.abs(r.due - Date.now() - 30 * 864e5) < 5000)
  assert.equal(dueReminders().length, 0)
  setReminder('k', 'My shoe', false)
  assert.equal(getReminder('k'), null)
})
