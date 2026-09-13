// @vitest-environment node
import { EventEmitter } from "node:events"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

// The run cache's "skip the build, relaunch what is installed" is only as good as its idea of
// what is installed. It used to ask the device one thing, whether the bundle id was there, and
// take this checkout's `.adaptv/state.json` for the rest. Another checkout of the same app (or an
// earlier run on another port) installs under that same bundle id, so `dev` printed `cached` and
// relaunched a shell baked for a port nothing served: the app sat on the offline screen, polling.
//
// `probe()` is a private `spawn` wrapper, so the seam is `node:child_process` itself: a fake
// `spawn` records every command and answers from a per-test script.

const fake = vi.hoisted(() => ({
  /** @type {string[][]} every spawned command, as [command, ...args] */
  calls: [],
  /** @type {(command: string, args: string[]) => { status?: number, stdout?: string }} */
  answer: () => ({ status: 1 }),
}))

vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal()
  return {
    ...actual,
    spawn: (command, args) => {
      fake.calls.push([command, ...args])
      const { status = 0, stdout = "" } = fake.answer(command, args) ?? {}
      const child = new EventEmitter()
      const out = new EventEmitter()
      out.setEncoding = () => {}
      child.stdout = out
      queueMicrotask(() => {
        if (stdout) out.emit("data", stdout)
        child.emit("close", status)
      })
      return child
    },
  }
})

const { isInstallCurrent, readInstalledConfig } = await import(
  "./native.mjs"
)

const APP_ID = "dev.arrz.projectzero.dev"
const SIM = "81C723E1-7B23-4A31-AAAE-A5A107EE9C6D"
const devConfig = (port) => ({
  appId: APP_ID,
  server: { url: `http://localhost:${port}`, cleartext: true },
})

let savedConfig
let dir
beforeEach(() => {
  savedConfig = process.env.ADAPTV_CAPACITOR_CONFIG
  fake.calls.length = 0
  fake.answer = () => ({ status: 1 })
  dir = mkdtempSync(path.join(tmpdir(), "adaptv-installed-"))
})
afterEach(() => {
  if (savedConfig === undefined) delete process.env.ADAPTV_CAPACITOR_CONFIG
  else process.env.ADAPTV_CAPACITOR_CONFIG = savedConfig
  rmSync(dir, { recursive: true, force: true })
})

/** A simulator holding an `App.app` whose baked config is `baked`. */
function simulatorWith(baked) {
  const bundle = path.join(dir, "App.app")
  mkdirSync(bundle)
  writeFileSync(
    path.join(bundle, "capacitor.config.json"),
    JSON.stringify(baked),
  )
  fake.answer = (command, args) =>
    command === "xcrun" && args[1] === "get_app_container"
      ? args[2] === SIM && args[3] === APP_ID
        ? { stdout: `${bundle}\n` }
        : { status: 2 }
      : { status: 1 }
}

describe("isInstallCurrent — the device, not this checkout's cache, says what is installed", () => {
  it("refuses a simulator install baked for another dev server's port (it sat on the offline screen polling :43110 while `dev` served :43100)", async () => {
    simulatorWith(devConfig(43110))
    process.env.ADAPTV_CAPACITOR_CONFIG = JSON.stringify(devConfig(43100))
    expect(await isInstallCurrent("/app", "ios", SIM, {})).toBe(false)
  })

  it("reuses the install when it loads the server this run serves, so the ~1s relaunch still happens", async () => {
    simulatorWith(devConfig(43100))
    process.env.ADAPTV_CAPACITOR_CONFIG = JSON.stringify(devConfig(43100))
    expect(await isInstallCurrent("/app", "ios", SIM, {})).toBe(true)
  })

  it("refuses a dev shell when a static build is intended, whichever checkout installed it", async () => {
    simulatorWith(devConfig(43110))
    process.env.ADAPTV_CAPACITOR_CONFIG = JSON.stringify({ appId: APP_ID })
    expect(await isInstallCurrent("/app", "ios", SIM, {})).toBe(false)
  })

  it("never vouches for an app that is not installed", async () => {
    process.env.ADAPTV_CAPACITOR_CONFIG = JSON.stringify(devConfig(43100))
    expect(await readInstalledConfig("/app", "ios", SIM, {})).toBeNull()
    expect(await isInstallCurrent("/app", "ios", SIM, {})).toBe(false)
  })
})

describe("readInstalledConfig — reading what is baked into the installed app", () => {
  it("reads the simulator's bundle directly off this machine", async () => {
    simulatorWith(devConfig(43110))
    process.env.ADAPTV_CAPACITOR_CONFIG = JSON.stringify(devConfig(43100))
    expect(await readInstalledConfig("/app", "ios", SIM, {})).toEqual(
      devConfig(43110),
    )
  })

  it("reads the file out of the base APK on the ONE device the run targets, never a split", async () => {
    process.env.ADAPTV_CAPACITOR_CONFIG = JSON.stringify(devConfig(43100))
    const base = `/data/app/~~x==/${APP_ID}-y==/base.apk`
    fake.answer = (command, args) => {
      if (command !== "adb") return { status: 1 }
      if (args[0] === "devices")
        return {
          stdout: "List of devices attached\nemulator-5554\tdevice\n",
        }
      if (args.slice(2, 5).join(" ") === "shell pm path")
        return {
          stdout: `package:/data/app/~~x==/${APP_ID}-y==/split_config.arm64_v8a.apk\npackage:${base}\n`,
        }
      if (
        args.slice(2, 5).join(" ") === "shell unzip -p" &&
        args[5] === base
      )
        return { stdout: JSON.stringify(devConfig(43110)) }
      return { status: 1 }
    }
    expect(
      await readInstalledConfig("/app", "android", "emulator-5554", {}),
    ).toEqual(devConfig(43110))
    const unzip = fake.calls.find((c) => c.includes("unzip"))
    expect(unzip).toEqual([
      "adb",
      "-s",
      "emulator-5554",
      "shell",
      "unzip",
      "-p",
      base,
      "assets/capacitor.config.json",
    ])
  })

  it("answers null when the device cannot extract the file, so the caller rebuilds", async () => {
    process.env.ADAPTV_CAPACITOR_CONFIG = JSON.stringify(devConfig(43100))
    fake.answer = (_command, args) => {
      if (args[0] === "devices")
        return {
          stdout: "List of devices attached\nemulator-5554\tdevice\n",
        }
      if (args.includes("path"))
        return { stdout: `package:/data/app/${APP_ID}-1/base.apk\n` }
      return {
        status: 127,
        stdout: "/system/bin/sh: unzip: inaccessible or not found",
      }
    }
    expect(
      await readInstalledConfig("/app", "android", "emulator-5554", {}),
    ).toBeNull()
  })
})
