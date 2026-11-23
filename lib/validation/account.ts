import { z } from "zod"

import { PLATFORMS, type Platform } from "@/db/schema/enums"

export const accountInputSchema = z.object({
  platform: z.enum(PLATFORMS),
  // A handle ("@name") or a full profile URL; normalized by parseAccountHandle.
  handleOrUrl: z.string().trim().min(1, "Enter a handle or profile URL").max(300),
  creatorId: z.uuid().nullable(),
  campaignId: z.uuid().nullable(),
  trackFrom: z.iso.date().nullable(),
  trackingEnabled: z.boolean(),
})
export type AccountInput = z.infer<typeof accountInputSchema>

export const accountLinkSchema = z.object({
  id: z.uuid(),
  creatorId: z.uuid().nullable(),
  campaignId: z.uuid().nullable(),
  trackFrom: z.iso.date().nullable(),
})
export type AccountLinkInput = z.infer<typeof accountLinkSchema>

const HOSTS: Record<Platform, RegExp> = {
  tiktok: /(^|\.)tiktok\.com$/i,
  instagram: /(^|\.)instagram\.com$/i,
  youtube: /(^|\.)youtube\.com$/i,
  facebook: /(^|\.)(facebook|fb)\.com$/i,
  snapchat: /(^|\.)snapchat\.com$/i,
}

const HANDLE = /^[a-z0-9._-]{1,60}$/

export function profileUrl(platform: Platform, handle: string): string {
  switch (platform) {
    case "tiktok":
      return `https://www.tiktok.com/@${handle}`
    case "instagram":
      return `https://www.instagram.com/${handle}/`
    case "youtube":
      return `https://www.youtube.com/@${handle}`
    case "facebook":
      return `https://www.facebook.com/${handle}`
    case "snapchat":
      return `https://www.snapchat.com/add/${handle}`
  }
}

// Accepts "@Name", "name" or a profile URL and returns the lowercase handle plus the canonical
// profile URL, or an error message the form can show.
export function parseAccountHandle(
  platform: Platform,
  input: string
): { ok: true; handle: string; url: string } | { ok: false; error: string } {
  let raw = input.trim()

  if (/^https?:\/\//i.test(raw) || /^(www\.)?[a-z]+\.com\//i.test(raw)) {
    let parsed: URL
    try {
      parsed = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`)
    } catch {
      return { ok: false, error: "That does not look like a valid URL" }
    }
    if (!HOSTS[platform].test(parsed.hostname)) {
      return { ok: false, error: `That URL is not a ${platform} profile` }
    }
    const segments = parsed.pathname.split("/").filter(Boolean)
    // Snapchat profile URLs are /add/<handle>.
    raw = (segments[0] === "add" ? segments[1] : segments[0]) ?? ""
  }

  const handle = raw.replace(/^@/, "").toLowerCase()
  if (!HANDLE.test(handle)) {
    return { ok: false, error: "Enter a handle like @name or the profile URL" }
  }
  return { ok: true, handle, url: profileUrl(platform, handle) }
}
