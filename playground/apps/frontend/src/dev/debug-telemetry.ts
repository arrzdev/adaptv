import { LOG_PATH, LOG_SINK_PORT } from "@repo/dev/log-sink-port"

//dev-only: forward console output and global errors to the LAN log sink so
//logs from a real device land in the agent's terminal. the whole module is
//tree-shaken from production builds (imported only under import.meta.env.DEV).

let installed = false

export function installDebugTelemetry(sinkUrl?: string): void {
  if (installed || typeof window === "undefined") return
  installed = true

  const url =
    sinkUrl ??
    `${location.protocol}//${location.hostname}:${LOG_SINK_PORT}${LOG_PATH}`

  for (const level of ["log", "warn", "error"] as const) {
    const original = console[level].bind(console)
    console[level] = (...args: unknown[]) => {
      original(...args)
      post(url, { level, message: args.map(toText).join(" ") })
    }
  }

  window.addEventListener("error", (event) => {
    post(url, {
      level: "error",
      message: event.message,
      data: { stack: event.error?.stack },
    })
  })

  window.addEventListener("unhandledrejection", (event) => {
    post(url, {
      level: "error",
      message: "unhandledrejection",
      data: { reason: String(event.reason) },
    })
  })
}

type Outgoing = {
  level: string
  message: string
  data?: unknown
}

//best-effort, never throws, never recurses (failures are swallowed, not logged)
function post(url: string, entry: Outgoing): void {
  const body = JSON.stringify({
    source: "frontend",
    ts: Date.now(),
    url: location.href,
    ...entry,
  })

  //text/plain is a CORS-"simple" request → no preflight, and survives page
  //unload. a JSON fetch triggers an OPTIONS preflight the browser drops
  //silently if it fails. fall back to keepalive fetch (also text/plain).
  if (typeof navigator !== "undefined" && navigator.sendBeacon) {
    navigator.sendBeacon(url, new Blob([body], { type: "text/plain" }))
    return
  }

  void fetch(url, {
    method: "POST",
    headers: { "content-type": "text/plain" },
    body,
    keepalive: true,
  }).catch(() => {})
}

function toText(value: unknown): string {
  if (typeof value === "string") return value
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}
