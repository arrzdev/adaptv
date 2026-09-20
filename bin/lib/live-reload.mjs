// Live-reload plumbing: point the native WebViews at the Vite dev server, and undo it
// on exit. All of these return a revert function so the run can tear down cleanly on
// Ctrl-C (config restored, ATS exception removed, adb reverse cleared). → live-reload PR.
import { spawnSync } from "node:child_process"
import { existsSync, readFileSync, writeFileSync } from "node:fs"
import path from "node:path"
import {
  androidSerialForTarget,
  capConfigFromEnv,
  nativeDir,
  updateCapacitorEnv,
} from "./native.mjs"
import { OFFLINE_PAGE } from "./offline-page.mjs"

/**
 * Patch `capacitor.config.json`'s `server` block so both platforms load from the dev
 * server (`url`) over cleartext http. The revert restores a CLEAN config — the
 * live-reload fields stripped — NOT the raw file: if a previous run was hard-killed
 * without teardown it may have left `server.url` behind, and restoring that would pin
 * the committed config at a dev URL forever (and break `adaptv build`). Stripping first
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
export function patchServerUrl(_appRoot, url) {
  const base = capConfigFromEnv() ?? {}
  // Serve the LOCAL origin over http for the dev session. Capacitor's Android default is
  // `https://localhost`, a secure origin — which mixed-content-blocks every request from
  // the offline errorPath page to the cleartext dev server, and Android can't fall back
  // to the native `CapacitorHttp` because it never injects the bridge into that page
  // (Bridge.loadWebView scopes `addDocumentStartJavaScript` to the appUrl origin and
  // nulls the local-server injector). With `http`, the offline page's origin matches the
  // dev server's scheme, so a plain `fetch` reachability probe works and Android can
  // auto-reconnect. Safe here precisely BECAUSE live-reload is on: the app itself runs
  // from the dev-server origin, so this local origin only ever serves the offline page —
  // and that is a test, not a claim: `live-reload.test.mjs` fails if the page ever reads
  // storage or a secure-context API, or if a built config carries this scheme.
  const server = {
    url,
    cleartext: true,
    errorPath: OFFLINE_PAGE,
    androidScheme: "http",
  }
  // Force the OS splash to auto-hide (see doc above) — preserve any other splash options.
  const plugins = {
    ...(base.plugins ?? {}),
    SplashScreen: {
      ...(base.plugins?.SplashScreen ?? {}),
      launchAutoHide: true,
      launchShowDuration: 1200,
    },
  }
  updateCapacitorEnv({ server, plugins })
  // Revert to the clean generated baseline. The env config is ephemeral (dies with the
  // process), so this only matters for a mode switch inside one run — but keep it exact.
  return () => {
    const cur = capConfigFromEnv() ?? {}
    delete cur.server
    cur.plugins = base.plugins
    process.env.ADAPTV_CAPACITOR_CONFIG = JSON.stringify(cur)
  }
}

/**
 * Add a DEBUG-ONLY iOS ATS exception so the WebView (and the app's fetches) can use
 * cleartext http during live-reload — both the dev server and a local/LAN http
 * backend. Uses `NSAllowsArbitraryLoads` because `NSAllowsLocalNetworking` does not
 * reliably cover a raw LAN IP (e.g. http://192.168.1.x). Reverted on exit, and it
 * only ever touches the live-reload session — release builds are untouched. No-op
 * (returns null) if the plist is missing or already declares ATS.
 *
 * A `AdaptvDevAtsPatch` marker goes in alongside. Unlike `capacitor.config.json`, this
 * plist is patched IN PLACE and never regenerated, so a run killed with SIGKILL leaves
 * the exception behind — and shipping `NSAllowsArbitraryLoads` is both a real hole and
 * something App Review asks about. The marker is what makes cleanup safe: it says "adaptv
 * added this", so `healDevAtsLeftover` can strip it without ever touching an ATS block
 * the app legitimately owns. → config-artifact PR.
 */
