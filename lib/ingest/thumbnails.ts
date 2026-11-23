import "server-only"

import { and, eq, isNotNull, isNull } from "drizzle-orm"

import { db } from "@/db"
import { posts } from "@/db/schema"
import { createAdminClient } from "@/lib/supabase/admin"

const BUCKET = "thumbnails"
const TIMEOUT_MS = 8_000
const MAX_BYTES = 3_000_000
// Covers arrive at up to 1080px and ~350 KB; the app never shows them wider than this.
const MAX_WIDTH = 480

// Shrinks a cover to a small JPEG (roughly a tenth of the size). If the image library cannot be
// loaded or the format is unknown, the original bytes are stored instead.
async function shrink(bytes: ArrayBuffer, type: string): Promise<{ data: ArrayBuffer | Buffer; type: string; extension: string }> {
  try {
    const { default: sharp } = await import("sharp")
    const data = await sharp(Buffer.from(bytes))
      .rotate()
      .resize({ width: MAX_WIDTH, withoutEnlargement: true })
      .jpeg({ quality: 72, mozjpeg: true })
      .toBuffer()
    return { data, type: "image/jpeg", extension: "jpg" }
  } catch {
    const extension = type.includes("webp") ? "webp" : type.includes("png") ? "png" : "jpg"
    return { data: bytes, type, extension }
  }
}

// TikTok and Instagram cover URLs are signed and expire within hours, so each cover is copied to
// our own Storage bucket once. Failures are silent: the next ingest refreshes the source URL and
// tries again.
export async function persistThumbnails(postIds: string[], concurrency = 4) {
  if (postIds.length === 0) return 0
  const supabase = createAdminClient()
  let stored = 0

  const queue = [...postIds]
  async function worker() {
    for (let id = queue.shift(); id; id = queue.shift()) {
      const [post] = await db
        .select({ id: posts.id, platform: posts.platform, key: posts.platformPostId, source: posts.thumbnailSourceUrl })
        .from(posts)
        .where(and(eq(posts.id, id), isNull(posts.thumbnailPath), isNotNull(posts.thumbnailSourceUrl)))
        .limit(1)
      if (!post?.source) continue
      try {
        const response = await fetch(post.source, { signal: AbortSignal.timeout(TIMEOUT_MS) })
        const type = response.headers.get("content-type") ?? "image/jpeg"
        if (!response.ok || !type.startsWith("image/")) continue
        const bytes = await response.arrayBuffer()
        if (bytes.byteLength === 0 || bytes.byteLength > MAX_BYTES) continue

        const image = await shrink(bytes, type)
        const path = `posts/${post.platform}/${post.key}.${image.extension}`
        const { error } = await supabase.storage
          .from(BUCKET)
          .upload(path, image.data, { contentType: image.type, upsert: true, cacheControl: "31536000" })
        if (error) continue
        await db.update(posts).set({ thumbnailPath: path }).where(eq(posts.id, post.id))
        stored++
      } catch {
        // Expired URL, timeout or blocked request: try again on the next ingest.
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, postIds.length) }, worker))
  return stored
}
