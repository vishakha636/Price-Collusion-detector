import { useEffect, useMemo, useState } from 'react'
import { api, post, rupees } from './common'

/**
 * Register a product in four steps:
 *   1 name + category   2 platforms (only working agents selectable)
 *   3 competitors found per platform   4 register -> My Products
 */
export default function Register({ onDone, onCancel }) {
  const [cats, setCats] = useState([])
  const [step, setStep] = useState(1)
  const [name, setName] = useState('')
  const [category, setCategory] = useState('')
  const [plats, setPlats] = useState([])
  const [found, setFound] = useState(null)          // discovery results per platform
  const [own, setOwn] = useState({})                // platform -> listing id chosen as yours
  const [picked, setPicked] = useState({})          // listing id -> bool (competitors kept)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)

  useEffect(() => { api('/categories').then((d) => setCats(d.categories)).catch((e) => setErr(e.message)) }, [])
  const cat = cats.find((c) => c.key === category)

  const discover = async () => {
    setBusy(true); setErr(null)
    try {
      const d = await post('/discover', { name, category, platforms: plats })
      setFound(d.results)
      setOwn(Object.fromEntries(d.results.filter((r) => r.own).map((r) => [r.platform, r.own.id])))
      setPicked(Object.fromEntries(d.results.flatMap((r) => r.competitors.map((c) => [c.id, true]))))
      setStep(3)
    } catch (e) { setErr(e.message) }
    setBusy(false)
  }

  const payload = useMemo(() => {
    if (!found) return null
    const listing = (r, id) => [...(r.candidates || []), ...r.competitors, r.own].find((x) => x && x.id === id)
    const ownL = found.filter((r) => own[r.platform]).map((r) => ({ ...listing(r, own[r.platform]), platform: r.platform }))
    const comps = found.flatMap((r) => r.competitors.filter((c) => picked[c.id] && c.id !== own[r.platform])
      .map((c) => ({ ...c, platform: r.platform })))
    return { name, category, platforms: found.filter((r) => own[r.platform]).map((r) => r.platform), own: ownL, competitors: comps }
  }, [found, own, picked, name, category])

  const register = async () => {
    setBusy(true); setErr(null)
    try { const p = await post('/products', payload); onDone(p) } catch (e) { setErr(e.message) }
    setBusy(false)
  }
  const label = (key) => cat?.platforms.find((p) => p.key === key)?.label || key

  return (
    <div className="r-wrap">
      <div className="r-steps">
        {['Product', 'Platforms', 'Competitors', 'Register'].map((s, i) => (
          <div key={s} className="r-step" data-on={step === i + 1} data-done={step > i + 1}><span>{i + 1}</span>{s}</div>
        ))}
      </div>

      {step === 1 && (
        <div className="r-card">
          <label className="r-lab">Product name</label>
          <input className="r-in" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. boAt Airdopes 311 Pro" />
          <label className="r-lab">Category</label>
          <select className="r-in" value={category} onChange={(e) => { setCategory(e.target.value); setPlats([]) }}>
            <option value="">Choose…</option>
            {cats.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
          </select>
          <div className="r-actions">
            <button className="a-link" onClick={onCancel}>Cancel</button>
            <button className="a-btn" disabled={!name.trim() || !category} onClick={() => setStep(2)}>Next</button>
          </div>
        </div>
      )}

      {step === 2 && cat && (
        <div className="r-card">
          <div className="r-plats">
            {cat.platforms.map((p) => {
              const on = plats.includes(p.key)
              return (
                <button key={p.key} className="r-plat" data-on={on} disabled={!p.ready} title={p.note || ''}
                  onClick={() => setPlats((cur) => (cur.includes(p.key) ? cur.filter((x) => x !== p.key) : [...cur, p.key]))}>
                  <b>{p.label}</b>
                  <small>{p.ready ? (on ? '✓ selected' : 'ready') : 'agent not ready'}</small>
                </button>
              )
            })}
          </div>
          <div className="r-actions">
            <button className="a-link" onClick={() => setStep(1)}>Back</button>
            <button className="a-btn" disabled={!plats.length || busy} onClick={discover}>
              {busy ? 'Searching…' : 'Find competitors'}
            </button>
          </div>
        </div>
      )}

      {step >= 3 && found && (
        <div className="r-card">
          <table className="a-table r-sum">
            <thead><tr><th>Platform</th><th>Your listing</th><th>Competitors found</th><th>Count</th></tr></thead>
            <tbody>
              {found.map((r) => (
                <tr key={r.platform}>
                  <td><b>{label(r.platform)}</b></td>
                  <td>
                    {r.error ? <span className="a-err">{r.error}</span> : (
                      <select className="r-own" value={own[r.platform] || ''}
                        onChange={(e) => setOwn({ ...own, [r.platform]: e.target.value })}>
                        <option value="">— not listed here —</option>
                        {(r.candidates || []).map((c) => (
                          <option key={c.id} value={c.id}>{c.brand} · {c.name.slice(0, 50)} · {rupees(c.price)}</option>
                        ))}
                      </select>
                    )}
                  </td>
                  <td>
                    <div className="r-comps">
                      {r.competitors.map((c) => (
                        <label key={c.id} className="r-comp" data-on={!!picked[c.id]}>
                          <input type="checkbox" checked={!!picked[c.id]} onChange={(e) => setPicked({ ...picked, [c.id]: e.target.checked })} />
                          <b>{c.brand}</b> {rupees(c.price)}
                        </label>
                      ))}
                    </div>
                  </td>
                  <td className="r-count">{r.competitors.filter((c) => picked[c.id]).length}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {err && <div className="a-err">{err}</div>}
          <div className="r-actions">
            <button className="a-link" onClick={() => setStep(2)}>Back</button>
            <button className="a-btn" disabled={busy || !payload?.own.length || !payload?.competitors.length} onClick={register}>
              {busy ? 'Registering…' : 'Register this product'}
            </button>
          </div>
        </div>
      )}
      {err && step < 3 && <div className="a-err">{err}</div>}
    </div>
  )
}
