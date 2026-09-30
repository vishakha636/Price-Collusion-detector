import { useMemo, useState } from 'react'
import BidChart from './BidChart'
import { CASES, TOOLKIT_URL } from './cases'
import { VERDICT, inr, parseRows, screenCase, screenTender } from './screens'
import './screener.css'

function Section({ num, title, sub, children }) {
  return (
    <section>
      <h2><span className="num">{num}</span>{title}</h2>
      {sub && <p className="sub">{sub}</p>}
      {children}
    </section>
  )
}

function Light({ level, big }) {
  const v = VERDICT[level]
  return (
    <span className={`light${big ? ' big' : ''}`} style={{ '--c': v.color }}>
      <span className="bulb" />{v.label}
    </span>
  )
}

function Flag({ f }) {
  return (
    <div className="flag" data-level={f.level}>
      <div className="flag-head">
        <span className="flag-dot" />
        <b>{f.title}</b>
      </div>
      <div className="flag-detail">{f.detail}</div>
      <div className="flag-cci">{f.cci}</div>
    </div>
  )
}

function Flags({ flags, empty = 'No red flags from the CCI checklist.' }) {
  const shown = flags.filter((f) => f.level !== 'green')
  if (!shown.length) return <div className="flag-empty">✓ {empty}</div>
  const order = { red: 0, amber: 1, info: 2 }
  return (
    <div className="flags">
      {[...shown].sort((a, b) => order[a.level] - order[b.level]).map((f, i) => <Flag f={f} key={i} />)}
    </div>
  )
}

// ---------------------------------------------------------------------------

