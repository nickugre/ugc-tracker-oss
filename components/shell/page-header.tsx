import { SidebarTrigger } from "@/components/ui/sidebar"
import { Separator } from "@/components/ui/separator"

// The top bar of every app page: sidebar toggle, title, optional description and actions.
export function PageHeader({
  title,
  description,
  children,
}: {
  title: string
  description?: string
  children?: React.ReactNode
}) {
  return (
    <header className="flex min-h-14 shrink-0 items-center gap-3 border-b px-4 py-2.5 md:px-6">
      <SidebarTrigger className="-ml-1.5 text-muted-foreground" />
      <Separator orientation="vertical" className="h-4 data-[orientation=vertical]:h-4" />
      <div className="flex min-w-0 flex-1 flex-col">
        <h1 className="truncate text-sm font-semibold tracking-tight">{title}</h1>
        {description ? (
          <p className="truncate text-xs text-muted-foreground">{description}</p>
        ) : null}
      </div>
      {children ? <div className="flex shrink-0 items-center gap-2">{children}</div> : null}
    </header>
  )
}

export function PageBody({ children }: { children: React.ReactNode }) {
  return <div className="flex flex-1 flex-col gap-6 p-4 md:p-6">{children}</div>
}
