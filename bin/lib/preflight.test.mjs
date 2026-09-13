import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { resolveIconSet } from "#adaptv/vite/icon-set"
import {
  configErrors,
  iconWarnings,
  inspect,
  missingPluginErrors,
} from "./preflight.mjs"

/** A config that passes — every check below starts from this and breaks one thing. */
const ok = {
  appId: "com.example.app",
  name: "Probe",
  styles: "./src/styles/main.css",
  router: { routesDirectory: "./routing" },
  themeColor: { light: "#ffffff", dark: "#101010" },
}

//a case may make more than one app root, so every one is kept for the cleanup
const dirs = []
afterEach(() => {
  for (const d of dirs.splice(0))
    rmSync(d, { recursive: true, force: true })
})

const tempApp = () => {
  const dir = mkdtempSync(path.join(tmpdir(), "adaptv-preflight-"))
  dirs.push(dir)
  return dir
}

/** An app root with `public/favicons/<name>` written from `bytes`. */
function appWithIcon(name, bytes) {
  const dir = tempApp()
  const icons = path.join(dir, "public/favicons")
  mkdirSync(icons, { recursive: true })
  if (name) writeFileSync(path.join(icons, name), bytes)
  return dir
}

/**
 * The app's icon set, resolved with NO adaptv default art. These tests are about what the
 * dev's own directory produces; a framework fallback standing in for a missing set would make
 * the "nothing there" cases silently pass.
 */
const setFor = (root) =>
  resolveIconSet(root, { icons: "./public/favicons" }, [])

