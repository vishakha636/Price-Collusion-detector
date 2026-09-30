import { useCallback, useEffect, useRef, useState } from 'react'
import { SITES, api, post, rupees } from './common'
import MarketCard from './MarketCard'
import PairCard from './PairCard'
import { REPLAYS } from './replays'
import Scan from './Scan'
import './watch.css'

const IDEAS = {
  flipkart: ['wireless earbuds', 'smartwatch', 'power bank 20000mah', 'basmati rice 5kg', 'mixer grinder', 'ceiling fan'],
  myntra: ['running shoes', 'mens t-shirts', 'kurta sets', 'sunglasses', 'backpacks', 'sneakers'],
}

// ---------------------------------------------------------------------------

function ProductInput({ n, site, value, onChange }) {
  const [info, setInfo] = useState(null)
  const [err, setErr] = useState(null)
  const [busy, setBusy] = useState(false)
  const timer = useRef()

  useEffect(() => {
    setInfo(null); setErr(null)
    if (!value.trim().startsWith('http')) return
    clearTimeout(timer.current)
    timer.current = setTimeout(async () => {
      setBusy(true)
      try { setInfo(await api(`/preview?url=${encodeURIComponent(value.trim())}`)) } catch (e) { setErr(e.message) }
      setBusy(false)
    }, 600)
    return () => clearTimeout(timer.current)
  }, [value])

  return (
    <div className="pin">
      <label>Product {n}</label>
      <input value={value} onChange={(e) => onChange(e.target.value)}
        placeholder={`Paste a ${site.label} product link`} spellCheck={false} />
      <div className="pin-status">
        {busy && <span className="dim">Checking…</span>}
        {err && <span className="bad">{err}</span>}
        {info && (
          <span className="good">
            <b>{info.brand}</b> · {info.name.slice(0, 60)}{info.name.length > 60 && '…'} · <b>{rupees(info.price)}</b>
          </span>
        )}
      </div>
    </div>
  )
}

function AddPair({ onAdded }) {
  const site = { label: 'Flipkart or Myntra' }
  const [a, setA] = useState('')
  const [b, setB] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)

  const start = async () => {
    setBusy(true); setErr(null)
    try {
      await post('/pairs', { url_a: a, url_b: b })
      setA(''); setB(''); onAdded()
    } catch (e) { setErr(e.message) }
    setBusy(false)
  }

  return (
    <div className="add-inner">
      <div className="pins">
        <ProductInput n={1} site={site} value={a} onChange={setA} />
        <div className="vs">vs</div>
        <ProductInput n={2} site={site} value={b} onChange={setB} />
      </div>

      <button className="go" onClick={start} disabled={busy || !a || !b}>
        {busy ? 'Reading both prices…' : 'Start watching these two'}
      </button>
      {err && <div className="bad" style={{ marginTop: 10 }}>{err}</div>}
    </div>
  )
}

// ---------------------------------------------------------------------------

function Replay() {
  const [sel, setSel] = useState(REPLAYS[0].id)
  const pair = REPLAYS.find((p) => p.id === sel)
  return (
    <div className="replay">
      <div className="tabs">
        {REPLAYS.map((p) => (
          <button key={p.id} className="tab" data-on={sel === p.id} onClick={() => setSel(p.id)}>
            {p.brand_a} vs {p.brand_b} · cargo fuel surcharge 2011–12
          </button>
        ))}
      </div>
      <div className="replay-card"><PairCard pair={pair} key={pair.id} /></div>
      <p className="dim" style={{ marginTop: 10 }}>{pair.cci.note}</p>
    </div>
  )
}

// ---------------------------------------------------------------------------

function SearchBar({ onScan, busy }) {
  const [site, setSite] = useState('flipkart')
  const [q, setQ] = useState('')
  const go = (query = q) => query.trim() && onScan(site, query.trim())
  return (
    <div className="searchbox">
      <div className="site-toggle">
        {SITES.map((s) => (
          <button key={s.id} data-on={site === s.id} disabled={!!s.off} title={s.off || ''}
            onClick={() => setSite(s.id)}>
            {s.label}{s.off && <small> blocked</small>}
          </button>
        ))}
      </div>
      <div className="search-row">
        <input value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && go()}
          placeholder="e.g. wireless earbuds" />
        <button className="go" onClick={() => go()} disabled={busy || !q.trim()}>
          {busy ? 'Scanning…' : 'Scan'}
        </button>
      </div>
      <div className="ideas">
        {IDEAS[site].map((i) => (
          <button key={i} className="chip idea" disabled={busy} onClick={() => { setQ(i); go(i) }}>{i}</button>
        ))}
      </div>
    </div>
  )
}

