import type { RoutesInterface } from "@repo/backend/http/interface"
import tryCatch from "@repo/shared/try-catch"
import { hc } from "hono/client"
import { getBearerToken } from "@/data/auth/token"
import { env } from "@/env/registry"

//resolved once: in dev the backend shares the host but runs on its own port,
//in prod it's the configured url. exported so non-RPC callers (the synq sync
//transport) hit the same origin.
export const backendBaseUrl = (() => {
  const configured = env.VITE_BACKEND_URL

  if (import.meta.env.DEV && typeof window !== "undefined") {
    const { port } = new URL(configured)
    const { protocol, hostname } = window.location
    return `${protocol}//${hostname}${port ? `:${port}` : ""}`
  }

  return configured.trim().replace(/\/$/, "")
})()

//auto-inject the session bearer token on every RPC call — user-scoped routes
//(sync, …) authenticate without each callsite attaching the header by hand
export const api = hc<RoutesInterface>(backendBaseUrl, {
  headers(): Record<string, string> {
    const token = getBearerToken()
    return token ? { Authorization: `Bearer ${token}` } : {}
  },
})

//only for fetch/client throws — envelope handling stays in queryFn / mutationFn
export async function withClientRequest<T>(
  run: () => Promise<T>,
): Promise<T> {
  const NETWORK_ERROR_MESSAGE =
    "Unable to reach the server.\nCheck your connection and try again."
  const [data, error] = await tryCatch(run)
  if (!error) return data
  if (error.name === "AbortError") throw error
  throw new Error(NETWORK_ERROR_MESSAGE, { cause: error })
}
