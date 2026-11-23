export type LinkRow = { url: string; creatorName: string | null }

// The text behind "Copy video links". Spark codes are asked for creator by creator, so links of
// several creators are grouped under their names; for a single creator it is just the links,
// ready to paste into a message.
export function formatLinksForCopy(rows: LinkRow[]): string {
  const groups = new Map<string, string[]>()
  for (const row of rows) {
    const name = row.creatorName ?? "No creator"
    groups.set(name, [...(groups.get(name) ?? []), row.url])
  }
  if (groups.size <= 1) return rows.map((row) => row.url).join("\n")
  return [...groups].map(([name, urls]) => `${name}:\n${urls.join("\n")}`).join("\n\n")
}
