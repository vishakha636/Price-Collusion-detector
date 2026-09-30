// Audit history and monthly re-check reminders, kept in the browser
// (localStorage). A seller re-runs the audit after changing their repricer
// settings; comparing with the previous run shows whether the change worked.

const KEY = 'self-audit-history-v1'
const REMIND = 'self-audit-reminders-v1'
const MONTH = 30 * 864e5

const read = (k) => { try { return JSON.parse(localStorage.getItem(k)) || {} } catch { return {} } }
const write = (k, v) => localStorage.setItem(k, JSON.stringify(v))

/** Identify "the same audit": your product plus the same set of rivals. */
export const auditKey = (audit) => [audit.me.name, ...audit.rivals.map((r) => r.name).sort()].join(' | ')

export function listRuns(key) {
  return read(KEY)[key] || []
}

/** Save a run; returns the previous run (for before/after), if any. */
export function saveRun(key, audit, source) {
  if (audit.level === 'collecting') return listRuns(key)[0] || null
  const all = read(KEY)
  const runs = all[key] || []
  const snap = {
    at: Date.now(), level: audit.level, source,
    followRate: audit.stats.followRate, reactionDays: audit.stats.reactionDays,
    flagged: audit.stats.flagged, rivals: audit.stats.rivals,
    lastPoint: audit.points,
  }
  // same data re-opened -> don't log a duplicate run
  if (runs[0] && runs[0].lastPoint === snap.lastPoint && runs[0].level === snap.level && runs[0].followRate === snap.followRate) {
    return runs[1] || null
  }
  all[key] = [snap, ...runs].slice(0, 20)
  write(KEY, all)
  return runs[0] || null
}

export function clearRuns(key) {
  const all = read(KEY)
  delete all[key]
  write(KEY, all)
}

// --- reminders ---------------------------------------------------------------

export function getReminder(key) {
  return read(REMIND)[key] || null
}

export function setReminder(key, label, on) {
  const all = read(REMIND)
  if (on) all[key] = { label, due: Date.now() + MONTH }
  else delete all[key]
  write(REMIND, all)
  return all[key] || null
}

/** Reminders whose due date has passed, for the banner at the top of the page. */
export function dueReminders() {
  return Object.entries(read(REMIND)).filter(([, r]) => r.due <= Date.now()).map(([key, r]) => ({ key, ...r }))
}
