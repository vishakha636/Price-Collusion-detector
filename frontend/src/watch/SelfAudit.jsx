import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ConfidenceChip } from './Explain'
import {
  CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts'
import { axisStyle as axis, chartTooltip } from '../lib/chartStyle'
import { STATUS, TEMPLATE, parseLog, runAudit } from './audit'
import { api, post, rupees } from './common'
import { auditKey, dueReminders, getReminder, listRuns, saveRun, setReminder } from './history'
import RegretTab from './RegretTab'
import './audit.css'

const MINE = '#0c56a8'
const RIVALS = ['#e07b00', '#7a8898', '#0891b2', '#c11574', '#12a150']

// ---------------------------------------------------------------------------
// Result

function AuditChart({ audit, unit, chartRef }) {
  const { series, times, pct } = useMemo(() => {
    const all = [audit.me, ...audit.rivals.map((r) => ({ name: r.name, points: r.rounds.map((x) => ({ t: x.t, price: x.b })) }))]
    const s = [{ name: audit.me.name, points: audit.me.points }, ...all.slice(1)]
    const vals = s.flatMap((x) => x.points.map((p) => p.price)).filter((v) => v != null)
    const t = [...new Set(s.flatMap((x) => x.points.map((p) => +new Date(p.t))))].sort((a, b) => a - b)
    return { series: s, times: t, pct: Math.max(...vals) / Math.min(...vals) > 3 }
  }, [audit])

  const long = times.length > 1 && times[times.length - 1] - times[0] > 120 * 864e5
  const data = times.map((t) => {
    const row = { t: new Date(t).toLocaleDateString('en-IN', long ? { month: 'short', year: '2-digit' } : { day: 'numeric', month: 'short' }) }
    for (const s of series) {
      const p = s.points.find((x) => +new Date(x.t) === t)?.price
      const base = s.points.find((x) => x.price != null)?.price
      if (p != null) row[s.name] = pct ? ((p - base) / base) * 100 : p
    }
    return row
  })
  return (
    <div ref={chartRef}>
      <ResponsiveContainer width="100%" height={250}>
        <LineChart data={data} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
          <CartesianGrid stroke="#e6ebf2" vertical={false} />
          <XAxis dataKey="t" {...axis} interval="preserveStartEnd" minTickGap={40} />
          <YAxis {...axis} width={54} tickFormatter={(v) => (pct ? `${v > 0 ? '+' : ''}${v.toFixed(0)}%` : rupees(v))} />
          <Tooltip {...chartTooltip} formatter={(v) => (pct ? `${v > 0 ? '+' : ''}${Number(v).toFixed(1)}%` : rupees(v))} />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          {series.map((s, i) => (
            <Line key={s.name} type="stepAfter" dataKey={s.name} dot={false} connectNulls isAnimationActive={false}
              stroke={i === 0 ? MINE : RIVALS[(i - 1) % RIVALS.length]} strokeWidth={i === 0 ? 3 : 1.8}
              strokeDasharray={i === 0 ? undefined : '6 3'} />
          ))}
        </LineChart>
      </ResponsiveContainer>
      {pct && <div className="a-cap">% change</div>}
    </div>
  )
}

const ratio = ({ k, n }) => (n ? `${k} of ${n}` : '—')
const days = (d) => (d == null ? '—' : d < 1 ? '< 1 day' : `${d.toFixed(1)} days`)
const fmtDate = (t) => new Date(t).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })

/** "High risk → Review · follow rate ↓ 24pt vs last run" */
function compareLine(prev, audit) {
  if (!prev) return null
  const parts = [`${STATUS[prev.level].label} → ${audit.status.label}`]
  if (prev.followRate != null && audit.stats.followRate != null) {
    const d = audit.stats.followRate - prev.followRate
    if (d !== 0) parts.push(`follow rate ${d < 0 ? '↓' : '↑'} ${Math.abs(d)}pt`)
  }
  return { text: `${parts.join(' · ')} vs last run (${fmtDate(prev.at)})`, better: STATUS_RANK[audit.level] < STATUS_RANK[prev.level] }
}
const STATUS_RANK = { green: 0, amber: 1, red: 2, collecting: -1 }

