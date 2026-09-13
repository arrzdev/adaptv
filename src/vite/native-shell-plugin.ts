import { readFileSync, renameSync, writeFileSync } from "node:fs"
import type { IncomingMessage, ServerResponse } from "node:http"
import path from "node:path"
import type { Plugin } from "vite"
import type { NativeShellVerdict } from "#adaptv/shell/native-shell.ts"
import {
  isNativeShellId,
  NATIVE_SHELL_ENDPOINT,
  nativeShellVerdict,
} from "#adaptv/shell/native-shell.ts"

/** How many ids the endpoint remembers the last verdict of, for its log. */
const REMEMBERED_IDS = 32

/**
 * The env var the CLI names its expected-shells file in. Set only by `adaptv dev ios|android|all`,
 * on the dev server it spawns; mirrored as `SHELLS_ENV` in `bin/lib/native-shell.mjs`.
 */
export const NATIVE_SHELLS_ENV = "ADAPTV_DEV_SHELLS"

/**
 * Written by the dev server next to the CLI's file: the build a stale app was really running,
 * and the build expected when it asked, per platform. Mirrored as `SHELLS_SEEN_FILE` in
 * `bin/lib/native-shell.mjs`.
 *
 * It exists for the one case the CLI cannot see on its own. The run cache says an install is
 * current when the dev URL, the native fingerprint and the bundle id all still match — and
 * another checkout of the same app, on the same port, can install its own build under that
 * bundle id. The CLI then reuses the install, expects the build it recorded, and the device
 * runs a different one. Only the device's own request knows, so the server writes it down and
 * the CLI's poll tells the dev to rebuild.
 */
export const NATIVE_SHELLS_SEEN_FILE = "dev-shells-seen.json"

/**
 * The shells the CLI expects, keyed by platform. A file, because the CLI decides it AFTER the
 * dev server is already running (the server comes up first, then the native projects are
 * prepared, then each platform is reused or rebuilt) and the dev server is a separate process.
 * Anything unreadable is `null` — "nothing decided yet" — which only ever makes a client wait.
 */
export function readExpectedShells(
  file: string,
): Record<string, string | false | null> | null {
  try {
    const parsed = JSON.parse(readFileSync(file, "utf8"))
    return parsed && typeof parsed === "object" ? parsed : null
  } catch {
    return null
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
  //Bounded, oldest first out: the server is on the LAN, and every distinct id is a new entry.
  const last = new Map<string, NativeShellVerdict>()
  //What this server last wrote to the seen file, so a polling app does not rewrite it each time.
  const seen: Record<string, { id: string; expected: string }> = {}
  const seenFile = path.join(path.dirname(file), NATIVE_SHELLS_SEEN_FILE)
  const recordStale = (id: string, expected: string): void => {
    const platform = id.slice(0, id.indexOf("-"))
    if (seen[platform]?.id === id && seen[platform]?.expected === expected)
      return
    seen[platform] = { id, expected }
    try {
      const tmp = `${seenFile}.${process.pid}.tmp`
      writeFileSync(tmp, JSON.stringify(seen))
      renameSync(tmp, seenFile)
    } catch {}
  }
  return (req: IncomingMessage, res: ServerResponse, next: () => void) => {
    const url = new URL(req.url ?? "/", "http://dev.invalid")
    if (url.pathname !== NATIVE_SHELL_ENDPOINT) return next()
    const raw = url.searchParams.get("id") || null
    //An id nothing minted is no id: it cannot match, and it never reaches the log as written —
    //a `%0A` in it would otherwise print a line of the requester's choosing, which the watcher
    //reads as dev-server output.
    const id = isNativeShellId(raw) ? raw : null
    const expected = readExpectedShells(file)
    const verdict = nativeShellVerdict(id, expected)
    //`stale` means the platform has a decided id and this is not it — both are well-formed here.
    if (verdict === "stale" && id) {
      const want = expected?.[id.slice(0, id.indexOf("-"))]
      if (typeof want === "string") recordStale(id, want)
    }
    const key = id ?? (raw ? "(invalid)" : "(none)")
    if (last.get(key) !== verdict) {
      last.delete(key)
      const oldest = last.keys().next().value
      if (last.size >= REMEMBERED_IDS && oldest !== undefined)
        last.delete(oldest)
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
