import { cookies } from "next/headers"

import { AppSidebar } from "@/components/shell/app-sidebar"
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar"
import { requireUser } from "@/lib/auth/dal"

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser()
  const cookieStore = await cookies()
  // The sidebar component remembers collapsed/expanded in this cookie.
  const defaultOpen = cookieStore.get("sidebar_state")?.value !== "false"

  return (
    <SidebarProvider defaultOpen={defaultOpen}>
      <AppSidebar user={{ email: user.email, fullName: user.fullName }} />
      <SidebarInset className="min-w-0">{children}</SidebarInset>
    </SidebarProvider>
  )
}
