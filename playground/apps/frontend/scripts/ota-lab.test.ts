import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { after, describe, test } from "node:test"
import { fileURLToPath } from "node:url"

// `tsx --test scripts/ota-lab.test.ts` — the lab against two attached devices.
//
// On a shared machine a second emulator, a second booted simulator or a cabled
// iPhone is the normal case, and a bare `adb` then fails with "more than one
// device", `simctl … booted` picks one of the simulators at random, and
// `preview` sits on its device picker forever. So this runs the REAL script,
// with `adb`, `xcrun`, `npx` and `sleep` replaced on PATH by recorders that
// list two devices, and reads back every call it made.
//
// Nothing here boots, installs or launches anything: the recorders answer the
// listing and exit 0 for everything else.

const HERE = path.dirname(fileURLToPath(import.meta.url))
const SCRIPT = path.join(HERE, "ota-lab.ts")
const TSX = fileURLToPath(import.meta.resolve("tsx/cli"))
const ADAPTV = path.join(HERE, "../node_modules/adaptv")

const root = mkdtempSync(path.join(tmpdir(), "ota-lab-test-"))
after(() => rmSync(root, { recursive: true, force: true }))

const EMULATORS = ["emulator-5554", "emulator-5556"]
const SIMULATORS = [
  "0FA4E000-0000-4000-8000-00000000A0A0",
  "0FA4E000-0000-4000-8000-00000000B0B0",
]

type Platform = "android" | "ios"

/** A fake bin dir that records argv and lists `count` devices. */
function fakeBin(dir: string, count: number): void {
  mkdirSync(dir, { recursive: true })
  const adbList = EMULATORS.slice(0, count)
    .map(
      (serial) =>
        `${serial}          device product:sdk model:Pixel_6 transport_id:1`,
    )
    //an offline device and an unauthorized phone are never candidates
    .concat([
      "emulator-5560          offline transport_id:3",
      "R5CT000FAKE          unauthorized transport_id:4",
    ])
    .join("\\n")
  const sims = SIMULATORS.slice(0, count).map((udid, i) => ({
    udid,
    name: `fake-sim-${i}`,
    state: "Booted",
  }))
  writeFileSync(
    path.join(dir, "simctl-list.json"),
    JSON.stringify({
      devices: {
        "com.apple.CoreSimulator.SimRuntime.iOS-26-1": [
          ...sims,
          //a shutdown simulator is never a candidate
          {
            udid: "0FA4E000-0000-4000-8000-00000000C0C0",
            name: "fake-sim-off",
            state: "Shutdown",
          },
        ],
        //a booted Watch is not an iOS device the app can be installed on
        "com.apple.CoreSimulator.SimRuntime.watchOS-11-0": [
          {
            udid: "0FA4E000-0000-4000-8000-00000000D0D0",
            name: "fake-watch",
            state: "Booted",
          },
        ],
      },
    }),
  )
  const record = (name: string, body = "") =>
    writeFileSync(
      path.join(dir, name),
      `#!/bin/bash\nprintf '%s\\0' ${name} "$@" >> "$OTA_LAB_CALLS"\nprintf '\\n' >> "$OTA_LAB_CALLS"\n${body}exit 0\n`,
      { mode: 0o755 },
    )
  record(
    "adb",
    `[ "$1" = devices ] && printf 'List of devices attached\\n${adbList}\\n\\n'\n`,
  )
  record(
    "xcrun",
    `[ "$1 $2" = "simctl list" ] && cat "${dir}/simctl-list.json"\n`,
  )
  record("npx")
  record("sleep")
}

let runs = 0

