"use client"

import { useMemo, useRef, useState } from "react"

type Point = { t: number; views: number }

const W = 560
const H = 200
const M = { top: 16, right: 56, bottom: 24, left: 44 }

const compact = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 })
const exact = new Intl.NumberFormat("en-US")

// Axis maximum and gridlines on clean numbers: the largest step that still gives 3–4 intervals,
// so ticks read 0 / 50K / 100K / 150K rather than 0 / 37.5K / 75K …
function niceScale(maxValue: number) {
  if (maxValue <= 0) return { max: 10, ticks: [0, 5, 10] }
  const power = 10 ** Math.floor(Math.log10(maxValue))
  for (const step of [0.25, 0.5, 1, 2, 2.5, 5, 10].map((s) => s * power)) {
    const count = Math.ceil(maxValue / step)
    if (count <= 4) {
      return { max: count * step, ticks: Array.from({ length: count + 1 }, (_, i) => i * step) }
    }
  }
  return { max: power * 10, ticks: [0, power * 5, power * 10] }
}

// A single series over time (views of one video, or views gained per day), so no legend — the
// heading above names it. The line is the accent, the area a 10% wash, the latest value is
// labelled at the end, and the crosshair snaps to the nearest real data point. Every value is
// also available in a table next to the chart, so the tooltip never gates information.
export function ViewsChart({
  points,
  marker = null,
  timeZone,
  unit = "views",
  dateOnly = false,
}: {
  points: Point[]
  // Optional vertical reference line, e.g. the end of the view window.
  marker?: { t: number; label: string } | null
  timeZone: string
  unit?: string
  // Daily data: show dates without a time of day.
  dateOnly?: boolean
}) {
  const svgRef = useRef<SVGSVGElement>(null)
  const [hover, setHover] = useState<number | null>(null)

  const scale = useMemo(() => {
    const times = points.map((p) => p.t)
    const tMin = Math.min(...times)
    const tMax = Math.max(...times, marker ? Math.min(marker.t, Math.max(...times) + 86_400_000) : -Infinity)
    const { max: yMax, ticks } = niceScale(Math.max(...points.map((p) => p.views)))
    const x = (t: number) => M.left + ((t - tMin) / (tMax - tMin || 1)) * (W - M.left - M.right)
    const y = (v: number) => H - M.bottom - (v / yMax) * (H - M.top - M.bottom)
    return { tMin, tMax, ticks, x, y }
  }, [points, marker])

  if (points.length < 2) {
    return (
      <p className="rounded-lg border border-dashed px-4 py-8 text-center text-sm text-muted-foreground">
        Not enough snapshots to draw a trend yet.
      </p>
    )
  }

  const { x, y, ticks, tMin, tMax } = scale
  const line = points.map((p, i) => `${i ? "L" : "M"}${x(p.t).toFixed(1)},${y(p.views).toFixed(1)}`).join(" ")
  const area = `${line} L${x(points[points.length - 1].t).toFixed(1)},${y(0)} L${x(points[0].t).toFixed(1)},${y(0)} Z`
  const last = points[points.length - 1]
  const showMarker = marker != null && marker.t >= tMin && marker.t <= tMax
  const day = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone })
  const full = dateOnly
    ? new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric", timeZone })
    : new Intl.DateTimeFormat("en-US", {
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
        timeZone,
      })
  const hovered = hover == null ? null : points[hover]

  function onMove(event: React.PointerEvent<SVGSVGElement>) {
    const box = svgRef.current?.getBoundingClientRect()
    if (!box) return
    const px = ((event.clientX - box.left) / box.width) * W
    let nearest = 0
    points.forEach((p, i) => {
      if (Math.abs(x(p.t) - px) < Math.abs(x(points[nearest].t) - px)) nearest = i
    })
    setHover(nearest)
  }

  return (
    <div className="relative">
      <svg
        ref={svgRef}
        viewBox={`0 0 ${W} ${H}`}
        className="w-full touch-none select-none"
        role="img"
        aria-label={`Trend over time, latest ${exact.format(last.views)} ${unit}`}
        onPointerMove={onMove}
        onPointerLeave={() => setHover(null)}
      >
        {ticks.map((tick) => (
          <g key={tick}>
            <line x1={M.left} x2={W - M.right} y1={y(tick)} y2={y(tick)} stroke="var(--border)" strokeWidth={1} />
            <text x={M.left - 8} y={y(tick) + 3.5} textAnchor="end" className="fill-muted-foreground text-[10px] tabular-nums">
              {compact.format(tick)}
            </text>
          </g>
        ))}
        {[tMin, (tMin + tMax) / 2, tMax].map((t, i) => (
          <text
            key={i}
            x={x(t)}
            y={H - 6}
            textAnchor={i === 0 ? "start" : i === 2 ? "end" : "middle"}
            className="fill-muted-foreground text-[10px]"
          >
            {day.format(t)}
          </text>
        ))}

        {showMarker && marker ? (
          <g>
            <line x1={x(marker.t)} x2={x(marker.t)} y1={M.top - 4} y2={H - M.bottom} stroke="var(--foreground)" strokeOpacity={0.35} strokeWidth={1} />
            <text x={x(marker.t) - 5} y={M.top + 4} textAnchor="end" className="fill-muted-foreground text-[10px]">
              {marker.label}
            </text>
          </g>
        ) : null}

        <path d={area} fill="var(--brand)" fillOpacity={0.1} />
        <path d={line} fill="none" stroke="var(--brand)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />

        {hovered ? (
          <g>
            <line x1={x(hovered.t)} x2={x(hovered.t)} y1={M.top} y2={H - M.bottom} stroke="var(--foreground)" strokeOpacity={0.25} strokeWidth={1} />
            <circle cx={x(hovered.t)} cy={y(hovered.views)} r={4} fill="var(--brand)" stroke="var(--background)" strokeWidth={2} />
          </g>
        ) : (
          <g>
            <circle cx={x(last.t)} cy={y(last.views)} r={4} fill="var(--brand)" stroke="var(--background)" strokeWidth={2} />
            <text x={x(last.t) + 8} y={y(last.views) + 3.5} className="fill-foreground text-[11px] font-medium tabular-nums">
              {compact.format(last.views)}
            </text>
          </g>
        )}
      </svg>

      {hovered ? (
        <div
          className="pointer-events-none absolute top-0 z-10 -translate-x-1/2 rounded-md border bg-popover px-2.5 py-1.5 shadow-sm"
          style={{ left: `${(x(hovered.t) / W) * 100}%` }}
        >
          <p className="text-sm font-semibold tabular-nums">
            {exact.format(hovered.views)} {unit}
          </p>
          <p className="text-xs whitespace-nowrap text-muted-foreground">{full.format(hovered.t)}</p>
        </div>
      ) : null}
    </div>
  )
}
