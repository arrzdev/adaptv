// @vitest-environment node
import { EventEmitter } from "node:events"
import { beforeEach, describe, expect, it, vi } from "vitest"

// `ensureDeviceWindow` runs after every launch, cached path and `r` reload. Its only job is
// iOS's: `open -g -a Simulator`. On Android it used to ask `isPhysicalTarget` first, which
// runs `adb devices`, and then do nothing with the answer — one process per reload, for a
// question no branch read.
//
// `probe()` is a private `spawn` wrapper, so the seam is `node:child_process` itself, as in
// `native-relaunch.test.mjs`: a fake `spawn` records every command and exits 0.

const fake = vi.hoisted(() => ({
  /** @type {string[][]} every spawned command, as [command, ...args] */
  calls: [],
}))

vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal()
  return {
    ...actual,
    spawn: (command, args) => {
      fake.calls.push([command, ...args])
      const child = new EventEmitter()
      const stdout = new EventEmitter()
      stdout.setEncoding = () => {}
      child.stdout = stdout
      queueMicrotask(() => child.emit("close", 0))
      return child
    },
  }
})

const { ensureDeviceWindow } = await import("./native.mjs")

const SIMULATOR = "5B3F2A10-1C2D-4E5F-8A9B-0C1D2E3F4A5B"

beforeEach(() => {
  fake.calls.length = 0
})

describe("ensureDeviceWindow", () => {
  it("spawns nothing on Android, for an AVD name or a serial", async () => {
    await ensureDeviceWindow("android", "Pixel_10", {})
    await ensureDeviceWindow("android", "emulator-5554", {})
    await ensureDeviceWindow("android", "R58M123ABC", {})
    expect(fake.calls).toEqual([])
  })

  it("opens the Simulator window behind the dev's own for an iOS simulator", async () => {
    await ensureDeviceWindow("ios", SIMULATOR, {})
    expect(fake.calls).toEqual([["open", "-g", "-a", "Simulator"]])
  })

  it("leaves the Simulator alone for a physical iPhone", async () => {
    await ensureDeviceWindow("ios", "00008030-001A2B3C4D5E6F70", {})
    expect(fake.calls).toEqual([])
  })
})