function Stat({ label, value, sub }) {
  return <div className="a-stat"><span>{label}</span><b>{value}</b>{sub && <small>{sub}</small>}</div>
}

function Ranking({ audit }) {
  return (
    <div className="a-rank">
      {audit.ranking.map((r) => {
        const s = STATUS[r.result.level]
        return (
          <div className="a-rank-row" key={r.name}>
            <div className="a-rank-head">
              <b>{r.name}</b>
              <span className="a-pill" style={{ '--c': s.color }}>{s.label}</span>
            </div>
            <div className="a-bar"><div style={{ width: `${r.score ?? 0}%`, background: s.color }} /></div>
            <div className="a-rank-sub">
              {r.score == null ? 'Collecting' : `${r.score}/100`} · {r.iFollowUp.k}/{r.iFollowUp.n} rises copied
            </div>
          </div>
        )
      })}
    </div>
  )
}

function History({ hkey, runs, reminder, onToggle }) {
  return (
    <div className="a-card">
      <h3>History</h3>
      {runs.length ? (
        <ul className="a-hist">
          {runs.slice(0, 5).map((r) => (
            <li key={r.at}>
              <span>{fmtDate(r.at)}</span>
              <span className="a-pill" style={{ '--c': STATUS[r.level].color }}>{STATUS[r.level].label}</span>
              <span className="a-muted">{r.followRate != null ? `${r.followRate}%` : ''}</span>
            </li>
          ))}
        </ul>
      ) : null}
      <label className="a-toggle">
        <input type="checkbox" checked={!!reminder} onChange={(e) => onToggle(hkey, e.target.checked)} />
        <span>Monthly reminder</span>
        {reminder && <em>{fmtDate(reminder.due)}</em>}
      </label>
    </div>
  )
}

export function Result({ audit, meta, prev, runs, reminder, onToggleReminder, hkey }) {
  const chartRef = useRef()
  const st = audit.status
  const cmp = compareLine(prev, audit)
  const s = audit.stats
  return (
    <section className="a-result" id="audit-result">
      <div className="a-status" style={{ '--c': st.color }}>
        <div className="a-badge">{st.label}</div>
        <div>
          <div className="a-status-line">{audit.me.name}</div>
          <div className="a-meta">
            vs {audit.rivals.map((r) => r.name).join(', ')} · {Math.round(audit.span)} days · {audit.points} snapshots
            {audit.medianGap > 1.5 && ` · every ~${Math.round(audit.medianGap)} days`}
          </div>
        </div>
        <button className="a-btn ghost" onClick={() => printReport(audit, meta, chartRef.current, cmp)}>
          Report
        </button>
      </div>

      <div className="a-row" style={{ marginTop: 10 }}>
        {cmp && <div className={`a-compare ${cmp.better ? 'up' : 'down'}`}>{cmp.text}</div>}
        {meta.source && <div className="a-source">{meta.source}</div>}
        <ConfidenceChip c={audit.confidence} />
      </div>

      <div className="a-stats">
        <Stat label="Price rises you followed" value={s.followRate == null ? '—' : `${s.followRate}%`} />
        <Stat label="How fast you responded" value={days(s.reactionDays)} />
        <Stat label="Competitors of concern" value={`${s.flagged}/${s.rivals}`} />
        <Stat label="Your price changes" value={s.changes} />
      </div>

      <div className="a-grid">
        <div className="a-card">
          <h3>Rivals</h3>
          <Ranking audit={audit} />
        </div>
        <div className="a-card">
          <h3>Prices</h3>
          <AuditChart audit={audit} unit={meta.unit} chartRef={chartRef} />
        </div>
      </div>

      <div className="a-grid three">
        <div className="a-card">
          <h3>Evidence</h3>
          {audit.evidence.length ? (
            <ul className="a-evidence">
              {audit.evidence.slice(0, 3).map((e, i) => <li key={i} data-w={e.w}>{e.text}</li>)}
            </ul>
          ) : <p className="a-muted">{audit.level === 'collecting' ? 'Collecting…' : 'None'}</p>}
        </div>
        <div className="a-card">
          <h3>Fix</h3>
          <ol className="a-fixes">{audit.fixes.slice(0, 3).map((f, i) => <li key={i}>{f}</li>)}</ol>
        </div>
        <History hkey={hkey} runs={runs} reminder={reminder} onToggle={onToggleReminder} />
      </div>
    </section>
  )
}

