"use client"

import { endOfMonth, format, isValid, parseISO, startOfMonth, subDays, subMonths } from "date-fns"
import { CalendarIcon, ChevronDownIcon } from "lucide-react"
import { useState } from "react"

import { Button } from "@/components/ui/button"
import { Calendar } from "@/components/ui/calendar"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"

const DAY = "yyyy-MM-dd"

type Days = { from: string | null; to: string | null }

// An open end ("to: null") keeps a saved link current: new videos keep showing up in it.
const PRESETS: { label: string; days: (today: Date) => { from: Date; to: Date | null } }[] = [
  { label: "Today", days: (today) => ({ from: today, to: null }) },
  { label: "Last 7 days", days: (today) => ({ from: subDays(today, 6), to: null }) },
  { label: "Last 30 days", days: (today) => ({ from: subDays(today, 29), to: null }) },
  { label: "Last 90 days", days: (today) => ({ from: subDays(today, 89), to: null }) },
  { label: "This month", days: (today) => ({ from: startOfMonth(today), to: null }) },
  {
    label: "Last month",
    days: (today) => ({ from: startOfMonth(subMonths(today, 1)), to: endOfMonth(subMonths(today, 1)) }),
  },
]

// A YYYY-MM-DD URL value → local midnight, or undefined when the text is not a real day.
function toDate(day: string | null) {
  if (!day || !/^\d{4}-\d{2}-\d{2}$/.test(day)) return undefined
  const date = parseISO(day)
  return isValid(date) ? date : undefined
}

function rangeLabel(from: Date | undefined, to: Date | undefined) {
  if (from && to) {
    const start = format(from, from.getFullYear() === to.getFullYear() ? "MMM d" : "MMM d, yyyy")
    return from.getTime() === to.getTime() ? format(to, "MMM d, yyyy") : `${start} – ${format(to, "MMM d, yyyy")}`
  }
  if (from) return `Since ${format(from, "MMM d, yyyy")}`
  if (to) return `Until ${format(to, "MMM d, yyyy")}`
  return null
}

// With an open end, shade through today so the calendar shows what the filter covers.
function shownRange(from: Date | undefined, to: Date | undefined) {
  if (!from && !to) return undefined
  const today = new Date()
  return { from, to: to ?? (from && from <= today ? today : undefined) }
}

export function PostedFilter({
  from,
  to,
  onChange,
}: Days & {
  onChange: (next: Days) => void
}) {
  const fromDate = toDate(from)
  const toDateValue = toDate(to)
  const label = rangeLabel(fromDate, toDateValue)
  // The month on screen. Controlled so that a preset can bring its range into view.
  const [month, setMonth] = useState<Date>()

  return (
    <Popover onOpenChange={(open) => (open ? setMonth(toDateValue ?? new Date()) : undefined)}>
      <PopoverTrigger render={<Button variant="outline" size="sm" className="font-normal" />}>
        <CalendarIcon className="text-muted-foreground" />
        {label ?? "Posted"}
        <ChevronDownIcon className="text-muted-foreground" />
      </PopoverTrigger>
      <PopoverContent align="start" className="w-auto flex-row gap-0 p-0">
        <div className="flex w-32 flex-col gap-0.5 border-r p-1.5">
          {PRESETS.map((preset) => (
            <Button
              key={preset.label}
              variant="ghost"
              size="sm"
              className="justify-start font-normal"
              onClick={() => {
                const today = new Date()
                const days = preset.days(today)
                setMonth(days.to ?? today)
                onChange({ from: format(days.from, DAY), to: days.to ? format(days.to, DAY) : null })
              }}
            >
              {preset.label}
            </Button>
          ))}
          {label ? (
            <Button
              variant="ghost"
              size="sm"
              className="mt-auto justify-start font-normal text-muted-foreground"
              onClick={() => onChange({ from: null, to: null })}
            >
              Any time
            </Button>
          ) : null}
        </div>
        <Calendar
          mode="range"
          selected={shownRange(fromDate, toDateValue)}
          onSelect={(range) =>
            onChange({
              from: range?.from ? format(range.from, DAY) : null,
              to: range?.to ? format(range.to, DAY) : null,
            })
          }
          month={month}
          onMonthChange={setMonth}
          disabled={{ after: new Date() }}
        />
      </PopoverContent>
    </Popover>
  )
}
