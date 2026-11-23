const AMOUNT = /^(\d+(?:\.\d+)?)([kmb])?$/
const MULTIPLIERS = { k: 1e3, m: 1e6, b: 1e9 }

// Text typed into a count filter → a number. Accepts "2500", "2,500", "10k", "1.5m".
// Empty text is null (no bound); anything else that is not a count is NaN.
export function parseAmount(text: string): number | null {
  const cleaned = text.trim().toLowerCase().replaceAll(",", "").replaceAll(" ", "")
  if (!cleaned) return null
  const match = AMOUNT.exec(cleaned)
  if (!match) return Number.NaN
  const suffix = match[2] as keyof typeof MULTIPLIERS | undefined
  return Math.round(Number(match[1]) * (suffix ? MULTIPLIERS[suffix] : 1))
}

// Text typed into a percent filter → a number of percent. Accepts "2.5" and "2.5%".
export function parsePercent(text: string): number | null {
  const cleaned = text.trim().replace(/%$/, "").trim()
  if (!cleaned) return null
  return /^\d+(?:\.\d+)?$/.test(cleaned) ? Number(cleaned) : Number.NaN
}

// The shortest text parseAmount reads back as the same number: 10000 → "10k", 1234 → "1234".
export function amountToText(n: number | null): string {
  if (n == null) return ""
  if (n >= 1e6 && n % 1e5 === 0) return `${n / 1e6}m`
  if (n >= 1e3 && n % 1e2 === 0) return `${n / 1e3}k`
  return String(n)
}
