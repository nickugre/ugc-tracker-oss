import type { Metadata } from "next"

import { SetPasswordForm } from "@/components/auth/auth-forms"

export const metadata: Metadata = { title: "Set password" }

export default function SetPasswordPage() {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-lg font-semibold tracking-tight">Choose a password</h1>
        <p className="text-sm text-muted-foreground">You will use it to sign in from now on.</p>
      </div>
      <SetPasswordForm />
    </div>
  )
}
