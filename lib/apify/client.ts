import "server-only"

import { env } from "@/lib/env"

// Minimal typed wrapper over the three Apify REST calls we need (start a run, read a run, read
// its dataset). Deliberately not the `apify-client` package: it pulls in a large dependency tree
// for what is a handful of fetches.

const API = "https://api.apify.com/v2"

export type ApifyRunStatus =
  | "READY"
  | "RUNNING"
  | "SUCCEEDED"
  | "FAILED"
  | "TIMING-OUT"
  | "TIMED-OUT"
  | "ABORTING"
  | "ABORTED"

export type ApifyRun = {
  id: string
  actId: string
  status: ApifyRunStatus
  startedAt: string
  finishedAt: string | null
  defaultDatasetId: string
  usageTotalUsd?: number
  statusMessage?: string
}

export const TERMINAL_STATUSES: ApifyRunStatus[] = ["SUCCEEDED", "FAILED", "TIMED-OUT", "ABORTED"]

export class ApifyError extends Error {
  constructor(
    message: string,
    readonly status?: number
  ) {
    super(message)
  }
}

function token() {
  const value = env().APIFY_TOKEN
  if (!value) throw new ApifyError("APIFY_TOKEN is not set. Add it to the environment to scrape.")
  return value
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token()}`,
      "Content-Type": "application/json",
      ...init?.headers,
    },
    cache: "no-store",
  })
  if (!response.ok) {
    const body = await response.text().catch(() => "")
    // Apify answers with { error: { type, message } }; show the sentence, not the JSON.
    let message = body.slice(0, 300)
    try {
      message = (JSON.parse(body) as { error?: { message?: string } }).error?.message ?? message
    } catch {
      // Not JSON: keep the raw text.
    }
    throw new ApifyError(`Apify: ${message}`, response.status)
  }
  return (await response.json()) as T
}

// "clockworks/tiktok-scraper" → "clockworks~tiktok-scraper" (the form the REST API expects).
const actorPath = (actorId: string) => actorId.replace("/", "~")

export type StartRunOptions = {
  // Hard caps so a bad input can never spend more than intended.
  maxItems: number
  maxTotalChargeUsd: number
  // Called by Apify when the run reaches a terminal state. Omitted on localhost, where the
  // status poller does the same job.
  webhookUrl?: string
  idempotencyKey?: string
}

export async function startActorRun(actorId: string, input: unknown, options: StartRunOptions) {
  const query = new URLSearchParams({
    waitForFinish: "0",
    maxItems: String(options.maxItems),
    maxTotalChargeUsd: String(options.maxTotalChargeUsd),
  })
  if (options.webhookUrl) {
    const webhooks = [
      {
        eventTypes: [
          "ACTOR.RUN.SUCCEEDED",
          "ACTOR.RUN.FAILED",
          "ACTOR.RUN.TIMED_OUT",
          "ACTOR.RUN.ABORTED",
        ],
        requestUrl: options.webhookUrl,
        idempotencyKey: options.idempotencyKey,
      },
    ]
    query.set("webhooks", Buffer.from(JSON.stringify(webhooks)).toString("base64"))
  }
  const { data } = await request<{ data: ApifyRun }>(`/acts/${actorPath(actorId)}/runs?${query}`, {
    method: "POST",
    body: JSON.stringify(input),
  })
  return data
}

export async function getRun(runId: string) {
  const { data } = await request<{ data: ApifyRun }>(`/actor-runs/${runId}`)
  return data
}

export async function getDatasetItems(datasetId: string, max = 5000): Promise<unknown[]> {
  const items: unknown[] = []
  const pageSize = 1000
  for (let offset = 0; offset < max; offset += pageSize) {
    const page = await request<unknown[]>(
      `/datasets/${datasetId}/items?clean=true&format=json&offset=${offset}&limit=${pageSize}`
    )
    items.push(...page)
    if (page.length < pageSize) break
  }
  return items
}

// Webhooks only work when Apify can reach us, i.e. not on localhost.
export function webhookUrlFor(scrapeRunId: string): string | undefined {
  const e = env()
  const isPublic = e.APP_URL.startsWith("https://")
  if (!isPublic || !e.APIFY_WEBHOOK_SECRET) return undefined
  return `${e.APP_URL}/api/webhooks/apify?token=${encodeURIComponent(e.APIFY_WEBHOOK_SECRET)}&run=${scrapeRunId}`
}
