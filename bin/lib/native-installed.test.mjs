// @vitest-environment node
import { EventEmitter } from "node:events"
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { crc32, deflateRawSync } from "node:zlib"
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

/**
 * A minimal zip (deflated entries, central directory, end record), the shape an APK has. Written
 * here rather than borrowed so the reader under test is checked against the format, not against
 * a second copy of its own assumptions.
 * @param {Record<string, string>} files
 */
function zipOf(files) {
  const locals = []
  const centrals = []
  let offset = 0
  for (const [name, text] of Object.entries(files)) {
    const data = Buffer.from(text)
    const body = deflateRawSync(data)
    const nameBuf = Buffer.from(name)
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt16LE(8, 8)
    local.writeUInt32LE(crc32(data), 14)
    local.writeUInt32LE(body.length, 18)
    local.writeUInt32LE(data.length, 22)
    local.writeUInt16LE(nameBuf.length, 26)
    const central = Buffer.alloc(46)
    central.writeUInt32LE(0x02014b50, 0)
    central.writeUInt16LE(20, 4)
    central.writeUInt16LE(20, 6)
    central.writeUInt16LE(8, 10)
    central.writeUInt32LE(crc32(data), 16)
    central.writeUInt32LE(body.length, 20)
    central.writeUInt32LE(data.length, 24)
    central.writeUInt16LE(nameBuf.length, 28)
    central.writeUInt32LE(offset, 42)
    locals.push(local, nameBuf, body)
    centrals.push(central, nameBuf)
    offset += local.length + nameBuf.length + body.length
  }
  const dir = Buffer.concat(centrals)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(Object.keys(files).length, 8)
  end.writeUInt16LE(Object.keys(files).length, 10)
  end.writeUInt32LE(dir.length, 12)
  end.writeUInt32LE(offset, 16)
  return Buffer.concat([...locals, dir, end])
}

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

  // Android 7 and 8 (API 24–27, inside minSdk) ship no `unzip` at all: it came with ziptool in
  // Android 9. Without a second way to read the file those devices would never take the cached
  // path again, when before they always could.
  it("pulls the APK to this machine and reads the entry there when the device has no unzip (API 24–27)", async () => {
    process.env.ADAPTV_CAPACITOR_CONFIG = JSON.stringify(devConfig(43100))
    const apk = zipOf({
      "AndroidManifest.xml": "<binary manifest>",
      "assets/capacitor.config.json": JSON.stringify(devConfig(43110)),
    })
    const pulledTo = []
    fake.answer = (command, args) => {
      if (command !== "adb") return { status: 1 }
      if (args[0] === "devices")
        return {
          stdout: "List of devices attached\nemulator-5554\tdevice\n",
        }
      if (args.includes("path"))
        return { stdout: `package:/data/app/${APP_ID}-1/base.apk\n` }
      if (
        args[2] === "pull" &&
        args[3] === `/data/app/${APP_ID}-1/base.apk`
      ) {
        writeFileSync(args[4], apk)
        pulledTo.push(args[4])
        return {}
      }
      return {
        status: 127,
        stdout: "/system/bin/sh: unzip: not found",
      }
    }
    expect(
      await readInstalledConfig("/app", "android", "emulator-5554", {}),
    ).toEqual(devConfig(43110))
    expect(pulledTo).toHaveLength(1)
    //the copy is this function's own scratch, gone once it has been read
    expect(existsSync(pulledTo[0])).toBe(false)
  })

  it("answers null when neither the device nor a pulled copy yields the file, so the caller rebuilds", async () => {
    process.env.ADAPTV_CAPACITOR_CONFIG = JSON.stringify(devConfig(43100))
    fake.answer = (_command, args) => {
      if (args[0] === "devices")
        return {
          stdout: "List of devices attached\nemulator-5554\tdevice\n",
        }
      if (args.includes("path"))
        return { stdout: `package:/data/app/${APP_ID}-1/base.apk\n` }
      if (args[2] === "pull") {
        writeFileSync(args[4], zipOf({ "classes.dex": "dex" }))
        return {}
      }
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