/** Run one step of the lab and return every call it made, argv split. */
function lab(
  platform: Platform,
  step: string,
  { devices, target }: { devices: number; target?: string },
) {
  const dir = path.join(root, `run-${runs++}`)
  const bin = path.join(dir, "bin")
  const app = path.join(dir, "app")
  fakeBin(bin, devices)
  mkdirSync(path.join(app, "node_modules"), { recursive: true })
  symlinkSync(ADAPTV, path.join(app, "node_modules/adaptv"))
  writeFileSync(
    path.join(app, "adaptv.config.ts"),
    'export default { themeColor: { light: "#eeeeec", dark: "#0a0a0c" } }\n',
  )
  const calls = path.join(dir, "calls")
  writeFileSync(calls, "")
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    PATH: `${bin}:${process.env.PATH}`,
    OTA_LAB_CALLS: calls,
    ADAPTV_OTA_PLATFORM: platform,
  }
  delete env.ADAPTV_OTA_TARGET
  if (target) env.ADAPTV_OTA_TARGET = target
  const result = spawnSync(process.execPath, [TSX, SCRIPT, step], {
    cwd: app,
    env,
    encoding: "utf8",
  })
  return {
    status: result.status,
    output: `${result.stdout}${result.stderr}`,
    calls: readFileSync(calls, "utf8")
      .split("\n")
      .filter(Boolean)
      .map((line) => line.split("\0").filter(Boolean)),
  }
}

/** The calls that reach a device — everything but the listing itself. */
function deviceCalls(calls: string[][]): string[][] {
  return calls.filter(
    ([cmd, a, b]) =>
      cmd !== "sleep" &&
      !(cmd === "adb" && a === "devices") &&
      !(cmd === "xcrun" && a === "simctl" && b === "list"),
  )
}

/** Does this call name `id` as its device, in the way its tool spells it? */
function aimsAt(call: string[], id: string): boolean {
  const [cmd, ...args] = call
  if (cmd === "adb") return args[0] === "-s" && args[1] === id
  if (cmd === "xcrun") return args[0] === "simctl" && args[2] === id
  if (cmd === "npx" && args[1] === "preview") {
    const at = args.indexOf("--target")
    return at >= 0 && args[at + 1] === id && !args.includes("--latest")
  }
  return false
}

const PLATFORMS: [Platform, string[]][] = [
  ["android", EMULATORS],
  ["ios", SIMULATORS],
]

for (const [platform, ids] of PLATFORMS) {
  const [first, second] = ids as [string, string]

  describe(`ota-lab on ${platform}`, () => {
    for (const step of ["fresh", "relaunch"]) {
      test(`${step} with two devices aims every call at ADAPTV_OTA_TARGET`, () => {
        const run = lab(platform, step, { devices: 2, target: second })
        assert.equal(run.status, 0, run.output)
        const reached = deviceCalls(run.calls)
        assert.ok(reached.length > 0, "the step made no device call")
        const stray = reached.filter((call) => !aimsAt(call, second))
        assert.deepEqual(
          stray,
          [],
          `calls not aimed at ${second}:\n${run.output}`,
        )
      })

      test(`${step} with one device and no target aims at that one`, () => {
        const run = lab(platform, step, { devices: 1 })
        assert.equal(run.status, 0, run.output)
        const stray = deviceCalls(run.calls).filter(
          (call) => !aimsAt(call, first),
        )
        assert.deepEqual(stray, [], run.output)
      })

      test(`${step} with two devices and no target names both and touches neither`, () => {
        const run = lab(platform, step, { devices: 2 })
        assert.notEqual(run.status, 0, run.output)
        assert.match(run.output, /ADAPTV_OTA_TARGET/)
        assert.ok(run.output.includes(first), run.output)
        assert.ok(run.output.includes(second), run.output)
        assert.deepEqual(deviceCalls(run.calls), [])
      })
    }

    test("a target that is not running names what is", () => {
      const run = lab(platform, "relaunch", {
        devices: 2,
        target: "not-a-device",
      })
      assert.notEqual(run.status, 0, run.output)
      assert.ok(run.output.includes("not-a-device"), run.output)
      assert.ok(run.output.includes(first), run.output)
      assert.deepEqual(deviceCalls(run.calls), [])
    })
  })
}
