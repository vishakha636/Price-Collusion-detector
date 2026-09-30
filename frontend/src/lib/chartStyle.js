// Shared recharts styling. Kept in its own module rather than exported from a
// component file, because mixing component and non-component exports breaks
// React Fast Refresh.

export const axisStyle = {
  stroke: '#c5d0de',
  tick: { fill: '#7a8898', fontSize: 10.5, fontFamily: 'var(--mono)' },
}

export const chartTooltip = {
  contentStyle: {
    background: '#ffffff', border: '1px solid #c5d0de', borderRadius: 8,
    fontSize: 12, fontFamily: 'var(--mono)', boxShadow: '0 8px 24px #0f2a4a1f',
  },
  labelStyle: { color: '#56667a', fontSize: 11, marginBottom: 4 },
  itemStyle: { padding: '1px 0' },
}

/** Thin a dense x-axis down to roughly `count` labels. */
export const thinTicks = (data, count = 8, key = 't') =>
  data.filter((_, i) => i % Math.ceil(data.length / count) === 0).map((d) => d[key])
