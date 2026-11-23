import { ArrowLeftIcon } from "lucide-react"
import type { Metadata } from "next"
import Link from "next/link"
import { notFound } from "next/navigation"

import { PageBody, PageHeader } from "@/components/shell/page-header"
import { buttonVariants } from "@/components/ui/button"
import { VideoDetail } from "@/components/videos/video-detail"
import { getPostDetail } from "@/lib/queries/posts"

export const metadata: Metadata = { title: "Video" }

// Full-page version of the detail sheet, for links shared outside the Videos table.
export default async function VideoPage(props: PageProps<"/videos/[id]">) {
  const { id } = await props.params
  const detail = await getPostDetail(id)
  if (!detail) notFound()

  return (
    <>
      <PageHeader title="Video" description={`@${detail.accountHandle}`}>
        <Link href="/videos" className={buttonVariants({ variant: "outline", size: "sm" })}>
          <ArrowLeftIcon />
          All videos
        </Link>
      </PageHeader>
      <PageBody>
        <div className="mx-auto w-full max-w-3xl">
          <VideoDetail key={detail.post.updatedAt.toISOString()} detail={detail} now={new Date()} />
        </div>
      </PageBody>
    </>
  )
}
