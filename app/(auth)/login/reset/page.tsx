import type { Metadata } from "next"
import Link from "next/link"

import { ResetRequestForm } from "@/components/auth/auth-forms"

export const metadata: Metadata = { title: "Reset password" }

export default function ResetPasswordPage() {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-lg font-semibold tracking-tight">Reset your password</h1>
        <p className="text-sm text-muted-foreground">We will email you a link to choose a new one.</p>
      </div>
      <ResetRequestForm />
      <Link
        href="/login"
        className="text-center text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
      >
        Back to sign in
      </Link>
    </div>
  )
}
