import type { Plugin } from "vite"

/**
 * The dev server re-sends a GET or HEAD once when the socket to Nitro's SSR
 * worker was reset under it, instead of answering the page with a 500.
 *
 * ## The race
 *
 * In dev, Nitro renders in a worker thread that serves HTTP on `127.0.0.1`
 * (env-runner, `srvx`), and the Vite middleware proxies every page request to it
 * with httpxy's `proxyFetch`, over sockets pooled in httpxy's module-level
 * `keepAlive` agent. The worker's server closes a socket left idle on its own
 * keep-alive timer, on another thread. A request written to a pooled socket the
 * worker has just closed fails with `read ECONNRESET`: Vite's error middleware
 * logs `Internal server error: read ECONNRESET` and the browser gets the
 * error-overlay page with a 500, not the app.
 *
 * MEASURED: the nightly `stress, chromium` cell failed this way (TUD-5881). The
 * navigation came ~6 s after the one before it, its `GET /` answered 500 in
 * 14 ms, and the page held only the overlay. On an idle machine the agent drops
 * its idle socket before the worker does (0 resets in 167 page requests 3.95 to
 * 6.05 s apart), so it takes a loaded one — which is where a suite runs.
 *
 * ## Why a re-send, and why only this one
 *
 * The request never reached the app, and HTTP lets a client repeat an
 * idempotent request whose connection closed before the response arrived
 * (RFC 9112 §9.3.1). A POST is not repeated: a server function could run
 * twice. Any other error, and a second reset, still reach Vite's error page.
 *
 * The fix belongs upstream (httpxy's pool or env-runner's worker server); this
 * goes when the pinned `nitro` brings one.
 */
export function devSsrSocketResetResend(nitroEnvironment: string): Plugin {
  return {
    name: "adaptv:dev-ssr-socket-reset-resend",
    apply: "serve",
    configureServer(server) {
      const runner = (
        server.environments[nitroEnvironment] as
          | { devServer?: { fetch?: unknown } }
          | undefined
      )?.devServer
      //no Nitro dev environment (a spa app): nothing is proxied
      if (!runner || typeof runner.fetch !== "function") return
      runner.fetch = resendOnSocketReset(
        runner.fetch.bind(runner) as SsrFetch,
      )
    },
  }
}

type SsrFetch = (
  input: Request | string | URL,
  init?: RequestInit,
) => Promise<Response>

const IDEMPOTENT = new Set(["GET", "HEAD"])
const RESET = new Set(["ECONNRESET", "EPIPE"])

export function resendOnSocketReset(fetch: SsrFetch): SsrFetch {
  return async (input, init) => {
    try {
      return await fetch(input, init)
    } catch (error) {
      const method = (
        init?.method ?? (input instanceof Request ? input.method : "GET")
      ).toUpperCase()
      const code = (error as { code?: unknown } | null)?.code
      if (!IDEMPOTENT.has(method) || !RESET.has(code as string))
        throw error
      return fetch(input, init)
    }
  }
}
