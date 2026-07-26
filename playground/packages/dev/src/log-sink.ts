import { appendFileSync, mkdirSync } from "node:fs"
import { createServer } from "node:http"
import { dirname, join } from "node:path"
import { getLanIp } from "#dev/src/lan-ip"
import { LOG_PATH, LOG_SINK_PORT } from "#dev/src/log-sink-port"

type LogEntry = {
  source?: string
  level?: string
  message?: string
  data?: unknown
  ts?: number
  url?: string
}

type StartLogSinkOptions = {
  port?: number
  logFile?: string
}

const CORS_HEADERS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "POST, OPTIONS",
  "access-control-allow-headers": "content-type",
}

//standalone dev-only sink: any app/language POSTs LOG_PATH and we echo it to
//stdout and append a json line to the log file. never shipped.
export function startLogSink(options: StartLogSinkOptions = {}): void {
  const port = options.port ?? LOG_SINK_PORT
  const logFile =
    options.logFile ?? join(process.cwd(), ".dev-logs", "sink.log")
  mkdirSync(dirname(logFile), { recursive: true })

  const server = createServer((req, res) => {
    if (req.method === "OPTIONS") {
      res.writeHead(204, CORS_HEADERS)
      res.end()
      return
    }

    if (req.method !== "POST" || req.url !== LOG_PATH) {
      res.writeHead(404, CORS_HEADERS)
      res.end()
      return
    }

    let body = ""
    req.on("data", (chunk) => {
      body += chunk
      if (body.length > 1_000_000) req.destroy()
    })
    req.on("end", () => {
      writeEntry(body, logFile)
      res.writeHead(204, CORS_HEADERS)
      res.end()
    })
  })

  server.listen(port, "0.0.0.0", () => {
    const lan = getLanIp()
    console.log(
      `[log-sink] listening on http://0.0.0.0:${port}${LOG_PATH}`,
    )
    console.log(`[log-sink] device  → http://${lan}:${port}${LOG_PATH}`)
    console.log(`[log-sink] file    → ${logFile}`)
  })
}

function writeEntry(body: string, logFile: string): void {
  const entry = parseEntry(body)
  const ts = new Date(entry.ts ?? Date.now()).toISOString()
  const source = entry.source ?? "?"
  const level = entry.level ?? "log"
  const detail =
    entry.data === undefined ? "" : ` ${stringify(entry.data)}`
  console.log(
    `[${ts}] (${source}/${level}) ${entry.message ?? ""}${detail}`,
  )
  appendFileSync(logFile, `${stringify({ ...entry, ts })}\n`)
}

//raw try/catch: trivial parse fallback, not worth the shared tuple helper
function parseEntry(body: string): LogEntry {
  try {
    return JSON.parse(body) as LogEntry
  } catch {
    return { source: "unknown", level: "raw", message: body }
  }
}

function stringify(value: unknown): string {
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

//run directly: `tsx packages/dev/src/log-sink.ts`
if (import.meta.url === `file://${process.argv[1]}`) {
  startLogSink()
}
