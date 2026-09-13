// @vitest-environment node
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { afterEach, describe, expect, it } from "vitest"
import { ADAPTV_DIR } from "./adaptv-dir.mjs"
import { patchNativeLinks } from "./native.mjs"
import { inspect } from "./preflight.mjs"

/**
 * `deepLinks.scheme` has to reach both native projects, or a link opens nothing: the app
 * installs, the build is green, and the OS has no idea the app answers to the scheme. The
 * fixtures are the two files exactly as the native templates scaffold them (8.4.3, the pinned
 * native platforms; byte-identical to the playground's generated project apart from its display
 * name), so a template that moves the insertion points fails here rather than on a device.
 */

const FIXTURES = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "fixtures/native-links",
)
const TEMPLATE_PLIST = readFileSync(
  path.join(FIXTURES, "Info.plist"),
  "utf8",
)
const TEMPLATE_MANIFEST = readFileSync(
  path.join(FIXTURES, "AndroidManifest.xml"),
  "utf8",
)
const PLIST = "ios/App/App/Info.plist"
const MANIFEST = "android/app/src/main/AndroidManifest.xml"

const dirs = []
afterEach(() => {
  for (const dir of dirs.splice(0))
    rmSync(dir, { recursive: true, force: true })
})

/** An app root whose native projects hold the two template files. */
function project() {
  const root = mkdtempSync(path.join(tmpdir(), "adaptv-links-"))
  dirs.push(root)
  for (const [rel, text] of [
    [PLIST, TEMPLATE_PLIST],
    [MANIFEST, TEMPLATE_MANIFEST],
  ]) {
    const file = path.join(root, ADAPTV_DIR, rel)
    mkdirSync(path.dirname(file), { recursive: true })
    writeFileSync(file, text)
  }
  return root
}

const read = (root, rel) =>
  readFileSync(path.join(root, ADAPTV_DIR, rel), "utf8")

/** Both platforms, as `preparePlatform` runs them. */
function patch(root, config) {
  patchNativeLinks(root, config, "ios")
  patchNativeLinks(root, config, "android")
}

const LINKS = { appId: "dev.example.app", deepLinks: { scheme: "myapp" } }
const NO_LINKS = { appId: "dev.example.app" }

/** The `<activity>` element for `.MainActivity`, as text. */
const mainActivity = (manifest) =>
  /<activity\b[^>]*android:name="\.MainActivity"[\s\S]*?<\/activity>/.exec(
    manifest,
  )?.[0] ?? ""

describe("patchNativeLinks — iOS", () => {
  it("declares the scheme as the plist's one URL type", () => {
    const root = project()
    patch(root, LINKS)
    const plist = read(root, PLIST)

    expect(plist.match(/<key>CFBundleURLTypes<\/key>/g)).toHaveLength(1)
    expect(plist).toContain(
      [
        "\t<key>CFBundleURLTypes</key>",
        "\t<array>",
        "\t\t<dict>",
        "\t\t\t<key>CFBundleURLName</key>",
        "\t\t\t<string>$(PRODUCT_BUNDLE_IDENTIFIER)</string>",
        "\t\t\t<key>CFBundleURLSchemes</key>",
        "\t\t\t<array>",
        "\t\t\t\t<string>myapp</string>",
        "\t\t\t</array>",
        "\t\t</dict>",
        "\t</array>",
        "</dict>",
        "</plist>",
      ].join("\n"),
    )
    //inside the root dict, and nothing else in the file moved
    expect(
      plist.replace(
        /\t<key>CFBundleURLTypes<\/key>\n[\s\S]*?\n\t<\/array>\n/,
        "",
      ),
    ).toBe(TEMPLATE_PLIST)
  })

  it("moves the declaration to a new scheme rather than adding a second", () => {
    const root = project()
    patch(root, LINKS)
    patch(root, { ...LINKS, deepLinks: { scheme: "other" } })
    const plist = read(root, PLIST)

    expect(plist.match(/<key>CFBundleURLTypes<\/key>/g)).toHaveLength(1)
    expect(plist).toContain("<string>other</string>")
    expect(plist).not.toContain("<string>myapp</string>")
  })

  it("adopts a URL type written somewhere else in the plist, keeping one", () => {
    //`dev` rewrites the plist through the system plist tool for its ATS exception, which
    //may put keys in its own order; the patch must still find its declaration there
    const root = project()
    const file = path.join(root, ADAPTV_DIR, PLIST)
    writeFileSync(
      file,
      TEMPLATE_PLIST.replace(
        "\t<key>CFBundleDevelopmentRegion</key>",
        "\t<key>CFBundleURLTypes</key>\n\t<array>\n\t\t<dict>\n\t\t\t<key>CFBundleURLSchemes</key>\n\t\t\t<array>\n\t\t\t\t<string>stale</string>\n\t\t\t</array>\n\t\t</dict>\n\t</array>\n\t<key>CFBundleDevelopmentRegion</key>",
      ),
    )
    patch(root, LINKS)
    const plist = read(root, PLIST)
    expect(plist.match(/<key>CFBundleURLTypes<\/key>/g)).toHaveLength(1)
    expect(plist).not.toContain("stale")
    patch(root, NO_LINKS)
    expect(read(root, PLIST)).toBe(TEMPLATE_PLIST)
  })

  it("leaves a right declaration where a re-sorted plist put it", () => {
    //the same re-sort, but the declaration it moved is already the right one: rewriting
    //the file to move it back would be a write that changes nothing the OS reads
    const root = project()
    patch(root, LINKS)
    const file = path.join(root, ADAPTV_DIR, PLIST)
    const block =
      /\t<key>CFBundleURLTypes<\/key>\n[\s\S]*?\n\t<\/array>\n/.exec(
        readFileSync(file, "utf8"),
      )?.[0]
    const resorted = TEMPLATE_PLIST.replace(
      "\t<key>CFBundleDevelopmentRegion</key>",
      `${block}\t<key>CFBundleDevelopmentRegion</key>`,
    )
    writeFileSync(file, resorted)
    patch(root, LINKS)
    expect(read(root, PLIST)).toBe(resorted)
  })
})

