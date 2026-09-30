import { IconArrow, IconCheck, IconFile, IconRadar, IconShield, Logo } from './icons'

const FEATURES = [
  { icon: IconRadar, title: 'Track rivals', text: 'Your prices and your competitors’, on every platform, every 6 hours.' },
  { icon: IconShield, title: 'Detect coordination', text: 'See if your pricing software copies rivals instead of competing.' },
  { icon: IconFile, title: 'Audit report', text: 'One-click PDF for your compliance file.' },
]

const PLANS = [
  { name: 'Starter', price: '₹999', per: '/month', items: ['5 products', '2 platforms', 'Weekly audit'] },
  { name: 'Growth', price: '₹4,999', per: '/month', items: ['50 products', 'All platforms', 'Daily audit', 'PDF reports'], best: true },
  { name: 'Enterprise', price: 'Custom', per: '', items: ['Unlimited products', 'Pricing-engine audit', 'API access'] },
]

export default function Landing() {
  return (
    <div className="lp">
      <header className="lp-nav">
        <div className="lp-in">
          <a className="brand" href="#/"><Logo /> PriceGuard</a>
          <nav>
            <a href="#features">Features</a>
            <a href="#how">How it works</a>
            <a href="#pricing">Pricing</a>
            <a href="#/app/results">Results</a>
          </nav>
          <a className="btn" href="#/app">Open dashboard</a>
        </div>
      </header>

      <section className="lp-hero">
        <div className="lp-in">
          <span className="lp-tag">Built for CCI’s 2026 AI self-audit guidance</span>
          <h1>Is your pricing algorithm<br /><span>colluding without you knowing?</span></h1>
          <p>Monitor competitors. Audit your repricer. Stay compliant.</p>
          <div className="lp-cta">
            <a className="btn lg" href="#/app/products?new=1">Start free audit <IconArrow size={18} /></a>
            <a className="btn ghost lg" href="#/app">See dashboard</a>
          </div>
          <div className="lp-proof">
            <div><b>97%</b><span>accuracy</span></div>
            <div><b>200</b><span>markets tested</span></div>
            <div><b>6</b><span>real CCI cases</span></div>
          </div>
          <div className="lp-plat">Works with <b>Flipkart</b> · <b>Myntra</b> · <b>any CSV log</b></div>
        </div>
      </section>

      <section className="lp-sec" id="features">
        <div className="lp-in lp-cards">
          {FEATURES.map(({ icon: Icon, title, text }) => (
            <div className="lp-card" key={title}>
              <div className="lp-icon"><Icon size={24} /></div>
              <h3>{title}</h3>
              <p>{text}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="lp-sec alt" id="how">
        <div className="lp-in">
          <h2>How it works</h2>
          <div className="lp-steps">
            {['Register your product', 'We find & track competitors', 'Get your risk status'].map((s, i) => (
              <div className="lp-step" key={s}><span>{i + 1}</span>{s}</div>
            ))}
          </div>
        </div>
      </section>

      <section className="lp-sec" id="pricing">
        <div className="lp-in">
          <h2>Pricing</h2>
          <div className="lp-plans">
            {PLANS.map((p) => (
              <div className={`lp-plan${p.best ? ' best' : ''}`} key={p.name}>
                {p.best && <div className="lp-best">Most popular</div>}
                <h3>{p.name}</h3>
                <div className="lp-price">{p.price}<small>{p.per}</small></div>
                <ul>{p.items.map((x) => <li key={x}><IconCheck size={16} /> {x}</li>)}</ul>
                <a className={`btn${p.best ? '' : ' ghost'}`} href="#/app/products?new=1">
                  {p.name === 'Enterprise' ? 'Contact us' : 'Start free'}
                </a>
              </div>
            ))}
          </div>
        </div>
      </section>

      <footer className="lp-foot">
        <div className="lp-in">
          <span className="brand"><Logo size={22} /> PriceGuard</span>
          <span>Final-year engineering project · Not affiliated with CCI</span>
        </div>
      </footer>
    </div>
  )
}
