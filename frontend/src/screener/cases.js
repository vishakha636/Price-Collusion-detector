// Real bid data transcribed from public CCI orders.
//
// Every number here was read off the order itself (page / paragraph noted in
// `source`), not reconstructed. Where a row in the order was illegible it was
// left out rather than guessed, and the omission is recorded in `notes`.
//
// Amounts are exactly as quoted -- no inflation adjustment, no rounding.

export const TOOLKIT_URL =
  'https://www.cci.gov.in/images/whatsnew/en/diagnostic-toolkit-for-public-procurement1747723682.pdf'

export const CASES = [
  {
    id: 'railways',
    short: 'Railways feed valves',
    title: 'Feed valves for Indian Railways locomotives',
    buyer: 'Diesel Loco Modernisation Works (Indian Railways), Patiala',
    caseNo: 'Suo Moto Case No. 03 of 2012',
    orderDate: '05 Feb 2014',
    unit: '₹ per piece',
    url: 'https://www.cci.gov.in/images/antitrustorder/en/0320121652438022.pdf',
    source: 'Order para 5 and the bid table at para 30.',
    story:
      'Railways floated a tender for a locomotive spare part. Only three approved vendors could bid. ' +
      'All three sent in exactly the same price, down to the paisa, and that price was 33% above ' +
      'what Railways had paid last time. The tender committee itself spotted it and reported it to the CCI.',
    tenders: [
      {
        id: 'Tender 201320510',
        date: '2012-04-27',
        label: 'Apr 2012',
        benchmark: { pctAbove: 33, label: 'last purchase rate' },
        bids: [
          { bidder: 'Escorts Ltd', amount: 17147.54 },
          { bidder: 'Faiveley Transport', amount: 17147.54 },
          { bidder: 'Stone India', amount: 17147.54 },
        ],
      },
    ],
    outcome: {
      guilty: true,
      headline: 'Cartel established — penalty ₹62.31 crore',
      penalties: [
        { firm: 'Escorts Ltd', crore: 54.70 },
        { firm: 'Faiveley Transport', crore: 5.70 },
        { firm: 'Stone India', crore: 1.91 },
      ],
      basis: '2% of average turnover for each company.',
      finding:
        'The firms quoted different basic prices and then applied different tax rates to arrive at the ' +
        'same final figure. The Commission called identical quotes "up to the last paisa" a very strong ' +
        'indicator of collusion when no economic justification exists (para 31–34).',
    },
    notes: [],
  },

  {
    id: 'aluminium',
    short: 'Aluminium Phosphide tablets',
    title: 'Aluminium Phosphide tablets (grain fumigant) for FCI and state agencies',
    buyer: 'Food Corporation of India, Central Warehousing Corp., state warehousing & civil supplies corps.',
    caseNo: 'Suo Moto Case No. 02 of 2011',
    orderDate: '23 Apr 2012',
    unit: '₹ per kg',
    url: 'https://www.cci.gov.in/images/antitrustorder/en/suo-moto-0220111652436455.pdf',
    source: 'FCI tender table at para 4.7; other-agency table at para 4.14; penalty at para 8.2.',
    story:
      'Four companies make these tablets, used to protect stored food grain. Across tenders by FCI and ' +
      'nine other government buyers, they kept quoting the same unusual, unrounded prices — ₹449, ₹419, ' +
      '₹409, ₹421. When asked, they could only say it "might be a coincidence". In 2009 their cost of ' +
      'production was about ₹260–268 per kg; the price all of them quoted FCI was ₹388.',
    tenders: [
      { id: 'FCI 2002', date: '2002-01-01', label: 'FCI 2002', buyer: 'FCI',
        bids: [
          { bidder: 'Excel Crop Care', amount: 245 }, { bidder: 'United Phosphorus', amount: 245 },
          { bidder: 'Sandhya Organics', amount: 245 }, { bidder: 'Agrosynth', amount: 245 },
        ] },
      { id: 'FCI Mar 2005', date: '2005-03-01', label: 'FCI 2005', buyer: 'FCI',
        bids: [
          { bidder: 'Excel Crop Care', amount: 310 }, { bidder: 'United Phosphorus', amount: 310 },
          { bidder: 'Sandhya Organics', amount: 310 }, { bidder: 'Agrosynth', amount: 310 },
        ] },
      { id: 'UPSWC 14/03/2007', date: '2007-03-14', label: 'Mar 2007', buyer: 'UP State Warehousing Corp.',
        bids: [{ bidder: 'Excel Crop Care', amount: 225 }, { bidder: 'United Phosphorus', amount: 225 }] },
      { id: 'FCI 2007', date: '2007-06-01', label: 'FCI 2007', buyer: 'FCI',
        bids: [
          { bidder: 'United Phosphorus', amount: 200 }, { bidder: 'Excel Crop Care', amount: 235 },
          { bidder: 'Sandhya Organics', amount: 236 }, { bidder: 'Agrosynth', amount: 234 },
        ] },
      { id: 'PSCSC 28/04/2008', date: '2008-04-28', label: 'Apr 2008', buyer: 'Punjab State Civil Supplies Corp.',
        bids: [{ bidder: 'Excel Crop Care', amount: 260 }, { bidder: 'United Phosphorus', amount: 260 }] },
      { id: 'CWC 06/08/2008', date: '2008-08-06', label: 'Aug 2008', buyer: 'Central Warehousing Corp.',
        bids: [{ bidder: 'Excel Crop Care', amount: 450 }, { bidder: 'Sandhya Organics', amount: 450 }] },
      { id: 'UPSWC 19/09/2008', date: '2008-09-19', label: 'Sep 2008', buyer: 'UP State Warehousing Corp.',
        bids: [{ bidder: 'Excel Crop Care', amount: 449 }, { bidder: 'United Phosphorus', amount: 449 }] },
      { id: 'Punjab Mktg Fed 26/12/2008', date: '2008-12-26', label: 'Dec 2008', buyer: 'Punjab State Co-op Supply & Mktg. Fed.',
        bids: [{ bidder: 'Excel Crop Care', amount: 419 }, { bidder: 'United Phosphorus', amount: 419 }] },
      { id: 'CWC 06/01/2009', date: '2009-01-06', label: 'Jan 2009', buyer: 'Central Warehousing Corp.',
        bids: [{ bidder: 'Excel Crop Care', amount: 414 }, { bidder: 'United Phosphorus', amount: 414 }] },
      { id: 'PSCSC 27/02/2009', date: '2009-02-27', label: 'Feb 2009', buyer: 'Punjab State Civil Supplies Corp.',
        bids: [{ bidder: 'Excel Crop Care', amount: 409 }, { bidder: 'United Phosphorus', amount: 409 }] },
      { id: 'FCI 08/05/2009', date: '2009-05-08', label: 'FCI 2009', buyer: 'FCI',
        bids: [
          { bidder: 'Excel Crop Care', amount: 388 }, { bidder: 'United Phosphorus', amount: 388 },
          { bidder: 'Sandhya Organics', amount: 388 },
        ] },
      { id: 'UPSWC 03/11/2009', date: '2009-11-03', label: 'Nov 2009', buyer: 'UP State Warehousing Corp.',
        bids: [{ bidder: 'Excel Crop Care', amount: 399 }, { bidder: 'United Phosphorus', amount: 399 }] },
      { id: 'Haryana SS&D 01/12/2009', date: '2009-12-01', label: 'Dec 2009', buyer: 'Director, Supplies & Disposal, Haryana',
        bids: [{ bidder: 'Sandhya Organics', amount: 399 }, { bidder: 'Agrosynth', amount: 399 }] },
      { id: 'PSCSC 18/03/2010', date: '2010-03-18', label: 'Mar 2010', buyer: 'Punjab State Civil Supplies Corp.',
        bids: [{ bidder: 'Excel Crop Care', amount: 419 }, { bidder: 'Agrosynth', amount: 419 }] },
      { id: 'CWC 13/07/2010', date: '2010-07-13', label: 'Jul 2010', buyer: 'Central Warehousing Corp.',
        bids: [
          { bidder: 'Excel Crop Care', amount: 421 }, { bidder: 'United Phosphorus', amount: 421 },
          { bidder: 'Sandhya Organics', amount: 421 },
        ] },
      { id: 'MPSWC 15/07/2010', date: '2010-07-15', label: '15 Jul 2010', buyer: 'MP State Warehousing Corp.',
        bids: [{ bidder: 'Excel Crop Care', amount: 436 }, { bidder: 'Sandhya Organics', amount: 436 }] },
      { id: 'Punjab Mktg Fed 14/02/2011', date: '2011-02-14', label: 'Feb 2011', buyer: 'Punjab State Co-op Supply & Mktg. Fed.',
        bids: [{ bidder: 'Excel Crop Care', amount: 415 }, { bidder: 'United Phosphorus', amount: 415 }] },
      { id: 'PSCSC 15/03/2011', date: '2011-03-15', label: 'Mar 2011', buyer: 'Punjab State Civil Supplies Corp.',
        bids: [{ bidder: 'United Phosphorus', amount: 415 }, { bidder: 'Agrosynth', amount: 415 }] },
    ],
    outcome: {
      guilty: true,
      headline: 'Cartel established — penalty ₹317.91 crore',
      penalties: [
        { firm: 'United Phosphorus', crore: 252.44 },
        { firm: 'Excel Crop Care', crore: 63.90 },
        { firm: 'Sandhya Organics', crore: 1.57 },
      ],
      basis:
        '9% of average total turnover. On appeal the Supreme Court (Excel Crop Care v. CCI, 2017) held ' +
        'that penalties must be based on turnover from the product in question only.',
      finding:
        'Identical, unrounded quotes across many tenders and buyers, with no satisfactory explanation, ' +
        'and quoted prices far above cost of production (para 4.15, 7.45).',
    },
    notes: [
      'The FCI 2007 tender is where United Phosphorus broke ranks and quoted ₹200 against ₹234–236 from the rest.',
      'Row 9 of the para 4.14 table (Punjab State Civil Supplies, June 2009) is partly covered by the ' +
        'Commission seal in the scanned order and is left out rather than guessed.',
      'FCI tenders of Nov 2005 and 2008 received no bids at all (all parties abstained) — also a red flag ' +
        'in the CCI toolkit, but there are no prices to screen.',
    ],
  },

  {
    id: 'djb_pac',
    short: 'Delhi Jal Board — water purifier (PAC)',
    title: 'Poly Aluminium Chloride for Delhi’s drinking water',
    buyer: 'Delhi Jal Board',
    caseNo: 'Ref. Case No. 03 of 2013',
    orderDate: '05 Oct 2017',
    unit: '₹ per tonne',
    url: 'https://cci.gov.in/images/antitrustorder/en/ref-case-nos-03-and-0420131652435755.pdf',
    source: 'Table-1 at para 132; findings at paras 147–160; penalty at para 215.',
    story:
      'Delhi Jal Board buys this chemical to purify drinking water. Three suppliers with plants in ' +
      'different states — so very different transport costs — kept quoting within a few hundred rupees ' +
      'of each other, year after year, and all raised prices together. One supplier (GACL) had the lowest ' +
      'costs yet came last in five tenders in a row. Two of the "competing" bids were in fact finalised ' +
      'by the same person.',
    tenders: [
      { id: 'Tender 3 (2009-10)', date: '2009-07-17', label: 'Jul 2009', negotiated: 8800,
        bids: [{ bidder: 'GACL', amount: 9082 }, { bidder: 'GIL', amount: 9250 }, { bidder: 'KCIL', amount: 9170 }] },
      { id: 'Tender 7 (2009-10)', date: '2009-12-24', label: 'Dec 2009', negotiated: 8784,
        bids: [{ bidder: 'GACL', amount: 9400 }, { bidder: 'GIL', amount: 8900 }, { bidder: 'KCIL', amount: 9272 }] },
      { id: 'Tender 1 (2010-11)', date: '2010-05-21', label: 'May 2010', negotiated: 8916,
        bids: [{ bidder: 'GACL', amount: 9500 }, { bidder: 'GIL', amount: 8916 }, { bidder: 'KCIL', amount: 9220 }] },
      { id: 'Tender 13 (2010-11)', date: '2011-01-02', label: 'Jan 2011', negotiated: 10908,
        bids: [{ bidder: 'GACL', amount: 11325 }, { bidder: 'GIL', amount: 10908 }, { bidder: 'ABCIL', amount: 11098 }] },
      { id: 'Tender 1 (2012-13)', date: '2012-04-18', label: 'Apr 2012', negotiated: 12001,
        bids: [{ bidder: 'GACL', amount: 12850 }, { bidder: 'GIL', amount: 12411 }, { bidder: 'ABCIL', amount: 12664 }] },
      { id: 'Tender 5 (2013-14)', date: '2013-05-01', label: 'May 2013', negotiated: 11300,
        bids: [{ bidder: 'GACL', amount: 11599 }, { bidder: 'GIL', amount: 11498 }, { bidder: 'ABCIL', amount: 11440 }] },
      { id: 'Tender 15 (2014-15)', date: '2014-03-05', label: 'Mar 2014', negotiated: 11750,
        bids: [{ bidder: 'GACL', amount: 12099 }, { bidder: 'GIL', amount: 12440 }, { bidder: 'ABCIL', amount: 12140 }] },
    ],
    outcome: {
      guilty: true,
      headline: 'Cartel established — penalty ₹6.27 crore',
      penalties: [
        { firm: 'GIL (Grasim)', crore: 2.30 },
        { firm: 'ABCIL (Aditya Birla Chemicals)', crore: 2.09 },
        { firm: 'GACL (Gujarat Alkalies)', crore: 1.88 },
      ],
      basis: '8% (GIL, ABCIL) and 6% (GACL) of average relevant turnover. One member dissented on GACL.',
      finding:
        'Bids "converging in a narrow range besides simultaneously increasing over the years" despite very ' +
        'different costs and plant locations (para 147, 155). Price parallelism alone was not treated as ' +
        'enough — the Commission also relied on GACL staying last despite the lowest cost, and on GIL and ' +
        'ABCIL bids being prepared by the same official (para 156, 160).',
    },
    notes: [
      'KCIL was investigated and cleared; ABCIL bought KCIL’s chemicals division in May 2011, which is ' +
        'why ABCIL replaces KCIL from Tender 13 onward.',
    ],
  },

  {
    id: 'djb_chlorine',
    short: 'Delhi Jal Board — liquid chlorine',
    title: 'Liquid chlorine for Delhi’s drinking water',
    buyer: 'Delhi Jal Board',
    caseNo: 'Ref. Case No. 04 of 2013',
    orderDate: '05 Oct 2017',
    unit: '₹ per tonne',
    url: 'https://cci.gov.in/images/antitrustorder/en/ref-case-nos-03-and-0420131652435755.pdf',
    source: 'Table-11 at para 175; findings at paras 199–203.',
    story:
      'Same buyer, same investigation, some of the same companies — and prices that also look ' +
      'suspicious, including two identical bids of ₹9,500 in 2011. But this time the CCI found no ' +
      'cartel. Chlorine is a hazardous by-product that makers must get rid of quickly, often at ' +
      '"throwaway prices", and the investigation had no cost data or other evidence to go with the ' +
      'price pattern.',
    tenders: [
      { id: 'NIT 3 (2009-10)', date: '2009-11-30', label: 'Nov 2009',
        bids: [
          { bidder: 'ABCIL', amount: 3582 }, { bidder: 'PACL', amount: 3596 },
          { bidder: 'GIL', amount: 3681 }, { bidder: 'KCIL', amount: 7359 },
        ] },
      { id: 'NIT 2 (2010-11)', date: '2010-11-29', label: 'Nov 2010',
        bids: [
          { bidder: 'ABCIL', amount: 5997 }, { bidder: 'PACL', amount: 7295 },
          { bidder: 'GIL', amount: 6579 }, { bidder: 'KCIL', amount: 8100 },
        ] },
      { id: 'NIT 3 (2011-12)', date: '2011-11-29', label: 'Nov 2011',
        bids: [{ bidder: 'ABCIL', amount: 9500 }, { bidder: 'PACL', amount: 9500 }, { bidder: 'GIL', amount: 10500 }] },
      { id: 'NIT 1 (2013-14)', date: '2013-09-16', label: 'Sep 2013',
        bids: [{ bidder: 'PACL', amount: 4990 }, { bidder: 'GACL', amount: 7250 }] },
      { id: 'NIT 1 (2014-15)', date: '2014-05-21', label: 'May 2014',
        bids: [{ bidder: 'ABCIL', amount: 7000 }, { bidder: 'PACL', amount: 7100 }, { bidder: 'GIL', amount: 7500 }] },
      { id: 'NIT 2 (2014-15)', date: '2014-10-27', label: 'Oct 2014',
        bids: [{ bidder: 'ABCIL', amount: 7400 }, { bidder: 'PACL', amount: 7460 }, { bidder: 'GIL', amount: 8000 }] },
    ],
    outcome: {
      guilty: false,
      headline: 'No contravention found — case closed',
      penalties: [],
      basis: '',
      finding:
        'The Commission accepted that the prices were close and sometimes identical, but held that ' +
        '"conscious parallel behaviour needs to be substantiated with the additional evidence or plus ' +
        'factors" (para 178). No cost comparison was possible and the other evidence was speculative ' +
        '(para 201–203).',
    },
    notes: [
      '2012-13 is omitted: DJB bought directly from GACL without a tender.',
      'In 2013-14 ABCIL and GIL were technically disqualified, leaving only two bids.',
    ],
  },
]
