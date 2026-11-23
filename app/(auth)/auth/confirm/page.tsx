import type { Metadata } from "next"

import { ConfirmLinkForm, LinkSessionForm } from "@/components/auth/auth-forms"

export const metadata: Metadata = { title: "Continue" }

// Landing point for invite and password-reset links, in either of two shapes:
//  - ?token_hash=…&type=…  our own links and email templates. The one-time token is only redeemed
//    when the button is pressed: mail scanners and chat apps open links to build previews, and a
//    token verified on a plain GET would already be used up by the time the person clicks.
//  - #access_token=…       Supabase's default email templates, which verify on Supabase's side.
export default async function ConfirmPage(props: PageProps<"/auth/confirm">) {
  const { token_hash: tokenHash, type, next } = await props.searchParams
  const nextPath = typeof next === "string" ? next : undefined

  if (typeof tokenHash !== "string" || typeof type !== "string") {
    return <LinkSessionForm next={nextPath} />
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-lg font-semibold tracking-tight">
          {type === "invite" ? "You have been invited" : "Continue to UGC Tracker"}
        </h1>
        <p className="text-sm text-muted-foreground">
          Continue to choose your password. The link works once.
        </p>
      </div>
      <ConfirmLinkForm tokenHash={tokenHash} type={type} next={nextPath} />
    </div>
  )
}
