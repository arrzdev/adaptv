import {
  chmodSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { relaunchAndroidApp } from "./native.mjs"

// `relaunchAndroidApp` runs on the cache-miss path of `adaptv dev android`, after the
// install reset the emulator's `adb reverse`. It used to force-stop and relaunch the app
// on EVERY connected emulator; a second, idle emulator was disturbed by a dev session
// that never targeted it. These tests pin the argv: every adb call that touches an app
// carries `-s <the target's serial>`, and an AVD name resolves to its serial the same
// way `launchInstalledApp` resolves it.

const APP_ID = "dev.arrz.relaunch"
const DEVICES =
  "List of devices attached\nemulator-5554\tdevice\nemulator-5556\tdevice\n"

//A fake `adb` on PATH: logs every argv line, answers `devices` with two emulators and
//`emu avd name` with a name per serial. Everything else succeeds silently.
const FAKE_ADB = `#!/bin/sh
printf '%s\\n' "$*" >> "$FAKE_ADB_LOG"
case "$*" in
  devices) printf '${DEVICES.replace(/\n/g, "\\n").replace(/\t/g, "\\t")}' ;;
  "-s emulator-5554 emu avd name") printf 'Pixel_8\\nOK\\n' ;;
  "-s emulator-5556 emu avd name") printf 'Pixel_10\\nOK\\n' ;;
esac
exit 0
`

let dir
let env
let savedConfig
beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "adaptv-relaunch-"))
  const adb = path.join(dir, "adb")
  writeFileSync(adb, FAKE_ADB)
  chmodSync(adb, 0o755)
  env = {
    ...process.env,
    PATH: `${dir}${path.delimiter}${process.env.PATH ?? ""}`,
    FAKE_ADB_LOG: path.join(dir, "adb.log"),
  }
  savedConfig = process.env.ADAPTV_CAPACITOR_CONFIG
  process.env.ADAPTV_CAPACITOR_CONFIG = JSON.stringify({ appId: APP_ID })
})
afterEach(() => {
  if (savedConfig === undefined) delete process.env.ADAPTV_CAPACITOR_CONFIG
  else process.env.ADAPTV_CAPACITOR_CONFIG = savedConfig
  rmSync(dir, { recursive: true, force: true })
})

function calls() {
  try {
    return readFileSync(env.FAKE_ADB_LOG, "utf8").trim().split("\n")
  } catch {
    return []
  }
}

/** The adb lines that touch the app (force-stop and launch), in order. */
function appCalls() {
  return calls().filter((l) => l.includes(APP_ID))
}

describe("relaunchAndroidApp targets one device", () => {
  it("an AVD name resolves to its serial, and only that serial is touched", async () => {
    await relaunchAndroidApp(dir, env, "Pixel_10")
    expect(appCalls()).toEqual([
      `-s emulator-5556 shell am force-stop ${APP_ID}`,
      `-s emulator-5556 shell monkey -p ${APP_ID} -c android.intent.category.LAUNCHER 1`,
    ])
    expect(
      calls().some((l) => l.includes("5554") && l.includes(APP_ID)),
    ).toBe(false)
  })

  it("a serial is used as given", async () => {
    await relaunchAndroidApp(dir, env, "emulator-5554")
    expect(appCalls()).toEqual([
      `-s emulator-5554 shell am force-stop ${APP_ID}`,
      `-s emulator-5554 shell monkey -p ${APP_ID} -c android.intent.category.LAUNCHER 1`,
    ])
  })

  it("an unresolvable target falls back to every device, each by its own serial", async () => {
    await relaunchAndroidApp(dir, env, "Nexus_5")
    const lines = appCalls()
    expect(lines).toHaveLength(4)
    //never a bare `shell …` — the device is always named
    for (const l of lines) expect(l).toMatch(/^-s emulator-555[46] shell /)
    expect(
      lines.filter((l) => l.startsWith("-s emulator-5554")),
    ).toHaveLength(2)
    expect(
      lines.filter((l) => l.startsWith("-s emulator-5556")),
    ).toHaveLength(2)
  })

  it("does nothing without an app id", async () => {
    delete process.env.ADAPTV_CAPACITOR_CONFIG
    await relaunchAndroidApp(dir, env, "Pixel_10")
    expect(calls()).toEqual([])
  })
})
