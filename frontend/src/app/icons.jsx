// Small inline icon set (stroke icons, 20px), so the app has no icon dependency.
const I = ({ d, size = 20 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {d}
  </svg>
)

export const Logo = ({ size = 28 }) => (
  <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
    <path d="M16 2 4 7v8c0 7.2 5.1 13.3 12 15 6.9-1.7 12-7.8 12-15V7L16 2z" fill="#2563eb" />
    <path d="M10 17l4 4 8-9" fill="none" stroke="#fff" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
)

export const IconGrid = (p) => <I {...p} d={<><rect x="3" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="3" width="7" height="7" rx="1.5" /><rect x="3" y="14" width="7" height="7" rx="1.5" /><rect x="14" y="14" width="7" height="7" rx="1.5" /></>} />
export const IconBox = (p) => <I {...p} d={<><path d="M21 8 12 3 3 8v8l9 5 9-5V8z" /><path d="M3 8l9 5 9-5M12 13v8" /></>} />
export const IconFile = (p) => <I {...p} d={<><path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" /><path d="M14 3v6h6M9 15h6M9 18h4" /></>} />
export const IconBell = (p) => <I {...p} d={<><path d="M18 16V11a6 6 0 1 0-12 0v5l-2 2h16z" /><path d="M10 20a2 2 0 0 0 4 0" /></>} />
export const IconEye = (p) => <I {...p} d={<><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" /><circle cx="12" cy="12" r="3" /></>} />
export const IconRadar = (p) => <I {...p} d={<><circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="5" /><path d="M12 12l6-6" /></>} />
export const IconShield = (p) => <I {...p} d={<><path d="M12 3 4 6v6c0 5 3.4 8.6 8 9.9 4.6-1.3 8-4.9 8-9.9V6z" /><path d="M9 12l2 2 4-4" /></>} />
export const IconUsers = (p) => <I {...p} d={<><circle cx="9" cy="8" r="3.5" /><path d="M2.5 20a6.5 6.5 0 0 1 13 0" /><path d="M16 4.5a3.5 3.5 0 0 1 0 7M21.5 20a6.5 6.5 0 0 0-4-6" /></>} />
export const IconPulse = (p) => <I {...p} d={<path d="M3 12h4l3-7 4 14 3-7h4" />} />
export const IconAlert = (p) => <I {...p} d={<><path d="M12 3 2 21h20L12 3z" /><path d="M12 10v4M12 17.5v.5" /></>} />
export const IconPlus = (p) => <I {...p} d={<path d="M12 5v14M5 12h14" />} />
export const IconArrow = (p) => <I {...p} d={<path d="M5 12h14M13 6l6 6-6 6" />} />
export const IconGear = (p) => <I {...p} d={<><circle cx="12" cy="12" r="3" /><path d="M12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1" /></>} />
export const IconCheck = (p) => <I {...p} d={<path d="M5 12l5 5L20 7" />} />