/** One entry of adaptv's own set, for the default-mark cases. */
const icon = (name, width) => ({
  file: `/adaptv/assets/default-icons/${name}`,
  name,
  family: "generic",
  width,
  height: width,
  alpha: true,
})

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
  it("passes a config that is fine, silently", async () => {
    //The bar every check has to clear: a warning or error every project sees teaches devs
    //to ignore them.
    expect(await configErrors(ok)).toEqual([])
    expect(
      await configErrors({
        ...ok,
        backgroundColor: "#FFF",
        splashMaskMode: "system",
        icons: "./src/brand",
      }),
    ).toEqual([])
  })

  it("names the key, the shape and what was actually there", async () => {
    //R7 — an error is terse and names the fix. These used to be SILENT: an unparseable
    //colour fell back to white and an unknown mode to `preferences`, so the app shipped
    //with a setting the dev wrote and adaptv ignored.
    const [color] = await configErrors({
      ...ok,
      themeColor: { light: "midnightblue", dark: "#101010" },
    })
    expect(color).toBe(
      `'themeColor.light' must be a hex colour like #1b1b1b, got "midnightblue"`,
    )
    const [mode] = await configErrors({ ...ok, splashMaskMode: "auto" })
    expect(mode).toBe(
      `'splashMaskMode' must be preferences, system, light or dark, got "auto"`,
    )
  })

  it("rejects an appId the native toolchains would reject four minutes later", async () => {
    //It is the Android package AND the iOS bundle id. `myapp` and `com.4d.app` both
    //scaffold happily and then fail deep inside gradle. A MISSING appId is refused one step
    //earlier, by `loadConfig` — the build can run without one, no command here can.
    expect((await configErrors({ ...ok, appId: "myapp" }))[0]).toContain(
      "reverse-DNS",
    )
    expect(
      await configErrors({ ...ok, appId: "com.4d.app" }),
    ).toHaveLength(1)
    expect(
      await configErrors({ ...ok, appId: "com.example.my_app_2" }),
    ).toEqual([])
  })

  it("refuses what the web build would refuse, before the run starts", async () => {
    //The rules are the build's own. `orientation: "sideways"` used to pass this check and
    //die inside the web build, worded by the tool that hit it (R33).
    expect(await configErrors({ ...ok, orientation: "sideways" })).toEqual(
      [`'orientation' must be portrait, landscape or any, got "sideways"`],
    )
    expect(await configErrors({ ...ok, styles: undefined })).toEqual([
      "'styles' must be a path to the app's stylesheet, got undefined",
    ])
  })

  it("reports every problem at once, not one per run", async () => {
    const errors = await configErrors({
      ...ok,
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
      iconWarnings(setFor(appWithIcon("icon.png", png(512))), [
        "ios",
        "android",
      ]),
    ).resolves.toEqual([
      "ios launcher icon upscaled from 512px. Add a 1024px icon",
    ])
  })

  it("says nothing about a set that is good", async () => {
    const root = appWithIcon("icon.png", png(1024))
    expect(await iconWarnings(setFor(root), ["ios"])).toEqual([])
  })

  it("states having no art ONCE, however many platforms are in the run", async () => {
    //R21 — one app-level fact, and it does not gain a platform prefix or a second copy just
    //because the code that found it runs per platform.
    const root = appWithIcon(null)
    const set = resolveIconSet(root, { icons: "./public/favicons" }, [
      icon("icon.png", 1024),
    ])
    for (const platforms of [[], ["ios"], ["ios", "android"]])
      expect(await iconWarnings(set, platforms)).toEqual([
        "no icons in ./public/favicons",
      ])
  })

  it("warns about the default mark on a `web` run, which has no platforms at all", async () => {
    //The whole reason this moved out of the per-platform launcher path: `dev web` never asks
    //about a launcher icon, and the app is still wearing someone else\'s logo in its tab, its
    //manifest and its install prompt.
    const set = resolveIconSet(
      appWithIcon(null),
      { icons: "./public/favicons" },
      [icon("icon.png", 1024)],
    )
    expect(await iconWarnings(set, [])).toEqual([
      "no icons in ./public/favicons",
    ])
  })

  it("names the KEY, not a directory, when the config never chose one", async () => {
    //Two ways to reach the default mark and they have different fixes: an empty directory is
    //filled, an absent key is set. Naming `./public/favicons` at someone who never wrote it
    //sent them looking for a directory adaptv had invented (R7 — name the fix).
    const set = resolveIconSet(appWithIcon("icon.png", png(1024)), {}, [
      icon("icon.png", 1024),
    ])
    expect(await iconWarnings(set, ["ios"])).toEqual([
      "no 'icons' in adaptv.config.ts",
    ])
  })

  it("checks the WEB manifest too, on a run with no native platforms at all", async () => {
    //`dev web` / `preview web` serve a manifest, so an app that cannot be installed should
    //hear it from adaptv rather than from a Lighthouse report weeks later.
    const root = appWithIcon("favicon-96x96.png", png(96))
    expect(await iconWarnings(setFor(root), [])).toEqual([
      "web manifest's largest icon is 96px — a PWA needs 192px",
    ])
  })

  it("says nothing ELSE about a default set — every other warning is about the dev's art", async () => {
    //adaptv's own mark is correct by construction. Reporting it as "upscaled from…" or
    //"not installable" would be adaptv filing bugs against its own files.
    const set = resolveIconSet(
      appWithIcon(null),
      { icons: "./public/favicons" },
      [icon("tiny.png", 64)],
    )
    expect(await iconWarnings(set, ["ios", "android"])).toHaveLength(1)
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

/**
 * A name in `plugins` that resolves to nothing.
 *
 * The regression: this used to be found inside the native injectors, half-way through a run,
 * once per platform, and pushed at a channel that renders it after the project has already
 * been scaffolded. Nothing about it needs a native project — Node's resolver answers it from
 * the dev's own `node_modules` — so it belongs here, under the banner, and it is an `✖`
 * rather than a `!` because the alternative is a build that succeeds and an app that rejects
 * the call the entry was written for (R33/R39).
 */
describe("missingPluginErrors — a plugin listed and never installed", () => {
  const root = () => {
    const dir = tempApp()
    writeFileSync(
      path.join(dir, "package.json"),
      JSON.stringify({ name: "scratch-app", dependencies: {} }),
    )
    return dir
  }

  it("refuses a native run, naming the entry and the fix", () => {
    expect(
      missingPluginErrors(
        root(),
        { ...ok, plugins: ["@capacitor/not-a-real-plugin"] },
        ["ios"],
      ),
    ).toEqual([
      "'plugins' names '@capacitor/not-a-real-plugin', which is not installed. Install it, or remove the entry.",
    ])
  })

  it("says it ONCE for a run with both platforms in it", () => {
    //The two injectors each pushed their own `ios:`/`android:` copy, so `build all` stated
    //one app-level fact twice with a label that carried no information (R21). They share one
    //resolver and it takes no platform, so they could never have disagreed.
    expect(
      missingPluginErrors(
        root(),
        { ...ok, plugins: ["@capacitor/not-a-real-plugin"] },
        ["ios", "android"],
      ),
    ).toHaveLength(1)
  })

  it("says nothing on a web-only run, which consumes `plugins` nowhere", () => {
    //`dev web` / `build web` / `preview web` pass no platforms. Refusing here would stop a
    //run with no stake in the plugin; a `!` here would be a native-only sentence on every
    //web command, true and unactionable (R6).
    expect(
      missingPluginErrors(
        root(),
        { ...ok, plugins: ["@capacitor/not-a-real-plugin"] },
        [],
      ),
    ).toEqual([])
  })

  it("accepts a plugin adaptv itself ships, which the app never declares", () => {
    //The consumer's `package.json` lists no `@capacitor/*` at all — adaptv owns them. A
    //check that only looked at the app's dependencies would refuse every correct config.
    expect(
      missingPluginErrors(
        root(),
        { ...ok, plugins: ["@capacitor/haptics"] },
        ["android"],
      ),
    ).toEqual([])
  })

  it("names a plugin listed twice once, and refuses over no entry at all", () => {
    expect(
      missingPluginErrors(
        root(),
        { ...ok, plugins: ["@capacitor/nope", "@capacitor/nope", ""] },
        ["ios"],
      ),
    ).toHaveLength(1)
    expect(missingPluginErrors(root(), ok, ["ios"])).toEqual([])
  })

  it("is reported by `inspect` alongside every other config problem, not instead of them", async () => {
    //R33: every problem at once. A config fixed one line per run is worse than a list.
    const errors = missingPluginErrors(
      root(),
      { ...ok, plugins: ["@capacitor/nope"] },
      ["ios"],
    )
    expect(errors).toHaveLength(1)
    expect(
      await configErrors({ ...ok, backgroundColor: "eeeeec" }),
    ).toHaveLength(1)
  })
})

describe("inspect — the plugin check rides with the rest of the config", () => {
  it("returns both a bad colour and an uninstalled plugin from one run", async () => {
    const root = appWithIcon("icon.png", png(1024))
    writeFileSync(
      path.join(root, "package.json"),
      JSON.stringify({ name: "scratch-app", dependencies: {} }),
    )
    const { errors, warnings } = await inspect(
      root,
      { ...ok, backgroundColor: "eeeeec", plugins: ["@capacitor/nope"] },
      ["ios"],
    )
    expect(errors).toEqual([
      "'backgroundColor' must be a hex colour like #1b1b1b, got \"eeeeec\"",
      "'plugins' names '@capacitor/nope', which is not installed. Install it, or remove the entry.",
    ])
    //and no `!` about art underneath a run that is being refused (R6)
    expect(warnings).toEqual([])
  })
})
