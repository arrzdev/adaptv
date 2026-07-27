import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { configErrors, iconWarnings, inspect } from "./preflight.mjs"

/** A config that passes — every check below starts from this and breaks one thing. */
const ok = {
  appId: "com.example.app",
  themeColor: { light: "#ffffff", dark: "#101010" },
}

let dir = null
afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true })
  dir = null
})

/** An app root with `public/favicons/<name>` written from `bytes`. */
function appWithIcon(name, bytes) {
  dir = mkdtempSync(path.join(tmpdir(), "adaptv-preflight-"))
  const icons = path.join(dir, "public/favicons")
  mkdirSync(icons, { recursive: true })
  if (name) writeFileSync(path.join(icons, name), bytes)
  return dir
}

/** A minimal PNG header: `width`×`width`, colour type 6 (RGBA) or 2 (RGB). */
function png(width, { alpha = true } = {}) {
  const buf = Buffer.alloc(64)
  Buffer.from("89504e470d0a1a0a", "hex").copy(buf, 0)
  buf.write("IHDR", 12)
  buf.writeUInt32BE(width, 16)
  buf.writeUInt32BE(width, 20)
  buf[24] = 8
  buf[25] = alpha ? 6 : 2
  return buf
}

describe("configErrors — a value adaptv cannot use stops the run", () => {
  it("passes a config that is fine, silently", () => {
    //The bar every check has to clear: a warning or error every project sees teaches devs
    //to ignore them.
    expect(configErrors(ok)).toEqual([])
    expect(
      configErrors({
        ...ok,
        backgroundColor: "#FFF",
        splashMaskMode: "system",
        icons: "./src/brand",
      }),
    ).toEqual([])
  })

  it("names the key, the shape and what was actually there", () => {
    //R7 — an error is terse and names the fix. These used to be SILENT: an unparseable
    //colour fell back to white and an unknown mode to `preferences`, so the app shipped
    //with a setting the dev wrote and adaptv ignored.
    const [color] = configErrors({
      ...ok,
      themeColor: { light: "midnightblue", dark: "#101010" },
    })
    expect(color).toBe(
      '`themeColor.light` must be a hex colour like #1b1b1b — got "midnightblue"',
    )
    const [mode] = configErrors({ ...ok, splashMaskMode: "auto" })
    expect(mode).toBe(
      '`splashMaskMode` must be preferences, system, light or dark — got "auto"',
    )
  })

  it("rejects an appId the native toolchains would reject four minutes later", () => {
    //It is the Android package AND the iOS bundle id. `myapp` and `com.4d.app` both
    //scaffold happily and then fail deep inside gradle.
    expect(configErrors({ ...ok, appId: "myapp" })[0]).toContain(
      "reverse-DNS",
    )
    expect(configErrors({ ...ok, appId: "com.4d.app" })).toHaveLength(1)
    expect(configErrors({ ...ok, appId: undefined })).toHaveLength(1)
    expect(configErrors({ ...ok, appId: "com.example.my_app_2" })).toEqual(
      [],
    )
  })

  it("reports every problem at once, not one per run", () => {
    const errors = configErrors({
      appId: "nope",
      themeColor: {},
      splashMaskDarkColor: "black",
    })
    expect(errors).toHaveLength(3)
  })
})

describe("iconWarnings — the art, read before the run touches anything", () => {
  it("warns per platform about the source, without a native project in sight", () => {
    //The whole reason this is separable from branding: nothing here has been scaffolded,
    //so the `!` can be printed under the banner instead of between two build steps (R33).
    return expect(
      iconWarnings(appWithIcon("icon.png", png(512)), ok, [
        "ios",
        "android",
      ]),
    ).resolves.toEqual([
      "ios launcher icon upscaled from 512px — add a 1024px icon",
    ])
  })

  it("says nothing about a set that is good", async () => {
    const root = appWithIcon("icon.png", png(1024))
    expect(await iconWarnings(root, ok, ["ios"])).toEqual([])
  })

  it("states a missing directory once per platform, for `flushNotices` to dedupe", async () => {
    //R21 — one app-level fact. The dedupe lives in the renderer so every command shares it.
    const root = appWithIcon(null)
    expect(await iconWarnings(root, ok, ["ios", "android"])).toEqual([
      "no icons in ./public/favicons — add one to brand the launcher icon",
      "no icons in ./public/favicons — add one to brand the launcher icon",
    ])
  })
})

describe("inspect — a broken config is the whole answer", () => {
  it("does not read the icon set for a run that is not going to happen", async () => {
    //Otherwise a config error arrives with `!` lines about art underneath it — advice
    //about a build the CLI is about to refuse (R6).
    const root = appWithIcon("icon.png", png(512))
    const { errors, warnings } = await inspect(
      root,
      { ...ok, appId: "myapp" },
      ["ios"],
    )
    expect(errors).toHaveLength(1)
    expect(warnings).toEqual([])
  })
})
