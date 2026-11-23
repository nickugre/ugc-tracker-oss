import { createLoader, parseAsString, parseAsStringLiteral } from "nuqs/server"

import { PLATFORMS } from "@/db/schema/enums"

// URL state of the Calendar page. `campaign` + `period` pick the grid; `creator` + `day`
// (+ `platform`) open the side panel with that cell's videos, so a cell is a shareable link.
export const calendarParsers = {
  campaign: parseAsString,
  // First day of the cycle, YYYY-MM-DD. Absent = the current cycle.
  period: parseAsString,
  creator: parseAsString,
  day: parseAsString,
  platform: parseAsStringLiteral(PLATFORMS),
}

export const loadCalendarParams = createLoader(calendarParsers)
export type CalendarParams = Awaited<ReturnType<typeof loadCalendarParams>>
