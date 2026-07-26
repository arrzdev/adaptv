import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { describe, expect, it } from "vitest"
import {
  brandLauncherIcon,
  iconFamily,
  iconIssue,
  MIN_SOURCE_PX,
  parseHex,
  pickIcon,
  readImageHeader,
  scanIcons,
} from "./icons.mjs"

/** A minimal but REAL png header — signature + IHDR, which is all the ranker reads. */
function pngHeader(width, height, { alpha = true } = {}) {
  const buf = Buffer.alloc(33)
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(
    buf,
    0,
  )
  buf.writeUInt32BE(13, 8)
  buf.write("IHDR", 12)
  buf.writeUInt32BE(width, 16)
  buf.writeUInt32BE(height, 20)
  buf[24] = 8 //bit depth
  buf[25] = alpha ? 6 : 2 //colour type: 6 = RGBA, 2 = RGB
  return buf
}

/**
 * A candidate as it reaches `iconIssue` — i.e. AFTER the pick has been decoded, so
 * `transparent` is whether the art uses transparency, not whether it declares a channel.
 */
const icon = (name, width, { transparent = true } = {}) => ({
  file: `/icons/${name}`,
  name,
  family: iconFamily(name),
  width,
  height: width,
  alpha: transparent,
  transparent,
})

/** The output of a real favicon generator — nothing above 512px, which is the normal case. */
const PWA_SET = [
  icon("android-chrome-192x192.png", 192),
  icon("android-chrome-512x512.png", 512),
  icon("android-maskable-512x512.png", 512),
  icon("apple-touch-icon.png", 180, { transparent: false }),
  icon("favicon-32x32.png", 32),
  icon("mstile-150x150.png", 150),
]

describe("iconFamily — which platform a file was drawn for", () => {
  it("reads the family out of the standard generator names", () => {
    expect(iconFamily("android-chrome-512x512.png")).toBe("android")
    expect(iconFamily("apple-touch-icon.png")).toBe("apple")
    expect(iconFamily("mstile-150x150.png")).toBe("ms")
    expect(iconFamily("favicon-32x32.png")).toBe("favicon")
  })

  it("calls a maskable icon maskable even though its name starts with android", () => {
    //It has to outrank plain `android-*` on Android and rank BELOW it on iOS, so the
    //prefix must not win: this art is safe-zoned, which is a different thing entirely.
    expect(iconFamily("android-maskable-512x512.png")).toBe("maskable")
  })

  it("treats an unrecognised name as a generic mark, not as unusable", () => {
    //The single-file case the whole feature has to keep working: one square logo.
    expect(iconFamily("logo.png")).toBe("generic")
    expect(iconFamily("icon.png")).toBe("generic")
    expect(iconFamily("my-brand-mark.webp")).toBe("generic")
  })
})

describe("pickIcon — the right art for the build being produced", () => {
  it("prefers apple art on iOS and maskable art on Android", () => {
    const set = [
      icon("apple-touch-icon-1024x1024.png", 1024, { transparent: false }),
      icon("android-chrome-1024x1024.png", 1024),
      icon("android-maskable-1024x1024.png", 1024),
    ]
    expect(pickIcon(set, "ios").name).toBe(
      "apple-touch-icon-1024x1024.png",
    )
    expect(pickIcon(set, "android").name).toBe(
      "android-maskable-1024x1024.png",
    )
  })

  it("ranks maskable art BELOW a square on iOS", () => {
    //iOS never masks an icon, so safe-zoned art ships a logo floating in dead space.
    const set = [
      icon("android-maskable-1024x1024.png", 1024),
      icon("android-chrome-1024x1024.png", 1024),
    ]
    expect(pickIcon(set, "ios").name).toBe("android-chrome-1024x1024.png")
  })

  it("takes the other platform's square over a badly undersized right-family icon", () => {
    //A 180px apple icon is the "correct" family for iOS and still the wrong answer:
    //upscaling it 5.7× is a worse defect than borrowing the android square.
    expect(pickIcon(PWA_SET, "ios").name).toBe(
      "android-chrome-512x512.png",
    )
  })

  it("still applies family order once every candidate clears the size bar", () => {
    const set = [
      icon("android-chrome-1024x1024.png", 1024),
      icon("apple-touch-icon-1024x1024.png", 1024, { transparent: false }),
    ]
    expect(pickIcon(set, "ios").name).toBe(
      "apple-touch-icon-1024x1024.png",
    )
  })

  it("falls back to the largest file when nothing is big enough", () => {
    const tiny = [
      icon("favicon-32x32.png", 32),
      icon("favicon-64x64.png", 64),
    ]
    expect(pickIcon(tiny, "ios").name).toBe("favicon-64x64.png")
  })

  it("returns null for an empty set rather than inventing a source", () => {
    expect(pickIcon([], "ios")).toBeNull()
  })

  it("is deterministic when family and size both tie", () => {
    //Two runs of the same build must brand the same icon; ties break on name.
    const set = [icon("icon-b.png", 1024), icon("icon-a.png", 1024)]
    expect(pickIcon(set, "ios").name).toBe("icon-a.png")
  })
})

