import type { Metadata } from "next"
import { redirect } from "next/navigation"

import { LoginForm } from "@/components/auth/auth-forms"
import { getCurrentUser } from "@/lib/auth/dal"

export const metadata: Metadata = { title: "Sign in" }

export default async function LoginPage(props: PageProps<"/login">) {
  if (await getCurrentUser()) redirect("/")

  const { next } = await props.searchParams
  const nextPath = typeof next === "string" ? next : undefined

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-lg font-semibold tracking-tight">Sign in</h1>
        <p className="text-sm text-muted-foreground">Access is by invitation only.</p>
      </div>
      <LoginForm next={nextPath} />
    </div>
  )
}
