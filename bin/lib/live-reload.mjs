// Live-reload plumbing: point the native WebViews at the Vite dev server, and undo it
// on exit. All of these return a revert function so the run can tear down cleanly on
// Ctrl-C (config restored, ATS exception removed, adb reverse cleared). → live-reload PR.
import { spawnSync } from "node:child_process"
import { existsSync, readFileSync, writeFileSync } from "node:fs"
import path from "node:path"
import { nativeDir } from "./native.mjs"

/**
 * Patch `capacitor.config.json`'s `server` block so both platforms load from the dev
 * server (`url`) over cleartext http. Returns a revert fn restoring the original file.
 */
export function patchServerUrl(appRoot, url) {
  const file = path.join(appRoot, "capacitor.config.json")
  const original = readFileSync(file, "utf8")
  const cfg = JSON.parse(original)
  cfg.server = { ...(cfg.server ?? {}), url, cleartext: true }
  writeFileSync(file, `${JSON.stringify(cfg, null, 2)}\n`)
  return () => writeFileSync(file, original)
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

/**
 * `adb reverse` so an emulator/device's `localhost:<port>` reaches the host dev
 * server. Returns a revert fn that removes the reverse mapping.
 */
export function androidReverse(port, env) {
  spawnSync("adb", ["reverse", `tcp:${port}`, `tcp:${port}`], { env })
  return () =>
    spawnSync("adb", ["reverse", "--remove", `tcp:${port}`], { env })
}
