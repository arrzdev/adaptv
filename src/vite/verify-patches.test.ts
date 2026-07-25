import { readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import {
  assertRouteTreeIsOpaque,
  checkPatches,
  describeMissingPatches,
  parsePatchFilename,
  patchInstructions,
} from "#adaptv/vite/verify-patches"

const PATCHED_SCHEMA = `var tsrConfig = configSchema.omit({ autoCodeSplitting: true, target: true }).partial();`
const UNPATCHED_SCHEMA = `var tsrConfig = configSchema.omit({ autoCodeSplitting: true, target: true, verboseFileRoutes: true }).partial();`
const PATCHED_TEMPLATE = `function adaptvRouterPkg(f){return process.env.ADAPTV_ROUTER_PKG || f}`
const UNPATCHED_TEMPLATE = `fullPkg: "@tanstack/react-router",`

describe("checkPatches — detects behaviour, not pnpm metadata", () => {
  //Checking the INSTALLED SOURCE is the honest test: true exactly when the
  //feature works, and immune to a stale lockfile, a partial install, or a
  //hoisting layout that resolved a different copy than the one patched.
  it("passes when both patches are applied", () => {
    expect(
      checkPatches({
        startSchema: PATCHED_SCHEMA,
        generatorTemplate: PATCHED_TEMPLATE,
      }).ok,
    ).toBe(true)
  })

  it("catches the unpatched Start schema", () => {
    const status = checkPatches({
      startSchema: UNPATCHED_SCHEMA,
      generatorTemplate: PATCHED_TEMPLATE,
    })
    expect(status.ok).toBe(false)
    expect(status.missing).toContain("@tanstack/start-plugin-core")
  })

  it("catches the unpatched generator template", () => {
    const status = checkPatches({
      startSchema: PATCHED_SCHEMA,
      generatorTemplate: UNPATCHED_TEMPLATE,
    })
    expect(status.ok).toBe(false)
    expect(status.missing).toContain("@tanstack/router-generator")
  })

  it("reports both when both are missing", () => {
    expect(
      checkPatches({
        startSchema: UNPATCHED_SCHEMA,
        generatorTemplate: UNPATCHED_TEMPLATE,
      }).missing,
    ).toHaveLength(2)
  })

  it("stays silent about a file it could not read", () => {
    //an unreadable dependency is not evidence of an unpatched one — guessing
    //would fail builds that are actually fine
    expect(checkPatches({}).ok).toBe(true)
  })
})

describe("describeMissingPatches", () => {
  it("explains WHY the failure is loud rather than silent", () => {
    const message = describeMissingPatches(["@tanstack/router-generator"])
    expect(message).toContain("silently")
    expect(message).toContain("build still")
  })

  it("gives the exact fix, including the pnpm-workspace key", () => {
    //a diagnostic that only names the fault sends people reading framework source
    const message = describeMissingPatches(["@tanstack/router-generator"])
    expect(message).toContain("patchedDependencies:")
    expect(message).toContain("@arrzdev/adaptv/patches/")
    expect(message).toContain("pnpm install")
  })

  it("mentions the incremental-install trap that cost real debugging time", () => {
    //pnpm reported "Already up to date" and skipped the patch even with --force
    //and the package directory deleted; only a full node_modules wipe worked
    expect(describeMissingPatches(["x"])).toContain("node_modules")
  })
})

describe("patch instructions — derived from what actually shipped", () => {
  const patchesDir = join(process.cwd(), "patches")

  it("decodes a patch filename into its pnpm key", () => {
    expect(
      parsePatchFilename("@tanstack__router-generator@1.166.22.patch"),
    ).toEqual({
      key: "@tanstack/router-generator@1.166.22",
      file: "@tanstack__router-generator@1.166.22.patch",
    })
    //pnpm's filename convention already carries the leading `@` — decoding only
    //the scope separator. Prepending one produced `@@capacitor/cli`.
    expect(parsePatchFilename("@capacitor__cli@8.4.2.patch")?.key).toBe(
      "@capacitor/cli@8.4.2",
    )
  })

  it("ignores unversioned patches and non-patch files (L21: keys are version-pinned)", () => {
    expect(
      parsePatchFilename("@tanstack__start-plugin-core.patch"),
    ).toBeNull()
    expect(parsePatchFilename("README.md")).toBeNull()
  })

  it("tells the consumer to install every patch adaptv actually ships", () => {
    //Regression: the block was hardcoded and listed two patches under
    //unversioned names. Version-keying (L21) renamed the files, so it pointed at
    //paths that did not exist — and it never mentioned the @capacitor/cli patch,
    //which is what lets adaptv own Capacitor without a config file (L20).
    const shipped = readdirSync(patchesDir).filter((f) =>
      f.endsWith(".patch"),
    )
    const message = describeMissingPatches(["x"])
    expect(shipped.length).toBeGreaterThan(0)
    for (const file of shipped) expect(message).toContain(file)
  })

  it("emits exactly the keys adaptv declares in its own pnpm-workspace.yaml", () => {
    //The instructions and the declaration are the same fact stated twice; this
    //fails if a patch is added, renamed or version-bumped in only one of them.
    const yaml = readFileSync(
      join(process.cwd(), "pnpm-workspace.yaml"),
      "utf8",
    )
    const declared = [...yaml.matchAll(/^\s+'([^']+)':\s*patches\//gm)]
      .map((m) => m[1])
      .sort()
    const advertised = patchInstructions(readdirSync(patchesDir))
      .map((l) => l.trim().split("':")[0].slice(1))
      .sort()
    expect(declared.length).toBe(3)
    expect(advertised).toEqual(declared)
  })
})

describe("assertRouteTreeIsOpaque — the outcome-based check", () => {
  //Two earlier versions checked the patched dependency FILES and both passed
  //silently, because those packages are transitive deps of @tanstack/react-start
  //and pnpm's strict layout makes them unresolvable by name — from the app root
  //AND from adaptv. A checker that cannot read what it checks reports success,
  //which is worse than having none. This one tests the outcome instead.
  it("passes on a tree that references only adaptv", () => {
    const file = join(tmpdir(), `adaptv-opaque-ok-${process.pid}.ts`)
    writeFileSync(
      file,
      'import type { CreateFileRoute } from "@arrzdev/adaptv/router"',
    )
    expect(() => assertRouteTreeIsOpaque(file)).not.toThrow()
    rmSync(file, { force: true })
  })

  it("throws when the tree still references @tanstack", () => {
    const file = join(tmpdir(), `adaptv-opaque-bad-${process.pid}.ts`)
    writeFileSync(file, 'import type { X } from "@tanstack/react-router"')
    expect(() => assertRouteTreeIsOpaque(file)).toThrow(/@tanstack/)
    rmSync(file, { force: true })
  })

  it("names the fix in the failure, not just the fault", () => {
    const file = join(tmpdir(), `adaptv-opaque-fix-${process.pid}.ts`)
    writeFileSync(file, 'import "@tanstack/react-start"')
    expect(() => assertRouteTreeIsOpaque(file)).toThrow(
      /patchedDependencies/,
    )
    rmSync(file, { force: true })
  })

  it("stays quiet when the tree has not been generated yet", () => {
    expect(() =>
      assertRouteTreeIsOpaque(join(tmpdir(), "definitely-not-here.ts")),
    ).not.toThrow()
  })
})
