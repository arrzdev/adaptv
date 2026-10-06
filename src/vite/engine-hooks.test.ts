// @vitest-environment node
import { readFileSync } from "node:fs"
import { createRequire } from "node:module"
import path from "node:path"
import { pathToFileURL } from "node:url"
import { describe, expect, it } from "vitest"
import type { EngineEdit } from "#adaptv/vite/engine-hooks"
import {
  assertEngineEdited,
  ENGINE_EDITS,
  editEngineSource,
  engineModule,
} from "#adaptv/vite/engine-hooks"

//The engine as this checkout installed it, unpatched: resolved the way Start resolves
//it, since neither package is adaptv's own dependency.
function installedRoot(pkg: string): string {
  const fromAdaptv = createRequire(import.meta.url)
  const fromStart = createRequire(
    fromAdaptv.resolve("@tanstack/react-start/package.json"),
  )
  const corePkg = fromStart.resolve(
    "@tanstack/start-plugin-core/package.json",
  )
  if (pkg === "@tanstack/start-plugin-core") return path.dirname(corePkg)
  return path.dirname(
    createRequire(corePkg).resolve(`${pkg}/package.json`),
  )
}

const EDIT: EngineEdit = {
  pkg: "@scope/engine",
  version: "1.0.0",
  file: "dist/esm/a.js",
  replace: [["const a = 1;", "const a = 2;"]],
}

describe("editEngineSource", () => {
  it("replaces the text it names", () => {
    expect(editEngineSource(EDIT, "1.0.0", "x\nconst a = 1;\ny")).toBe(
      "x\nconst a = 2;\ny",
    )
  })

  it("throws, naming the file and both versions, on another version", () => {
    expect(() => editEngineSource(EDIT, "1.0.1", "const a = 1;")).toThrow(
      "[adaptv] @scope/engine@1.0.1 dist/esm/a.js: adaptv edits @scope/engine@1.0.0 only.",
    )
  })

  it("throws, naming the file and the version, when the text moved", () => {
    expect(() => editEngineSource(EDIT, "1.0.0", "const a = 3;")).toThrow(
      "[adaptv] @scope/engine@1.0.0 dist/esm/a.js no longer contains, exactly once, the text adaptv replaces: const a = 1;",
    )
  })

  it("tells an app that still patches the file to stop", () => {
    expect(() => editEngineSource(EDIT, "1.0.0", "const a = 2;")).toThrow(
      "[adaptv] @scope/engine@1.0.0 dist/esm/a.js is already patched.",
    )
  })

  it("throws when the text is there twice", () => {
    expect(() =>
      editEngineSource(EDIT, "1.0.0", "const a = 1;const a = 1;"),
    ).toThrow(/exactly once/)
  })
})

describe("engineModule", () => {
  it("finds the package and the file under a pnpm store path", () => {
    const url = pathToFileURL(
      "/app/node_modules/.pnpm/@tanstack+router-generator@1.167.21/node_modules/@tanstack/router-generator/dist/esm/transform/transform.js",
    ).href
    expect(engineModule(url)).toEqual({
      edit: ENGINE_EDITS[0],
      root: "/app/node_modules/.pnpm/@tanstack+router-generator@1.167.21/node_modules/@tanstack/router-generator/",
      file: "dist/esm/transform/transform.js",
    })
  })

  it("leaves every other module alone", () => {
    expect(
      engineModule(
        pathToFileURL("/app/node_modules/@tanstack/react-router/dist/a.js")
          .href,
      ),
    ).toBeNull()
    expect(engineModule("node:fs")).toBeNull()
  })
})

describe("the installed engine", () => {
  //a bump of either package fails here first, naming the edit that no longer fits
  it.each(ENGINE_EDITS)("takes every edit to $pkg", (edit) => {
    const root = installedRoot(edit.pkg)
    const { version } = JSON.parse(
      readFileSync(path.join(root, "package.json"), "utf8"),
    )
    const source = readFileSync(path.join(root, edit.file), "utf8")
    expect(() => editEngineSource(edit, version, source)).not.toThrow()
  })

  //vitest.setup.ts installs the hook, as `@arrzdev/adaptv/vite` does before it loads
  //the plugin; so what Node loads here is the edited engine
  it("is loaded edited", async () => {
    await import("@tanstack/react-start/plugin/vite")
    expect(() => assertEngineEdited()).not.toThrow()
    const constants = await import(
      pathToFileURL(
        path.join(
          installedRoot("@tanstack/start-plugin-core"),
          "dist/esm/constants.js",
        ),
      ).href
    )
    expect(constants.ENTRY_POINTS.client).toBe(
      "virtual:adaptv/client-entry",
    )
    expect(constants.DEV_CLIENT_ENTRY).toBe(
      "virtual:adaptv/dev-client-entry",
    )
  })
})