describe("iconIssue — the one thing the dev may need to act on", () => {
  it("says nothing about a big transparent square, which is the ideal source", () => {
    //The lone `icon.png` case. A warning every project sees is noise, not information.
    expect(iconIssue(icon("icon.png", 1024), "ios")).toBeNull()
    expect(iconIssue(icon("icon.png", 1024), "android")).toBeNull()
  })

  it("names the platform, the source size and the size to add when upscaling", () => {
    const warning = iconIssue(
      icon("android-chrome-512x512.png", 512),
      "ios",
    )
    expect(warning).toBe(
      "ios launcher icon upscaled from 512px — add a 1024px icon",
    )
  })

  it("holds Android to 432px, not to iOS's 1024", () => {
    //Different slots, different bars — a 512px source is genuinely fine on Android, and
    //warning about it would print a problem the dev cannot usefully act on.
    expect(
      iconIssue(icon("android-chrome-512x512.png", 512), "android"),
    ).toBeNull()
    expect(
      iconIssue(icon("android-chrome-192x192.png", 192), "android"),
    ).toBe("android launcher icon upscaled from 192px — add a 432px icon")
  })

  it("warns about an opaque source on Android, where the foreground must be transparent", () => {
    const warning = iconIssue(
      icon("logo.jpg", 1024, { transparent: false }),
      "android",
    )
    expect(warning).toContain("is opaque")
  })

  it("goes by whether the art USES transparency, not whether it declares a channel", () => {
    //`android-chrome-512.png` out of a favicon generator is RGBA with every pixel opaque.
    //Trusting the header branded the adaptive foreground as a white box AND stayed silent.
    const declaresChannelButIsSolid = {
      ...icon("android-chrome-512x512.png", 512),
      alpha: true,
      transparent: false,
    }
    expect(iconIssue(declaresChannelButIsSolid, "android")).toContain(
      "is opaque",
    )
  })

  it("does NOT warn about an opaque source on iOS", () => {
    //App Store icons must not have an alpha channel; `writeIosIcon` flattens either way.
    expect(
      iconIssue(icon("logo.jpg", 1024, { transparent: false }), "ios"),
    ).toBeNull()
  })

  it("reports the size before the alpha when a source fails both", () => {
    //One line, one fix. Resolution is the fix that also tends to bring the right art.
    const warning = iconIssue(
      icon("logo.jpg", 96, { transparent: false }),
      "android",
    )
    expect(warning).toContain("upscaled from 96px")
  })

  it("keeps every message short enough for a narrow terminal", () => {
    //R10/R15: `log.warn` must not truncate a line whose whole value is the instruction
    //in it, so the text itself has to fit without wrapping.
    for (const platform of ["ios", "android"]) {
      const small = iconIssue(icon("favicon-32x32.png", 32), platform)
      expect(small.length).toBeLessThanOrEqual(72)
    }
  })
})

describe("readImageHeader — measured pixels, not parsed filenames", () => {
  it("reads a PNG's real size and alpha channel", () => {
    expect(readImageHeader(pngHeader(512, 512))).toEqual({
      width: 512,
      height: 512,
      alpha: true,
    })
    expect(
      readImageHeader(pngHeader(64, 64, { alpha: false })).alpha,
    ).toBe(false)
  })

  //Encoded by sharp rather than hand-assembled: the parser's whole job is to agree with
  //real encoder output (JPEG's segment chain and WebP's three header chunks are exactly
  //where a hand-written fixture would quietly diverge from the files a dev actually has).
  it.each([
    ["jpeg", { alpha: false }],
    ["webp", { alpha: true }],
    ["png", { alpha: true }],
  ])("agrees with a real %s encoder", async (format, expected) => {
    const { default: sharp } = await import("sharp")
    const buf = await sharp({
      create: {
        width: 400,
        height: 300,
        channels: 4,
        background: { r: 10, g: 20, b: 30, alpha: 0.5 },
      },
    })
      .toFormat(format)
      .toBuffer()
    expect(readImageHeader(buf)).toEqual({
      width: 400,
      height: 300,
      alpha: expected.alpha,
    })
  })

  it("returns null for bytes that aren't an image it knows", () => {
    expect(readImageHeader(Buffer.alloc(64))).toBeNull()
    expect(
      readImageHeader(Buffer.from("<svg xmlns='x'></svg>")),
    ).toBeNull()
  })
})

