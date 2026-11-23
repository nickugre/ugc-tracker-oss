import "server-only"

import { eq, sql } from "drizzle-orm"

import { db } from "@/db"
import { jobLocks, jobRuns } from "@/db/schema"

export type JobName = "daily-sync" | "window-close" | "tiktok-ads-sync"

// Runs a scheduled job at most once at a time. The lease is a row that expires on its own, so a
// crashed invocation cannot block the job forever (and it works through a transaction pooler,
// unlike advisory locks). Every execution is recorded in job_runs.
export async function runJob<T extends Record<string, unknown>>(
  job: JobName,
  leaseMinutes: number,
  work: () => Promise<T>
): Promise<{ ran: false; reason: string } | { ran: true; summary: T }> {
  const lease = await db.execute<{ job: string }>(sql`
    insert into job_locks (job, locked_until)
    values (${job}, now() + make_interval(mins => ${leaseMinutes}))
    on conflict (job) do update set locked_until = excluded.locked_until
    where job_locks.locked_until < now()
    returning job
  `)
  if (lease.length === 0) return { ran: false, reason: "already running" }

  const [run] = await db.insert(jobRuns).values({ job }).returning({ id: jobRuns.id })
  try {
    const summary = await work()
    await db
      .update(jobRuns)
      .set({ status: "succeeded", finishedAt: new Date(), summary })
      .where(eq(jobRuns.id, run.id))
    return { ran: true, summary }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    await db
      .update(jobRuns)
      .set({ status: "failed", finishedAt: new Date(), error: message.slice(0, 1000) })
      .where(eq(jobRuns.id, run.id))
    throw error
  } finally {
    await db.delete(jobLocks).where(eq(jobLocks.job, job))
  }
}
