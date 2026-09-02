import { existsSync, mkdirSync, mkdtempSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { describe, expect, it } from "vitest"
// The scan itself lives in `src/vite/icon-set.ts` — the manifest and the head need the same
// answer, so there is one implementation of it and these tests exercise the native half only.
import { iconFamily, resolveIconSet } from "#adaptv/vite/icon-set"
import {
  brandLauncherIcon,
  iconIssue,
  MIN_SOURCE_PX,
  parseHex,
  pickIcon,
  resolveLauncherSource,
} from "./icons.mjs"

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
      "ios launcher icon upscaled from 512px. Add a 1024px icon",
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
    ).toBe("android launcher icon upscaled from 192px. Add a 432px icon")
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
  it("matches the largest size each slot actually fills", () => {
    //iOS has exactly one 1024px App Store slot; Android's biggest adaptive foreground is
    //xxxhdpi at 432px and its biggest legacy mipmap is 192px. These bars are what the
    //warning means — and only `ios`/`android` are ever warned about (one fix, one sentence).
    expect(MIN_SOURCE_PX).toEqual({
      ios: 1024,
      android: 432,
      androidLegacy: 192,
    })
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

  // The set is resolved with NO default icons on purpose: these tests are about what adaptv
  // does with the APP's art, and a framework fallback would quietly stand in for a missing set.
  const brand = (platform) =>
    brandLauncherIcon(nativeRoot(platform), platform, {
      set: resolveIconSet(appRoot, { icons: "./public/favicons" }, []),
      background: "#ffffff",
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

  it("declares a monochrome layer, and writes one at every density", async () => {
    //Capacitor's template ships two layers and no <monochrome>, which on Android 13+ means the
    //app opts out of themed icons and sits in full colour on a themed home screen. Same shape
    //of defect as an iOS icon with no dark variant, and invisible until someone looks.
    const { nativeRoot, brand, sharp } = await fixture([
      ["icon.png", 1024, false],
    ])
    await brand("android")
    const res = path.join(nativeRoot("android"), RES)
    for (const name of ["ic_launcher.xml", "ic_launcher_round.xml"]) {
      const xml = readFileSync(
        path.join(res, "mipmap-anydpi-v26", name),
        "utf8",
      )
      expect(xml).toContain(
        '<monochrome android:drawable="@mipmap/ic_launcher_monochrome"/>',
      )
      expect(xml).toContain(
        '<foreground android:drawable="@mipmap/ic_launcher_foreground"/>',
      )
    }
    for (const [density, px] of [
      ["mdpi", 108],
      ["xxxhdpi", 432],
    ]) {
      const meta = await sharp(
        path.join(res, `mipmap-${density}`, "ic_launcher_monochrome.png"),
      ).metadata()
      expect(meta.width).toBe(px)
      //It is a LAYER: the launcher supplies the ink and the background, so it must carry alpha.
      expect(meta.hasAlpha).toBe(true)
    }
  })

  it("derives the monochrome layer for a set that has no authored one", async () => {
    //A hand-dropped favicon set never ran `gen icons`, so it has no `icon-monochrome.png` —
    //and it is exactly the app that would otherwise ship no themed icon at all.
    const { nativeRoot, brand, sharp } = await fixture([
      ["android-chrome-512x512.png", 512, false],
    ])
    await brand("android")
    const alphaMax = async (f) =>
      (
        await sharp(
          path.join(nativeRoot("android"), RES, "mipmap-xxxhdpi", f),
        ).stats()
      ).channels[3].max
    //This fixture is one flat colour, so there is no internal contrast to ramp and the layer
    //should come out inked exactly as far as the foreground is — which is also the check that
    //something was derived at all, rather than an empty layer being written.
    expect(await alphaMax("ic_launcher_monochrome.png")).toBe(
      await alphaMax("ic_launcher_foreground.png"),
    )
    expect(await alphaMax("ic_launcher_monochrome.png")).toBeGreaterThan(0)
  })

  it("gives both appearances the SAME tile colour, so it can't follow the device theme", async () => {
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
    //A launcher icon is not part of the app's UI — it sits on a home screen next to thirty
    //others, none of which restyle themselves when the system flips to dark. `values-night`
    //used to resolve to the app's dark THEME colour, which under a dark-outlined mark on a
    //dark home screen read as no tile at all ("em android o icon fica sem fundo").
    expect(colour("values")).toContain("#ffffff")
    expect(colour("values-night")).toContain("#ffffff")
  })

  it("keeps writing values-night, so an older run's dark tile cannot outlive it", async () => {
    //Deleting the divergence is not enough: the file is already on disk in every project
    //branded before this, and a resource adaptv stops writing is a resource that keeps
    //applying.
    const { nativeRoot, brand } = await fixture([
      ["icon.png", 1024, false],
    ])
    await brand("android")
    expect(
      existsSync(
        path.join(
          nativeRoot("android"),
          RES,
          "values-night/ic_launcher_background.xml",
        ),
      ),
    ).toBe(true)
  })

  it("fits a MARK into the ring, leaves maskable art and solid tiles alone", async () => {
    //Three cases, one rule. Only the centre 72 of an adaptive foreground's 108dp survives the
    //mask, so a mark is measured into it; `maskable` art is DRAWN to that spec and insetting
    //it twice leaves the logo a speck; and a source with no isolable mark at all is a finished
    //picture, so the mask crops it rather than adaptv shrinking something it can't read.
    const spread = async (name, art = "solid") => {
      const { appRoot, nativeRoot, brand, sharp } = await fixture([])
      const icons = path.join(appRoot, "public/favicons")
      mkdirSync(icons, { recursive: true })
      await sharp(
        Buffer.from(
          art === "mark"
            ? `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024"><circle cx="512" cy="512" r="512" fill="#dc323c"/></svg>`
            : `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024"><rect width="1024" height="1024" fill="#dc323c"/></svg>`,
        ),
      )
        .png()
        .toFile(path.join(icons, name))
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
    //432 × 0.6 (the ring, less the default margin) = 259
    expect(
      await spread("android-chrome-1024x1024.png", "mark"),
    ).toBeGreaterThan(250)
    expect(
      await spread("android-chrome-1024x1024.png", "mark"),
    ).toBeLessThan(268)
    //already drawn to the spec — not inset a second time
    expect(await spread("android-maskable-1024x1024.png", "mark")).toBe(
      432,
    )
    //a solid tile has no mark to protect; the mask crops it
    expect(await spread("android-chrome-1024x1024.png", "solid")).toBe(432)
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
      "android launcher icon is opaque. Add one with a transparent background",
    )
  })
})

describe("brandLauncherIcon — when there is nothing to work with", () => {
  it("writes nothing, and says nothing, when there is no art at all", async () => {
    //Silent on purpose: "this app has no icons" is ONE app-level fact and `iconWarnings`
    //states it once for the whole run (R21) — including a `dev web` run that never gets
    //here. Repeating it per platform is what R21 exists to stop.
    const { nativeRoot, brand } = await fixture([])
    expect((await brand("ios")).warning).toBeNull()
    expect(existsSync(path.join(nativeRoot("ios"), IOS_ICON))).toBe(false)
  })
})

describe("resolveLauncherSource — the sentence the dev reads", () => {
  it("brands from adaptv's mark and says nothing about the art itself", async () => {
    //A default set is by construction a perfect source, so `iconIssue` has nothing to say
    //about it. That the app is wearing someone else's logo is app-level and belongs to
    //`iconWarnings`, once — see `preflight.test.mjs`.
    const appRoot = mkdtempSync(path.join(tmpdir(), "adaptv-icons-def-"))
    const { default: sharp } = await import("sharp")
    const marks = path.join(appRoot, "adaptv-marks")
    mkdirSync(marks, { recursive: true })
    await sharp({
      create: {
        width: 1024,
        height: 1024,
        channels: 4,
        background: { r: 30, g: 30, b: 40, alpha: 0.8 },
      },
    })
      .png()
      .toFile(path.join(marks, "icon.png"))

    const set = resolveIconSet(appRoot, { icons: "./public/favicons" }, [
      {
        file: path.join(marks, "icon.png"),
        name: "icon.png",
        family: iconFamily("icon.png"),
        width: 1024,
        height: 1024,
        alpha: true,
      },
    ])
    expect(set.source).toBe("default")

    const { pick, warning } = await resolveLauncherSource(set, "android")
    expect(pick.name).toBe("icon.png")
    expect(warning).toBeNull()
  })
})

describe("Android's two slots want opposite art", () => {
  it("ranks full-bleed art FIRST for the legacy square and maskable art LAST", () => {
    //Nothing masks the legacy mipmap, so it wants what iOS wants. Feeding it the safe-zoned
    //maskable source insets art that is already inset (0.85 × 72/108) and the launcher shows
    //a mark at 57% of its icon, adrift in the brand colour.
    const set = [
      icon("icon-maskable.png", 1024),
      icon("icon.png", 1024, { transparent: false }),
    ]
    expect(pickIcon(set, "android").name).toBe("icon-maskable.png")
    expect(pickIcon(set, "androidLegacy").name).toBe("icon.png")
  })

  it("falls back to the maskable source when it is the only art there is", () => {
    const set = [icon("icon-maskable.png", 1024)]
    expect(pickIcon(set, "androidLegacy").name).toBe("icon-maskable.png")
  })

  it("draws the legacy square from the full-bleed source, edge to edge", async () => {
    //The regression this pair exists for: with ONE pick, the round mipmap cut its circle out
    //of transparent padding and the icon read as a small tile. Measured by trimming — a
    //full-bleed square trims to nothing, a floating mark trims to its own size.
    const { nativeRoot, brand, sharp } = await fixture([
      ["icon-maskable.png", 1024, false],
      ["icon.png", 1024, true],
    ])
    await brand("android")
    const { info } = await sharp(
      path.join(
        nativeRoot("android"),
        RES,
        "mipmap-xxxhdpi/ic_launcher.png",
      ),
    )
      .trim()
      .toBuffer({ resolveWithObject: true })
    expect(info.width).toBe(192)
  })
})
