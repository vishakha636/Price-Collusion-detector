import { StrictMode, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.jsx'
import AppShell from './app/AppShell.jsx'
import Landing from './app/Landing.jsx'
import Alerts from './app/Alerts.jsx'
import Check from './app/Check.jsx'
import Overview from './app/Overview.jsx'
import Results from './app/Results.jsx'
import Settings from './app/Settings.jsx'
import Screener from './screener/Screener.jsx'
import PriceWatch from './watch/PriceWatch.jsx'
import Products from './watch/Products.jsx'
import SelfAudit from './watch/SelfAudit.jsx'
import './theme.css'
import './app/app.css'
import './app/calm.css'

// Routes (hash based, so the static build works anywhere):
//   #/                    product landing page
//   #/app/overview        dashboard
//   #/app/products[?new=1|?id=N]
//   #/app/audit           audit an uploaded pricing log
//   #/app/results         validation results (accuracy, real cases, real data)
//   #/app/alerts          status changes over time
//   #/app/settings        detection window, AI analyst, monitoring
// Research pages, not in the product navigation (for the viva):
//   #lab  simulation lab · #screener  tender screener · #watch  market scan
const LEGACY = {
  lab: { label: 'Simulation Lab', Page: App },
  screener: { label: 'Tender Screener', Page: Screener },
  watch: { label: 'Market Scan', Page: PriceWatch },
}
const TITLES = { overview: 'Overview', check: 'Check a product', products: 'Products', alerts: 'Alerts', audit: 'Audit a log', results: 'Validation', settings: 'Settings' }

function parse() {
  const raw = window.location.hash.replace(/^#/, '')
  const [path, qs = ''] = raw.split('?')
  const query = Object.fromEntries(new URLSearchParams(qs))
  if (path in LEGACY) return { kind: 'legacy', key: path }
  if (path === 'products' || path === 'audit') return { kind: 'app', page: path, query }   // old links
  const m = path.match(/^\/app\/?(\w+)?/)
  if (m) return { kind: 'app', page: TITLES[m[1]] ? m[1] : 'overview', query }
  return { kind: 'landing' }
}

function Root() {
  const [route, setRoute] = useState(parse)
  const [alerts, setAlerts] = useState(0)

  useEffect(() => {
    const onHash = () => {
      const next = parse()
      setRoute(next)
      if (next.kind !== 'app' || !next.query.id) window.scrollTo(0, 0)
    }
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  if (route.kind === 'landing') return <Landing />

  if (route.kind === 'legacy') {
    const { Page } = LEGACY[route.key]
    return (
      <div className="legacy">
        <nav className="legacy-nav">
          <a href="#/app">← PriceGuard</a>
          {Object.entries(LEGACY).map(([k, v]) => (
            <a key={k} href={`#${k}`} data-on={route.key === k}>{v.label}</a>
          ))}
        </nav>
        <Page />
      </div>
    )
  }

  return (
    <AppShell page={route.page} title={TITLES[route.page]} alerts={alerts}>
      {route.page === 'overview' && <Overview onAlerts={setAlerts} />}
      {route.page === 'products' && <Products query={route.query} onAlerts={setAlerts} />}
      {route.page === 'audit' && <SelfAudit />}
      {route.page === 'results' && <Results />}
      {route.page === 'alerts' && <Alerts />}
      {route.page === 'check' && <Check />}
      {route.page === 'settings' && <Settings />}
    </AppShell>
  )
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <Root />
  </StrictMode>,
)