describe("patchNativeLinks — Android", () => {
  it("adds a VIEW filter for the scheme inside MainActivity", () => {
    const root = project()
    patch(root, LINKS)
    const activity = mainActivity(read(root, MANIFEST))

    expect(activity).toContain(
      [
        "            <intent-filter>",
        '                <action android:name="android.intent.action.VIEW" />',
        '                <category android:name="android.intent.category.DEFAULT" />',
        '                <category android:name="android.intent.category.BROWSABLE" />',
        '                <data android:scheme="myapp" />',
        "            </intent-filter>",
        "",
        "        </activity>",
      ].join("\n"),
    )
    expect(activity.match(/android\.intent\.action\.VIEW/g)).toHaveLength(
      1,
    )
  })

  it("leaves the MAIN/LAUNCHER filter exactly as it was", () => {
    const launcher = [
      "            <intent-filter>",
      '                <action android:name="android.intent.action.MAIN" />',
      '                <category android:name="android.intent.category.LAUNCHER" />',
      "            </intent-filter>",
    ].join("\n")
    expect(TEMPLATE_MANIFEST).toContain(launcher)

    const root = project()
    patch(root, LINKS)
    const manifest = read(root, MANIFEST)
    expect(manifest).toContain(launcher)
    expect(
      manifest.match(/android\.intent\.category\.LAUNCHER/g),
    ).toHaveLength(1)
    //and the one filter adaptv added is the whole difference
    expect(
      manifest.replace(
        /[ \t]*<intent-filter>\n[^\n]*action\.VIEW[\s\S]*?<\/intent-filter>\n\n/,
        "",
      ),
    ).toBe(TEMPLATE_MANIFEST)
  })

  it("moves the filter to a new scheme rather than adding a second", () => {
    const root = project()
    patch(root, LINKS)
    patch(root, { ...LINKS, deepLinks: { scheme: "other" } })
    const manifest = read(root, MANIFEST)

    expect(manifest.match(/android\.intent\.action\.VIEW/g)).toHaveLength(
      1,
    )
    expect(manifest).toContain('android:scheme="other"')
    expect(manifest).not.toContain('android:scheme="myapp"')
  })
})

describe("patchNativeLinks — both projects", () => {
  it("writes nothing on a second run: both files are byte-identical", () => {
    const root = project()
    patch(root, LINKS)
    const once = [read(root, PLIST), read(root, MANIFEST)]
    patch(root, LINKS)
    expect([read(root, PLIST), read(root, MANIFEST)]).toEqual(once)
  })

  it("takes both declarations back out when the key is removed", () => {
    const root = project()
    patch(root, LINKS)
    patch(root, NO_LINKS)
    expect(read(root, PLIST)).toBe(TEMPLATE_PLIST)
    expect(read(root, MANIFEST)).toBe(TEMPLATE_MANIFEST)
  })

  it("leaves a project that never declared a scheme untouched", () => {
    const root = project()
    patch(root, NO_LINKS)
    expect(read(root, PLIST)).toBe(TEMPLATE_PLIST)
    expect(read(root, MANIFEST)).toBe(TEMPLATE_MANIFEST)
  })

  it("leaves a platform with no project alone, inventing nothing", () => {
    const root = mkdtempSync(path.join(tmpdir(), "adaptv-links-"))
    dirs.push(root)
    expect(() => patch(root, LINKS)).not.toThrow()
  })
})

describe("patchNativeLinks — a scheme the projects cannot use never reaches them", () => {
  //the patch writes the scheme verbatim and does not validate it; `preflight` refuses a bad
  //one before any native step runs, and that is the order every command takes
  it("refuses an invalid or reserved scheme before the run starts", async () => {
    const root = project()
    const base = {
      ...LINKS,
      name: "Probe",
      styles: "./src/styles/main.css",
      router: { routesDirectory: "./routing" },
      themeColor: { light: "#ffffff", dark: "#101010" },
    }
    for (const scheme of [
      "MyApp",
      "my_app",
      "myapp://",
      "https",
      "http",
    ]) {
      const { errors } = await inspect(
        root,
        { ...base, deepLinks: { scheme } },
        ["ios", "android"],
      )
      expect(errors, scheme).toHaveLength(1)
      expect(errors[0], scheme).toMatch(/^'deepLinks\.scheme' must be /)
    }
    const { errors } = await inspect(root, base, ["ios", "android"])
    expect(errors).toEqual([])
  })
})
