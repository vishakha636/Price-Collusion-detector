// Shared recharts styling. Kept in its own module rather than exported from a
// component file, because mixing component and non-component exports breaks
// React Fast Refresh.

export const axisStyle = {
  stroke: '#3a4a5c',
  tick: { fill: '#5b6a7d', fontSize: 10.5, fontFamily: 'var(--mono)' },
}

export const chartTooltip = {
  contentStyle: {
    background: '#0f151d', border: '1px solid #2c3d50', borderRadius: 8,
    fontSize: 12, fontFamily: 'var(--mono)', boxShadow: '0 8px 24px #0008',
  },
  labelStyle: { color: '#8b9bb0', fontSize: 11, marginBottom: 4 },
  itemStyle: { padding: '1px 0' },
}

/** Thin a dense x-axis down to roughly `count` labels. */
export const thinTicks = (data, count = 8, key = 't') =>
  data.filter((_, i) => i % Math.ceil(data.length / count) === 0).map((d) => d[key])
