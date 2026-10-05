// @vitest-environment node
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, relative } from "node:path"
import { fileURLToPath } from "node:url"
import { afterAll, describe, expect, it } from "vitest"
import { create } from "../packages/create-adaptv/create.mjs"

/*
 * `examples/basic` is what the README quick start runs: the app `create-adaptv` writes,
 * installed from this checkout's `pnpm pack` tarball. Two things drift silently: the
 * tarball name carries the version, and the patches the app carries carry theirs.
 * Either one stale fails the quick start at `pnpm install`, which no other suite runs.
 * The patches are the template's, and `create.test.mjs` holds those to the repo's.
 *
 * The example also pins the repo's pnpm in `packageManager`, which a created app does not:
 * copied out of the repo, it would otherwise install with whatever pnpm is global.
 */

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..")
const EXAMPLE = join(ROOT, "examples/basic")
const read = (dir, file) => readFileSync(join(dir, file), "utf8")
const rootPkg = JSON.parse(read(ROOT, "package.json"))
const TARBALL = `file:../../arrzdev-adaptv-${rootPkg.version}.tgz`

/** `package.json` as create-adaptv writes it: the example's, without its pnpm pin. */
function unpinned(text) {
  const { packageManager: _, ...pkg } = JSON.parse(text)
  return `${JSON.stringify(pkg, null, 2)}\n`
}

/** Every file under `dir`, relative to it, skipping what an install or a build writes. */
function files(dir, at = dir) {
  return readdirSync(at, { withFileTypes: true }).flatMap((entry) => {
    const path = join(at, entry.name)
    if (entry.isDirectory())
      return ["node_modules", ".adaptv", ".output", "dist"].includes(
        entry.name,
      )
        ? []
        : files(dir, path)
    return [relative(dir, path)]
  })
}

const temp = mkdtempSync(join(tmpdir(), "examples-basic-"))
afterAll(() => rmSync(temp, { recursive: true, force: true }))

describe("examples/basic", () => {
  it("installs the tarball `pnpm pack` writes for this version", () => {
    const pkg = JSON.parse(read(EXAMPLE, "package.json"))
    expect(pkg.dependencies["@arrzdev/adaptv"]).toBe(TARBALL)
  })

  it("pins the pnpm this repo uses", () => {
    const pkg = JSON.parse(read(EXAMPLE, "package.json"))
    expect(pkg.packageManager).toBe(rootPkg.packageManager)
  })

  it("is the app create-adaptv writes, patches included", () => {
    const created = join(temp, "basic")
    create({ dir: created, name: "basic", adaptv: TARBALL })
    const ignored = [".gitignore", "pnpm-lock.yaml"]
    const ours = files(EXAMPLE).filter((f) => !ignored.includes(f))
    expect(ours.sort()).toEqual(
      files(created)
        .filter((f) => !ignored.includes(f))
        .sort(),
    )
    for (const file of ours)
      expect(
        file === "package.json"
          ? unpinned(read(EXAMPLE, file))
          : read(EXAMPLE, file),
        file,
      ).toBe(read(created, file))
  })
})
