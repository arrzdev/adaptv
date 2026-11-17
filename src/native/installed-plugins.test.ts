// @vitest-environment node
// One enumeration feeds two consumers with opposite tolerances (see the table in
// installed-plugins.ts), so these tests pin both halves separately: the list is
// wide (adaptv's own dependencies first, then everything the app names), and
// `carriesNativeCode` is narrow (a `capacitor` field AND a platform tree).
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it, vi } from "vitest"
import {
  adaptvRoots,
  carriesNativeCode,
  installedPlugins,
  pluginDir,
  readPackageJson,
} from "#adaptv/native/installed-plugins.ts"

const dirs: string[] = []
afterEach(() => {
  for (const dir of dirs.splice(0))
    rmSync(dir, { recursive: true, force: true })
  vi.doUnmock("#adaptv/vite/package-files.ts")
  vi.doUnmock("node:url")
  vi.resetModules()
  vi.restoreAllMocks()
})

function tempDir(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "adaptv-plugins-"))
  dirs.push(dir)
  return dir
}

function writePackage(dir: string, pkg: object): string {
  mkdirSync(dir, { recursive: true })
  writeFileSync(path.join(dir, "package.json"), JSON.stringify(pkg))
  return dir
}

describe("readPackageJson", () => {
  it("is null for no directory, a missing file and broken JSON", () => {
    const dir = tempDir()
    expect(readPackageJson(null)).toBeNull()
    expect(readPackageJson(dir)).toBeNull()
    writeFileSync(path.join(dir, "package.json"), "{ not json")
    expect(readPackageJson(dir)).toBeNull()
  })

  it("parses a real manifest", () => {
    const dir = writePackage(tempDir(), { version: "1.2.3" })
    expect(readPackageJson(dir)).toEqual({ version: "1.2.3" })
  })
})

describe("adaptvRoots", () => {
  it("tries the given root first, then the package's own, then the cwd", () => {
    const roots = adaptvRoots("/given")
    expect(roots[0]).toBe("/given")
    expect(roots.at(-1)).toBe(process.cwd())
    expect(roots).toHaveLength(3)
  })

  it("leaves out an absent given root", () => {
    expect(adaptvRoots(undefined)).toHaveLength(2)
  })

  it("falls back to the cwd when the package cannot locate itself", async () => {
    vi.doMock("#adaptv/vite/package-files.ts", () => ({
      adaptvPackageRoot: () => {
        throw new Error("no file: URL under this loader")
      },
    }))
    const fresh = await import("#adaptv/native/installed-plugins.ts")
    expect(fresh.adaptvRoots(undefined)).toEqual([process.cwd()])
    expect(fresh.adaptvRoots("/given")).toEqual(["/given", process.cwd()])
  })
})

describe("installedPlugins", () => {
  it("starts with adaptv's own dependencies, whatever their vendor", () => {
    const adaptvRoot = writePackage(tempDir(), {
      dependencies: {
        "@capacitor/device": "1",
        "@capawesome/capacitor-live-update": "1",
      },
    })
    const app = writePackage(tempDir(), {})
    expect(installedPlugins(app, { adaptvRoot })).toEqual([
      "@capacitor/device",
      "@capawesome/capacitor-live-update",
    ])
  })

  it("reads only the first adaptv root that has dependencies", () => {
    //the given root wins; the real package's long list must not be merged in
    const adaptvRoot = writePackage(tempDir(), {
      dependencies: { "@capacitor/device": "1" },
    })
    const app = writePackage(tempDir(), {})
    expect(installedPlugins(app, { adaptvRoot })).toEqual([
      "@capacitor/device",
    ])
  })

  it("skips a given root with no dependencies and reads the next one", () => {
    const adaptvRoot = writePackage(tempDir(), { name: "empty" })
    const app = writePackage(tempDir(), {})
    //the next root is this checkout, which bundles Capacitor
    expect(installedPlugins(app, { adaptvRoot })).toContain(
      "@capacitor/preferences",
    )
  })

  it("adds the app's dependencies, dev dependencies and config plugins, once each", () => {
    const adaptvRoot = writePackage(tempDir(), {
      dependencies: { "@capacitor/device": "1" },
    })
    const app = writePackage(tempDir(), {
      dependencies: { "@capacitor/camera": "1", "@capacitor/device": "1" },
      devDependencies: { vitest: "1" },
    })
    expect(
      installedPlugins(app, {
        adaptvRoot,
        plugins: ["@vendor/scanner", "@capacitor/camera"],
      }),
    ).toEqual([
      "@capacitor/device",
      "@capacitor/camera",
      "vitest",
      "@vendor/scanner",
    ])
  })

  it("still lists adaptv's plugins for an app with no package.json and no input", () => {
    const list = installedPlugins(tempDir(), undefined)
    expect(list).toContain("@capacitor/device")
    expect(list).toContain("@capawesome/capacitor-live-update")
  })
})

