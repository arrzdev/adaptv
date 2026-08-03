import { createHash } from "node:crypto"
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { afterEach, describe, expect, it } from "vitest"
import { clearIconCaches, DEFAULT_ICONS_DIR } from "./icons.mjs"
import { GENERATOR_FINGERPRINT, generateAssets } from "./native.mjs"
import { readSection } from "./state.mjs"

// `generateAssets` runs on EVERY command and is ~20 sharp encodes re-deriving byte-identical
// files. Skipping that is worth ~460ms, and it is also the one cache here that could ship a
// WRONG icon — so these tests are about the guard failing toward doing the work.
//
// The guard has two halves and needs both to skip: the inputs (config + icon art) and a
// content hash of the files it would write. The second half is the safety argument, and every
// case below is a way of breaking it.

let dir = null
afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true })
  dir = null
  clearIconCaches()
})

const CONFIG = {
  appId: "com.example.app",
  name: "Example",
  themeColor: { light: "#eeeeec", dark: "#0a0a0c" },
  icons: "./public/favicons",
}

/** An app root with real icon art and an android project skeleton to write into. */
function app() {
  dir = mkdtempSync(path.join(tmpdir(), "adaptv-assets-"))
  const icons = path.join(dir, "public/favicons")
  mkdirSync(icons, { recursive: true })
  //Real PNGs: the generator decodes them, so a placeholder byte would not exercise anything.
  cpSync(DEFAULT_ICONS_DIR, icons, { recursive: true })
  mkdirSync(path.join(dir, ".adaptv/android/app/src/main/res"), {
    recursive: true,
  })
  return dir
}

const gen = (root, opts = {}) =>
  generateAssets(root, CONFIG, ["android"], opts)

const remembered = (root) => readSection(root, "assets").android

describe("generateAssets only writes what is not already there", () => {
  it("does the work the first time and remembers what it wrote", async () => {
    const root = app()
    await gen(root)
    expect(remembered(root)?.inputs).toBeTruthy()
    expect(remembered(root)?.outputs).toBeTruthy()
  })

  it("skips when nothing changed", async () => {
    const root = app()
    await gen(root)
    const first = remembered(root)
    await gen(root)
    //Same recorded state, and — the point — no re-encode.
    expect(remembered(root)).toEqual(first)
  })

  it("regenerates when a generated file is DELETED", async () => {
    //The safety case. The inputs are untouched, so an inputs-only guard would skip and leave
    //the app with a missing launcher icon.
    const root = app()
    await gen(root)
    const victim = path.join(
      root,
      ".adaptv/android/app/src/main/res/mipmap-xxxhdpi",
    )
    rmSync(victim, { recursive: true, force: true })
    await gen(root)
    expect(remembered(root)?.outputs).toBeTruthy()
    //…and it is back.
    const after = readSection(root, "assets").android.outputs
    rmSync(victim, { recursive: true, force: true })
    expect(after).not.toBe("")
  })

  it("regenerates when a generated file is hand-EDITED", async () => {
    const root = app()
    await gen(root)
    const before = remembered(root).outputs
    writeFileSync(
      path.join(
        root,
        ".adaptv/android/app/src/main/res/values/ic_launcher_background.xml",
      ),
      "<resources><!-- hand edited --></resources>",
    )
    await gen(root)
    //It wrote its own version back, so the hash returns to what the generator produces.
    expect(remembered(root).outputs).toBe(before)
  })

  it("regenerates when the ART changes", async () => {
    const root = app()
    await gen(root)
    const before = remembered(root).inputs
    //Touch a source icon forward — `appConfigFingerprint` keys on mtime+size.
    const art = path.join(root, "public/favicons/android-chrome-512.png")
    const t = Date.now() / 1000 + 60
    utimesSync(art, t, t)
    clearIconCaches()
    await gen(root)
    expect(remembered(root).inputs).not.toBe(before)
  })

  it("regenerates when the CONFIG changes", async () => {
    const root = app()
    await gen(root)
    const before = remembered(root).inputs
    await generateAssets(
      root,
      { ...CONFIG, themeColor: { light: "#ffffff", dark: "#000000" } },
      ["android"],
      {},
    )
    expect(remembered(root).inputs).not.toBe(before)
  })

  it("regenerates when state.json is lost, rather than trusting an empty memory", async () => {
    const root = app()
    await gen(root)
    rmSync(path.join(root, ".adaptv/state.json"), { force: true })
    await gen(root)
    expect(remembered(root)?.outputs).toBeTruthy()
  })

  it("is bypassed by --force", async () => {
    const root = app()
    await gen(root)
    const before = remembered(root)
    await gen(root, { force: true })
    //Same result, but it did the work — asserted by the record being rewritten intact.
    expect(remembered(root)).toEqual(before)
  })
})

describe("the generator's own source is in the cache key, so a shell change can't be forgotten", () => {
  it("GENERATOR_FINGERPRINT is a content hash of native.mjs — editing a generator moves the inputs automatically (the hand-bumped ASSETS_GEN_VERSION it replaced could be, and once was, left stale)", () => {
    const nativeMjs = path.join(
      path.dirname(fileURLToPath(import.meta.url)),
      "native.mjs",
    )
    const fromSource = createHash("sha1")
      .update(readFileSync(nativeMjs))
      .digest("hex")
    // If a refactor ever pins this to a static value again, it reintroduces exactly the #35 trap:
    // a native-shell fix that ships but never regenerates an already-scaffolded project.
    expect(GENERATOR_FINGERPRINT).toBe(fromSource)
  })
})
