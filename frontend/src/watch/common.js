// Shared bits for the Price Watch page.

export async function api(path, opts) {
  const r = await fetch(`/api${path}`, opts)
  const body = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(body.error || `HTTP ${r.status}`)
  return body
}

export const post = (path, body) =>
  api(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })

export const rupees = (v) =>
  v == null ? '—' : '₹' + Number(v).toLocaleString('en-IN', { maximumFractionDigits: 2 })

export const LIGHT = {
  red: { label: 'Likely coordinating', color: '#d92d20' },
  amber: { label: 'Some signs — keep watching', color: '#e07b00' },
  green: { label: 'Looks independent', color: '#12a150' },
  collecting: { label: 'Collecting prices…', color: '#94a3b8' },
}

export const SITES = [
  { id: 'flipkart', label: 'Flipkart' },
  { id: 'myntra', label: 'Myntra' },
  { id: 'amazon', label: 'Amazon', off: 'Amazon blocks automated price checks with a CAPTCHA.' },
]

export const PALETTE = ['#0f2a4a', '#0c56a8', '#0891b2', '#e07b00', '#12a150', '#c11574', '#ea580c', '#2563eb', '#4d7c0f', '#9333ea']
