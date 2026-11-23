import { describe, expect, it } from "vitest"

import { divRoundHalfUp, formatCents, parseMoneyToCents, roundHalfUp } from "../cents"

describe("roundHalfUp", () => {
  it("rounds to the nearest integer with .5 going up", () => {
    expect(roundHalfUp(0)).toBe(0)
    expect(roundHalfUp(0.4)).toBe(0)
    expect(roundHalfUp(0.5)).toBe(1)
    expect(roundHalfUp(1.5)).toBe(2)
    expect(roundHalfUp(2.5)).toBe(3)
    expect(roundHalfUp(2.4999)).toBe(2)
    expect(roundHalfUp(98333.33333333333)).toBe(98333)
    expect(roundHalfUp(91666.66666666667)).toBe(91667)
  })

  it("rounds negatives symmetrically, away from zero", () => {
    expect(roundHalfUp(-0.5)).toBe(-1)
    expect(roundHalfUp(-1.5)).toBe(-2)
    expect(roundHalfUp(-2.5)).toBe(-3)
    expect(roundHalfUp(-2.4)).toBe(-2)
    // Math.round alone would give -2 here.
    expect(Math.round(-2.5)).toBe(-2)
  })

  it("never returns -0", () => {
    expect(Object.is(roundHalfUp(-0.2), 0)).toBe(true)
    expect(Object.is(roundHalfUp(-0), 0)).toBe(true)
  })

  it("is not fooled by the largest double below one half", () => {
    expect(roundHalfUp(0.49999999999999994)).toBe(0)
  })

  it("passes non-finite input through like Math.round", () => {
    expect(roundHalfUp(Number.NaN)).toBeNaN()
    expect(roundHalfUp(Number.POSITIVE_INFINITY)).toBe(Number.POSITIVE_INFINITY)
  })
})

describe("divRoundHalfUp", () => {
  it("matches the contract proration examples", () => {
    expect(divRoundHalfUp(100_000 * 118, 120)).toBe(98_333)
    expect(divRoundHalfUp(100_000 * 112, 120)).toBe(93_333)
    expect(divRoundHalfUp(100_000 * 110, 120)).toBe(91_667)
    expect(divRoundHalfUp(100_000 * 120, 120)).toBe(100_000)
    expect(divRoundHalfUp(0, 120)).toBe(0)
  })

  it("rounds an exact half up and anything below it down", () => {
    expect(divRoundHalfUp(1, 2)).toBe(1)
    expect(divRoundHalfUp(3, 2)).toBe(2)
    expect(divRoundHalfUp(5, 10)).toBe(1)
    expect(divRoundHalfUp(4, 10)).toBe(0)
    expect(divRoundHalfUp(3_703_500, 1000)).toBe(3704)
    expect(divRoundHalfUp(3_703_499, 1000)).toBe(3703)
  })

  it("mirrors negative numerators and never returns -0", () => {
    expect(divRoundHalfUp(-5, 10)).toBe(-1)
    expect(divRoundHalfUp(-4, 10)).toBe(0)
    expect(Object.is(divRoundHalfUp(-4, 10), 0)).toBe(true)
    expect(divRoundHalfUp(-15, 10)).toBe(-2)
  })

  it("stays exact where a float quotient cannot", () => {
    // 9007199254740991 / 2 = 4503599627370495.5, which is not a representable double.
    expect(divRoundHalfUp(Number.MAX_SAFE_INTEGER, 2)).toBe(4_503_599_627_370_496)
    expect(divRoundHalfUp(Number.MAX_SAFE_INTEGER - 1, 2)).toBe(4_503_599_627_370_495)
    expect(divRoundHalfUp(Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER)).toBe(1)
  })

  it("agrees with BigInt arithmetic on pseudo-random input", () => {
    let seed = 12345
    const next = () => {
      seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648
      return seed
    }
    for (let i = 0; i < 500; i++) {
      const numerator = next() * (1 + (next() % 1000))
      const denominator = 1 + (next() % 100_000)
      const n = BigInt(numerator)
      const d = BigInt(denominator)
      const expected = Number((n * BigInt(2) + d) / (d * BigInt(2)))
      expect(divRoundHalfUp(numerator, denominator)).toBe(expected)
    }
  })

  it("rejects anything that is not a safe integer over a positive denominator", () => {
    expect(() => divRoundHalfUp(1.5, 2)).toThrow(RangeError)
    expect(() => divRoundHalfUp(1, 0)).toThrow(RangeError)
    expect(() => divRoundHalfUp(1, -2)).toThrow(RangeError)
    expect(() => divRoundHalfUp(Number.NaN, 2)).toThrow(RangeError)
    expect(() => divRoundHalfUp(2 ** 53, 2)).toThrow(RangeError)
  })
})

