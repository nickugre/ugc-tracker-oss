"use client"

import {
  AtSignIcon,
  BanknoteIcon,
  CalendarDaysIcon,
  ChevronsUpDownIcon,
  LayoutDashboardIcon,
  KeyRoundIcon,
  LogOutIcon,
  MegaphoneIcon,
  SettingsIcon,
  UsersIcon,
  VideoIcon,
  ZapIcon,
  type LucideIcon,
} from "lucide-react"
import Link from "next/link"
import { usePathname } from "next/navigation"

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
} from "@/components/ui/sidebar"
import { signOut } from "@/lib/auth/actions"

type NavItem = { title: string; href: string; icon: LucideIcon }

// The order follows the pipeline: track accounts → ingest videos → lock views → pay creators.
const OPERATE: NavItem[] = [
  { title: "Overview", href: "/", icon: LayoutDashboardIcon },
  { title: "Videos", href: "/videos", icon: VideoIcon },
  { title: "Spark", href: "/spark", icon: ZapIcon },
  { title: "Calendar", href: "/calendar", icon: CalendarDaysIcon },
  { title: "Payouts", href: "/payouts", icon: BanknoteIcon },
]

const MANAGE: NavItem[] = [
  { title: "Creators", href: "/creators", icon: UsersIcon },
  { title: "Accounts", href: "/accounts", icon: AtSignIcon },
  { title: "Campaigns", href: "/campaigns", icon: MegaphoneIcon },
]

function isActive(pathname: string, href: string) {
  return href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`)
}

function NavGroup({ label, items }: { label: string; items: NavItem[] }) {
  const pathname = usePathname()

  return (
    <SidebarGroup>
      <SidebarGroupLabel>{label}</SidebarGroupLabel>
      <SidebarGroupContent>
        <SidebarMenu>
          {items.map((item) => (
            <SidebarMenuItem key={item.href}>
              <SidebarMenuButton
                isActive={isActive(pathname, item.href)}
                tooltip={item.title}
                render={<Link href={item.href} />}
              >
                <item.icon />
                <span>{item.title}</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          ))}
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  )
}

export function AppSidebar({ user }: { user: { email: string; fullName: string | null } }) {
  const pathname = usePathname()
  const name = user.fullName?.trim() || user.email.split("@")[0]
  const initial = name.charAt(0).toUpperCase()

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" render={<Link href="/" />}>
              <span className="flex aspect-square size-8 items-center justify-center rounded-lg bg-foreground text-sm font-semibold text-background">
                U
              </span>
              <span className="grid flex-1 text-left leading-tight">
                <span className="truncate text-sm font-semibold">UGC Tracker</span>
                <span className="truncate text-xs text-muted-foreground">Views → payouts</span>
              </span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>

      <SidebarContent>
        <NavGroup label="Operate" items={OPERATE} />
        <NavGroup label="Manage" items={MANAGE} />
      </SidebarContent>

      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              isActive={isActive(pathname, "/settings")}
              tooltip="Settings"
              render={<Link href="/settings" />}
            >
              <SettingsIcon />
              <span>Settings</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <DropdownMenu>
              <DropdownMenuTrigger render={<SidebarMenuButton size="lg" />}>
                <span className="flex aspect-square size-8 items-center justify-center rounded-lg bg-muted text-sm font-medium">
                  {initial}
                </span>
                <span className="grid flex-1 text-left leading-tight">
                  <span className="truncate text-sm font-medium">{name}</span>
                  <span className="truncate text-xs text-muted-foreground">{user.email}</span>
                </span>
                <ChevronsUpDownIcon className="ml-auto size-4 text-muted-foreground" />
              </DropdownMenuTrigger>
              <DropdownMenuContent side="top" align="start" className="min-w-56">
                {/* Base UI only allows a label inside a group; without one the whole menu throws. */}
                <DropdownMenuGroup>
                  <DropdownMenuLabel className="truncate text-xs font-normal text-muted-foreground">
                    {user.email}
                  </DropdownMenuLabel>
                </DropdownMenuGroup>
                <DropdownMenuSeparator />
                <DropdownMenuItem render={<Link href="/set-password" />}>
                  <KeyRoundIcon />
                  Change password
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => signOut()}>
                  <LogOutIcon />
                  Sign out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  )
}
