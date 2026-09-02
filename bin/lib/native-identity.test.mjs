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
import { afterEach, describe, expect, it } from "vitest"
import { ADAPTV_DIR } from "./adaptv-dir.mjs"
import { patchNativeIdentity } from "./native.mjs"

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
    ).toThrow(`could not write ${ADAPTV_DIR}/ios/${PLIST} (EISDIR)`)
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
