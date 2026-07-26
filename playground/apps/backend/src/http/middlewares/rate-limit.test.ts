import { env } from "cloudflare:workers"
import { Hono } from "hono"
import { beforeAll, beforeEach, describe, expect, it } from "vitest"
import { envRegistry } from "@/env/registry"
import {
  rateLimit,
  resetRateLimitBuckets,
} from "@/http/middlewares/rate-limit"

//exercise the limiter on a throwaway app (no DB) and, crucially, WITHOUT the
//x-test-bypass header so hits actually count. the "auth" preset (60/min) is the
//smallest window, so 60 pass and the 61st is shed. regression guard for the bug
//where the empty-bucket branch skipped recording the hit, making the limit
//unreachable.
describe("rate limit middleware", () => {
  beforeAll(() => {
    //the middleware reads RATE_LIMIT_ALLOW_TEST_BYPASS off the env registry;
    //seed it from the test worker bindings (worker.fetch does this in the app).
    envRegistry.setEnv(env as unknown as Record<string, unknown>)
  })

  beforeEach(() => {
    resetRateLimitBuckets()
  })

  it("allows requests up to the limit then returns 429", async () => {
    const app = new Hono()
      .use("*", rateLimit("auth"))
      .get("/", (c) => c.json({ ok: true }))

    for (let index = 0; index < 60; index++) {
      const response = await app.request("http://example.com/")
      expect(response.status).toBe(200)
    }

    const limited = await app.request("http://example.com/")
    expect(limited.status).toBe(429)
  })
})
