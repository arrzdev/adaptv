import {
  createExecutionContext,
  waitOnExecutionContext,
} from "cloudflare:test"
import { env } from "cloudflare:workers"
import worker from "@/entrypoint"

const testHeaders = { "x-test-bypass": "true" }

export async function workerRequest(
  path: string,
  init?: RequestInit,
): Promise<Response> {
  const ctx = createExecutionContext()
  const response = await worker.fetch(
    new Request(`http://example.com${path}`, {
      ...init,
      headers: {
        ...testHeaders,
        ...(init?.headers ?? {}),
      },
    }),
    env,
    ctx,
  )
  await waitOnExecutionContext(ctx)
  return response
}