describe("scanIcons", () => {
  it("measures each icon and skips files that aren't usable art", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "adaptv-icons-"))
    writeFileSync(
      path.join(dir, "android-chrome-512x512.png"),
      pngHeader(512, 512),
    )
    //A name that LIES about its size — the ranker must go by the bytes.
    writeFileSync(
      path.join(dir, "apple-touch-icon-1024.png"),
      pngHeader(180, 180),
    )
    //SVG is excluded on purpose: `safari-pinned-tab.svg` is a flat silhouette and
    //nothing in the name separates it from a real logo.
    writeFileSync(path.join(dir, "safari-pinned-tab.svg"), "<svg/>")
    writeFileSync(path.join(dir, "site.webmanifest"), "{}")

    const found = scanIcons(dir)
    expect(found.map((f) => f.name)).toEqual([
      "android-chrome-512x512.png",
      "apple-touch-icon-1024.png",
    ])
    expect(found.find((f) => f.name.startsWith("apple")).width).toBe(180)
  })

  it("treats a missing directory as an empty set, never as a crash", () => {
    //The dev configured an `icons` path that isn't there yet — that is a warning, and
    //a warning is not a reason to fail their build.
    expect(scanIcons("/definitely/not/a/real/icons/dir")).toEqual([])
  })
})

describe("parseHex", () => {
  it("accepts both shorthand and full hex, with or without the hash", () => {
    expect(parseHex("#fff")).toEqual({ r: 255, g: 255, b: 255, alpha: 1 })
    expect(parseHex("1a2b3c")).toEqual({ r: 26, g: 43, b: 60, alpha: 1 })
  })

  it("falls back to white rather than throwing on a colour it can't read", () => {
    //A malformed theme colour must cost a wrong icon background, not a failed build.
    expect(parseHex("rebeccapurple")).toEqual({
      r: 255,
      g: 255,
      b: 255,
      alpha: 1,
    })
    expect(parseHex(undefined)).toEqual({
      r: 255,
      g: 255,
      b: 255,
      alpha: 1,
    })
  })
})

describe("MIN_SOURCE_PX", () => {
  it("matches the largest slot each platform actually fills", () => {
    //iOS has exactly one 1024px App Store slot; Android's biggest is the xxxhdpi
    //adaptive foreground at 432px. These bars are what the warning means.
    expect(MIN_SOURCE_PX).toEqual({ ios: 1024, android: 432 })
  })
})

/* =============================================================================
 * generation — the half that ships silently wrong
 * ============================================================================= */

const IOS_ICON =
  "App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png"
const RES = "app/src/main/res"

/** An app root with a real icon set on disk, plus scaffolded native project dirs. */
async function fixture(sources) {
  const { default: sharp } = await import("sharp")
  const appRoot = mkdtempSync(path.join(tmpdir(), "adaptv-icons-e2e-"))
  const icons = path.join(appRoot, "public/favicons")
  mkdirSync(icons, { recursive: true })
  for (const [name, size, opaque] of sources) {
    let img = sharp({
      create: {
        width: size,
        height: size,
        channels: 4,
        background: { r: 220, g: 50, b: 60, alpha: opaque ? 1 : 0.6 },
      },
    })
    if (opaque)
      img = img
        .flatten({ background: { r: 255, g: 255, b: 255 } })
        .removeAlpha()
    await img
      .toFormat(path.extname(name) === ".jpg" ? "jpeg" : "png")
      .toFile(path.join(icons, name))
  }
  const nativeRoot = (platform) => path.join(appRoot, ".adaptv", platform)
  for (const p of ["ios", "android"])
    mkdirSync(nativeRoot(p), { recursive: true })

  const brand = (platform) =>
    brandLauncherIcon(nativeRoot(platform), platform, {
      appRoot,
      iconsDir: "./public/favicons",
      background: "#ffffff",
      backgroundDark: "#101014",
    })
  return { appRoot, nativeRoot, brand, sharp }
}

describe("brandLauncherIcon — iOS", () => {
  it("writes the one 1024px slot the scaffolded asset catalog declares", async () => {
    const { nativeRoot, brand, sharp } = await fixture([
      ["icon.png", 1024, false],
    ])
    await brand("ios")
    const meta = await sharp(
      path.join(nativeRoot("ios"), IOS_ICON),
    ).metadata()
    expect([meta.width, meta.height]).toEqual([1024, 1024])
  })

  it("ships the icon with NO alpha channel", async () => {
    //App Store Connect rejects an icon that merely HAS one — after the archive, not
    //before it. `flatten` alone composites the transparency away but leaves the channel.
    const { nativeRoot, brand, sharp } = await fixture([
      ["icon.png", 1024, false],
    ])
    await brand("ios")
    const meta = await sharp(
      path.join(nativeRoot("ios"), IOS_ICON),
    ).metadata()
    expect(meta.hasAlpha).toBe(false)
    expect(meta.channels).toBe(3)
  })
})

