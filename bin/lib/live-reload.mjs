// Live-reload plumbing: point the native WebViews at the Vite dev server, and undo it
// on exit. All of these return a revert function so the run can tear down cleanly on
// Ctrl-C (config restored, ATS exception removed, adb reverse cleared). → live-reload PR.
import { spawnSync } from "node:child_process"
import { existsSync, readFileSync, writeFileSync } from "node:fs"
import path from "node:path"
import { androidDevices, nativeDir } from "./native.mjs"
import { OFFLINE_PAGE } from "./offline-page.mjs"

/**
 * Patch `capacitor.config.json`'s `server` block so both platforms load from the dev
 * server (`url`) over cleartext http. The revert restores a CLEAN config — the
 * live-reload fields stripped — NOT the raw file: if a previous run was hard-killed
 * without teardown it may have left `server.url` behind, and restoring that would pin
 * the committed config at a dev URL forever (and break `nativ build`). Stripping first
 * both self-heals that and guarantees a clean revert now.
 *
 * A `server.errorPath` gives us a graceful offline screen: Capacitor loads it from the
 * LOCAL asset handler (`capacitor://localhost` / `http://localhost`, always registered,
 * independent of the remote `url`) whenever the main-frame load fails — i.e. the dev
 * server is down. The offline file itself is generated + synced separately
 * (`installOfflinePage`).
 *
 * We ALSO force the splash to auto-hide for the dev session. An app can set
 * `SplashScreen.launchAutoHide:false` (this one does) so its own custom splash controls
 * the handoff — but that relies on app JS calling `SplashScreen.hide()`. The offline
 * errorPath page can't: iOS could (the bridge is injected) but ANDROID DOES NOT INJECT
 * the bridge into an errorPath page, so `SplashScreen.hide()` is unreachable and the OS
 * splash sits on top of the (correctly rendered) offline screen — it only *looks* black.
 * Overriding `launchAutoHide:true` here makes the OS clear the splash on its own, so the
 * offline screen shows on both platforms. Normal live-reload loads are unaffected: the
 * app still calls `hideNativeSplash()` on first paint, which clears it earlier. The
 * revert restores the app's original splash config along with the server block.
 */
export function patchServerUrl(appRoot, url) {
  const file = path.join(appRoot, "capacitor.config.json")
  const cfg = JSON.parse(readFileSync(file, "utf8"))

  // The clean baseline: drop everything live-reload adds; drop `server` if it empties.
  const clean = structuredClone(cfg)
  if (clean.server) {
    // every field live-reload owns — stripping them is also what self-heals a config
    // left behind by a hard-killed run (SIGKILL can't revert). Safe to strip wholesale
    // because nativ GENERATES capacitor.config.json from nativ.config.ts; a consumer
    // never hand-writes these.
    for (const k of ["url", "cleartext", "errorPath", "androidScheme"])
      delete clean.server[k]
    if (Object.keys(clean.server).length === 0) delete clean.server
  }
  const cleanText = `${JSON.stringify(clean, null, 2)}\n`

  const patched = structuredClone(clean)
  patched.server = {
    ...(clean.server ?? {}),
    url,
    cleartext: true,
    errorPath: OFFLINE_PAGE,
  }
  // Serve the LOCAL origin over http for the dev session. Capacitor's Android default is
  // `https://localhost`, a secure origin — which mixed-content-blocks every request from
  // the offline errorPath page to the cleartext dev server, and Android can't fall back
  // to the native `CapacitorHttp` because it never injects the bridge into that page
  // (Bridge.loadWebView scopes `addDocumentStartJavaScript` to the appUrl origin and
  // nulls the local-server injector). With `http`, the offline page's origin matches the
  // dev server's scheme, so a plain `fetch` reachability probe works and Android can
  // auto-reconnect. Safe here precisely BECAUSE live-reload is on: the app itself runs
  // from the dev-server origin, so this local origin only ever serves the offline page —
  // no app storage or secure-context API rides on it. Reverted with everything else.
  patched.server.androidScheme = "http"
  // Force the OS splash to auto-hide (see doc above) — preserve any other splash options.
  patched.plugins = { ...(patched.plugins ?? {}) }
  patched.plugins.SplashScreen = {
    ...(patched.plugins.SplashScreen ?? {}),
    launchAutoHide: true,
    launchShowDuration: 1200,
  }
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
 *
 * A `NativDevAtsPatch` marker goes in alongside. Unlike `capacitor.config.json`, this
 * plist is patched IN PLACE and never regenerated, so a run killed with SIGKILL leaves
 * the exception behind — and shipping `NSAllowsArbitraryLoads` is both a real hole and
 * something App Review asks about. The marker is what makes cleanup safe: it says "nativ
 * added this", so `healDevAtsLeftover` can strip it without ever touching an ATS block
 * the app legitimately owns. → config-artifact PR.
 */
export const ATS_MARKER = "NativDevAtsPatch"

export function patchIosAts(appRoot) {
  const plist = iosPlistPath(appRoot)
  if (!existsSync(plist)) return null
  const original = readFileSync(plist, "utf8")
  if (original.includes("NSAppTransportSecurity")) return null
  const pb = (cmd) =>
    spawnSync("/usr/libexec/PlistBuddy", ["-c", cmd, plist])
  pb("Add :NSAppTransportSecurity dict")
  pb("Add :NSAppTransportSecurity:NSAllowsArbitraryLoads bool true")
  pb("Add :NSAppTransportSecurity:NSAllowsLocalNetworking bool true")
  pb(`Add :${ATS_MARKER} bool true`)
  return () => writeFileSync(plist, original)
}

function iosPlistPath(appRoot) {
  return path.join(nativeDir(appRoot, "ios"), "App/App/Info.plist")
}

/**
 * Strip a dev ATS exception the CLI left behind, before a release build packages it.
 *
 * Returns one of:
 * - `{ healed: true }`  — our marker was there; the exception + marker were removed.
 * - `{ warn: true }`    — ATS is declared but NOT by us. Never auto-edit that: the app
 *                         may legitimately need it. Surface it and let the dev decide.
 * - `{}`                — nothing to do.
 */
export function healDevAtsLeftover(appRoot) {
  const plist = iosPlistPath(appRoot)
  if (!existsSync(plist)) return {}
  const text = readFileSync(plist, "utf8")
  if (!text.includes("NSAppTransportSecurity")) return {}
  if (!text.includes(ATS_MARKER)) return { warn: true }
  const pb = (cmd) =>
    spawnSync("/usr/libexec/PlistBuddy", ["-c", cmd, plist])
  pb("Delete :NSAppTransportSecurity")
  pb(`Delete :${ATS_MARKER}`)
  return { healed: true }
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
