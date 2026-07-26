import type { Context, Next } from "hono"
import { env } from "@/env/registry"
import { error } from "@/http/envelope"
import { CustomError } from "@/http/errors"

const RATE_LIMIT_WINDOW_MS = 60_000

const RATE_LIMITS: Record<string, { max: number }> = {
  todos: { max: 240 },
  //sync fires on a heartbeat + every mutation burst, so allow more headroom
  sync: { max: 600 },
  //auth endpoints (sign-in/up, oauth) — tighter to blunt credential stuffing
  auth: { max: 60 },
}

//best-effort limiter: per-isolate on cloudflare workers, not shared across
//isolates, so callers must not assume global enforcement
const buckets = new Map<string, number[]>()

export function resetRateLimitBuckets(): void {
  buckets.clear()
}

function pruneExpired(
  list: number[],
  now: number,
  windowMs: number,
): number[] {
  const cutoff = now - windowMs
  const cutoffIndex = list.findIndex((timestamp) => timestamp > cutoff)
  return cutoffIndex === -1 ? [] : list.slice(cutoffIndex)
}

function getClientIp(c: Context): string {
  return (
    c.req.header("cf-connecting-ip") ??
    c.req.header("x-forwarded-for")?.split(",")[0].trim() ??
    "unknown"
  )
}

export function rateLimit(code: string) {
  const preset = RATE_LIMITS[code]
  if (!preset) throw new CustomError("internal_server_error")

  const options = {
    max: preset.max,
    windowMs: RATE_LIMIT_WINDOW_MS,
    key: code,
  }

  return async (c: Context, next: Next) => {
    const allowBypass =
      (env as { RATE_LIMIT_ALLOW_TEST_BYPASS?: string })
        .RATE_LIMIT_ALLOW_TEST_BYPASS === "true" &&
      c.req.header("x-test-bypass") === "true"
    if (allowBypass) return next()

    const ip = getClientIp(c)
    const bucketKey = `${ip}:${options.key}`
    const now = Date.now()
    const pruned = pruneExpired(
      buckets.get(bucketKey) ?? [],
      now,
      options.windowMs,
    )

    if (pruned.length >= options.max)
      return error(c, "rate_limit_exceeded")

    //record this hit and persist the in-window timestamps. the bucket MUST be
    //written on every allowed request — including the first, when `pruned` is
    //empty — or the window never accumulates and the limit is unreachable.
    //stale keys prune to a single fresh hit on their owner's next request and
    //otherwise linger only until the isolate recycles (per-isolate best-effort).
    pruned.push(now)
    buckets.set(bucketKey, pruned)
    await next()
  }
}
