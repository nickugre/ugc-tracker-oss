// Runs a scheduled job once from the terminal (local development has no scheduler):
//   pnpm job window-close | daily-sync | tiktok-ads-sync | comment-sync

async function main() {
  const name = process.argv[2]
  const { runJob } = await import("../lib/jobs/run-job")
  const now = new Date()

  if (name === "daily-sync") {
    const { dailySync } = await import("../lib/jobs/daily-sync")
    console.log(await runJob("daily-sync", 10, () => dailySync(now)))
  } else if (name === "window-close") {
    const { windowClose } = await import("../lib/jobs/window-close")
    console.log(await runJob("window-close", 20, () => windowClose(now)))
  } else if (name === "tiktok-ads-sync") {
    const { tiktokAdsSync } = await import("../lib/jobs/tiktok-ads-sync")
    console.log(await runJob("tiktok-ads-sync", 15, () => tiktokAdsSync(now)))
  } else if (name === "comment-sync") {
    // In production this is the last step of daily-sync; on its own here to try it out.
    const { commentSync } = await import("../lib/jobs/comment-sync")
    console.log(await commentSync(now))
  } else {
    console.error("Usage: pnpm job <daily-sync | window-close | tiktok-ads-sync | comment-sync>")
    process.exit(1)
  }
  process.exit(0)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
