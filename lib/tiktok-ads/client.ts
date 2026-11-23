import "server-only"

import { env } from "@/lib/env"

// TikTok Business (Marketing) API v1.3. Endpoints and fields were verified against the real
// advertiser account: Spark ads expose `tiktok_item_id` (the organic post id), and the AUCTION_AD
// report with dimensions ad_id + stat_time_day returns daily `video_play_actions` as strings.

const API = "https://business-api.tiktok.com/open_api/v1.3"

export class TikTokAdsError extends Error {}

export function tiktokAdsConfig() {
  const e = env()
  const advertiserIds = (e.TIKTOK_ADS_ADVERTISER_IDS ?? "")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean)
  return e.TIKTOK_ADS_ACCESS_TOKEN && advertiserIds.length
    ? { token: e.TIKTOK_ADS_ACCESS_TOKEN, advertiserIds }
    : null
}

async function get<T>(token: string, path: string, params: Record<string, unknown>): Promise<T> {
  const query = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value == null) continue
    query.set(key, typeof value === "string" ? value : JSON.stringify(value))
  }
  const response = await fetch(`${API}${path}?${query}`, {
    headers: { "Access-Token": token },
    cache: "no-store",
  })
  const body = (await response.json().catch(() => null)) as { code: number; message: string; data: T } | null
  if (!response.ok || !body || body.code !== 0) {
    throw new TikTokAdsError(`TikTok Ads ${path}: ${body?.message ?? response.statusText}`)
  }
  return body.data
}

type Page<T> = { list: T[]; page_info: { page: number; total_page: number } }

async function getAllPages<T>(token: string, path: string, params: Record<string, unknown>) {
  const rows: T[] = []
  for (let page = 1; page <= 50; page++) {
    const data = await get<Page<T>>(token, path, { ...params, page, page_size: 1000 })
    rows.push(...data.list)
    if (page >= data.page_info.total_page) break
  }
  return rows
}

export type AdDailyStat = { adId: string; statDate: string; videoViews: number; impressions: number; spend: number }

// Daily paid video views per ad. TikTok allows at most 30 days per request when the report is
// broken down by day; dates are calendar days in the ad account's time zone.
export async function fetchAdDailyStats(token: string, advertiserId: string, startDate: string, endDate: string) {
  type Row = { dimensions: { ad_id: string; stat_time_day: string }; metrics: Record<string, string> }
  const base = {
    advertiser_id: advertiserId,
    report_type: "BASIC",
    service_type: "AUCTION",
    data_level: "AUCTION_AD",
    dimensions: ["ad_id", "stat_time_day"],
    metrics: ["video_play_actions", "impressions", "spend"],
    start_date: startDate,
    end_date: endDate,
  }
  let rows: Row[]
  try {
    // Deleted ads still produced paid views, so ask for every status…
    rows = await getAllPages<Row>(token, "/report/integrated/get/", {
      ...base,
      filtering: [{ field_name: "ad_status", filter_type: "IN", filter_value: '["STATUS_ALL"]' }],
    })
  } catch {
    // …but never let an unsupported filter stop the sync.
    rows = await getAllPages<Row>(token, "/report/integrated/get/", base)
  }
  return rows.map<AdDailyStat>((row) => ({
    adId: row.dimensions.ad_id,
    statDate: row.dimensions.stat_time_day.slice(0, 10),
    videoViews: Number(row.metrics.video_play_actions) || 0,
    impressions: Number(row.metrics.impressions) || 0,
    spend: Number(row.metrics.spend) || 0,
  }))
}

export type AdInfo = {
  adId: string
  adName: string | null
  tiktokItemId: string | null
  identityType: string | null
  identityId: string | null
  createTime: string | null
}

export async function fetchAds(token: string, advertiserId: string, adIds: string[]) {
  type Row = {
    ad_id: string
    ad_name?: string
    tiktok_item_id?: string
    identity_type?: string
    identity_id?: string
    create_time?: string
  }
  const ads: AdInfo[] = []
  for (let i = 0; i < adIds.length; i += 100) {
    const data = await get<Page<Row>>(token, "/ad/get/", {
      advertiser_id: advertiserId,
      filtering: { ad_ids: adIds.slice(i, i + 100) },
      fields: ["ad_id", "ad_name", "tiktok_item_id", "identity_type", "identity_id", "create_time"],
      page_size: 100,
    })
    ads.push(
      ...data.list.map((ad) => ({
        adId: ad.ad_id,
        adName: ad.ad_name ?? null,
        tiktokItemId: ad.tiktok_item_id ?? null,
        identityType: ad.identity_type ?? null,
        identityId: ad.identity_id ?? null,
        createTime: ad.create_time ?? null,
      }))
    )
  }
  return ads
}

// The ad account's time zone decides what "a day" means in the report.
export async function fetchAdvertiserTimeZone(token: string, advertiserId: string) {
  try {
    const data = await get<{ list: { timezone?: string; display_timezone?: string }[] }>(
      token,
      "/advertiser/info/",
      { advertiser_ids: [advertiserId], fields: ["timezone", "display_timezone"] }
    )
    const zone = data.list[0]?.display_timezone ?? data.list[0]?.timezone
    if (zone) {
      new Intl.DateTimeFormat("en-US", { timeZone: zone })
      return zone
    }
  } catch {
    // Unknown or unsupported zone name.
  }
  return "UTC"
}