describe("brandLauncherIcon — Android", () => {
  it("writes every mipmap bucket at its density's size", async () => {
    const { nativeRoot, brand, sharp } = await fixture([
      ["icon.png", 1024, false],
    ])
    await brand("android")
    const res = path.join(nativeRoot("android"), RES)
    for (const [density, legacy, foreground] of [
      ["mdpi", 48, 108],
      ["hdpi", 72, 162],
      ["xhdpi", 96, 216],
      ["xxhdpi", 144, 324],
      ["xxxhdpi", 192, 432],
    ]) {
      const at = (f) =>
        sharp(path.join(res, `mipmap-${density}`, f)).metadata()
      expect((await at("ic_launcher.png")).width).toBe(legacy)
      expect((await at("ic_launcher_round.png")).width).toBe(legacy)
      expect((await at("ic_launcher_foreground.png")).width).toBe(
        foreground,
      )
    }
  })

  it("keeps the adaptive foreground transparent and the legacy square opaque", async () => {
    //The launcher composites the foreground OVER the background colour and then masks the
    //pair; an opaque foreground defeats both. The legacy square is never masked.
    const { nativeRoot, brand, sharp } = await fixture([
      ["icon.png", 1024, false],
    ])
    await brand("android")
    const at = (f) =>
      sharp(
        path.join(nativeRoot("android"), RES, "mipmap-xxxhdpi", f),
      ).metadata()
    expect((await at("ic_launcher_foreground.png")).hasAlpha).toBe(true)
    expect((await at("ic_launcher_round.png")).hasAlpha).toBe(true)
    expect((await at("ic_launcher.png")).hasAlpha).toBe(false)
  })

  it("writes the adaptive background colour for both appearances", async () => {
    const { nativeRoot, brand } = await fixture([
      ["icon.png", 1024, false],
    ])
    await brand("android")
    const colour = (dir) =>
      readFileSync(
        path.join(
          nativeRoot("android"),
          RES,
          dir,
          "ic_launcher_background.xml",
        ),
        "utf8",
      )
    expect(colour("values")).toContain("#ffffff")
    expect(colour("values-night")).toContain("#101014")
  })

  it("insets a plain mark into the safe zone but leaves maskable art alone", async () => {
    //Only the centre 72 of an adaptive foreground's 108dp survives the launcher mask, so a
    //plain mark has to be scaled into it — but `maskable` art is DRAWN to that spec, and
    //insetting it a second time leaves the logo a speck. Measure the art, not the canvas.
    const spread = async (name) => {
      const { nativeRoot, brand, sharp } = await fixture([
        [name, 1024, false],
      ])
      await brand("android")
      const { info } = await sharp(
        path.join(
          nativeRoot("android"),
          RES,
          "mipmap-xxxhdpi/ic_launcher_foreground.png",
        ),
      )
        .trim()
        .toBuffer({ resolveWithObject: true })
      return info.width
    }
    //432 × 72/108 = 288
    expect(await spread("android-chrome-1024x1024.png")).toBe(288)
    expect(await spread("android-maskable-1024x1024.png")).toBe(432)
  })

  it("warns about a source that declares alpha but is a solid square", async () => {
    //The real regression: a favicon generator's `android-chrome-512.png` is RGBA with every
    //pixel opaque. Reading the header alone branded the adaptive foreground as a white box
    //floating in the safe zone, and printed nothing — the one case the warning is FOR.
    const { brand, sharp, appRoot } = await fixture([])
    const icons = path.join(appRoot, "public/favicons")
    mkdirSync(icons, { recursive: true })
    await sharp({
      create: {
        width: 512,
        height: 512,
        channels: 4, //declares an alpha channel…
        background: { r: 255, g: 255, b: 255, alpha: 1 }, //…and never uses it
      },
    })
      .png()
      .toFile(path.join(icons, "android-chrome-512x512.png"))

    expect((await brand("android")).warning).toBe(
      "android launcher icon is opaque — add one with a transparent background",
    )
  })
})

describe("brandLauncherIcon — when there is nothing to work with", () => {
  it("warns and writes nothing when the icons dir is missing", async () => {
    const { nativeRoot, brand } = await fixture([])
    const { warning } = await brand("ios")
    expect(warning).toBe(
      "no icons in ./public/favicons — add one to brand the launcher icon",
    )
    expect(existsSync(path.join(nativeRoot("ios"), IOS_ICON))).toBe(false)
  })

  it("names the icons dir the app configured, not adaptv's default", async () => {
    const appRoot = mkdtempSync(path.join(tmpdir(), "adaptv-icons-cfg-"))
    const { warning } = await brandLauncherIcon(appRoot, "android", {
      appRoot,
      iconsDir: "./src/brand",
      background: "#ffffff",
      backgroundDark: "#000000",
    })
    expect(warning).toContain("./src/brand")
  })
})
