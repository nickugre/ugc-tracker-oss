export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex min-h-svh items-center justify-center bg-muted/40 px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex items-center justify-center gap-2">
          <span className="flex size-7 items-center justify-center rounded-md bg-foreground text-xs font-semibold text-background">
            U
          </span>
          <span className="text-sm font-semibold tracking-tight">UGC Tracker</span>
        </div>
        <div className="rounded-xl border bg-background p-6 shadow-xs">{children}</div>
      </div>
    </main>
  )
}
