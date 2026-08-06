import { spawnSync } from "node:child_process"
import {
  chmodSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { withBackgroundSimulator } from "./native.mjs"

// `cap run ios` reaches the Simulator through native-run, which runs, verbatim:
//   open <Xcode>/Applications/Simulator.app --args -CurrentDeviceUDID <udid>
// A bare `open` ACTIVATES — the reason every rebuild used to yank the screen away from the
// dev mid-keystroke. adaptv can't pass a flag into a dependency's argv, so it puts its own
// `open` at the front of that subprocess's PATH. These tests are about the two things that
// makes or breaks: the shim has to actually run (exec bit), and it has to add `-g` to the
// Simulator call and NOTHING else.

const dirs = []
afterEach(() => {
  for (const d of dirs.splice(0))
    rmSync(d, { recursive: true, force: true })
})

/** The shim adaptv would hand `cap run ios`, as an absolute path. */
function shim() {
  const { PATH } = withBackgroundSimulator({ PATH: "/usr/bin:/bin" })
  return path.join(PATH.split(path.delimiter)[0], "open")
}

/**
 * The shipped shim, with only the real binary swapped for one that echoes its argv — the
 * routing under test is the shipped text, and `/usr/bin/open` can't be observed from a test
 * without opening something.
 */
function traced() {
  const dir = mkdtempSync(path.join(tmpdir(), "adaptv-shim-"))
  dirs.push(dir)
  const stub = path.join(dir, "stub")
  writeFileSync(stub, '#!/bin/sh\necho "$@"\n')
  chmodSync(stub, 0o755)
  const file = path.join(dir, "open")
  writeFileSync(
    file,
    readFileSync(shim(), "utf8").replaceAll("/usr/bin/open", stub),
  )
  chmodSync(file, 0o755)
  return (...args) =>
    spawnSync(file, args, { encoding: "utf8" }).stdout.trim()
}

//The shim re-execs /usr/bin/open, and iOS builds are macOS-only anyway.
const onMac = process.platform === "darwin"

describe.runIf(onMac)("the Simulator open shim", () => {
  it("goes first on PATH, so native-run's `open` resolves to it", () => {
    const env = withBackgroundSimulator({ PATH: "/usr/bin:/bin" })
    expect(env.PATH.endsWith(":/usr/bin:/bin")).toBe(true)
    expect(env.PATH.split(path.delimiter)[0]).not.toBe("/usr/bin")
  })

  it("is executable — a shim that can't run is a Simulator that jumps the screen", () => {
    expect(statSync(shim()).mode & 0o111).toBeTruthy()
  })

  it("backgrounds native-run's launch, argv otherwise intact", () => {
    const run = traced()
    expect(
      run(
        "/Applications/Xcode.app/Contents/Developer/Applications/Simulator.app",
        "--args",
        "-CurrentDeviceUDID",
        "27DF56D5",
      ),
    ).toBe(
      "-g /Applications/Xcode.app/Contents/Developer/Applications/Simulator.app --args -CurrentDeviceUDID 27DF56D5",
    )
  })

  it("backgrounds the `-a Simulator` form adaptv uses on the cached path", () => {
    expect(traced()("-a", "Simulator")).toBe("-g -a Simulator")
  })

  it("passes every other `open` through untouched", () => {
    const run = traced()
    expect(run("-a", "Safari", "https://example.com")).toBe(
      "-a Safari https://example.com",
    )
    expect(run("./report.pdf")).toBe("./report.pdf")
  })

  it("leaves the dev's own PATH alone when it can't write the shim", () => {
    // No shim is an annoyance; a build that dies because of one is not acceptable.
    const tmp = process.env.TMPDIR
    process.env.TMPDIR = "/dev/null/nowhere"
    try {
      expect(withBackgroundSimulator({ PATH: "/usr/bin" }).PATH).toBe(
        "/usr/bin",
      )
    } finally {
      process.env.TMPDIR = tmp
    }
  })
})
