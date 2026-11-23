// Deciding whether a comment is "about the app". Deliberately a plain keyword list rather than a
// model: it costs nothing, the team can edit it in Settings, and the Spark page shows the matched
// comments, so a wrong keyword is easy to spot and remove.

// What people write under a video that makes them want the product: asking what it is, where to
// get it, or saying they got it. Your own brand name (and how people misspell it) belongs in Settings,
// not here: Settings → Spark suggestions.
export const DEFAULT_KEYWORDS = [
  "app",
  "apps",
  "download",
  "downloaded",
  "downloading",
  "link",
  "website",
  "app store",
  "play store",
  "android",
  "iphone",
  "ios",
  "what is this",
  "whats this",
  "what is it called",
  "whats it called",
  "where can i get",
  "where can i find",
  "where do i get",
  "how do i get",
  "sign up",
  "is it free",
  "is this free",
]

export const MAX_KEYWORDS = 100
export const MAX_KEYWORD_LENGTH = 60

// Lowercase words separated by single spaces: accents, apostrophes, punctuation and emoji are
// gone, so "What's the APP?? 😍" becomes "whats the app".
export function normalizeText(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/['’‘`´]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
}

// The textarea in Settings: one keyword or phrase per line (commas work too).
export function parseKeywords(input: string): string[] {
  const seen = new Set<string>()
  for (const part of input.split(/[\n,]/)) {
    const keyword = normalizeText(part).slice(0, MAX_KEYWORD_LENGTH).trim()
    if (keyword) seen.add(keyword)
    if (seen.size >= MAX_KEYWORDS) break
  }
  return [...seen]
}

export type KeywordMatcher = (text: string) => string[]

// Whole words only: "app" matches "what app?" and "APP!!" but never "happy" or "what happens".
// Returns the keywords found, longest first ("app store" before "app").
export function keywordMatcher(keywords: string[]): KeywordMatcher {
  const needles = [...new Set(keywords.map(normalizeText).filter(Boolean))]
    .sort((a, b) => b.length - a.length)
    .map((keyword) => ({ keyword, padded: ` ${keyword} ` }))
  return (text) => {
    const haystack = ` ${normalizeText(text)} `
    return needles.filter((n) => haystack.includes(n.padded)).map((n) => n.keyword)
  }
}
