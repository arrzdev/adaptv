import { mkdirSync, mkdtempSync, readdirSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it, vi } from "vitest"
import { brandLauncherIcon, resolveLauncherSource } from "./icons.mjs"

// The platform with no prebuilt image binary: importing it throws. A file of its own, because
// the module mock replaces the image library for every test in the file.
vi.mock("sharp", () => {
  throw new Error(
    "Could not load the sharp module using the darwin-arm64 runtime",
  )
})

const roots = []
afterEach(() => {
  for (const dir of roots.splice(0))
    rmSync(dir, { recursive: true, force: true })
})

const SET = {
  source: "app",
  icons: [
    {
      file: "/app/public/favicons/icon.png",
      name: "icon.png",
      family: "generic",
      width: 1024,
      height: 1024,
      alpha: true,
    },
  ],
}

describe("launcher icons when the image library cannot load", () => {
  it("is one warning about the icon, not a crash and not advice about adaptv's plumbing", async () => {
    //The dev can act on "the icon was not branded"; "install sharp" is about adaptv's own
    //dependency, and a stack trace before anything prints is worse than either.
    const { pick, warning } = await resolveLauncherSource(SET, "ios")
    expect(pick).toBeNull()
    expect(warning).toBe(
      "could not brand the launcher icon on this platform",
    )
    expect(warning).not.toMatch(/sharp/i)
  })

  it("writes nothing into the native project and hands the same warning back", async () => {
    const nativeRoot = mkdtempSync(path.join(tmpdir(), "adaptv-nosharp-"))
    roots.push(nativeRoot)
    mkdirSync(path.join(nativeRoot, "app"), { recursive: true })

    const result = await brandLauncherIcon(nativeRoot, "android", {
      set: SET,
      background: "#ffffff",
    })
    expect(result).toEqual({
      warning: "could not brand the launcher icon on this platform",
    })
    expect(readdirSync(path.join(nativeRoot, "app"))).toEqual([])
  })
})
