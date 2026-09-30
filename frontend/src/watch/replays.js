// Real price histories from CCI orders, replayed through the same Price Watch
// check that runs on live Flipkart / Myntra prices.
//
// Airline cargo fuel surcharge (FSC), Case No. 30 of 2013. The rates and
// implementation dates are the table at para 113 of the 17.11.2015 order,
// repeated unchanged in the final 07.03.2018 order. A surcharge stays in force
// until the next revision, so the daily series is a step function between the
// dates in that table. The order gives no rates for 2009–10 (withdrawn, or
// charged by one airline only), so the replay starts in April 2011.

const FSC_URL_2018 = 'https://www.cci.gov.in/images/antitrustorder/en/3020131652781765.pdf'
const FSC_URL_2015 = 'https://www.cci.gov.in/images/antitrustorder/en/3020131652439071.pdf'

// [implementation date, ₹ per kg]
const FSC = {
  'Jet Airways': [['2011-04-16', 9], ['2012-06-01', 11], ['2012-09-10', 13], ['2012-11-16', 15]],
  IndiGo: [['2011-06-01', 9], ['2012-06-05', 11], ['2012-09-16', 13], ['2012-11-16', 15]],
  SpiceJet: [['2011-06-01', 9], ['2012-06-05', 11], ['2012-09-16', 13], ['2012-11-19', 15]],
}

/** Expand revision lists into one reading per day (null before a rate is known). */
function daily(stepsA, stepsB, from, to) {
  const at = (steps, day) => {
    let v = null
    for (const [d, p] of steps) if (d <= day) v = p
    return v
  }
  const out = []
  for (let t = Date.parse(`${from}T06:00:00Z`); t <= Date.parse(`${to}T06:00:00Z`); t += 864e5) {
    const day = new Date(t).toISOString().slice(0, 10)
    out.push({ t, a: at(stepsA, day), b: at(stepsB, day) })
  }
  return out
}

const fscPair = (id, a, b, penalty) => ({
  id,
  site: 'cargo fuel surcharge',
  brand_a: a,
  brand_b: b,
  unit: '₹ per kg',
  windowDays: 7,
  rounds: daily(FSC[a], FSC[b], '2011-04-16', '2012-12-15'),
  cci: {
    guilty: true,
    caseNo: 'Case No. 30 of 2013',
    orderDate: '07 Mar 2018',
    url: FSC_URL_2018,
    urlFirst: FSC_URL_2015,
    penalty,
    finding:
      'The airlines raised their cargo fuel surcharge by the same amount at nearly the same time, ' +
      'sometimes on the same day, even while jet fuel prices were falling. The CCI rejected the ' +
      'argument that gaps of a few days showed independence: "The so-called time gap is just a ' +
      'matter of few days" (2015 order, para 114).',
    note:
      'Air India was not penalised: its surcharge was lower (₹11 and ₹13 when the others charged ' +
      '₹13 and ₹15) and followed fuel prices (para 125). The order lists only two of its rates for ' +
      'this period, too few to replay here.',
  },
})

export const REPLAYS = [
  fscPair('fsc-jet-indigo', 'Jet Airways', 'IndiGo', 'Jet Airways ₹39.81 crore · IndiGo ₹9.45 crore'),
  fscPair('fsc-indigo-spicejet', 'IndiGo', 'SpiceJet', 'IndiGo ₹9.45 crore · SpiceJet ₹5.10 crore'),
]

/**
 * The same real surcharge table, laid out as a repricer log would be:
 * IndiGo as "your product", Jet Airways and SpiceJet as rivals. One reading
 * per day from the first date all three rates are known.
 */
export function sampleAuditSeries() {
  const names = ['IndiGo', 'Jet Airways', 'SpiceJet']
  const rounds = (a, b) => daily(FSC[a], FSC[b], '2011-06-01', '2012-12-15')
  const base = rounds('IndiGo', 'Jet Airways')
  const spice = rounds('IndiGo', 'SpiceJet')
  return {
    windowDays: 7,
    unit: '₹ per kg',
    source: 'CCI Case 30/2013 · fined ₹54 crore',
    series: [
      { name: names[0], points: base.map((r) => ({ t: r.t, price: r.a })) },
      { name: names[1], points: base.map((r) => ({ t: r.t, price: r.b })) },
      { name: names[2], points: spice.map((r) => ({ t: r.t, price: r.b })) },
    ],
  }
}