describe("pluginDir", () => {
  it("finds a plugin the app installed", () => {
    const app = writePackage(tempDir(), {})
    const dir = writePackage(
      path.join(app, "node_modules/@vendor/scanner"),
      {
        name: "@vendor/scanner",
      },
    )
    expect(pluginDir("@vendor/scanner", app, undefined)).toBe(dir)
  })

  it("prefers the app's copy over adaptv's", () => {
    const app = writePackage(tempDir(), {})
    const adaptvRoot = writePackage(tempDir(), {})
    const appCopy = writePackage(path.join(app, "node_modules/shared"), {
      name: "shared",
    })
    writePackage(path.join(adaptvRoot, "node_modules/shared"), {
      name: "shared",
    })
    expect(pluginDir("shared", app, adaptvRoot)).toBe(appCopy)
  })

  it("falls back to a plugin only adaptv can see", () => {
    const app = writePackage(tempDir(), {})
    const adaptvRoot = writePackage(tempDir(), {})
    const dir = writePackage(
      path.join(adaptvRoot, "node_modules/@capacitor/x"),
      {
        name: "@capacitor/x",
      },
    )
    expect(pluginDir("@capacitor/x", app, adaptvRoot)).toBe(dir)
  })

  it("resolves from the module's own tree when no adaptv root is given", () => {
    const app = writePackage(tempDir(), {})
    expect(pluginDir("@capacitor/device", app, undefined)).toMatch(
      /@capacitor[/\\]device$/,
    )
  })

  it("resolves from the cwd when the module URL is not a file path", async () => {
    //what `bin/lib/load-ts.mjs` hands out: a `data:` URL
    vi.doMock("node:url", async (original) => ({
      ...(await original<typeof import("node:url")>()),
      fileURLToPath: () => {
        throw new TypeError("The URL must be of scheme file")
      },
    }))
    const fresh = await import("#adaptv/native/installed-plugins.ts")
    const app = writePackage(tempDir(), {})
    //found through `process.cwd()`, which is this checkout
    expect(fresh.pluginDir("@capacitor/device", app, undefined)).toMatch(
      /@capacitor[/\\]device$/,
    )
  })

  it("finds a plugin whose exports map leaves out ./package.json", () => {
    //`require.resolve("<pkg>/package.json")` throws ERR_PACKAGE_PATH_NOT_EXPORTED
    //for these, and a null here drops the plugin out of the OTA fingerprint
    const app = writePackage(tempDir(), {})
    const dir = writePackage(
      path.join(app, "node_modules/@vendor/sealed"),
      {
        name: "@vendor/sealed",
        exports: { ".": "./index.js" },
      },
    )
    writeFileSync(path.join(dir, "index.js"), "")
    expect(pluginDir("@vendor/sealed", app, undefined)).toBe(dir)
  })

  it("is null when neither root can see the package", () => {
    const app = writePackage(tempDir(), {})
    const adaptvRoot = writePackage(tempDir(), {})
    expect(pluginDir("@vendor/absent", app, adaptvRoot)).toBeNull()
  })
})

describe("carriesNativeCode", () => {
  function plugin(pkg: object, platforms: string[]): string {
    const dir = writePackage(tempDir(), pkg)
    for (const p of platforms) mkdirSync(path.join(dir, p))
    return dir
  }

  it("needs a capacitor field and a platform tree", () => {
    expect(carriesNativeCode(plugin({ capacitor: {} }, ["ios"]))).toBe(
      true,
    )
    expect(carriesNativeCode(plugin({ capacitor: {} }, ["android"]))).toBe(
      true,
    )
  })

  it("is false for the field alone, like @capacitor/cli", () => {
    expect(carriesNativeCode(plugin({ capacitor: {} }, []))).toBe(false)
  })

  it("is false for a platform folder without the field", () => {
    expect(carriesNativeCode(plugin({}, ["ios", "android"]))).toBe(false)
  })

  it("is false for no directory or an unreadable manifest", () => {
    expect(carriesNativeCode(null)).toBe(false)
    expect(carriesNativeCode(tempDir())).toBe(false)
  })
})
