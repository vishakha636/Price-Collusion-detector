import { Component } from 'react'
import { IconBell, IconBox, IconFile, IconGear, IconGrid, IconRadar, IconShield, Logo } from './icons'

const NAV = [
  { key: 'overview', label: 'Overview', icon: IconGrid },
  { key: 'check', label: 'Check a product', icon: IconRadar },
  { key: 'products', label: 'Products', icon: IconBox },
  { key: 'alerts', label: 'Alerts', icon: IconBell },
  { key: 'audit', label: 'Audit a log', icon: IconFile },
  { key: 'results', label: 'Validation', icon: IconShield },
  { key: 'settings', label: 'Settings', icon: IconGear },
]

// A crash inside one page shows a short message instead of blanking the app.
class PageGuard extends Component {
  state = { error: null }
  static getDerivedStateFromError(error) { return { error } }
  componentDidUpdate(prev) { if (prev.page !== this.props.page && this.state.error) this.setState({ error: null }) }
  render() {
    if (!this.state.error) return this.props.children
    return (
      <div className="banner bad">
        This page failed to load · {String(this.state.error.message || this.state.error)} ·{' '}
        <a href="#" onClick={(e) => { e.preventDefault(); window.location.reload() }}>Reload</a>
      </div>
    )
  }
}

export default function AppShell({ page, title, alerts = 0, children }) {
  return (
    <div className="shell">
      <aside className="side">
        <a className="brand" href="#/"><Logo /> PriceGuard</a>
        <nav>
          {NAV.map(({ key, label, icon: Icon }) => (
            <a key={key} href={`#/app/${key}`} data-on={page === key}>
              <Icon /> {label}
              {key === 'products' && alerts > 0 && <span className="side-badge">{alerts}</span>}
            </a>
          ))}
        </nav>
        <div className="side-foot">
          <div className="ws"><span>DW</span><div><b>Demo workspace</b><small>Growth plan</small></div></div>
        </div>
      </aside>
      <main className="main">
        <div className="topbar"><h1>{title}</h1></div>
        <div className="content"><PageGuard page={page}>{children}</PageGuard></div>
      </main>
    </div>
  )
}
