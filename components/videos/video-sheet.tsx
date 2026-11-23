"use client"

import { parseAsString, useQueryState } from "nuqs"
import { useRef, useTransition } from "react"

import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet"

// The sheet is open whenever `?video=<id>` is in the URL, so a video detail is a shareable link.
// Its content is rendered by the server page and passed in as children.
export function VideoSheet({ open, children }: { open: boolean; children: React.ReactNode }) {
  const [, startTransition] = useTransition()
  // Focus the panel itself on open; otherwise the first link inside gets a stray focus ring.
  const bodyRef = useRef<HTMLDivElement>(null)
  const [, setVideo] = useQueryState("video", parseAsString.withOptions({ shallow: false, startTransition }))

  return (
    <Sheet open={open} onOpenChange={(next) => !next && setVideo(null)}>
      <SheetContent
        initialFocus={bodyRef}
        className="w-full gap-0 overflow-y-auto data-[side=right]:sm:max-w-2xl"
      >
        <SheetHeader className="border-b">
          <SheetTitle>Video</SheetTitle>
          <SheetDescription>Views, lock, paid views and history for one post.</SheetDescription>
        </SheetHeader>
        <div ref={bodyRef} tabIndex={-1} className="p-4 outline-none md:p-6">
          {children}
        </div>
      </SheetContent>
    </Sheet>
  )
}
