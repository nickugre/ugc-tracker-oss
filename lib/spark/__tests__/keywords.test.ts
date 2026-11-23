import { describe, expect, it } from "vitest"

import { DEFAULT_KEYWORDS, MAX_KEYWORDS, keywordMatcher, normalizeText, parseKeywords } from "../keywords"

describe("normalizeText", () => {
  it("drops case, punctuation, apostrophes, accents and emoji", () => {
    expect(normalizeText("What's the APP?? 😍")).toBe("whats the app")
    expect(normalizeText("  Où  télécharger…  ")).toBe("ou telecharger")
    expect(normalizeText("😍😍")).toBe("")
  })
})

describe("keywordMatcher", () => {
  const match = keywordMatcher(DEFAULT_KEYWORDS)

  it("finds the questions people ask when a video converts", () => {
    for (const comment of [
      "what app is this??",
      "APP NAME PLS",
      "Whats this called",
      "what's this 👀",
      "where can I get it",
      "is it free?",
      "just downloaded, thank you",
      "link?",
      "Is it on Android",
      "is this free",
    ]) {
      expect(match(comment), comment).not.toHaveLength(0)
    }
  })

  it("matches whole words only", () => {
    // "app" is inside all of these, and none of them is about the app.
    for (const comment of ["what happens next", "so happy for you", "I appreciate this", "she snapped", "blinking twice"]) {
      expect(match(comment), comment).toHaveLength(0)
    }
  })

  it("ignores ordinary praise", () => {
    expect(match("love this so much 😭")).toHaveLength(0)
    expect(match("")).toHaveLength(0)
  })

  it("reports every keyword found, longest first", () => {
    expect(match("is the app on the app store?")).toEqual(["app store", "app"])
  })

  it("treats the team's keywords like the comments: case and punctuation do not matter", () => {
    const custom = keywordMatcher(["  Budget-Tracker ", "WHAT'S IT CALLED"])
    expect(custom("what's it called?")).toEqual(["whats it called"])
    expect(custom("need this budget tracker")).toEqual(["budget tracker"])
  })

  it("matches nothing when the list is empty", () => {
    expect(keywordMatcher([])("what app is this")).toHaveLength(0)
  })
})

describe("parseKeywords", () => {
  it("reads one keyword per line or comma, normalized and without duplicates", () => {
    expect(parseKeywords("App\napp store, APP\n\n  what's this?  \n")).toEqual(["app", "app store", "whats this"])
  })

  it("drops lines that are only punctuation or emoji", () => {
    expect(parseKeywords("???\n😍\nlink")).toEqual(["link"])
  })

  it("keeps the list bounded", () => {
    const many = Array.from({ length: 300 }, (_, i) => `word${i}`).join("\n")
    expect(parseKeywords(many)).toHaveLength(MAX_KEYWORDS)
  })
})
