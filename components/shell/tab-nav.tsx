import { cn } from "cn"
import Link from "next/link"

// Tabs as plain links (`?tab=`), so each tab is server-rendered and deep-linkable.
export function TabNav({
  tabs,
  active,
  basePath,
}: {
  tabs: { value: string; label: string; count?: number }[]
  active: string
  basePath: string
}) {
  return (
    <nav className="-mb-px flex gap-5 border-b" aria-label="Sections">
      {tabs.map((tab, index) => (
        <Link
          key={tab.value}
          href={index === 0 ? basePath : `${basePath}?tab=${tab.value}`}
          aria-current={tab.value === active ? "page" : undefined}
          className={cn(
            "-mb-px flex items-center gap-1.5 border-b-2 border-transparent pb-2.5 text-sm text-muted-foreground transition-colors hover:text-foreground",
            tab.value === active && "border-foreground font-medium text-foreground"
          )}
        >
          {tab.label}
          {tab.count != null ? (
            <span className="rounded bg-muted px-1.5 text-xs tabular-nums text-muted-foreground">
              {tab.count}
            </span>
          ) : null}
        </Link>
      ))}
    </nav>
  )
}
