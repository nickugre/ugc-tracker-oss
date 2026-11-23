import "server-only"

import type { z } from "zod"

import { getCurrentUser, type CurrentUser } from "@/lib/auth/dal"

export type ActionResult<T = undefined> =
  | { ok: true; data: T }
  | { ok: false; error: string; fieldErrors?: Record<string, string> }

// Wraps a Server Action body: checks the session (the proxy redirect is not a security
// boundary — actions are plain POST endpoints), validates the input with zod, and turns
// failures into a result the UI can render instead of throwing.
export async function authedAction<S extends z.ZodType, T>(
  schema: S,
  input: unknown,
  handler: (data: z.output<S>, user: CurrentUser) => Promise<T>
): Promise<ActionResult<T>> {
  const user = await getCurrentUser()
  if (!user) return { ok: false, error: "Your session has expired. Sign in again." }

  const parsed = schema.safeParse(input)
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {}
    for (const issue of parsed.error.issues) {
      const key = issue.path.join(".")
      if (!(key in fieldErrors)) fieldErrors[key] = issue.message
    }
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Some fields are not valid",
      fieldErrors,
    }
  }

  try {
    return { ok: true, data: await handler(parsed.data, user) }
  } catch (error) {
    if (error instanceof ActionError) return { ok: false, error: error.message }
    console.error("Server action failed", error)
    return { ok: false, error: "Something went wrong. Nothing was saved." }
  }
}

// Throw from a handler to show a specific message to the user.
export class ActionError extends Error {}
