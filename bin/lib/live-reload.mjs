// Live-reload plumbing: point the native WebViews at the Vite dev server, and undo it
// on exit. All of these return a revert function so the run can tear down cleanly on
// Ctrl-C (config restored, ATS exception removed, adb reverse cleared). → live-reload PR.
import { spawnSync } from "node:child_process"
import { existsSync, readFileSync, writeFileSync } from "node:fs"
import path from "node:path"
import { androidDevices, nativeDir } from "./native.mjs"

/**
 * Patch `capacitor.config.json`'s `server` block so both platforms load from the dev
 * server (`url`) over cleartext http. The revert restores a CLEAN config — the
 * live-reload fields stripped — NOT the raw file: if a previous run was hard-killed
 * without teardown it may have left `server.url` behind, and restoring that would pin
 * the committed config at a dev URL forever (and break `nativ build`). Stripping first
 * both self-heals that and guarantees a clean revert now.
 *
 * NOTE: a Capacitor `server.errorPath` (a local "dev server offline" page) does NOT
 * work here — with a remote `server.url` set, Capacitor fires errorPath and serves the
 * bundled file, but the remote-configured WebView renders nothing (verified: even a
 * solid-colour static page shows black on iOS + Android, empty a11y tree). A real
 * offline screen needs the local-first "dev client" model (load the bundle, navigate
 * to the dev server) — a separate change. → live-reload PR notes.
 */
export function patchServerUrl(appRoot, url) {
  const file = path.join(appRoot, "capacitor.config.json")
  const cfg = JSON.parse(readFileSync(file, "utf8"))

  // The clean baseline: drop everything live-reload adds; drop `server` if it empties.
  const clean = structuredClone(cfg)
  if (clean.server) {
    for (const k of ["url", "cleartext", "errorPath"])
      delete clean.server[k]
    if (Object.keys(clean.server).length === 0) delete clean.server
  }
  const cleanText = `${JSON.stringify(clean, null, 2)}\n`

  const patched = structuredClone(clean)
  patched.server = { ...(clean.server ?? {}), url, cleartext: true }
  writeFileSync(file, `${JSON.stringify(patched, null, 2)}\n`)
  return () => writeFileSync(file, cleanText)
}

/**
 * Add a DEBUG-ONLY iOS ATS exception so the WebView (and the app's fetches) can use
 * cleartext http during live-reload — both the dev server and a local/LAN http
 * backend. Uses `NSAllowsArbitraryLoads` because `NSAllowsLocalNetworking` does not
 * reliably cover a raw LAN IP (e.g. http://192.168.1.x). Reverted on exit, and it
 * only ever touches the live-reload session — release builds are untouched. No-op
 * (returns null) if the plist is missing or already declares ATS.
 */
export function patchIosAts(appRoot) {
  const plist = path.join(nativeDir(appRoot, "ios"), "App/App/Info.plist")
  if (!existsSync(plist)) return null
  const original = readFileSync(plist, "utf8")
  if (original.includes("NSAppTransportSecurity")) return null
  const pb = (cmd) =>
    spawnSync("/usr/libexec/PlistBuddy", ["-c", cmd, plist])
  pb("Add :NSAppTransportSecurity dict")
  pb("Add :NSAppTransportSecurity:NSAllowsArbitraryLoads bool true")
  pb("Add :NSAppTransportSecurity:NSAllowsLocalNetworking bool true")
  return () => writeFileSync(plist, original)
}

/** Set the `adb reverse tcp:<port>` mapping on every connected device. */
function setAndroidReverse(serials, port, env) {
  for (const s of serials) {
    // `-s <serial>` explicitly: a bare `adb reverse` throws with >1 emulator running.
    spawnSync("adb", ["-s", s, "reverse", `tcp:${port}`, `tcp:${port}`], {
      env,
    })
  }
}

/**
 * KEEP an `adb reverse tcp:<port>` mapping alive for the whole run so an emulator's
 * `localhost:<port>` always reaches the host dev server. Setting it once isn't enough:
 * the mapping is global to the adb server, so ANY other `nativ run` tearing down (even
 * a stale/orphaned one) runs `adb reverse --remove tcp:<port>` and silently kills the
 * route for THIS run too — the app keeps rendering but stops hot-reloading. So we set
 * it, then re-assert it on a short interval (only re-adding when it's actually missing,
 * so it's cheap), and the Android watchdog reconnects HMR once the route is back.
 * Returns a revert fn that stops the interval and removes the mapping.
 */
export function androidReverse(port, env, { intervalMs = 4000 } = {}) {
  const serials = androidDevices(env)
  setAndroidReverse(serials, port, env)
  const ensure = () => {
    for (const s of serials) {
      const r = spawnSync("adb", ["-s", s, "reverse", "--list"], {
        env,
        encoding: "utf8",
      })
      if (!(r.stdout ?? "").includes(`tcp:${port}`)) {
        spawnSync(
          "adb",
          ["-s", s, "reverse", `tcp:${port}`, `tcp:${port}`],
          {
            env,
          },
        )
      }
    }
  }
  const timer = setInterval(ensure, intervalMs)
  timer.unref?.() // don't keep the process alive on its own
  return () => {
    clearInterval(timer)
    for (const s of serials) {
      spawnSync("adb", ["-s", s, "reverse", "--remove", `tcp:${port}`], {
        env,
      })
    }
  }
}
