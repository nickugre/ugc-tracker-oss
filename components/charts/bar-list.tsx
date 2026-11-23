import Link from "next/link"

export type BarListItem = {
  key: string
  label: string
  sublabel?: string
  value: number
  href?: string
  // A picture in front of the row, such as a video cover.
  media?: React.ReactNode
  // For values that are not a plain count (a percentage): what to write at the end of the row
  // and what to say on hover. The bar length still comes from `value`.
  valueLabel?: string
  title?: string
}

const compact = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 })
const exact = new Intl.NumberFormat("en-US")

// Ranked horizontal bars: one series, so one colour for every bar (a darker-where-bigger ramp
// would only repeat what the bar length already says). Thin bars with a rounded data end, the
// label above, and the value written at the end of every row so nothing depends on hovering.
export function BarList({
  items,
  unit,
  emptyText = "No data in this period.",
}: {
  items: BarListItem[]
  unit: string
  emptyText?: string
}) {
  if (items.length === 0) {
    return <p className="py-8 text-center text-sm text-muted-foreground">{emptyText}</p>
  }
  const max = Math.max(...items.map((i) => i.value), 1e-9)

  return (
    <ol className="flex flex-col gap-3">
      {items.map((item) => {
        const label = (
          <span className="flex min-w-0 items-baseline gap-2">
            <span className="truncate text-sm">{item.label}</span>
            {item.sublabel ? (
              <span className="shrink-0 text-xs text-muted-foreground">{item.sublabel}</span>
            ) : null}
          </span>
        )
        return (
          <li
            key={item.key}
            className="flex items-center gap-3"
            title={item.title ?? `${exact.format(item.value)} ${unit}`}
          >
            {item.media}
            <div className="flex min-w-0 flex-1 flex-col gap-1.5">
              <div className="flex items-baseline justify-between gap-3">
                {item.href ? (
                  <Link href={item.href} className="min-w-0 hover:underline">
                    {label}
                  </Link>
                ) : (
                  label
                )}
                <span className="shrink-0 text-sm font-medium tabular-nums">
                  {item.valueLabel ?? compact.format(item.value)}
                </span>
              </div>
              <div className="h-1.5 w-full rounded-r-full bg-muted">
                <div
                  className="h-full rounded-r-full bg-brand"
                  style={{ width: `${Math.max(1.5, (item.value / max) * 100)}%` }}
                />
              </div>
            </div>
          </li>
        )
      })}
    </ol>
  )
}