describe("formatCents", () => {
  it("formats cents as US dollars", () => {
    expect(formatCents(98_333)).toBe("$983.33")
    expect(formatCents(100_000)).toBe("$1,000.00")
    expect(formatCents(0)).toBe("$0.00")
    expect(formatCents(5)).toBe("$0.05")
    expect(formatCents(50)).toBe("$0.50")
    expect(formatCents(123_456_789)).toBe("$1,234,567.89")
  })

  it("puts the minus sign before the currency symbol", () => {
    expect(formatCents(-1250)).toBe("-$12.50")
    expect(formatCents(-1)).toBe("-$0.01")
  })

  it("does not print negative zero", () => {
    expect(formatCents(-0)).toBe("$0.00")
  })

  it("accepts another currency", () => {
    expect(formatCents(123_456, "EUR")).toBe("€1,234.56")
  })

  it("never drifts by a cent", () => {
    for (let cents = 0; cents < 20_000; cents += 7) {
      const digits = formatCents(cents).replace(/[^0-9]/g, "")
      expect(Number(digits)).toBe(cents)
    }
  })
})

describe("parseMoneyToCents", () => {
  it("parses plain, grouped and dollar-prefixed amounts", () => {
    expect(parseMoneyToCents("1000")).toBe(100_000)
    expect(parseMoneyToCents("1,000")).toBe(100_000)
    expect(parseMoneyToCents("$1,000.50")).toBe(100_050)
    expect(parseMoneyToCents("1,000.50")).toBe(100_050)
    expect(parseMoneyToCents(" 12.5 ")).toBe(1250)
    expect(parseMoneyToCents("0")).toBe(0)
    expect(parseMoneyToCents("0.00")).toBe(0)
    expect(parseMoneyToCents("0.07")).toBe(7)
    expect(parseMoneyToCents("$ 20")).toBe(2000)
    expect(parseMoneyToCents("1,234,567.89")).toBe(123_456_789)
    expect(parseMoneyToCents("007")).toBe(700)
  })

  it("accepts what a user passes through while typing a decimal", () => {
    expect(parseMoneyToCents("12.")).toBe(1200)
    expect(parseMoneyToCents(".5")).toBe(50)
    expect(parseMoneyToCents(".05")).toBe(5)
  })

  it("has no float error on the classic cases", () => {
    // 1.15 * 100 = 114.99999999999999 and 19.99 * 100 = 1998.9999999999998 in float maths.
    expect(parseMoneyToCents("1.15")).toBe(115)
    expect(parseMoneyToCents("19.99")).toBe(1999)
    expect(parseMoneyToCents("1.005")).toBeNull()
    expect(parseMoneyToCents("4.35")).toBe(435)
    expect(parseMoneyToCents("8.20")).toBe(820)
  })

  it("returns null for more than two decimals", () => {
    expect(parseMoneyToCents("12.345")).toBeNull()
    expect(parseMoneyToCents("0.001")).toBeNull()
  })

  it("returns null for negative, empty or non-numeric input", () => {
    expect(parseMoneyToCents("-5")).toBeNull()
    expect(parseMoneyToCents("-$5")).toBeNull()
    expect(parseMoneyToCents("$-5")).toBeNull()
    expect(parseMoneyToCents("(5)")).toBeNull()
    expect(parseMoneyToCents("+5")).toBeNull()
    expect(parseMoneyToCents("")).toBeNull()
    expect(parseMoneyToCents("   ")).toBeNull()
    expect(parseMoneyToCents("$")).toBeNull()
    expect(parseMoneyToCents(".")).toBeNull()
    expect(parseMoneyToCents("abc")).toBeNull()
    expect(parseMoneyToCents("12abc")).toBeNull()
    expect(parseMoneyToCents("1e3")).toBeNull()
    expect(parseMoneyToCents("1 000")).toBeNull()
    expect(parseMoneyToCents("1.2.3")).toBeNull()
    expect(parseMoneyToCents("$$5")).toBeNull()
    expect(parseMoneyToCents("NaN")).toBeNull()
    expect(parseMoneyToCents("Infinity")).toBeNull()
    expect(parseMoneyToCents("１２")).toBeNull()
  })

  it("rejects a comma that is not a complete thousands separator", () => {
    // "12,50" is 12.50 in much of the world: refusing it beats reading it as 1250.
    expect(parseMoneyToCents("12,50")).toBeNull()
    expect(parseMoneyToCents("12,5")).toBeNull()
    expect(parseMoneyToCents("0,500")).toBeNull()
    expect(parseMoneyToCents("1,00")).toBeNull()
    expect(parseMoneyToCents("1,0000")).toBeNull()
    expect(parseMoneyToCents("1000,000")).toBeNull()
    expect(parseMoneyToCents(",500")).toBeNull()
    expect(parseMoneyToCents("1,,000")).toBeNull()
    expect(parseMoneyToCents("1,000,")).toBeNull()
  })

  it("returns null instead of an inexact number for absurdly large input", () => {
    expect(parseMoneyToCents("90071992547409.91")).toBe(Number.MAX_SAFE_INTEGER)
    expect(parseMoneyToCents("90071992547409.92")).toBeNull()
    expect(parseMoneyToCents("9".repeat(400))).toBeNull()
  })

  it("round-trips with formatCents", () => {
    for (const cents of [0, 1, 99, 100, 101, 98_333, 100_000, 12_345_678]) {
      expect(parseMoneyToCents(formatCents(cents))).toBe(cents)
    }
  })
})
