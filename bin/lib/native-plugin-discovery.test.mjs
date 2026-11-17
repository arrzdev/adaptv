// @vitest-environment node
// Which packages get compiled into the native binary — and the one way that list
// used to be wrong.
//
// It filtered on the `@capacitor/` name prefix, which reads like "Capacitor plugins"
// and actually means "plugins from one vendor". Anything else compiled and then never
// registered, and the only symptom was a runtime "plugin is not implemented" with a
// clean build log above it. `@capawesome/capacitor-live-update` — the OTA mechanism —
// is the first plugin adaptv ships that the prefix would have dropped, so it is the
// fixture here rather than a synthetic name.
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import {
  carriesNativeCode,
  pluginDir,
} from "#adaptv/native/installed-plugins.ts"
import {
  ADAPTV_ROOT,
  adaptvCapacitorNativePkgs,
  pkgDirResolver,
} from "./native.mjs"

const OTA_PLUGIN = "@capawesome/capacitor-live-update"

const nativeSource = readFileSync(
  path.join(ADAPTV_ROOT, "bin/lib/native.mjs"),
  "utf8",
)

describe("membership is decided by inspecting the package, not by its name", () => {
  it("includes a native plugin that is not published under @capacitor", () => {
    expect(adaptvCapacitorNativePkgs("ios")).toContain(OTA_PLUGIN)
    expect(adaptvCapacitorNativePkgs("android")).toContain(OTA_PLUGIN)
  })

  it("does not reintroduce the vendor prefix filter", () => {
    //the regression is a one-line edit away and produces no build-time symptom
    const codeLines = nativeSource
      .split("\n")
      .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
      .join("\n")
    expect(codeLines).not.toContain('startsWith("@capacitor/")')
  })
})

describe("the platform runtimes, which the package test alone gets wrong", () => {
  it("keeps @capacitor/ios on iOS even though it fails the native-code test", () => {
    //It is the platform, not a plugin: no `capacitor` field, no `ios/` dir. Its pods
    //are what the core builds from, so dropping it breaks the iOS build outright.
    expect(carriesNativeCode(dirOf("@capacitor/ios"))).toBe(false)
    expect(adaptvCapacitorNativePkgs("ios")).toContain("@capacitor/ios")
  })

  it("excludes @capacitor/ios from the Android list", () => {
    expect(adaptvCapacitorNativePkgs("android")).not.toContain(
      "@capacitor/ios",
    )
  })

  it("never declares @capacitor/android, which cap itself already includes", () => {
    //cap writes `include ':capacitor-android'` into capacitor.settings.gradle, so
    //adding it here declares the same Gradle module twice
    expect(adaptvCapacitorNativePkgs("android")).not.toContain(
      "@capacitor/android",
    )
  })

  it("excludes the JS-only core and the CLI", () => {
    for (const platform of ["ios", "android"]) {
      const list = adaptvCapacitorNativePkgs(platform)
      expect(list).not.toContain("@capacitor/core")
      expect(list).not.toContain("@capacitor/cli")
    }
  })
})

describe("🔴 the CLI and the OTA fingerprint must answer the same question", () => {
  it("agrees with carriesNativeCode over adaptv's real dependencies", () => {
    // A plugin the CLI compiles in but the fingerprint cannot see is native code the
    // compatibility gate misses changing; the reverse lets a bundle call a plugin that
    // was never built. Two implementations exist only because every caller in the CLI
    // is synchronous — so this asserts they cannot drift apart.
    const deps = Object.keys(
      JSON.parse(
        readFileSync(path.join(ADAPTV_ROOT, "package.json"), "utf8"),
      ).dependencies ?? {},
    )
    const fingerprintSays = deps
      .filter((n) => carriesNativeCode(dirOf(n)))
      .sort()
    //the CLI list minus the forced platform entry, which is not a plugin
    const cliSays = adaptvCapacitorNativePkgs("ios")
      .filter((n) => n !== "@capacitor/ios")
      .sort()

    expect(cliSays).toEqual(fingerprintSays)
  })

  it("finds the OTA plugin through the shared predicate too", () => {
    //guards the other half of the same prefix bug, in installed-plugins.ts
    expect(carriesNativeCode(dirOf(OTA_PLUGIN))).toBe(true)
  })
})

describe("a plugin whose exports map leaves out ./package.json", () => {
  //`require.resolve("<pkg>/package.json")` throws ERR_PACKAGE_PATH_NOT_EXPORTED for
  //these, so a resolver built on it drops the plugin: compiled out of the binary by
  //the CLI, and invisible to the OTA fingerprint
  const SEALED = "@vendor/sealed"
  let root
  beforeAll(() => {
    root = mkdtempSync(path.join(tmpdir(), "adaptv-sealed-"))
    writeFileSync(
      path.join(root, "package.json"),
      JSON.stringify({ dependencies: { [SEALED]: "1.0.0" } }),
    )
    const dir = path.join(root, "node_modules", SEALED)
    mkdirSync(path.join(dir, "android"), { recursive: true })
    writeFileSync(
      path.join(dir, "package.json"),
      JSON.stringify({
        name: SEALED,
        capacitor: {},
        exports: { ".": "./index.js" },
      }),
    )
    writeFileSync(path.join(dir, "index.js"), "")
  })
  afterAll(() => rmSync(root, { recursive: true, force: true }))

  it("is compiled in by the CLI", () => {
    expect(adaptvCapacitorNativePkgs("android", root)).toContain(SEALED)
  })

  it("is found by the native injectors and preflight", () => {
    expect(pkgDirResolver(root)(SEALED)).toBe(
      path.join(root, "node_modules", SEALED),
    )
  })

  it("is counted by the fingerprint, in step with the CLI", () => {
    expect(carriesNativeCode(pluginDir(SEALED, root, root))).toBe(true)
    expect(adaptvCapacitorNativePkgs("ios", root)).toEqual([SEALED])
  })
})

/** Resolve from adaptv, where its own dependencies live — the fingerprint's resolver. */
function dirOf(name) {
  return pluginDir(name, ADAPTV_ROOT, ADAPTV_ROOT)
}
