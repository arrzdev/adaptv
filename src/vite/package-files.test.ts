// @vitest-environment node
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { describe, expect, it } from "vitest"
import {
  adaptvPackage,
  adaptvShippedFile,
  SHIPPED_FILES,
} from "#adaptv/vite/package-files.ts"

/*
 * `/vite` located its own files with `new URL("../..", import.meta.url)`, which is the
 * package root from `src/vite/` and the directory ABOVE the package from `dist/vite.mjs`.
 * These pin the walk-up that replaced it, from every place the code runs.
 */

/** A package root named adaptv, inside a directory that is itself a package. */
function fixture(): string {
  const outer = mkdtempSync(path.join(tmpdir(), "adaptv-package-files-"))
  writeFileSync(
    path.join(outer, "package.json"),
    JSON.stringify({ name: "my-app" }),
  )
  const root = path.join(outer, "node_modules", "adaptv")
  mkdirSync(root, { recursive: true })
  writeFileSync(
    path.join(root, "package.json"),
    JSON.stringify({ name: "adaptv" }),
  )
  return root
}

describe("adaptvPackage", () => {
  it("finds the root and the src layout from src/vite/", () => {
    const root = fixture()
    expect(
      adaptvPackage(path.join(root, "src/vite/adaptv-plugin.ts")),
    ).toEqual({ root, layout: "src" })
  })

  it("finds the root and the dist layout from dist/vite.mjs, one level up", () => {
    const root = fixture()
    expect(adaptvPackage(path.join(root, "dist/vite.mjs"))).toEqual({
      root,
      layout: "dist",
    })
  })

  it("finds the root from a CLI module under dist/cli/", () => {
    const root = fixture()
    expect(
      adaptvPackage(path.join(root, "dist/cli/vite/verify-patches.mjs")),
    ).toEqual({ root, layout: "dist" })
  })

  it("throws when no package.json above names adaptv", () => {
    const outer = mkdtempSync(path.join(tmpdir(), "adaptv-package-files-"))
    expect(() => adaptvPackage(path.join(outer, "dist/vite.mjs"))).toThrow(
      /no adaptv package\.json/,
    )
  })

  it("is this checkout's root, in the src layout, when run from source", () => {
    expect(adaptvPackage()).toEqual({ root: process.cwd(), layout: "src" })
  })
})

describe("adaptvShippedFile", () => {
  it("hands the consumer's build the copy that matches the layout", () => {
    const root = "/pkg"
    expect(
      adaptvShippedFile("router-entry", { root, layout: "src" }),
    ).toBe(path.join(root, "src/routes/router-entry.tsx"))
    expect(
      adaptvShippedFile("router-entry", { root, layout: "dist" }),
    ).toBe(path.join(root, "dist/router-entry.mjs"))
  })

  //A dist path that no build emits is a published package whose consumer build fails to
  //find its own client entry. `pnpm build:check` sees the files; this sees the mapping.
  it("names, for every dist file, a tsdown entry built from the same source", () => {
    //Read as text, the way `src/execution-boundary.test.ts` does: the config imports a
    //plain `.mjs` this program has no types for.
    const config = readFileSync(
      path.join(process.cwd(), "tsdown.config.ts"),
      "utf8",
    )
    for (const { src, dist } of Object.values(SHIPPED_FILES)) {
      expect(dist, dist).toMatch(/^dist\/[^/]+\.mjs$/)
      const name = path.basename(dist, ".mjs")
      expect(config, dist).toContain(`"${name}": "${src}"`)
    }
  })
})