function Fold({ title, sub, children, open: initial = false }) {
  const [open, setOpen] = useState(initial)
  return (
    <div className="fold" data-open={open}>
      <button className="fold-head" onClick={() => setOpen(!open)}>
        <span className="caret">{open ? '▾' : '▸'}</span>
        <span><b>{title}</b>{sub && <span className="dim"> — {sub}</span>}</span>
      </button>
      {open && <div className="fold-body">{children}</div>}
    </div>
  )
}

export default function PriceWatch() {
  const [pairs, setPairs] = useState([])
  const [markets, setMarkets] = useState([])
  const [down, setDown] = useState(false)
  const [scan, setScan] = useState(null)
  const [scanErr, setScanErr] = useState(null)
  const [scanning, setScanning] = useState(false)
  const [collecting, setCollecting] = useState(false)
  const scanRef = useRef()

  const load = useCallback(async () => {
    try {
      const [p, m] = await Promise.all([api('/pairs'), api('/markets')])
      setPairs(p.pairs); setMarkets(m.markets); setDown(false)
    } catch { setDown(true) }
  }, [])

  useEffect(() => {
    load()
    const id = setInterval(load, 60000)
    return () => clearInterval(id)
  }, [load])

  const runScan = async (site, q) => {
    setScanning(true); setScanErr(null)
    try {
      setScan(await api(`/scan?site=${site}&q=${encodeURIComponent(q)}`))
      setTimeout(() => scanRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50)
    } catch (e) { setScanErr(e.message) }
    setScanning(false)
  }
  const collectNow = async () => {
    setCollecting(true)
    try { await api('/collect', { method: 'POST' }); await load() } catch { setDown(true) }
    setCollecting(false)
  }
  const removePair = async (id) => { await api(`/pairs/${id}`, { method: 'DELETE' }); load() }
  const removeMarket = async (id) => { await api(`/markets/${id}`, { method: 'DELETE' }); load() }
  const watchedScan = scan && markets.some((m) => m.site === scan.site && m.query.toLowerCase() === scan.query.toLowerCase())
  const nWatch = pairs.length + markets.length

  return (
    <div className="wrap watch">
      <header className="hero">
        <h1>Is anyone fixing prices?</h1>
        <p className="lede">Search any product to check its market.</p>
        <SearchBar onScan={runScan} busy={scanning} />
        {scanErr && <div className="bad" style={{ marginTop: 12 }}>{scanErr}</div>}
      </header>

      {down && (
        <div className="panel bad-panel">
          Tracker offline. Run <code>python -m tracker.server</code>
        </div>
      )}

      <div ref={scanRef}>
        {scan && (
          <Scan result={scan} watched={watchedScan}
            onWatchMarket={async () => { await post('/markets', { site: scan.site, query: scan.query }); await load() }}
            onWatchPair={async (a, b) => { await post('/pairs', { url_a: a, url_b: b }); await load() }} />
        )}
      </div>

      <section>
        <div className="list-head">
          <h2>Watching {nWatch > 0 && <span className="dim">({nWatch})</span>}</h2>
          <button className="tab" onClick={collectNow} disabled={collecting || down || !nWatch}>
            {collecting ? 'Checking…' : 'Refresh'}
          </button>
        </div>
        {nWatch === 0 && (
          <div className="panel dim">Nothing yet.</div>
        )}
        <div className="markets">
          {markets.map((m) => <MarketCard key={m.id} market={m} onRemove={removeMarket} />)}
        </div>
        {pairs.length > 0 && (
          <div className="pairs" style={{ marginTop: 20 }}>
            {pairs.map((p) => <PairCard key={p.id} pair={p} onRemove={removePair} />)}
          </div>
        )}
      </section>

      <section>
        <Fold open title="Example: a cartel the CCI caught">
          <Replay />
        </Fold>
        <Fold title="Compare two links">
          <AddPair onAdded={load} />
        </Fold>
      </section>

    </div>
  )
}
