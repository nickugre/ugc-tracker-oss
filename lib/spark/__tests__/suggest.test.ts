import { describe, expect, it } from "vitest"

import { formatLinksForCopy } from "../links"
import { DEFAULT_SPARK_RULES, rankSuggestions, type SparkComment } from "../suggest"

const video = (id: string, views: number, engagementRate: number | null) => ({ id, views, engagementRate })
const comments = (...texts: string[]): SparkComment[] => texts.map((text, i) => ({ text, likes: i }))

describe("rankSuggestions", () => {
  it("suggests a video for its engagement alone, even before its comments were read", () => {
    const [s] = rankSuggestions([video("a", 5000, 0.12)], new Map(), DEFAULT_SPARK_RULES)
    expect(s.reasons).toEqual(["engagement"])
    expect(s.commentsRead).toBe(0)
  })

  it("suggests a video with modest engagement when people ask about the app", () => {
    const byPost = new Map([["a", comments("what app is this", "cute", "link??", "lol")]])
    const [s] = rankSuggestions([video("a", 5000, 0.04)], byPost, DEFAULT_SPARK_RULES)
    expect(s.reasons).toEqual(["app_comments"])
    expect(s.appComments.map((c) => c.text)).toEqual(["link??", "what app is this"])
    expect(s.commentsRead).toBe(4)
  })

  it("needs the configured number of app comments", () => {
    const byPost = new Map([["a", comments("what app is this", "cute")]])
    expect(rankSuggestions([video("a", 5000, 0.04)], byPost, { ...DEFAULT_SPARK_RULES, minAppComments: 2 })).toHaveLength(0)
    expect(rankSuggestions([video("a", 5000, 0.04)], byPost, { ...DEFAULT_SPARK_RULES, minAppComments: 1 })).toHaveLength(1)
  })

  it("leaves out videos below the view minimum, whatever their rate", () => {
    const byPost = new Map([["a", comments("what app", "which app", "app?")]])
    expect(rankSuggestions([video("a", 400, 0.5)], byPost, DEFAULT_SPARK_RULES)).toHaveLength(0)
  })

  it("leaves out ordinary videos and ones without a known rate", () => {
    expect(rankSuggestions([video("a", 9000, 0.05), video("b", 9000, null)], new Map(), DEFAULT_SPARK_RULES)).toHaveLength(0)
  })

  it("puts videos with both signals first, then the most asked about, then by engagement", () => {
    const byPost = new Map([
      ["both", comments("what app", "app name?")],
      ["asked", comments("what app", "app name?", "link", "download link")],
    ])
    const ranked = rankSuggestions(
      [video("eng-high", 2000, 0.3), video("asked", 2000, 0.02), video("both", 2000, 0.11), video("eng-low", 90000, 0.1)],
      byPost,
      DEFAULT_SPARK_RULES
    )
    expect(ranked.map((s) => s.id)).toEqual(["both", "asked", "eng-high", "eng-low"])
  })

  it("follows edited keywords without anything being stored", () => {
    const byPost = new Map([["a", comments("need this planner", "planner where??")]])
    expect(rankSuggestions([video("a", 5000, 0.01)], byPost, DEFAULT_SPARK_RULES)).toHaveLength(0)
    expect(rankSuggestions([video("a", 5000, 0.01)], byPost, { ...DEFAULT_SPARK_RULES, keywords: ["planner"] })).toHaveLength(1)
  })
})

describe("formatLinksForCopy", () => {
  it("is just the links for one creator", () => {
    expect(
      formatLinksForCopy([
        { url: "https://t/1", creatorName: "Alex" },
        { url: "https://t/2", creatorName: "Alex" },
      ])
    ).toBe("https://t/1\nhttps://t/2")
  })

  it("groups the links by creator when there are several", () => {
    expect(
      formatLinksForCopy([
        { url: "https://t/1", creatorName: "Alex" },
        { url: "https://t/2", creatorName: "Maya" },
        { url: "https://t/3", creatorName: "Alex" },
        { url: "https://t/4", creatorName: null },
      ])
    ).toBe("Alex:\nhttps://t/1\nhttps://t/3\n\nMaya:\nhttps://t/2\n\nNo creator:\nhttps://t/4")
  })

  it("is empty for nothing", () => {
    expect(formatLinksForCopy([])).toBe("")
  })
})
