// Short, factual readings of an audit for the top of the product page.
// The full numbers stay under "Details".

const ORDER = ['copy', 'match', 'gap', 'theyCopy']

/** One fact per competitor: the strongest warning sign, or "Independent". */
export function rivalLine(r) {
  if (!r || r.result.status !== 'ready') return { tone: 'wait', text: 'Too little data' }
  if (r.result.level === 'green') return { tone: 'ok', text: 'Independent' }
  const tone = r.result.level === 'red' ? 'bad' : 'warn'
  const met = (r.why || []).filter((w) => w.met).sort((a, b) => ORDER.indexOf(a.key) - ORDER.indexOf(b.key))
  if (!met.length) {
    // verdict from "raise together", counted in both directions
    const sign = r.result.signs.find((x) => x.strong)
    const n = sign?.detail.match(/^(\d+) of (\d+)/)
    return { tone, text: sign?.id === 'rise_together' ? `Raise prices together${n ? ` · ${n[1]}/${n[2]}` : ''}` : SIGN[sign?.id] || 'Review' }
  }
  const w = met[0]
  const n = w.measured ? `${w.measured.k}/${w.measured.n}` : ''   // only the "rises" signals have counts
  const text = w.key === 'copy' ? `You followed their rises · ${n}`
    : w.key === 'theyCopy' ? `They followed your rises · ${n}`
    : w.key === 'gap' ? (w.label === 'Always the same price' ? 'Same price' : 'Fixed price gap')
    : 'Match discounts, never lower'
  return { tone, text }
}

/** Short names for the three verdict signs (analyze.js). */
export const SIGN = {
  rise_together: 'Raise prices together',
  match_not_beat: 'Match discounts, never lower',
  frozen_gap: 'Fixed price gap',
}

/** Facts for the whole product: how many competitors are flagged, and which. */
export function verdictLine(audit) {
  if (audit.level === 'collecting') return 'Collecting data'
  const flagged = audit.ranking.filter((r) => r.result.level === 'red' || r.result.level === 'amber').map((r) => r.name)
  if (!flagged.length) return `0 of ${audit.rivals.length} competitors flagged`
  return `${flagged.length} of ${audit.rivals.length} flagged · ${flagged.join(', ')}`
}

/** How sure, and on how much data. */
export function sureLine(c) {
  if (!c || c.level === 'none') return 'Needs more data'
  return `${c.label} · ${c.days} days · ${c.moves} price changes`
}
