import { readFileSync } from "node:fs"
import type { IncomingMessage, ServerResponse } from "node:http"
import type { Plugin } from "vite"
import type { NativeShellVerdict } from "#adaptv/shell/native-shell.ts"
import {
  NATIVE_SHELL_ENDPOINT,
  nativeShellVerdict,
} from "#adaptv/shell/native-shell.ts"

/**
 * The env var the CLI names its expected-shells file in. Set only by `adaptv dev ios|android|all`,
 * on the dev server it spawns; mirrored as `SHELLS_ENV` in `bin/lib/native-shell.mjs`.
 */
export const NATIVE_SHELLS_ENV = "ADAPTV_DEV_SHELLS"

/**
 * The shells the CLI expects, keyed by platform. A file, because the CLI decides it AFTER the
 * dev server is already running (the server comes up first, then the native projects are
 * prepared, then each platform is reused or rebuilt) and the dev server is a separate process.
 * Anything unreadable is "nothing decided yet", which only ever makes a client wait.
 */
export function readExpectedShells(
  file: string,
): Record<string, string | null> {
  try {
    const parsed = JSON.parse(readFileSync(file, "utf8"))
    return parsed && typeof parsed === "object" ? parsed : {}
  } catch {
    return {}
  }
}

/**
 * The request handler, separate from the plugin so a test can drive it with a plain
 * request/response pair. Calls `next()` for everything that is not the endpoint.
 */
export function nativeShellMiddleware(
  file: string,
  log: (line: string) => void = () => {},
) {
  //One line per id per verdict change: a waiting app polls every two seconds, and the dev
  //server's output is only ever read under `--verbose`, where a line per poll would drown it.
  const last = new Map<string, NativeShellVerdict>()
  return (req: IncomingMessage, res: ServerResponse, next: () => void) => {
    const url = new URL(req.url ?? "/", "http://dev.invalid")
    if (url.pathname !== NATIVE_SHELL_ENDPOINT) return next()
    const id = url.searchParams.get("id") || null
    const verdict = nativeShellVerdict(id, readExpectedShells(file))
    const key = id ?? "(none)"
    if (last.get(key) !== verdict) {
      last.set(key, verdict)
      log(`[adaptv] native shell ${key}: ${verdict}`)
    }
    res.statusCode = 200
    res.setHeader("Content-Type", "application/json")
    res.setHeader("Cache-Control", "no-store")
    //Android's offline page asks from the WebView's LOCAL origin (`http://localhost`, no port),
    //a different origin from the dev server, and it has to read the answer, not just reach it.
    res.setHeader("Access-Control-Allow-Origin", "*")
    res.end(JSON.stringify({ verdict }))
  }
}

/**
 * Serve the native-shell verdict on the dev server a native `adaptv dev` run started.
 *
 * Registered only when the CLI named a file (`ADAPTV_DEV_SHELLS`), so `dev web`, a bare `vite`
 * and every build carry none of it. → `src/shell/native-shell.ts` for the whole mechanism.
 */
export function adaptvNativeShellPlugin(file: string): Plugin {
  return {
    name: "adaptv:native-shell",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use(
        nativeShellMiddleware(file, (line) =>
          server.config.logger.info(line),
        ),
      )
    },
  }
}

/**
 * The plugin list entry: the plugin when a native `adaptv dev` started this server — the web
 * target with `ADAPTV_DEV_NATIVE` set, and a shells file named — and nothing otherwise. `dev web`,
 * a bare `vite` and every build get an empty list.
 */
export function adaptvNativeShellPlugins(
  target: "web" | "capacitor",
  env: NodeJS.ProcessEnv = process.env,
): Plugin[] {
  const file = env[NATIVE_SHELLS_ENV]
  if (target !== "web" || env.ADAPTV_DEV_NATIVE !== "1" || !file) return []
  return [adaptvNativeShellPlugin(file)]
}
