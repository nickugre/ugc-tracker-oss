// The zones offered in the campaign and creator forms. Any IANA zone is accepted; a form adds the
// saved value to its list when it is not one of these.
export const TIME_ZONES = [
  "UTC",
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
  "America/Sao_Paulo",
  "Europe/London",
  "Europe/Berlin",
  "Europe/Istanbul",
  "Asia/Tbilisi",
  "Asia/Dubai",
  "Asia/Kolkata",
  "Asia/Singapore",
  "Asia/Tokyo",
  "Australia/Sydney",
]

export function isValidTimeZone(tz: string) {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz })
    return true
  } catch {
    return false
  }
}

export function timeZoneLabel(tz: string) {
  return tz.replaceAll("_", " ")
}
