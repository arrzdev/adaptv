// @vitest-environment node
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it, vi } from "vitest"
import { ADAPTV_DIR } from "./adaptv-dir.mjs"
import { explainFailure } from "./explain.mjs"
import { patchNativeIdentity } from "./native.mjs"
import { runLine } from "./render.mjs"

/**
 * `patchNativeIdentity` rewrites the bundle id and display name into the native project
 * on every prepare. It did that best-effort — every failure swallowed — which is the wrong
 * tolerance for a value that decides which app a build installs as: a plist adaptv could
 * not write left the project on the previous identity, and the build went on. The line
 * it draws now: a file that is not there is left alone, and anything else is a failure
 * with the file's name on it.
 */

const dirs = []
afterEach(() => {
  for (const dir of dirs.splice(0))
    rmSync(dir, { recursive: true, force: true })
})

function appRoot() {
  const dir = mkdtempSync(path.join(tmpdir(), "adaptv-identity-"))
  dirs.push(dir)
  return dir
}

/**
 * The ✖ row a failed prepare settles on: the step run through `runLine` with the platform's
 * explainer, the way `preparePlatforms` runs it, colour stripped, from both streams.
 */
async function renderedFailure(root, step) {
  const lines = []
  const take = (s) => {
    lines.push(...String(s).replace(SGR, "").split("\n"))
    return true
  }
  const spies = [
    vi.spyOn(process.stdout, "write").mockImplementation(take),
    vi.spyOn(process.stderr, "write").mockImplementation(take),
  ]
  try {
    await runLine("ios", async () => step(), {
      explain: explainFailure("ios", root),
    }).catch(() => {})
  } finally {
    for (const s of spies) s.mockRestore()
  }
  return { row: lines.find((l) => l.includes("✖")) ?? "" }
}

//Built rather than written as a literal: a raw ESC inside a regex trips
//lint/suspicious/noControlCharactersInRegex.
const SGR = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, "g")

const CONFIG = { appId: "dev.example.app", appName: "Example" }
const PLIST = "App/App/Info.plist"
const plist = (root) => path.join(root, ADAPTV_DIR, "ios", PLIST)

describe("patchNativeIdentity — what a failure to patch means", () => {
  it("a project file that is not there is left alone", () => {
    const root = appRoot()
    mkdirSync(path.join(root, ADAPTV_DIR, "ios/App/App"), {
      recursive: true,
    })
    expect(() =>
      patchNativeIdentity(root, CONFIG, "ios", { dev: true }),
    ).not.toThrow()
    //and nothing is invented in its place
    expect(existsSync(plist(root))).toBe(false)
  })

  it("a project file that cannot be read is a failure, named relative to the app", () => {
    const root = appRoot()
    //a directory where the plist should be: readable as a path, not as a file
    mkdirSync(plist(root), { recursive: true })
    expect(() =>
      patchNativeIdentity(root, CONFIG, "ios", { dev: true }),
    ).toThrow(`could not read ${ADAPTV_DIR}/ios/${PLIST} (EISDIR)`)
  })

  it("a project file adaptv may not read says READ, on the row the dev sees", async () => {
    //root reads through a cleared mode, so under it this proves nothing
    if (process.getuid?.() === 0) return
    const root = appRoot()
    mkdirSync(path.dirname(plist(root)), { recursive: true })
    writeFileSync(
      plist(root),
      "<key>CFBundleDisplayName</key>\n<string>Old</string>\n",
    )
    chmodSync(plist(root), 0o000)
    try {
      const { row } = await renderedFailure(root, () =>
        patchNativeIdentity(root, CONFIG, "ios", { dev: true }),
      )
      expect(row).toMatch(
        new RegExp(
          `✖ ios {2}could not read ${ADAPTV_DIR}/ios/${PLIST} \\(EACCES\\) · \\d+ms$`,
        ),
      )
    } finally {
      chmodSync(plist(root), 0o644)
    }
  })

  it("a project file that cannot be written is a failure too", () => {
    //root writes through a read-only bit, so under it this proves nothing
    if (process.getuid?.() === 0) return
    const root = appRoot()
    mkdirSync(path.dirname(plist(root)), { recursive: true })
    writeFileSync(
      plist(root),
      "<key>CFBundleDisplayName</key>\n<string>Old</string>\n",
    )
    chmodSync(plist(root), 0o444)
    try {
      expect(() =>
        patchNativeIdentity(root, CONFIG, "ios", { dev: true }),
      ).toThrow(`could not write ${ADAPTV_DIR}/ios/${PLIST} (EACCES)`)
      expect(readFileSync(plist(root), "utf8")).toContain("<string>Old<")
    } finally {
      chmodSync(plist(root), 0o644)
    }
  })

  it("a file that already carries the identity is not rewritten", () => {
    //the write is skipped when nothing changes, so a read-only file that is already
    //right is not a failure — the same guard that keeps Xcode's watcher quiet
    if (process.getuid?.() === 0) return
    const root = appRoot()
    mkdirSync(path.dirname(plist(root)), { recursive: true })
    writeFileSync(
      plist(root),
      "<key>CFBundleDisplayName</key>\n<string>Example (dev)</string>\n",
    )
    chmodSync(plist(root), 0o444)
    try {
      expect(() =>
        patchNativeIdentity(root, CONFIG, "ios", { dev: true }),
      ).not.toThrow()
    } finally {
      chmodSync(plist(root), 0o644)
    }
  })
})
