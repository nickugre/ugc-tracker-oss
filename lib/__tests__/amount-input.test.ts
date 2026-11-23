import { describe, expect, it } from "vitest"

import { amountToText, parseAmount, parsePercent } from "@/lib/amount-input"
import { parseAsNumberRange } from "@/lib/search-params/videos"

describe("parseAmount", () => {
  it("reads plain, grouped and shorthand counts", () => {
    expect(parseAmount("2500")).toBe(2500)
    expect(parseAmount("2,500")).toBe(2500)
    expect(parseAmount(" 10k ")).toBe(10_000)
    expect(parseAmount("1.5M")).toBe(1_500_000)
    expect(parseAmount("2b")).toBe(2_000_000_000)
  })

  it("treats empty text as no bound and junk as invalid", () => {
    expect(parseAmount("  ")).toBeNull()
    expect(parseAmount("abc")).toBeNaN()
    expect(parseAmount("-5")).toBeNaN()
    expect(parseAmount("10kk")).toBeNaN()
  })
})

describe("parsePercent", () => {
  it("reads a percent with or without the sign", () => {
    expect(parsePercent("2.5")).toBe(2.5)
    expect(parsePercent("7 %")).toBe(7)
    expect(parsePercent("")).toBeNull()
    expect(parsePercent("high")).toBeNaN()
  })
})

describe("amountToText", () => {
  it("round-trips through parseAmount", () => {
    for (const n of [0, 7, 999, 1000, 1100, 1234, 10_000, 250_000, 1_000_000, 1_500_000, 2_300_000, 1_234_567]) {
      expect(parseAmount(amountToText(n))).toBe(n)
    }
    expect(amountToText(10_000)).toBe("10k")
    expect(amountToText(1_500_000)).toBe("1.5m")
    expect(amountToText(1234)).toBe("1234")
    expect(amountToText(null)).toBe("")
  })
})

describe("parseAsNumberRange", () => {
  it("reads closed and half-open ranges", () => {
    expect(parseAsNumberRange.parse("1000-50000")).toEqual({ min: 1000, max: 50_000 })
    expect(parseAsNumberRange.parse("1000-")).toEqual({ min: 1000, max: null })
    expect(parseAsNumberRange.parse("-2.5")).toEqual({ min: null, max: 2.5 })
  })

  it("rejects anything else", () => {
    expect(parseAsNumberRange.parse("-")).toBeNull()
    expect(parseAsNumberRange.parse("1000")).toBeNull()
    expect(parseAsNumberRange.parse("a-b")).toBeNull()
    expect(parseAsNumberRange.parse("99999999999999999999-")).toBeNull()
  })

  it("serializes back to the same text", () => {
    expect(parseAsNumberRange.serialize({ min: 1000, max: null })).toBe("1000-")
    expect(parseAsNumberRange.serialize({ min: null, max: 2.5 })).toBe("-2.5")
  })
})
