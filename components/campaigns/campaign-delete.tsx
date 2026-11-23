"use client"

import { useRouter } from "next/navigation"

import { DeleteButton } from "@/components/form/delete-button"
import { deleteCampaign } from "@/lib/actions/campaigns"

export function CampaignDelete({ campaignId, name }: { campaignId: string; name: string }) {
  const router = useRouter()
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-6">
      <p className="text-sm text-muted-foreground">
        A campaign can be deleted while it has no videos and no payouts. After that, set its status to Ended.
      </p>
      <DeleteButton
        label="Delete campaign…"
        title={`Delete ${name}?`}
        description="This permanently deletes the campaign and its creator assignments. Linked accounts are kept and unlinked."
        confirmText={name}
        successMessage="Campaign deleted"
        action={(confirm) => deleteCampaign({ id: campaignId, confirm })}
        onDeleted={() => router.push("/campaigns")}
      />
    </div>
  )
}
