// Money is integer cents everywhere. These helpers are the only places where a typed amount
// becomes cents (or cents become text), so no float arithmetic ever touches a stored amount.

// Nearest integer, with .5 going away from zero (2.5 → 3, -2.5 → -3). Math.round on its own
// sends -2.5 to -2. Non-finite input comes back unchanged, like Math.round.
export function roundHalfUp(n: number): number {
  const rounded = n < 0 ? -Math.round(-n) : Math.round(n)
  // -0 prints as "-0" and is not Object.is-equal to 0.
  return rounded === 0 ? 0 : rounded
}

// numerator ÷ denominator rounded half up (away from zero for a negative numerator), in exact
// integer maths. It works on the remainder instead of forming a float quotient, so a result that
// sits on or next to a .5 boundary can never be pushed to the wrong side by rounding error.
export function divRoundHalfUp(numerator: number, denominator: number): number {
  if (!Number.isSafeInteger(numerator) || !Number.isSafeInteger(denominator) || denominator <= 0) {
    throw new RangeError(
      `divRoundHalfUp needs safe integers and a positive denominator, got ${numerator} / ${denominator}`
    )
  }
  const magnitude = Math.abs(numerator)
  const remainder = magnitude % denominator
  const quotient = (magnitude - remainder) / denominator
  // remainder × 2 ≥ denominator, written so that it cannot overflow.
  const rounded = remainder >= denominator - remainder ? quotient + 1 : quotient
  const signed = numerator < 0 ? -rounded : rounded
  return signed === 0 ? 0 : signed
}

const formatters = new Map<string, Intl.NumberFormat>()

function currencyFormatter(currency: string): Intl.NumberFormat {
  let formatter = formatters.get(currency)
  if (!formatter) {
    formatter = new Intl.NumberFormat("en-US", { style: "currency", currency })
    formatters.set(currency, formatter)
  }
  return formatter
}

// 98333 → "$983.33", 100000 → "$1,000.00", -1250 → "-$12.50".
export function formatCents(cents: number, currency = "USD"): string {
  // -0 would print as "-$0.00".
  return currencyFormatter(currency).format(cents === 0 ? 0 : cents / 100)
}

// Optional "$", then either plain digits or complete thousands groups, then up to two decimals.
// Groups must be complete on purpose: "12,50" is how much of the world writes 12.50, and reading
// it as 1250 would be a 100× error, so it is rejected instead of guessed at.
const MONEY_PATTERN = /^\$?\s*(\d+|[1-9]\d{0,2}(?:,\d{3})+)?(?:\.(\d{0,2}))?$/

// "1000", "1,000", "$1,000.50", " 12.5 " → integer cents. null when the text is empty, negative,
// has more than two decimals or is not an amount at all. The whole and fractional parts are
// converted separately, so there is no float maths ("12.5" is 12 × 100 + 50, never 12.5 × 100).
export function parseMoneyToCents(input: string): number | null {
  if (typeof input !== "string") return null
  const match = MONEY_PATTERN.exec(input.trim())
  if (!match) return null
  const whole = match[1]
  const fraction = match[2] ?? ""
  // "", "$" and "." match the pattern but contain no digits.
  if (whole === undefined && fraction === "") return null

  const dollars = whole === undefined ? 0 : Number(whole.replaceAll(",", ""))
  const cents = dollars * 100 + Number(fraction.padEnd(2, "0"))
  // Past 2^53 the multiplication above is no longer exact.
  return Number.isSafeInteger(cents) ? cents : null
}
