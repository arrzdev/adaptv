#!/usr/bin/env node
// Does the app on the device actually HAVE adaptv's native plugins?
//
// This exists because the answer was "no, 12 of 13 are missing" for the entire life of the
// Android target, and nothing noticed. Capacitor discovers plugins from the consumer app's
// `package.json`, adaptv's plugins are adaptv's dependencies, so the generated Android project
// declared only whatever `@capacitor/*` the app happened to depend on itself. Every wrapper in
// `src/capabilities/` swallows the resulting rejection — one of them with the comment "older
// plugin / unsupported — safe to ignore" — so the app looked fine and silently ran its web
// fallbacks: no haptics, no native KV, no hardware back button, no status-bar styling.
//
// The check has to run ON A DEVICE. Every cheaper proxy passes while the app is broken:
//   - the app boots, renders, and logs nothing
//   - `Capacitor.isNativePlatform()` is true
//   - `Capacitor.Plugins.Haptics` EXISTS (it's the JS shim; only the CALL rejects)
//   - `Device.getInfo()` works — Device is the one plugin that was never broken, because it
//     was the one the consumer app declared. Treat it as evidence and you re-ship the bug.
//
// It reads the plugin list from adaptv's own manifest, so a plugin added to adaptv is
// automatically something this asserts — there is no second list to keep in step.
//
// Usage:
//   node scripts/native-plugin-smoke.mjs [--app-id <id>] [--target <serial>] [--app <dir>]
//
// With the app already installed and RUNNING on the device (e.g. after
// `adaptv preview android`), from the repo root:
//   node scripts/native-plugin-smoke.mjs --app playground/apps/frontend

import { spawnSync } from "node:child_process"
import { existsSync, readdirSync, readFileSync } from "node:fs"
import { createRequire } from "node:module"
import { createServer } from "node:net"
import path from "node:path"
import { fileURLToPath } from "node:url"

const ADAPTV_ROOT = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
)

/* ---------------------------------------------------------------- what to expect */

/** Every `@capacitor/*` plugin adaptv depends on, as `{ pkg, name }` — `name` being the
 * identifier the bridge registers it under (the `@CapacitorPlugin` annotation's `name`, which
 * is NOT always the class name). Derived from the manifest + the plugin's own Android source,
 * the same two sources `bin/lib/native.mjs` injects from, so the two can't disagree. */
function expectedPlugins() {
  const pkg = JSON.parse(
    readFileSync(path.join(ADAPTV_ROOT, "package.json"), "utf8"),
  )
  const req = createRequire(path.join(ADAPTV_ROOT, "package.json"))
  const skip = new Set([
    "@capacitor/cli",
    "@capacitor/core",
    "@capacitor/android",
    "@capacitor/ios",
  ])
  const out = []
  for (const name of Object.keys(pkg.dependencies ?? {})) {
    if (!name.startsWith("@capacitor/") || skip.has(name)) continue
    let dir
    try {
      dir = path.dirname(req.resolve(`${name}/package.json`))
    } catch {
      throw new Error(
        `${name} is in adaptv's manifest but not installed — run \`pnpm install\``,
      )
    }
    const src = JSON.parse(
      readFileSync(path.join(dir, "package.json"), "utf8"),
    ).capacitor?.android?.src
    if (!src) continue
    const registered = androidPluginName(
      path.join(dir, src, "src", "main"),
    )
    if (registered) out.push({ pkg: name, name: registered })
  }
  return out
}

/** The name the Android bridge registers a plugin under. */
function androidPluginName(srcMainDir) {
  const stack = [srcMainDir]
  while (stack.length) {
    const dir = stack.pop()
    let entries
    try {
      entries = readdirSync(dir, { withFileTypes: true })
    } catch {
      continue
    }
    for (const e of entries) {
      const p = path.join(dir, e.name)
      if (e.isDirectory()) {
        stack.push(p)
        continue
      }
      if (!e.name.endsWith(".java") && !e.name.endsWith(".kt")) continue
      const src = readFileSync(p, "utf8")
      const at = src.indexOf("@CapacitorPlugin")
      if (at === -1) continue
      const cls = src.slice(at).match(/class ([\w]+)/)
      if (!cls) continue
      // The annotation is often multi-line (Geolocation's spans five), so bound the search
      // at the `class` keyword rather than trying to match balanced parens.
      const named = src
        .slice(at, at + cls.index)
        .match(/name\s*=\s*"([^"]+)"/)
      // No explicit name → Capacitor falls back to the class name minus the Plugin suffix.
      return named ? named[1] : cls[1].replace(/Plugin$/, "")
    }
  }
  return null
}

/* ------------------------------------------------------------------- the device */

const adb = (args, { check = true } = {}) => {
  const r = spawnSync("adb", args, { encoding: "utf8" })
  if (check && r.status !== 0) {
    throw new Error(
      `adb ${args.join(" ")} failed: ${(r.stderr || r.stdout || "").trim()}`,
    )
  }
  return (r.stdout ?? "").trim()
}

function freePort() {
  return new Promise((resolve, reject) => {
    const s = createServer()
    s.on("error", reject)
    s.listen(0, "127.0.0.1", () => {
      const { port } = s.address()
      s.close(() => resolve(port))
    })
  })
}

/** Ask the app's WebView what the native bridge registered. Returns the plugin names plus
 * the result of a side-effect-free call per plugin that has one. */