function CaseView({ c }) {
  const r = useMemo(() => screenCase(c.tenders), [c])
  const allIdentical = new Set()
  for (const t of r.results) {
    const seen = new Map()
    for (const b of t.tender.bids) seen.set(b.amount, (seen.get(b.amount) || 0) + 1)
    for (const [amt, n] of seen) if (n > 1) allIdentical.add(`${t.tender.id}|${amt}`)
  }

  return (
    <>
      <div className="panel case-top">
        <div className="case-story">
          <div className="case-meta">
            <span className="chip">{c.caseNo}</span>
            <span className="chip">order {c.orderDate}</span>
            <span className="chip">{c.tenders.length} tender{c.tenders.length > 1 ? 's' : ''}</span>
          </div>
          <h3>{c.title}</h3>
          <div className="case-buyer">Buyer: {c.buyer}</div>
          <p>{c.story}</p>
          <a className="src" href={c.url} target="_blank" rel="noreferrer">
            Read the CCI order (PDF) ↗
          </a>
          <span className="src-note"> · figures from {c.source}</span>
        </div>

        <div className="versus">
          <div className="vbox">
            <div className="vk">This screener says</div>
            <Light level={r.level} big />
            <div className="vn">
              {r.counts.red} red flag{r.counts.red !== 1 && 's'} · {r.counts.amber} warning{r.counts.amber !== 1 && 's'}
            </div>
          </div>
          <div className="vbox">
            <div className="vk">What the CCI decided</div>
            <span className={`outcome ${c.outcome.guilty ? 'guilty' : 'cleared'}`}>
              {c.outcome.guilty ? 'Guilty' : 'Cleared'}
            </span>
            <div className="vn">{c.outcome.headline}</div>
          </div>
        </div>
      </div>

      {!c.outcome.guilty && (
        <div className="note warn-note">
          <b>Why the screener and the CCI disagree here — and why that is correct.</b> A screen decides
          which tenders deserve a closer look; it does not decide guilt. The CCI <i>did</i> investigate this
          case, which is exactly what a red flag should trigger. It closed it because the law needs
          "plus factors" beyond similar prices, and none were found. Notice how much weaker the evidence
          is than in the real cartels: one identical pair instead of seventeen, and no year-after-year
          pattern.
        </div>
      )}

      <div className="grid-2" style={{ marginTop: 20 }}>
        <div className="panel">
          <div className="ptitle">Every bid, tender by tender <span className="unit">({c.unit})</span></div>
          <div className="psub">Lines that stick together = bidders quoting alike. Dots on top of each other = identical bids.</div>
          <BidChart tenders={c.tenders} results={r.results} />
        </div>
        <div className="panel">
          <div className="ptitle">Patterns across all tenders</div>
          <div className="psub">Things you can only see by lining up several tenders side by side.</div>
          <Flags flags={r.patterns} empty="No pattern across tenders." />
        </div>
      </div>

      <div className="panel" style={{ marginTop: 20 }}>
        <div className="ptitle">Tender-by-tender check</div>
        <div className="psub">Click a row to see why it was flagged.</div>
        <TenderTable results={r.results} identical={allIdentical} />
      </div>

      <div className="grid-2" style={{ marginTop: 20 }}>
        <div className="panel">
          <div className="ptitle">What the CCI found</div>
          <p className="finding">{c.outcome.finding}</p>
          {c.outcome.penalties.length > 0 && (
            <div className="tbl-wrap">
              <table>
                <thead><tr><th>Company</th><th>Penalty</th></tr></thead>
                <tbody>
                  {c.outcome.penalties.map((p) => (
                    <tr key={p.firm} style={{ cursor: 'default' }}>
                      <td className="strong">{p.firm}</td><td className="strong">₹{p.crore.toFixed(2)} crore</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {c.outcome.basis && <div className="psub" style={{ marginTop: 10 }}>{c.outcome.basis}</div>}
        </div>
        <div className="panel">
          <div className="ptitle">Notes on the data</div>
          <ul className="notes">
            <li>Every amount is copied from the order ({c.source})</li>
            {c.notes.map((n, i) => <li key={i}>{n}</li>)}
          </ul>
        </div>
      </div>
    </>
  )
}

function TenderTable({ results, identical }) {
  const [open, setOpen] = useState(null)
  return (
    <div className="tbl-wrap">
      <table className="tender-tbl">
        <thead>
          <tr><th>Tender</th><th>Bids received</th><th>Spread</th><th>Result</th></tr>
        </thead>
        <tbody>
          {results.map((r) => {
            const t = r.tender
            const isOpen = open === t.id
            return [
              <tr key={t.id} data-sel={isOpen} onClick={() => setOpen(isOpen ? null : t.id)}>
                <td className="strong">
                  {t.label || t.id}
                  {t.buyer && <div className="buyer">{t.buyer}</div>}
                </td>
                <td style={{ textAlign: 'left' }}>
                  <div className="bids">
                    {[...t.bids].sort((a, b) => a.amount - b.amount).map((b) => (
                      <span key={b.bidder} className="bid"
                        data-same={identical.has(`${t.id}|${b.amount}`)}>
                        {b.bidder} <b>{inr(b.amount)}</b>
                      </span>
                    ))}
                  </div>
                </td>
                <td>{r.stats && r.stats.n > 1 ? `${r.stats.spread.toFixed(1)}%` : '—'}</td>
                <td><Light level={r.level} /></td>
              </tr>,
              isOpen && (
                <tr key={`${t.id}-x`} className="expand">
                  <td colSpan={4}><Flags flags={r.flags} /></td>
                </tr>
              ),
            ]
          })}
        </tbody>
      </table>
    </div>
  )
}

// ---------------------------------------------------------------------------

const START = [
  { bidder: 'Escorts Ltd', amount: '17147.54' },
  { bidder: 'Faiveley Transport', amount: '17147.54' },
  { bidder: 'Stone India', amount: '17147.54' },
]

function TryIt() {
  const [rows, setRows] = useState(START)
  const [bench, setBench] = useState('12893')
  const tender = {
    id: 'yours',
    bids: rows.filter((r) => r.bidder.trim() && r.amount !== '')
      .map((r) => ({ bidder: r.bidder.trim(), amount: Number(String(r.amount).replace(/[₹,\s]/g, '')) })),
    benchmark: Number(bench) > 0 ? { value: Number(bench), label: 'last purchase price' } : undefined,
  }
  const r = screenTender(tender)
  const set = (i, k, v) => setRows(rows.map((row, j) => (j === i ? { ...row, [k]: v } : row)))

  return (
    <div className="grid-2">
      <div className="panel">
        <div className="ptitle">Enter the bids from one tender</div>
        <div className="psub">
          Pre-filled with the Railways case. <b>Try changing one bid by a single rupee</b> — or type in any
          tender you like.
        </div>
        <div className="editor">
          {rows.map((row, i) => (
            <div className="erow" key={i}>
              <input value={row.bidder} placeholder="Bidder name" onChange={(e) => set(i, 'bidder', e.target.value)} />
              <span className="rs">₹</span>
              <input className="amt" value={row.amount} inputMode="decimal" placeholder="Amount"
                onChange={(e) => set(i, 'amount', e.target.value)} />
              <button className="x" title="Remove" onClick={() => setRows(rows.filter((_, j) => j !== i))}>×</button>
            </div>
          ))}
          <button className="tab" onClick={() => setRows([...rows, { bidder: '', amount: '' }])}>+ add bidder</button>
          <div className="erow bench">
            <label>Last price paid (optional)</label>
            <span className="rs">₹</span>
            <input className="amt" value={bench} inputMode="decimal" onChange={(e) => setBench(e.target.value)} />
          </div>
          <div className="psub" style={{ marginTop: 6 }}>
            ₹12,893 is roughly what a 33% rise to ₹17,147.54 implies. The order states the 33%, not the old price.
          </div>
        </div>
      </div>
      <div className="panel">
        <div className="ptitle">Result</div>
        <div style={{ margin: '6px 0 14px' }}><Light level={r.level} big /></div>
        <Flags flags={r.flags} />
      </div>
    </div>
  )
}

const SAMPLE = `# tender, bidder, amount, date (optional) — paste from Excel works too
Tender 5, GIL, 11498, 2013-05-01
Tender 5, ABCIL, 11440, 2013-05-01
Tender 5, GACL, 11599, 2013-05-01
Tender 15, GIL, 12440, 2014-03-05
Tender 15, ABCIL, 12140, 2014-03-05
Tender 15, GACL, 12099, 2014-03-05`

function PasteMany() {
  const [text, setText] = useState(SAMPLE)
  const { tenders, errors } = useMemo(() => parseRows(text), [text])
  const r = useMemo(() => (tenders.length ? screenCase(tenders) : null), [tenders])
  return (
    <div className="grid-2">
      <div className="panel">
        <div className="ptitle">Paste several tenders at once</div>
        <div className="psub">One bid per line. Tenders with the same name are grouped together.</div>
        <textarea className="paste" value={text} onChange={(e) => setText(e.target.value)} spellCheck={false} />
        {errors.length > 0 && <div className="perr">{errors.slice(0, 4).join(' · ')}</div>}
      </div>
      <div className="panel">
        <div className="ptitle">Result for {tenders.length} tender{tenders.length !== 1 && 's'}</div>
        {r && (
          <>
            <div style={{ margin: '6px 0 14px' }}><Light level={r.level} big /></div>
            <Flags flags={[...r.patterns, ...r.results.flatMap((x) =>
              x.flags.map((f) => ({ ...f, detail: `${x.tender.label}: ${f.detail}` })))]} />
          </>
        )}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------

export default function Screener() {
  const [sel, setSel] = useState(CASES[0].id)
  const [mode, setMode] = useState('one')
  const c = CASES.find((x) => x.id === sel)

  return (
    <div className="wrap">
      <header className="masthead">
        <div className="eyebrow">Bid-rigging red-flag screener · built on the CCI’s own checklist</div>
        <h1>Would these tenders pass the Competition Commission’s own checks?</h1>
        <p className="lede">
          When companies secretly agree on their bids, the government pays more for everything from
          railway parts to drinking-water chemicals. Today the <strong>Competition Commission of India
          (CCI)</strong> gives procurement officers a <strong>paper checklist</strong> to spot this.
          This tool runs the same checks <strong>automatically</strong>, and here it is tested on real
          cases the CCI has already decided.
        </p>
      </header>

      <Section num="01" title="How the CCI looks for rigged tenders today">
        <div className="grid-2">
          <div className="panel today">
            <div className="ptitle">Today</div>
            <ul className="notes">
              <li>A <b>yes/no questionnaire</b> for procurement officers — the CCI’s{' '}
                <a href={TOOLKIT_URL} target="_blank" rel="noreferrer">Diagnostic Toolkit</a>.</li>
              <li>Cases usually start with a <b>complaint</b>, a <b>whistle-blower</b>, or a cartel member
                confessing for a lower penalty.</li>
              <li>Then <b>raids</b>, seized emails and phones, and outside forensic firms.</li>
              <li>In its 2025 study on AI, the CCI said this area needs skills
                "beyond traditional economic and legal analysis".</li>
            </ul>
          </div>
          <div className="panel tool">
            <div className="ptitle">With this tool</div>
            <ul className="notes">
              <li>Type or paste the bids from any tender and get an answer <b>instantly</b>.</li>
              <li>Every flag is <b>one of the CCI’s own red flags</b>, with the page or paragraph it comes from.</li>
              <li>Checks <b>many tenders together</b>, which catches cartels a person reading one tender at a time would miss.</li>
              <li>Tested below on <b>four real CCI cases</b> — three cartels and one where the companies were cleared.</li>
            </ul>
          </div>
        </div>
      </Section>

      <Section num="02" title="Tested on real cases the CCI has decided"
        sub="Pick a case. On the left is what the screener finds from the bid prices alone. On the right is what the CCI actually ruled after a full investigation.">
        <div className="tabs case-tabs">
          {CASES.map((x) => {
            const lvl = screenCase(x.tenders).level
            return (
              <button key={x.id} className="tab" data-on={sel === x.id} onClick={() => setSel(x.id)}>
                <span className="dot" style={{ background: VERDICT[lvl].color }} /> {x.short}
                <span className={`mini ${x.outcome.guilty ? 'guilty' : 'cleared'}`}>
                  {x.outcome.guilty ? 'guilty' : 'cleared'}
                </span>
              </button>
            )
          })}
        </div>
        <CaseView c={c} key={c.id} />
      </Section>

      <Section num="03" title="Try it yourself"
        sub="Everything runs live in this page — no internet, no server.">
        <div className="tabs">
          <button className="tab" data-on={mode === 'one'} onClick={() => setMode('one')}>One tender</button>
          <button className="tab" data-on={mode === 'many'} onClick={() => setMode('many')}>Many tenders (paste)</button>
        </div>
        {mode === 'one' ? <TryIt /> : <PasteMany />}
      </Section>

      <Section num="04" title="What this does not do">
        <div className="panel">
          <ul className="notes">
            <li><b>A red flag is not proof.</b> Indian law needs "plus factors" beyond similar prices — see the
              liquid chlorine case above, where the CCI saw close and even identical bids and still closed the
              case. The screener’s job is to decide what deserves an investigation, not to replace one.</li>
            <li><b>It only sees prices.</b> Handwriting, shared bank drafts, the same person preparing two bids —
              evidence the CCI also uses — needs an investigator.</li>
            <li><b>Tomorrow’s cartels may not need a meeting at all.</b> Pricing software can learn to keep prices
              high on its own. That is the second part of this project — see the{' '}
              <a href="#lab">Algorithmic Collusion Lab</a>.</li>
          </ul>
        </div>
      </Section>
    </div>
  )
}
