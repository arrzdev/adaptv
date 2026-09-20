import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import type { Sharp } from "sharp"
import { afterEach, describe, expect, it } from "vitest"
import type { IconFile, IconSet } from "#adaptv/vite/icon-set"
import {
  defaultIconAssets,
  defaultIconFiles,
  headIconLinks,
  iconFamily,
  installabilityIssue,
  manifestIcons,
  readImageHeader,
  resolveIconSet,
  scanIcons,
} from "#adaptv/vite/icon-set"

const roots: string[] = []
afterEach(() => {
  for (const dir of roots.splice(0))
    rmSync(dir, { recursive: true, force: true })
})

/** A fresh temp directory, removed again after the test. */
function tempDir(prefix: string) {
  const dir = mkdtempSync(path.join(tmpdir(), prefix))
  roots.push(dir)
  return dir
}

/** A minimal but REAL png header — signature + IHDR, which is all the scanner reads. */
function pngHeader(width: number, height: number, alpha = true) {
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

const icon = (name: string, width: number, height = width): IconFile => ({
  file: `/icons/${name}`,
  name,
  family: iconFamily(name),
  width,
  height,
  alpha: true,
})

/** An `IconSet` around a hand-built list, for the pure derivation tests. */
const setOf = (
  icons: IconFile[],
  over: Partial<IconSet> = {},
): IconSet => ({
  source: "app",
  configured: true,
  dirRel: "./public/favicons",
  dirAbs: "/app/public/favicons",
  urlBase: "/favicons",
  icons,
  ...over,
})

/** Write PNG headers into a fresh temp directory and return its path. */
function iconDir(files: Record<string, [number, number?]>) {
  const dir = tempDir("adaptv-icon-set-")
  for (const [name, [w, h]] of Object.entries(files))
    writeFileSync(path.join(dir, name), pngHeader(w, h ?? w))
  return dir
}

describe("iconFamily — which platform a file was drawn for", () => {
  it("reads the family out of the standard generator names", () => {
    expect(iconFamily("android-chrome-512x512.png")).toBe("android")
    expect(iconFamily("apple-touch-icon.png")).toBe("apple")
    expect(iconFamily("mstile-150x150.png")).toBe("ms")
    expect(iconFamily("favicon-32x32.png")).toBe("favicon")
  })

  it("calls a maskable icon maskable even though its name starts with android", () => {
    expect(iconFamily("android-maskable-512x512.png")).toBe("maskable")
    expect(iconFamily("icon-maskable.png")).toBe("maskable")
  })

  it("names the appearance variants whole, so a favicon set's dark tab icon isn't one", () => {
    expect(iconFamily("icon-dark.png")).toBe("dark")
    expect(iconFamily("icon-tinted.png")).toBe("tinted")
    expect(iconFamily("icon-monochrome.png")).toBe("monochrome")
    //A tab icon for dark browser chrome, and someone's own art — neither is an app-icon slot.
    expect(iconFamily("favicon-dark.svg")).toBe("favicon")
    expect(iconFamily("logo-monochrome.png")).toBe("generic")
  })

  it("treats an unrecognised name as a generic mark, not as unusable", () => {
    expect(iconFamily("icon.png")).toBe("generic")
    expect(iconFamily("logo.png")).toBe("generic")
    expect(iconFamily("my-brand-mark.png")).toBe("generic")
  })
})

describe("readImageHeader — measured pixels, not parsed filenames", () => {
  it("reads a PNG's real size and alpha channel", () => {
    expect(readImageHeader(pngHeader(512, 512))).toEqual({
      width: 512,
      height: 512,
      alpha: true,
    })
    expect(readImageHeader(pngHeader(180, 180, false))).toEqual({
      width: 180,
      height: 180,
      alpha: false,
    })
  })

  it("returns null for bytes that aren't an image it knows", () => {
    expect(readImageHeader(Buffer.alloc(64))).toBeNull()
    expect(readImageHeader(Buffer.from("not an image at all"))).toBeNull()
  })

  /**
   * A 300x200 image as sharp encodes it — non-square, so a swapped axis cannot pass. Imported
   * here, not at the top: on a machine with no prebuilt binary only these cases should fail.
   */
  const encoded = async (
    alpha: boolean,
    encode: (image: Sharp) => Sharp,
  ) => {
    const { default: sharp } = await import("sharp")
    return encode(
      sharp({
        create: {
          width: 300,
          height: 200,
          channels: alpha ? 4 : 3,
          background: { r: 10, g: 20, b: 30, alpha: alpha ? 0.5 : 1 },
        },
      }),
    ).toBuffer()
  }

  it("reads all three WebP headers an encoder writes, alpha included", async () => {
    //An `icon.webp` is rankable art (it is in ICON_EXTS); measured wrong it lies in `sizes`,
    //and not measured at all it silently drops out of the manifest.
    const cases = [
      [await encoded(false, (image) => image.webp()), "VP8 ", false],
      [
        await encoded(false, (image) => image.webp({ lossless: true })),
        "VP8L",
        false,
      ],
      [
        await encoded(true, (image) => image.webp({ lossless: true })),
        "VP8L",
        true,
      ],
      [await encoded(true, (image) => image.webp()), "VP8X", true],
    ] as const
    for (const [bytes, chunk, alpha] of cases) {
      //the case really is the header it claims to exercise
      expect(bytes.toString("latin1", 12, 16)).toBe(chunk)
      expect(readImageHeader(bytes), chunk).toEqual({
        width: 300,
        height: 200,
        alpha,
      })
    }
  })

  it("returns null for a WebP whose first chunk is none of the three headers", () => {
    const riff = Buffer.alloc(40)
    riff.write("RIFF", 0, "latin1")
    riff.write("WEBP", 8, "latin1")
    riff.write("ALPH", 12, "latin1")
    expect(readImageHeader(riff)).toBeNull()
  })

  it("reads a JPEG's size from its frame header, baseline or progressive", async () => {
    for (const progressive of [false, true]) {
      const bytes = await encoded(false, (image) =>
        image.jpeg({ progressive }),
      )
      expect(
        readImageHeader(bytes),
        `progressive: ${progressive}`,
      ).toEqual({
        width: 300,
        height: 200,
        alpha: false,
      })
    }
  })

  it("walks past segments that are not a frame header, even ones in the SOF range", () => {
    //0xC4 (a Huffman table) sits inside SOF0–SOF15 and is not a frame. Read as one, its first
    //bytes become the icon's size — here 0x0102 x 0x0304 — instead of the real 64x48.
    const jpeg = Buffer.from([
      0xff,
      0xd8, //SOI
      0xff,
      0xe0,
      0x00,
      0x04,
      0x00,
      0x00, //APP0, 2 bytes of payload
      0x00, //a stray byte between segments, skipped
      0xff,
      0xc4,
      0x00,
      0x08,
      0x00,
      0x01,
      0x02,
      0x03,
      0x04,
      0x00, //DHT
      0xff,
      0xc0,
      0x00,
      0x11,
      0x08,
      0x00,
      0x30,
      0x00,
      0x40,
      0x03, //SOF0: 48 high, 64 wide
      0x01,
      0x22,
      0x00,
      0x02,
      0x11,
      0x01,
      0x03,
      0x11,
      0x01,
    ])
    expect(readImageHeader(jpeg)).toEqual({
      width: 64,
      height: 48,
      alpha: false,
    })
  })

  it("returns null for a JPEG with no frame header in the bytes it was given", () => {
    const jpeg = Buffer.alloc(64)
    jpeg.writeUInt16BE(0xffd8, 0)
    expect(readImageHeader(jpeg)).toBeNull()
  })
})

describe("scanIcons", () => {
  it("measures each icon and skips files that aren't usable art", () => {
    const dir = iconDir({
      "android-chrome-512x512.png": [512],
      "icon.png": [1024],
    })
    writeFileSync(path.join(dir, "browserconfig.xml"), "<xml/>")
    writeFileSync(path.join(dir, "broken.png"), "not a png")

    const found = scanIcons(dir)
    expect(found.map((f) => f.name)).toEqual([
      "android-chrome-512x512.png",
      "icon.png",
    ])
    expect(found.map((f) => f.width)).toEqual([512, 1024])
  })

  it("treats a missing directory as an empty set, never as a crash", () => {
    expect(scanIcons("/nope/not/here")).toEqual([])
  })

  it("treats an `icons` path that is a FILE as an empty set, never as a crash", () => {
    const dir = iconDir({ "icon.png": [512] })
    expect(scanIcons(path.join(dir, "icon.png"))).toEqual([])
  })

  it("skips an entry it cannot read, and keeps the rest of the set", () => {
    //A directory named like an icon: `readFileSync` throws EISDIR, and one odd entry must not
    //cost the app every other icon it has.
    const dir = iconDir({ "icon.png": [512] })
    mkdirSync(path.join(dir, "folder.png"))
    expect(scanIcons(dir).map((f) => f.name)).toEqual(["icon.png"])
  })
})

describe("resolveIconSet — which set a build is going to use", () => {
  it("uses the app's own art when the directory has any", () => {
    //An app root the test owns: the parent of a temp dir is the shared temp root, and a
    //`public/` made there outlives the run and is anyone's to clobber.
    const appRoot = tempDir("adaptv-app-art-")
    const favicons = path.join(appRoot, "public/favicons")
    mkdirSync(favicons, { recursive: true })
    writeFileSync(path.join(favicons, "icon.png"), pngHeader(1024, 1024))

    const set = resolveIconSet(appRoot, { icons: "./public/favicons" })
    expect(set.source).toBe("app")
    expect(set.icons).toHaveLength(1)
    expect(set.urlBase).toBe("/favicons")
    expect(set.error).toBeUndefined()
  })

  it("uses the default set for a directory with no usable art", () => {
    const empty = iconDir({})
    const fallback = [icon("icon.png", 1024)]
    const set = resolveIconSet(empty, { icons: "." }, fallback)
    expect(set.source).toBe("default")
    expect(set.configured).toBe(true)
    expect(set.icons).toEqual(fallback)
    expect(set.urlBase).toBe("/adaptv-icons")
  })

  it("uses the default set when the config names NO directory, whatever is on disk", () => {
    //The reported bug, and the rule the framework claimed to have but didn't: commenting
    //`icons` out changed nothing, because the read path fell back to `./public/favicons` —
    //the very directory the app's art was already in. So the icons "would not update".
    const root = tempDir("adaptv-unset-")
    const favicons = path.join(root, "public/favicons")
    mkdirSync(favicons, { recursive: true })
    writeFileSync(path.join(favicons, "icon.png"), pngHeader(1024, 1024))

    const fallback = [icon("adaptv.png", 1024)]
    const set = resolveIconSet(root, {}, fallback)
    expect(set.source).toBe("default")
    expect(set.configured).toBe(false)
    expect(set.icons).toEqual(fallback)
    expect(set.urlBase).toBe("/adaptv-icons")
    //No directory was named, so there is none to name back — the message says which KEY to
    //set instead, and a path the dev never wrote must not appear in it.
    expect(set.dirRel).toBe("")
  })

  it("uses the app's art the moment the key names the directory it is in", () => {
    //The other half of the same rule: configuring it is all it takes, and nothing else
    //about the app has to change.
    const root = tempDir("adaptv-set-")
    const favicons = path.join(root, "public/favicons")
    mkdirSync(favicons, { recursive: true })
    writeFileSync(path.join(favicons, "icon.png"), pngHeader(1024, 1024))

    const set = resolveIconSet(root, { icons: "./public/favicons" }, [
      icon("adaptv.png", 1024),
    ])
    expect(set.source).toBe("app")
    expect(set.configured).toBe(true)
    expect(set.urlBase).toBe("/favicons")
    expect(set.icons.map((i) => i.name)).toEqual(["icon.png"])
  })

  it("reports an icon directory outside public/ instead of emitting ../ hrefs", () => {
    const root = tempDir("adaptv-app-")
    mkdirSync(path.join(root, "public"))
    mkdirSync(path.join(root, "assets"))
    writeFileSync(
      path.join(root, "assets/icon.png"),
      pngHeader(1024, 1024),
    )

    const set = resolveIconSet(root, { icons: "./assets" })
    expect(set.source).toBe("app")
    expect(set.error).toContain("inside public/")
    expect(set.urlBase).toBe("")
    // the art is still there — it brands the native icons perfectly well
    expect(set.icons).toHaveLength(1)
  })

  it("builds the url base from the directory's position under public/", () => {
    const root = tempDir("adaptv-app-")
    mkdirSync(path.join(root, "public/brand/icons"), { recursive: true })
    writeFileSync(
      path.join(root, "public/brand/icons/icon.png"),
      pngHeader(1024, 1024),
    )

    expect(
      resolveIconSet(root, { icons: "./public/brand/icons" }).urlBase,
    ).toBe("/brand/icons")
  })
})

describe("defaultIconAssets — what actually has to reach a URL", () => {
  it("serves everything the head and manifest reference, including the non-rankable members", () => {
    //`favicon.ico` and `icon.svg` are linked BY NAME and skipped by `scanIcons`, which is what
    //once left `/adaptv-icons/favicon.ico` a 404 under a link pointing straight at it.
    const names = defaultIconAssets().map((f) => path.basename(f))
    expect(names).toContain("favicon.ico")
    expect(names).toContain("icon.svg")
    expect(names).toContain("apple-touch-icon-180.png")
    expect(names).toContain("icon.png")
  })

  it("leaves the launcher-only variants out of the build output", () => {
    //Nothing on a web surface links them and the native brander reads them off disk, so
    //emitting them is dead weight in every app that wears adaptv's mark.
    const names = defaultIconAssets().map((f) => path.basename(f))
    expect(names).not.toContain("icon-dark.png")
    expect(names).not.toContain("icon-tinted.png")
    expect(names).not.toContain("icon-monochrome.png")
  })

  it("serves exactly what headIconLinks asks for, with nothing missing", () => {
    //The pairing that matters: a link with no asset behind it is a 404 that looks like a
    //working fallback, and this is the check that keeps the two lists honest with each other.
    const set = resolveIconSet("/nonexistent-app", {}, defaultIconFiles())
    expect(set.source).toBe("default")
    const served = new Set(
      defaultIconAssets().map((f) => path.basename(f)),
    )
    for (const link of headIconLinks(set))
      expect(served).toContain(path.basename(link.href))
    for (const icon of manifestIcons(set))
      expect(served).toContain(path.basename(icon.src))
  })
})

describe("manifestIcons — the set a browser is handed", () => {
  it("uses measured sizes, never the ones in the filename", () => {
    // a designer resized this by hand and kept the name
    const icons = manifestIcons(
      setOf([icon("android-chrome-192x192.png", 180)]),
    )
    expect(icons[0].sizes).toBe("180x180")
  })

  it("takes art the old `android-` prefix filter threw away", () => {
    const icons = manifestIcons(
      setOf([icon("logo-192.png", 192), icon("my-mark-512.png", 512)]),
    )
    expect(icons.map((i) => i.src)).toEqual([
      "/favicons/logo-192.png",
      "/favicons/my-mark-512.png",
    ])
  })

  it("keeps the 1024px native masters OUT — no browser asks for them", () => {
    //`icon-maskable.png` is Android's adaptive FOREGROUND and transparent by design.
    //Published as `purpose: "maskable"` it promises full-bleed art on a solid background
    //and delivers a mark floating in a transparent circle on Chrome's splash.
    const icons = manifestIcons(
      setOf([
        icon("icon.png", 1024),
        icon("icon-maskable.png", 1024),
        icon("android-chrome-512.png", 512),
        icon("android-maskable-512.png", 512),
      ]),
    )
    expect(icons.map((i) => i.sizes)).toEqual(["512x512", "512x512"])
  })

  it("keeps the platform appearance variants out of the manifest entirely", () => {
    //None of the three is an icon in the web sense: `icon-dark.png` is a bare mark on
    //nothing, `icon-tinted.png` a greyscale ramp, `icon-monochrome.png` a white silhouette
    //whose ink a launcher supplies. On a browser surface the last one is white on white.
    const icons = manifestIcons(
      setOf([
        icon("android-chrome-512.png", 512),
        icon("icon-dark.png", 512),
        icon("icon-tinted.png", 512),
        icon("icon-monochrome.png", 512),
      ]),
    )
    expect(icons.map((i) => i.src)).toEqual([
      "/favicons/android-chrome-512.png",
    ])
  })

  it("still lists an oversized master when it is the only art there is", () => {
    //An empty `icons` array means no install prompt at all — worse than one big entry.
    const icons = manifestIcons(
      setOf([icon("icon.png", 1024), icon("icon-maskable.png", 2048)]),
    )
    expect(icons).toEqual([
      { src: "/favicons/icon.png", sizes: "1024x1024", type: "image/png" },
      {
        src: "/favicons/icon-maskable.png",
        sizes: "2048x2048",
        type: "image/png",
        purpose: "maskable",
      },
    ])
  })

  it("keeps only the SMALLEST oversized master per purpose, not every one", () => {
    //Every candidate is over the cap, so one entry per purpose survives — and the smallest is
    //the cheapest download that still fills every slot a browser has.
    const icons = manifestIcons(
      setOf([icon("logo.png", 2048), icon("icon.png", 1024)]),
    )
    expect(icons.map((i) => i.src)).toEqual(["/favicons/icon.png"])
  })

  it("marks maskable art and sorts it after the `any` icon of the same size", () => {
    const icons = manifestIcons(
      setOf([
        icon("android-maskable-512x512.png", 512),
        icon("android-chrome-512x512.png", 512),
      ]),
    )
    expect(icons).toEqual([
      {
        src: "/favicons/android-chrome-512x512.png",
        sizes: "512x512",
        type: "image/png",
      },
      {
        src: "/favicons/android-maskable-512x512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ])
  })

  it("keeps ONE entry when two files claim the same size and purpose", () => {
    const icons = manifestIcons(
      setOf([
        icon("android-chrome-192.png", 192),
        icon("android-icon-192x192.png", 192),
        icon("favicon-192x192.png", 192),
      ]),
    )
    expect(icons).toHaveLength(1)
    //the android family outranks a favicon-named file of the same size
    expect(icons[0].src).toBe("/favicons/android-chrome-192.png")
  })

  it("drops apple and ms art, which is head-linked rather than manifest-listed", () => {
    const icons = manifestIcons(
      setOf([
        icon("apple-touch-icon-180.png", 180),
        icon("mstile-150x150.png", 150),
        icon("icon.png", 512),
      ]),
    )
    expect(icons.map((i) => i.src)).toEqual(["/favicons/icon.png"])
  })

  it("drops sub-48px favicons and non-square art", () => {
    const icons = manifestIcons(
      setOf([
        icon("favicon-16x16.png", 16),
        icon("favicon-32x32.png", 32),
        icon("banner.png", 512, 256),
        icon("favicon-512x512.png", 512),
      ]),
    )
    expect(icons.map((i) => i.sizes)).toEqual(["512x512"])
  })

  it("emits nothing when the icons aren't served at any url", () => {
    expect(
      manifestIcons(setOf([icon("icon.png", 1024)], { urlBase: "" })),
    ).toEqual([])
  })

  it("types each entry from its extension", () => {
    const icons = manifestIcons(setOf([icon("icon.webp", 512)]))
    expect(icons[0].type).toBe("image/webp")
  })
})

describe("installabilityIssue — silent on any normal set", () => {
  it("says nothing about a lone big icon, which IS installable", () => {
    //"192 and 512" is a Lighthouse recommendation, not Chrome's requirement. An app whose
    //whole set is one `icon.png` would otherwise see a `!` on every single run.
    expect(
      installabilityIssue(manifestIcons(setOf([icon("icon.png", 1024)]))),
    ).toBeNull()
    expect(
      installabilityIssue(manifestIcons(setOf([icon("icon.png", 192)]))),
    ).toBeNull()
  })

  it("names the largest size when nothing reaches Chrome's install bar", () => {
    const icons = manifestIcons(setOf([icon("favicon-96x96.png", 96)]))
    expect(installabilityIssue(icons)).toBe(
      "web manifest's largest icon is 96px — a PWA needs 192px",
    )
  })

  it("points at the generator when there is nothing at all", () => {
    expect(installabilityIssue([])).toContain("adaptv gen icons")
  })

  it("stays inside a narrow terminal", () => {
    for (const icons of [[], manifestIcons(setOf([icon("i.png", 96)]))]) {
      const message = installabilityIssue(icons)
      if (message) expect(message.length).toBeLessThanOrEqual(72)
    }
  })
})

describe("headIconLinks — links to files that exist", () => {
  it("emits nothing for a set that isn't served", () => {
    expect(
      headIconLinks(setOf([icon("icon.png", 512)], { urlBase: "" })),
    ).toEqual([])
  })

  it("links every tab-sized raster ascending, so the browser's last-wins pick is the biggest", () => {
    const dir = iconDir({
      "favicon-16x16.png": [16],
      "favicon-32x32.png": [32],
      "android-chrome-192.png": [192],
    })
    const links = headIconLinks(setOf(scanIcons(dir), { dirAbs: dir }))
    expect(links.map((l) => l.sizes)).toEqual([
      "16x16",
      "32x32",
      "192x192",
    ])
  })

  it("does NOT link the 1024px master as a tab icon when smaller art exists", () => {
    const dir = iconDir({ "icon.png": [1024], "favicon-32x32.png": [32] })
    const links = headIconLinks(setOf(scanIcons(dir), { dirAbs: dir }))
    expect(links.map((l) => l.href)).toEqual([
      "/favicons/favicon-32x32.png",
    ])
  })

  it("never links an appearance variant as a tab icon", () => {
    const dir = iconDir({
      "favicon-32x32.png": [32],
      "icon-dark.png": [64],
      "icon-tinted.png": [64],
      "icon-monochrome.png": [64],
    })
    const links = headIconLinks(setOf(scanIcons(dir), { dirAbs: dir }))
    expect(links.map((l) => l.href)).toEqual([
      "/favicons/favicon-32x32.png",
    ])
  })

  it("links the master anyway when it is the only art there is", () => {
    const dir = iconDir({ "icon.png": [1024] })
    const links = headIconLinks(setOf(scanIcons(dir), { dirAbs: dir }))
    expect(links.map((l) => l.href)).toEqual(["/favicons/icon.png"])
  })

  it("puts favicon.ico first and an svg last, so both outranked and outranking are right", () => {
    const dir = iconDir({ "favicon-32x32.png": [32] })
    writeFileSync(path.join(dir, "favicon.ico"), Buffer.alloc(8))
    writeFileSync(path.join(dir, "icon.svg"), "<svg/>")
    const links = headIconLinks(setOf(scanIcons(dir), { dirAbs: dir }))
    expect(links.map((l) => l.href)).toEqual([
      "/favicons/favicon.ico",
      "/favicons/favicon-32x32.png",
      "/favicons/icon.svg",
    ])
  })

  it("emits apple-touch-icon only for the sizes present, largest last", () => {
    const dir = iconDir({
      "apple-touch-icon.png": [180],
      "apple-icon-120x120.png": [120],
      "apple-touch-icon-180.png": [180],
    })
    const links = headIconLinks(
      setOf(scanIcons(dir), { dirAbs: dir }),
    ).filter((l) => l.rel === "apple-touch-icon")
    expect(links.map((l) => l.href)).toEqual([
      "/favicons/apple-touch-icon.png",
      "/favicons/apple-icon-120x120.png",
      "/favicons/apple-touch-icon-180.png",
    ])
  })

  it("never links a maskable icon from the head — it is manifest-only art", () => {
    const dir = iconDir({
      "icon-maskable.png": [512],
      "favicon-32x32.png": [32],
    })
    const links = headIconLinks(setOf(scanIcons(dir), { dirAbs: dir }))
    expect(links.map((l) => l.href)).not.toContain(
      "/favicons/icon-maskable.png",
    )
  })
})

describe("headIconLinks — one link per size", () => {
  it("breaks a same-family, same-size tie on the name, whatever order the files came in", () => {
    //Two builds of the same directory must link the same file.
    const links = headIconLinks(
      setOf([icon("favicon-b-96.png", 96), icon("favicon-a-96.png", 96)]),
    )
    expect(links.map((l) => l.href)).toEqual([
      "/favicons/favicon-a-96.png",
    ])
  })

  it("does not link two files for the same size", () => {
    //A full generator set ships `android-icon-96x96.png` AND `favicon-96x96.png`. A browser
    //downloads one of them, so the second is markup that can only ever be ignored.
    const dir = iconDir({
      "android-icon-96x96.png": [96],
      "favicon-96x96.png": [96],
      "favicon-32x32.png": [32],
    })
    const links = headIconLinks(setOf(scanIcons(dir), { dirAbs: dir }))
    expect(links.map((l) => l.href)).toEqual([
      "/favicons/favicon-32x32.png",
      //android outranks favicon at the same size — the same tie-break the manifest uses
      "/favicons/android-icon-96x96.png",
    ])
  })
})
