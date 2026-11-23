"use client"

import { useQueryStates } from "nuqs"
import { useRef, useTransition } from "react"

import { SimpleSelect } from "@/components/form/simple-select"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { calendarParsers } from "@/lib/search-params/calendar"

type Option = { id: string; name: string }

// Switching campaign starts over on its current cycle: another campaign may cut its cycles
// differently (weekly, another time zone), so the old period would not line up.
export function CampaignPicker({ campaigns, value }: { campaigns: Option[]; value: string }) {
  const [pending, startTransition] = useTransition()
  const [, setParams] = useQueryStates(calendarParsers, { shallow: false, startTransition })

  return (
    <div className="data-[pending=true]:opacity-70" data-pending={pending}>
      <SimpleSelect
        size="sm"
        className="w-52"
        value={value}
        onValueChange={(campaign) =>
          campaign && setParams({ campaign, period: null, creator: null, day: null, platform: null })
        }
        options={campaigns.map((c) => ({ value: c.id, label: c.name }))}
      />
    </div>
  )
}

// Open whenever `?creator=…&day=…` is in the URL. Its content is rendered by the server page.
export function DaySheet({
  open,
  title,
  description,
  children,
}: {
  open: boolean
  title: string
  description: string
  children: React.ReactNode
}) {
  const [, startTransition] = useTransition()
  const bodyRef = useRef<HTMLDivElement>(null)
  const [, setParams] = useQueryStates(calendarParsers, { shallow: false, startTransition })

  return (
    <Sheet open={open} onOpenChange={(next) => !next && setParams({ creator: null, day: null, platform: null })}>
      <SheetContent initialFocus={bodyRef} className="w-full gap-0 overflow-y-auto data-[side=right]:sm:max-w-md">
        <SheetHeader className="border-b">
          <SheetTitle>{title}</SheetTitle>
          <SheetDescription>{description}</SheetDescription>
        </SheetHeader>
        <div ref={bodyRef} tabIndex={-1} className="p-4 outline-none md:p-6">
          {children}
        </div>
      </SheetContent>
    </Sheet>
  )
}
