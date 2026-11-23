import type { Platform } from "@/db/schema/enums"

import { instagramAdapter } from "./instagram"
import { tiktokAdapter } from "./tiktok"
import { NotImplementedError, type PlatformAdapter } from "./types"

// Platforms that can be chosen in a campaign but are not scraped yet. Adding one means writing an
// adapter like tiktok.ts and registering it here; nothing else in the pipeline changes.
function stub(platform: Platform): PlatformAdapter {
  const fail = (): never => {
    throw new NotImplementedError(`Scraping ${platform} is not available yet.`)
  }
  return {
    platform,
    enabled: false,
    pricePerResultUsd: 0,
    discovery: fail,
    metrics: fail,
    normalize: () => null,
  }
}

const ADAPTERS: Record<Platform, PlatformAdapter> = {
  tiktok: tiktokAdapter,
  instagram: instagramAdapter,
  youtube: stub("youtube"),
  facebook: stub("facebook"),
  snapchat: stub("snapchat"),
}

export function adapterFor(platform: Platform): PlatformAdapter {
  return ADAPTERS[platform]
}
