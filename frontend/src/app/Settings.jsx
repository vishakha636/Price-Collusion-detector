import { useEffect, useState } from 'react'
import { api } from '../watch/common'
import { VIEW_OPTIONS, WINDOW_OPTIONS, getSettings, saveSettings, viewLabel } from '../watch/settings'

function Choice({ options, value, onChange, label }) {
  return (
    <div className="a-tabs">
      {options.map((o) => <button key={o} data-on={value === o} onClick={() => onChange(o)}>{label(o)}</button>)}
    </div>
  )
}

export default function Settings() {
  const [s, setS] = useState(getSettings())
  const [ai, setAi] = useState(undefined)
  const [info, setInfo] = useState(null)
  const set = (patch) => setS(saveSettings(patch))
  const check = () => { setAi(undefined); api('/ai/status').then(setAi).catch(() => setAi(null)) }

  useEffect(() => {
    check()
    api('/products?days=1').then((d) => setInfo({ products: d.products.length, last: d.last_round, every: d.every_hours })).catch(() => setInfo(null))
  }, [])

  return (
    <div className="pg st">
      <div className="a-card">
        <h3>Detection</h3>
        <div className="st-row">
          <div><b>Data window</b><span>Prices shown and audited</span></div>
          <Choice options={VIEW_OPTIONS} value={s.viewDays} onChange={(v) => set({ viewDays: v })}
            label={(v) => (v ? (v >= 365 ? '1 year' : `${v} days`) : 'All')} />
        </div>
        <div className="st-row">
          <div><b>Response window</b><span>Max days between a move and the reply</span></div>
          <Choice options={WINDOW_OPTIONS} value={s.windowDays} onChange={(v) => set({ windowDays: v })}
            label={(v) => `${v} day${v > 1 ? 's' : ''}`} />
        </div>
        <div className="st-row">
          <div><b>Sale days</b><span>Days when 30%+ of a store’s listings move together</span></div>
          <Choice options={[true, false]} value={s.excludeMarket} onChange={(v) => set({ excludeMarket: v })}
            label={(v) => (v ? 'Exclude' : 'Include')} />
        </div>
      </div>

      <div className="a-card">
        <h3>AI analyst</h3>
        <div className="st-row">
          <div>
            <b>Google Gemini</b>
            <span>{ai === undefined ? 'Checking…' : ai?.connected ? `Connected · ${ai.model}` : ai === null ? 'Tracker offline' : 'Not connected · built-in analyst in use'}</span>
          </div>
          <span className={`ai-conn ${ai?.connected ? 'on' : ''}`}>{ai?.connected ? 'Connected' : 'Off'}</span>
        </div>
        {ai && !ai.connected && (
          <ol className="st-steps">
            <li>Get a free key at <a href="https://aistudio.google.com/apikey" target="_blank" rel="noreferrer">aistudio.google.com/apikey</a></li>
            <li>Create a file named <code>.env</code> in the project folder with one line: <code>GEMINI_API_KEY=your-key</code></li>
            <li>Restart the tracker, then <button className="a-link" onClick={check}>check again</button></li>
          </ol>
        )}
        <div className="st-hint">Key stored locally in .env · AI receives the audit summary only</div>
      </div>

      <div className="a-card">
        <h3>Monitoring</h3>
        <div className="st-row"><div><b>Products monitored</b></div><span>{info ? info.products : '—'}</span></div>
        <div className="st-row"><div><b>Collection</b><span>Flipkart, Myntra</span></div><span>{info ? `every ${info.every} h` : '—'}</span></div>
        <div className="st-row"><div><b>Last collection round</b></div><span>{info?.last ? new Date(info.last).toLocaleString('en-IN') : '—'}</span></div>
      </div>
    </div>
  )
}