// ---------------------------------------------------------------------------
// PDF report: a clean one-page document in a new window, then the browser's
// own "Save as PDF". The chart is the live SVG, copied across.

export function printReport(audit, meta, chartEl, cmp) {
  const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]))
  const svg = chartEl?.querySelector('svg.recharts-surface')?.outerHTML || ''
  const rows = audit.ranking.map((r) => `<tr><td>${esc(r.name)}</td><td>${r.score ?? '—'}</td><td>${ratio(r.iFollowUp)}</td><td>${ratio(r.theyFollowUp)}</td><td>${STATUS[r.result.level].label}</td></tr>`).join('')
  const st = audit.stats
  // Print from a hidden iframe rather than a pop-up window, which browsers block.
  document.getElementById('audit-print')?.remove()
  const frame = document.createElement('iframe')
  frame.id = 'audit-print'
  frame.style.cssText = 'position:fixed;width:0;height:0;border:0;right:0;bottom:0'
  document.body.appendChild(frame)
  const w = frame.contentWindow
  w.document.open()
  w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Pricing self-audit — ${esc(audit.me.name)}</title>
<style>
  body{font:13px/1.5 'Segoe UI',Roboto,sans-serif;color:#0f2a4a;margin:32px 40px}
  header{border-bottom:3px solid #f69321;padding-bottom:10px;margin-bottom:18px;display:flex;justify-content:space-between;align-items:flex-end}
  h1{font-size:20px;color:#0c56a8;margin:0} h2{font-size:14px;color:#0c56a8;margin:20px 0 6px}
  .status{display:inline-block;padding:6px 12px;border-radius:6px;color:#fff;font-weight:700;background:${audit.status.color}}
  table{border-collapse:collapse;width:100%} th,td{border:1px solid #d9e1ec;padding:6px 8px;text-align:left} th{background:#f0f5ff}
  .muted{color:#56667a;font-size:11.5px} svg{max-width:100%;height:auto}
  footer{margin-top:28px;border-top:1px solid #d9e1ec;padding-top:8px;color:#56667a;font-size:11px}
</style></head><body>
<header><div><h1>Pricing Self-Audit Report</h1><div class="muted">Price Collusion Detector</div></div>
<div class="muted">${new Date().toLocaleString('en-IN')}</div></header>
<p><b>Product audited:</b> ${esc(audit.me.name)}<br><b>Rivals:</b> ${audit.rivals.map((r) => esc(r.name)).join(', ')}<br>
<b>Data:</b> ${audit.points} readings over ${Math.round(audit.span)} days${meta.source ? ` · ${esc(meta.source)}` : ''}</p>
<p><span class="status">${audit.status.label}</span> &nbsp;${esc(audit.status.short)}</p>
${cmp ? `<p><b>Compared with last run:</b> ${esc(cmp.text)}</p>` : ''}
<table><tr><th>Rival rises you copied</th><th>Reaction time</th><th>Rivals flagged</th><th>Your price changes</th></tr><tr><td>${st.followRate == null ? '—' : st.followRate + '%'}</td><td>${days(st.reactionDays)}</td><td>${st.flagged} of ${st.rivals}</td><td>${st.changes}</td></tr></table>
<h2>Evidence</h2><ul>${audit.evidence.slice(0, 6).map((e) => `<li>${esc(e.text)}</li>`).join('') || '<li>No coordination signs.</li>'}</ul>
<h2>Which rival is the problem</h2><table><tr><th>Rival</th><th>Score (0–100)</th><th>You follow their rises</th><th>They follow yours</th><th>Status</th></tr>${rows}</table>
<h2>Price history</h2>${svg}
<h2>Recommended changes</h2><ol>${audit.fixes.map((f) => `<li>${esc(f)}</li>`).join('')}</ol>
<footer>Automated screening of price data, in the spirit of the self-audit recommended in the CCI's 2025 Market Study on AI and Competition.
A flag is a reason to review pricing rules, not a finding of collusion, and not legal advice.</footer>
</body></html>`)
  w.document.close()
  setTimeout(() => { w.focus(); w.print() }, 300)
}

// ---------------------------------------------------------------------------
// Inputs

function UploadTab({ onAudit }) {
  const [parsed, setParsed] = useState(null)
  const [mine, setMine] = useState(0)
  const [err, setErr] = useState(null)
  const [drag, setDrag] = useState(false)
  const input = useRef()

  const load = (text) => {
    const r = parseLog(text)
    if (r.series.length < 2) { setErr(r.errors[0] || 'Could not read that file.'); setParsed(null); return }
    setErr(null); setParsed(r); setMine(0)
    onAudit(r.series, {})
  }
  const readFile = (f) => f && f.text().then(load)
  const pick = (i) => {
    setMine(i)
    const s = [parsed.series[i], ...parsed.series.filter((_, j) => j !== i)]
    onAudit(s, {})
  }
  // Real price histories imported from the Internet Archive (tracker/archive.py)
  const [histories, setHistories] = useState([])
  useEffect(() => {
    fetch(`${import.meta.env.BASE_URL}history/index.json`).then((r) => (r.ok ? r.json() : [])).then(setHistories).catch(() => {})
  }, [])
  const openHistory = async (key) => {
    const d = await (await fetch(`${import.meta.env.BASE_URL}history/${key}.json`)).json()
    const series = d.series.filter((x) => x.points.length).map((x) => ({
      name: x.name, points: x.points.map((pt) => ({ t: pt.t, price: pt.price, seller: pt.seller })),
    }))
    // snapshots are irregular: allow a response window of ~2 typical gaps (3–10 days)
    const days = [...new Set(series.flatMap((x) => x.points.map((pt) => pt.t)))].sort()
    const gaps = days.slice(1).map((t, i) => (Date.parse(t) - Date.parse(days[i])) / 864e5).sort((a, b) => a - b)
    const gap = gaps.length ? gaps[Math.floor(gaps.length / 2)] : 1
    setParsed(null); setErr(null)
    onAudit(series, { windowDays: Math.min(10, Math.max(3, Math.ceil(gap * 2))), source: `Internet Archive · ${d.title}` })
  }

  const template = () => {
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob([TEMPLATE], { type: 'text/csv' }))
    a.download = 'repricer-log-template.csv'
    a.click()
  }

  return (
    <div>
      <div className={`a-drop${drag ? ' on' : ''}`}
        onClick={() => input.current.click()}
        onDragOver={(e) => { e.preventDefault(); setDrag(true) }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => { e.preventDefault(); setDrag(false); readFile(e.dataTransfer.files[0]) }}>
        <div className="a-drop-icon">⤓</div>
        <b>Drop CSV</b>
        <input ref={input} type="file" accept=".csv,.txt,.tsv" hidden onChange={(e) => readFile(e.target.files[0])} />
      </div>
      <div className="a-row">
        {histories.map((h) => (
          <button key={h.key} className="a-btn ghost" onClick={() => openHistory(h.key)}>{h.title.split(' · ')[0]}</button>
        ))}
        <button className="a-link" onClick={template}>Template</button>
      </div>
      {err && <div className="a-err">{err}</div>}
      {parsed && (
        <div className="a-row">
          <label className="a-label">You:</label>
          <select value={mine} onChange={(e) => pick(+e.target.value)}>
            {parsed.series.map((s, i) => <option key={s.name} value={i}>{s.name}</option>)}
          </select>
        </div>
      )}
    </div>
  )
}

function LiveTab({ onAudit }) {
  const [urls, setUrls] = useState(['', '', ''])
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)
  const [audits, setAudits] = useState([])
  const [down, setDown] = useState(false)

  const load = useCallback(async () => {
    try { setAudits((await api('/audits')).audits); setDown(false) } catch { setDown(true) }
  }, [])
  useEffect(() => { load() }, [load])

  const set = (i, v) => setUrls(urls.map((u, j) => (j === i ? v : u)))
  const start = async () => {
    setBusy(true); setErr(null)
    try { await post('/audits', { urls: urls.filter((u) => u.trim()) }); setUrls(['', '', '']); await load() } catch (e) { setErr(e.message) }
    setBusy(false)
  }
  const open = (a) => {
    // brand name, or the first words of the product name when a brand repeats
    const brands = a.products.map((p) => p.brand || '')
    const uniq = a.products.map((p) =>
      p.brand && brands.filter((b) => b === p.brand).length === 1
        ? p.brand : p.name.replace(/[,(].*$/, '').split(' ').slice(0, 3).join(' '))
    onAudit(a.products.map((_, i) => ({
      name: uniq[i],
      points: a.rounds.filter((r) => r.prices[i] != null).map((r) => ({ t: r.t, price: r.prices[i] })),
    })), {})
  }
  const remove = async (id) => { await api(`/audits/${id}`, { method: 'DELETE' }); load() }

  return (
    <div>
      {down && <div className="a-err">Tracker offline. Run <code>python -m tracker.server</code></div>}
      <div className="a-urls">
        {urls.map((u, i) => (
          <div className="a-url" key={i}>
            <span className={i === 0 ? 'a-tag mine' : 'a-tag'}>{i === 0 ? 'You' : `Rival ${i}`}</span>
            <input value={u} onChange={(e) => set(i, e.target.value)}
              placeholder={i === 0 ? 'Your product link' : 'Rival link'} />
          </div>
        ))}
      </div>
      <div className="a-row">
        <button className="a-btn" onClick={start} disabled={busy || !urls[0] || !urls[1]}>
          {busy ? '…' : 'Track'}
        </button>
        {urls.length < 6 && <button className="a-link" onClick={() => setUrls([...urls, ''])}>+ rival</button>}
      </div>
      {err && <div className="a-err">{err}</div>}

      {audits.length > 0 && (
        <div className="a-live">
          {audits.map((a) => {
            const days = a.rounds.length > 1 ? Math.floor((Date.parse(a.rounds[a.rounds.length - 1].t) - Date.parse(a.rounds[0].t)) / 864e5) : 0
            return (
              <div className="a-live-row" key={a.id}>
                <div>
                  <b>{a.products[0].brand || a.products[0].name.slice(0, 30)}</b>
                  <span className="a-muted"> · day {days}</span>
                </div>
                <div className="a-row" style={{ margin: 0 }}>
                  <button className="a-link" onClick={() => open(a)}>Open</button>
                  <button className="a-link danger" onClick={() => remove(a.id)}>Remove</button>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------

export default function SelfAudit() {
  const [tab, setTab] = useState('upload')
  const [run, setRun] = useState(null)
  const [due, setDue] = useState(() => dueReminders())

  const onAudit = (series, meta) => {
    const audit = runAudit(series, { windowDays: meta.windowDays })
    const hkey = auditKey(audit)
    const prev = saveRun(hkey, audit, meta.source || 'upload')
    setRun({ audit, meta, hkey, prev, runs: listRuns(hkey), reminder: getReminder(hkey) })
    setTimeout(() => document.getElementById('audit-result')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 60)
  }
  const toggleReminder = (hkey, on) => {
    const reminder = setReminder(hkey, run.audit.me.name, on)
    setRun({ ...run, reminder })
    setDue(dueReminders())
  }

  return (
    <div className="pg">
      {due.length > 0 && (
        <div className="a-due">
          Audit due: {due.map((d) => d.label).join(', ')}
        </div>
      )}

      <div className="a-input">
        <div className="a-tabs">
          <button data-on={tab === 'upload'} onClick={() => setTab('upload')}>Upload log</button>
          <button data-on={tab === 'live'} onClick={() => setTab('live')}>Track live</button>
          <button data-on={tab === 'regret'} onClick={() => setTab('regret')}>Regret test</button>
        </div>
        <div className="a-tab-body">
          {tab === 'upload' && <UploadTab onAudit={onAudit} />}
          {tab === 'live' && <LiveTab onAudit={onAudit} />}
          {tab === 'regret' && <RegretTab />}
        </div>
      </div>

      {run && (
        <Result audit={run.audit} meta={run.meta} prev={run.prev} runs={run.runs}
          reminder={run.reminder} onToggleReminder={toggleReminder} hkey={run.hkey} />
      )}

    </div>
  )
}
