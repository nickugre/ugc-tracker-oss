import { NextResponse, type NextRequest } from "next/server"

import { getCurrentUser } from "@/lib/auth/dal"
import { getCycleView } from "@/lib/payouts/service"

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// Quote every cell, and neutralise values a spreadsheet would run as a formula.
function cell(value: string | number | null | undefined) {
  let text = value == null ? "" : String(value)
  if (/^[=+\-@\t\r]/.test(text) && typeof value !== "number") text = `'${text}`
  return `"${text.replaceAll('"', '""')}"`
}

const dollars = (cents: number) => (cents / 100).toFixed(2)

// CSV of one cycle: a summary row per creator followed by one row per settled video.
export async function GET(request: NextRequest) {
  if (!(await getCurrentUser())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const campaign = request.nextUrl.searchParams.get("campaign") ?? ""
  const period = request.nextUrl.searchParams.get("period")
  if (!UUID.test(campaign) || (period && !ISO_DATE.test(period))) {
    return NextResponse.json({ error: "Bad request" }, { status: 400 })
  }

  const view = await getCycleView(campaign, period, new Date())
  if (!view) return NextResponse.json({ error: "Not found" }, { status: 404 })

  const rows: (string | number | null)[][] = [
    [
      "row", "creator", "status", "posts_published", "posts_delivered", "quota", "base_usd", "bonus_usd",
      "adjustments_usd", "cap_reduction_usd", "total_usd", "payment_ref", "video", "platform",
      "window_ended", "locked_views", "paid_views", "payable_views", "video_bonus_usd",
    ],
  ]
  for (const line of view.lines) {
    const p = line.payout
    rows.push([
      "creator", line.creatorName, line.status ?? view.status, p.postsPublished, p.postsDelivered, p.quota,
      dollars(p.baseCents), dollars(p.bonusCents), dollars(p.adjustmentsCents), dollars(p.capReductionCents),
      dollars(p.totalCents), line.paymentRef, null, null, null, null, null, null, null,
    ])
    for (const post of line.bonusPosts) {
      const item = p.bonusItems.find((i) => i.postId === post.id)
      rows.push([
        "video", line.creatorName, null, null, null, null, null, null, null, null, null, null,
        post.caption, post.platform, post.windowEndsAt.toISOString(), post.lockedViews, post.paidViews,
        post.payableViews, dollars(item?.amountCents ?? 0),
      ])
    }
  }

  const csv = rows.map((row) => row.map(cell).join(",")).join("\r\n")
  const name = `payout-${view.campaign.name.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}-${view.cycle.periodStart}.csv`
  return new NextResponse(`﻿${csv}`, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${name}"`,
      "Cache-Control": "no-store",
    },
  })
}
