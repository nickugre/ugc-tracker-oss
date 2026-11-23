"use client"

import { PlayIcon, VideoIcon } from "lucide-react"
import Image from "next/image"
import { useState } from "react"

import type { Platform } from "@/db/schema/enums"
import { cn } from "@/lib/utils"

// The platforms' own embed players, so the video plays here without us storing or proxying it.
// TikTok's id is the numeric video id; Instagram's is the shortcode.
function embedUrl(platform: Platform, platformPostId: string) {
  return platform === "tiktok"
    ? `https://www.tiktok.com/player/v1/${platformPostId}?autoplay=1&rel=0&description=0&music_info=0`
    : `https://www.instagram.com/reel/${platformPostId}/embed/`
}

// Shows the stored cover until clicked, so opening a video's detail doesn't load a third-party
// player (and its tracking) every time.
export function VideoPlayer({
  platform,
  platformPostId,
  thumbnailSrc,
}: {
  platform: Platform
  platformPostId: string
  thumbnailSrc: string | null
}) {
  const [playing, setPlaying] = useState(false)

  if (playing) {
    return (
      <div
        className={cn(
          "w-full max-w-[300px] shrink-0 overflow-hidden rounded-lg bg-black",
          // Instagram's embed adds a header and footer around the video.
          platform === "tiktok"
            ? "aspect-[9/16]"
            : "h-[620px] bg-white ring-1 ring-border",
        )}
      >
        <iframe
          src={embedUrl(platform, platformPostId)}
          title="Video player"
          className="size-full"
          allow="autoplay; encrypted-media; fullscreen; picture-in-picture"
          allowFullScreen
        />
      </div>
    )
  }

  return (
    <button
      type="button"
      onClick={() => setPlaying(true)}
      aria-label="Play video"
      className="group relative flex aspect-[9/16] w-32 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-muted outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      {thumbnailSrc ? (
        <Image
          src={thumbnailSrc}
          alt=""
          fill
          sizes="128px"
          className="object-cover"
        />
      ) : (
        <VideoIcon className="size-5 text-muted-foreground/60" />
      )}
      <span className="absolute inset-0 bg-black/10 transition-colors group-hover:bg-black/25" />
      <span className="relative flex size-10 items-center justify-center rounded-full bg-white/90 shadow-sm transition-transform group-hover:scale-105">
        <PlayIcon className="size-4 translate-x-px fill-foreground text-foreground" />
      </span>
    </button>
  )
}
