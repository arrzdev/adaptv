import { rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import {
  assertRouteTreeIsOpaque,
  checkPatches,
  describeMissingPatches,
} from "#nativ/vite/verify-patches"

const PATCHED_SCHEMA = `var tsrConfig = configSchema.omit({ autoCodeSplitting: true, target: true }).partial();`
const UNPATCHED_SCHEMA = `var tsrConfig = configSchema.omit({ autoCodeSplitting: true, target: true, verboseFileRoutes: true }).partial();`
const PATCHED_TEMPLATE = `function nativRouterPkg(f){return process.env.NATIV_ROUTER_PKG || f}`
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
    expect(message).toContain("@arrzdev/nativ/patches/")
    expect(message).toContain("pnpm install")
  })

  it("mentions the incremental-install trap that cost real debugging time", () => {
    //pnpm reported "Already up to date" and skipped the patch even with --force
    //and the package directory deleted; only a full node_modules wipe worked
    expect(describeMissingPatches(["x"])).toContain("node_modules")
  })
})

describe("assertRouteTreeIsOpaque — the outcome-based check", () => {
  //Two earlier versions checked the patched dependency FILES and both passed
  //silently, because those packages are transitive deps of @tanstack/react-start
  //and pnpm's strict layout makes them unresolvable by name — from the app root
  //AND from nativ. A checker that cannot read what it checks reports success,
  //which is worse than having none. This one tests the outcome instead.
  it("passes on a tree that references only nativ", () => {
    const file = join(tmpdir(), `nativ-opaque-ok-${process.pid}.ts`)
    writeFileSync(
      file,
      'import type { CreateFileRoute } from "@arrzdev/nativ/router"',
    )
    expect(() => assertRouteTreeIsOpaque(file)).not.toThrow()
    rmSync(file, { force: true })
  })

  it("throws when the tree still references @tanstack", () => {
    const file = join(tmpdir(), `nativ-opaque-bad-${process.pid}.ts`)
    writeFileSync(file, 'import type { X } from "@tanstack/react-router"')
    expect(() => assertRouteTreeIsOpaque(file)).toThrow(/@tanstack/)
    rmSync(file, { force: true })
  })

  it("names the fix in the failure, not just the fault", () => {
    const file = join(tmpdir(), `nativ-opaque-fix-${process.pid}.ts`)
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
