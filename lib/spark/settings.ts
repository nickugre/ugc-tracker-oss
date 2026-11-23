import "server-only"

import { db } from "@/db"
import { sparkSettings } from "@/db/schema"

import { DEFAULT_SPARK_RULES, type SparkRules } from "./suggest"

// The saved rules, or the defaults while nobody has saved the form in Settings yet.
export async function getSparkRules(): Promise<SparkRules> {
  const [row] = await db.select().from(sparkSettings).limit(1)
  if (!row) return DEFAULT_SPARK_RULES
  return {
    keywords: row.keywords,
    minEngagement: row.minEngagement,
    minViews: row.minViews,
    minAppComments: row.minAppComments,
    commentsBudgetUsd: row.commentsBudgetUsd,
  }
}