export const ATS_MARKER = "AdaptvDevAtsPatch"

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
 * Add `NSLocalNetworkUsageDescription` for external (physical-device) live-reload. iOS 14+
 * gates any Local Network access behind a runtime prompt, and without this key the OS
 * SILENTLY blocks the WebView from reaching the dev server on the LAN — the app just never
 * loads. (The Simulator does NOT enforce this, which is why it "works on the sim, fails on
 * the device".) Only needed when the dev server is on the LAN IP, so it's applied for
 * external runs and reverted on teardown. No-op if the app already declares the key.
 */
export function patchIosLocalNetwork(appRoot) {
  const plist = iosPlistPath(appRoot)
  if (!existsSync(plist)) return null
  const original = readFileSync(plist, "utf8")
  if (original.includes("NSLocalNetworkUsageDescription")) return null
  spawnSync("/usr/libexec/PlistBuddy", [
    "-c",
    `Add :NSLocalNetworkUsageDescription string "${LOCAL_NETWORK_REASON}"`,
    plist,
  ])
  return () => writeFileSync(plist, original)
}

/**
 * Dev's Local Network reason. The sentence is its own marker: no app writes it, so a plist
 * carrying it under that key is carrying a killed session's leftover, and `healDevAtsLeftover`
 * can remove it without a second marker key.
 */
const LOCAL_NETWORK_REASON =
  "Development live-reload connects to the adaptv dev server on your local network."
const DEV_LOCAL_NETWORK = new RegExp(
  `<key>NSLocalNetworkUsageDescription</key>\\s*<string>${LOCAL_NETWORK_REASON.replace(/\./g, "\\.")}</string>`,
)

/**
 * Strip what a killed dev session left in the plist, before a release build packages it: the
 * ATS exception, and the Local Network reason an external run adds beside it. Both are
 * patched in place, so both outlive a SIGKILL, and the patch that finds either already there
 * adopts it and registers no revert.
 *
 * Returns one of:
 * - `{ warn: true }`   — ATS is declared but NOT by us. Never auto-edit that: the app
 *                        may legitimately need it. Surface it and let the dev decide.
 *                        (A leftover Local Network reason is still removed.)
 * - `{ healed: true }` — a leftover of dev's own (marker or sentence) was removed.
 * - `{}`               — nothing to do.
 */
export function healDevAtsLeftover(appRoot) {
  const plist = iosPlistPath(appRoot)
  if (!existsSync(plist)) return {}
  const text = readFileSync(plist, "utf8")
  const pb = (cmd) =>
    spawnSync("/usr/libexec/PlistBuddy", ["-c", cmd, plist])
  const result = {}
  if (DEV_LOCAL_NETWORK.test(text)) {
    pb("Delete :NSLocalNetworkUsageDescription")
    result.healed = true
  }
  if (!text.includes("NSAppTransportSecurity")) return result
  //`warn` alone: the caller reads `healed` first and stays silent on it, and a healed
  //sentence must not hide the one thing here the dev has to decide.
  if (!text.includes(ATS_MARKER)) return { warn: true }
  pb("Delete :NSAppTransportSecurity")
  pb(`Delete :${ATS_MARKER}`)
  return { healed: true }
}

/**
 * KEEP an `adb reverse tcp:<port>` mapping alive on the run's target device for the whole run,
 * so the emulator's `localhost:<port>` always reaches the host dev server. Setting it once
 * isn't enough: `cap run` resets the device's reverse table while installing, and anything
 * else that runs `adb reverse --remove tcp:<port>` on the device silently kills the route —
 * the app keeps rendering but stops hot-reloading. So we set it, then re-assert it on a short
 * interval (only re-adding when it's actually missing, so it's cheap), and the Android
 * watchdog reconnects HMR once the route is back.
 *
 * ONE device, the target, resolved to its serial by `androidSerialForTarget` with `exact`: the
 * serial itself or the emulator whose AVD name it is, never merely the only device connected.
 * Every connected device is not the run's: another session's emulator on the same
 * adb server has its own reverse table, and a mapping for this port there belongs to whatever
 * run put it there — which is what setting it everywhere and removing it everywhere on
 * teardown used to break.
 *
 * A target that does not resolve yet touches nothing and is retried on each tick: both
 * callers run after the target was launched, so it is a moment (a console that has not
 * answered its AVD name), and guessing — every connected device — is the bug itself.
 *
 * Returns a revert fn that stops the interval and removes the mapping from the one device it
 * was set on, if any.
 */
export async function androidReverse(
  port,
  target,
  env,
  { intervalMs = 4000 } = {},
) {
  const adb = (serial, ...args) =>
    // `-s <serial>` explicitly: a bare `adb reverse` throws with >1 emulator running.
    spawnSync("adb", ["-s", serial, "reverse", ...args], {
      env,
      encoding: "utf8",
    })
  const map = (serial) => adb(serial, `tcp:${port}`, `tcp:${port}`)
  let serial = await androidSerialForTarget(target, env, { exact: true })
  if (serial) map(serial)
  let stopped = false
  let resolving = false
  const ensure = async () => {
    if (serial) {
      if (!(adb(serial, "--list").stdout ?? "").includes(`tcp:${port}`))
        map(serial)
      return
    }
    if (resolving) return
    resolving = true
    const found = await androidSerialForTarget(target, env, {
      exact: true,
    })
    resolving = false
    if (!found || stopped) return
    serial = found
    map(serial)
  }
  const timer = setInterval(ensure, intervalMs)
  timer.unref?.() // don't keep the process alive on its own
  return () => {
    stopped = true
    clearInterval(timer)
    if (serial) adb(serial, "--remove", `tcp:${port}`)
  }
}
