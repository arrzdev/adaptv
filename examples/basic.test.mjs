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
 * tarball name carries the version, and the patches it declares carry theirs. Either
 * one stale fails the quick start at `pnpm install`, which no other suite runs.
 */

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..")
const EXAMPLE = join(ROOT, "examples/basic")
const read = (dir, file) => readFileSync(join(dir, file), "utf8")
const rootPkg = JSON.parse(read(ROOT, "package.json"))
const TARBALL = `file:../../arrzdev-adaptv-${rootPkg.version}.tgz`

/** `'name@version': path` rows under `patchedDependencies`, as a map. */
function patches(dir) {
  const block = read(dir, "pnpm-workspace.yaml").split(
    /^patchedDependencies:\n/m,
  )[1]
  return Object.fromEntries(
    [...(block ?? "").matchAll(/^ {2}'([^']+)': (\S+)$/gm)].map((m) => [
      m[1],
      m[2],
    ]),
  )
}

/** Every file under `dir`, relative to it, skipping what an install or a build writes. */
function files(dir, at = dir) {
  return readdirSync(at, { withFileTypes: true }).flatMap((entry) => {
    const path = join(at, entry.name)
    if (entry.isDirectory())
      return [
        "node_modules",
        ".adaptv",
        ".output",
        "dist",
        "patches",
      ].includes(entry.name)
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

  it("is the app create-adaptv writes, apart from its patches", () => {
    const created = join(temp, "basic")
    create({ dir: created, name: "basic", adaptv: TARBALL })
    const ignored = ["pnpm-workspace.yaml", ".gitignore", "pnpm-lock.yaml"]
    const ours = files(EXAMPLE).filter((f) => !ignored.includes(f))
    expect(ours.sort()).toEqual(
      files(created)
        .filter((f) => !ignored.includes(f))
        .sort(),
    )
    for (const file of ours)
      expect(read(EXAMPLE, file), file).toBe(read(created, file))
  })

  it("declares every patch the framework applies, from the repo's patches/", () => {
    const expected = Object.fromEntries(
      Object.entries(patches(ROOT)).map(([key, file]) => [
        key,
        `../../${file}`,
      ]),
    )
    expect(Object.keys(expected).length).toBeGreaterThan(0)
    expect(patches(EXAMPLE)).toEqual(expected)
  })
})
