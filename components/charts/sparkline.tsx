// Tiny trend line for table rows: cumulative views per day. Server-rendered SVG, no JavaScript.
// A single muted series with the latest point in the accent, so a column of them stays calm.
export function Sparkline({
  values,
  width = 72,
  height = 22,
  className,
}: {
  values: number[]
  width?: number
  height?: number
  className?: string
}) {
  if (values.length < 2) {
    return <span className="inline-block text-xs text-muted-foreground" style={{ width }} />
  }

  const pad = 3
  const max = Math.max(...values)
  const min = Math.min(...values)
  const span = max - min || 1
  const stepX = (width - pad * 2) / (values.length - 1)
  const points = values.map((v, i) => {
    const x = pad + i * stepX
    const y = height - pad - ((v - min) / span) * (height - pad * 2)
    return [x, y] as const
  })
  const path = points.map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`).join(" ")
  const [lastX, lastY] = points[points.length - 1]

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className={className}
      role="img"
      aria-label={`Views trend, latest ${max.toLocaleString("en-US")}`}
    >
      <path
        d={path}
        fill="none"
        stroke="var(--muted-foreground)"
        strokeOpacity={0.55}
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx={lastX} cy={lastY} r={2.5} fill="var(--brand)" stroke="var(--background)" strokeWidth={1.5} />
    </svg>
  )
}