async function queryBridge(wsUrl) {
  const ws = new WebSocket(wsUrl)
  await new Promise((resolve, reject) => {
    ws.onopen = resolve
    ws.onerror = () => reject(new Error(`could not attach to ${wsUrl}`))
  })
  const send = (method, params) =>
    new Promise((resolve, reject) => {
      const id = Math.floor(Math.random() * 1e9)
      const onMessage = (ev) => {
        const msg = JSON.parse(ev.data)
        if (msg.id !== id) return
        ws.removeEventListener("message", onMessage)
        msg.error
          ? reject(new Error(msg.error.message))
          : resolve(msg.result)
      }
      ws.addEventListener("message", onMessage)
      ws.send(JSON.stringify({ id, method, params }))
    })

  // `PluginHeaders` is written by the NATIVE bridge at startup from the plugins it actually
  // registered — unlike `Capacitor.Plugins`, whose entries are JS shims that exist whether or
  // not anything native backs them. This is the assertion; the calls below are corroboration.
  const expr = `(async () => {
    const C = window.Capacitor
    if (!C) return JSON.stringify({ error: "no Capacitor on this page" })
    const registered = (C.PluginHeaders ?? []).map((h) => h.name)
    // Side-effect-free probes only — nothing that vibrates the device, opens a browser tab,
    // or raises a permission dialog.
    const probes = {
      App: () => C.Plugins.App.getInfo(),
      Network: () => C.Plugins.Network.getStatus(),
      Preferences: () => C.Plugins.Preferences.keys(),
      ScreenOrientation: () => C.Plugins.ScreenOrientation.orientation(),
      StatusBar: () => C.Plugins.StatusBar.getInfo(),
      Geolocation: () => C.Plugins.Geolocation.checkPermissions(),
      Device: () => C.Plugins.Device.getInfo(),
    }
    const calls = {}
    for (const [name, fn] of Object.entries(probes)) {
      try { await fn(); calls[name] = "ok" }
      catch (e) { calls[name] = String(e?.message ?? e) }
    }
    return JSON.stringify({ registered, calls, platform: C.getPlatform() })
  })()`
  const res = await send("Runtime.evaluate", {
    expression: expr,
    awaitPromise: true,
    returnByValue: true,
  })
  ws.close()
  if (res.exceptionDetails) {
    throw new Error(
      res.exceptionDetails.exception?.description ?? "evaluate failed",
    )
  }
  return JSON.parse(res.result.value)
}

/* ------------------------------------------------------------------------- main */

function arg(flag) {
  const i = process.argv.indexOf(flag)
  return i === -1 ? null : process.argv[i + 1]
}

function resolveAppId() {
  const explicit = arg("--app-id")
  if (explicit) return explicit
  const appRoot = arg("--app")
  if (!appRoot) {
    throw new Error(
      "pass --app-id <id>, or --app <dir> to read it from the generated project",
    )
  }
  const cfg = path.join(
    appRoot,
    ".adaptv/android/app/src/main/assets/capacitor.config.json",
  )
  if (!existsSync(cfg)) {
    throw new Error(
      `no Android project at ${appRoot} — run \`adaptv preview android\` there first`,
    )
  }
  return JSON.parse(readFileSync(cfg, "utf8")).appId
}

async function main() {
  const expected = expectedPlugins()
  const appId = resolveAppId()
  const target = arg("--target")
  const dev = target ? ["-s", target] : []

  const pid = adb([...dev, "shell", "pidof", appId], { check: false })
  if (!pid) {
    throw new Error(
      `${appId} isn't running on the device — launch it, then re-run`,
    )
  }
  const port = await freePort()
  adb([
    ...dev,
    "forward",
    `tcp:${port}`,
    `localabstract:webview_devtools_remote_${pid.split(/\s+/)[0]}`,
  ])
  let bridge
  try {
    const pages = await fetch(`http://127.0.0.1:${port}/json/list`).then(
      (r) => r.json(),
    )
    // The app's own WebView, not a service worker or devtools target of its own.
    const page = pages.find(
      (p) => p.type === "page" && p.webSocketDebuggerUrl,
    )
    if (!page) throw new Error("no WebView page on the devtools bridge")
    bridge = await queryBridge(page.webSocketDebuggerUrl)
  } finally {
    adb([...dev, "forward", "--remove", `tcp:${port}`], { check: false })
  }

  if (bridge.error) throw new Error(bridge.error)
  const registered = new Set(bridge.registered)
  const missing = expected.filter((p) => !registered.has(p.name))

  console.log(`platform: ${bridge.platform}   app: ${appId}`)
  for (const p of expected) {
    const call = bridge.calls[p.name]
    const note = call && call !== "ok" ? `  (${call})` : ""
    console.log(
      `  ${registered.has(p.name) ? "ok     " : "MISSING"} ${p.name.padEnd(20)} ${p.pkg}${note}`,
    )
  }
  // Named explicitly so a reader can't mistake it for the thing being asserted: `Device` is
  // the plugin the consumer app declared itself, so it worked throughout the outage.
  if (bridge.calls.Device === "ok" && missing.length > 0) {
    console.log(
      "\nnote: Device.getInfo() succeeded — it always did. It is not evidence.",
    )
  }

  if (missing.length > 0) {
    console.error(
      `\n${missing.length}/${expected.length} of adaptv's plugins are not registered on this device:\n` +
        missing.map((p) => `  ${p.pkg}`).join("\n") +
        "\n\nThe native project is missing them. Check that `capacitor.settings.gradle`," +
        "\n`app/capacitor.build.gradle` and `app/src/main/assets/capacitor.plugins.json`" +
        "\ndeclare every plugin — bin/lib/native.mjs `injectAndroidPluginProjects` writes them.",
    )
    process.exit(1)
  }
  console.log(
    `\nall ${expected.length} of adaptv's native plugins are registered.`,
  )
}

main().catch((err) => {
  console.error(`native-plugin-smoke: ${err.message}`)
  process.exit(1)
})
