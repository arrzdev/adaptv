// @vitest-environment node
import { mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { describe, expect, it } from "vitest"
import {
  adaptvEngineImportsPlugin,
  declaredBy,
  describeEngineImport,
  importsIn,
  isInternalPackage,
  packageOf,
} from "#adaptv/vite/engine-imports.ts"

/*
 * An app imported `@tanstack/react-router` without listing it, and it worked: npm hoists
 * adaptv's dependencies into the app's `node_modules`, and under pnpm
 * `tanstack-resolve.ts` resolves every `@tanstack/*` import in the app's files from
 * adaptv. The end-to-end proof that a created app is refused, under either layout, and
 * builds once it lists the package, is `packages/create-adaptv/create.test.mjs`.
 */

const DEPS = new Set(["@tanstack/react-router", "@capacitor/core", "ink"])

describe("packageOf", () => {
  it("names the package of a bare specifier, scoped or not, with or without a subpath", () => {
    expect(packageOf("@tanstack/react-router")).toBe(
      "@tanstack/react-router",
    )
    expect(packageOf("@tanstack/react-start/server")).toBe(
      "@tanstack/react-start",
    )
    expect(packageOf("ink")).toBe("ink")
    expect(packageOf("workbox-core/types")).toBe("workbox-core")
  })

  it("names none for a relative, absolute, builtin or virtual one", () => {
    for (const specifier of [
      "./home",
      "../lib/a.ts",
      "/abs/x",
      "node:fs",
      "virtual:adaptv-config",
      "\0virtual",
      "#app/x",
    ])
      expect(packageOf(specifier), specifier).toBeNull()
  })
})

describe("isInternalPackage", () => {
  it("covers adaptv's dependencies and the whole engine scope", () => {
    expect(isInternalPackage("@capacitor/core", DEPS)).toBe(true)
    expect(isInternalPackage("@tanstack/router-core", DEPS)).toBe(true)
    expect(isInternalPackage("@tanstack/react-query", DEPS)).toBe(true)
  })

  it("leaves the app's own packages and adaptv's peers alone", () => {
    for (const name of ["react", "motion", "zod", "adaptv"])
      expect(isInternalPackage(name, DEPS), name).toBe(false)
  })
})

describe("importsIn", () => {
  it("finds static, type-only, dynamic and re-exported specifiers at their offsets", () => {
    const code = [
      `import { Link } from "@tanstack/react-router"`,
      `import type { AnyRouter } from "@tanstack/router-core"`,
      `export { x } from "./x"`,
      `export * from "ink"`,
      `const m = () => import("@capacitor/core")`,
      `const s = "@tanstack/react-start" // a string is not an import`,
    ].join("\n")
    const found = importsIn(code, "/app/src/a.ts")
    expect(found.map((f) => f.source)).toEqual([
      "@tanstack/react-router",
      "@tanstack/router-core",
      "./x",
      "ink",
      "@capacitor/core",
    ])
    expect(code.slice(found[0]?.start)).toMatch(
      /^"@tanstack\/react-router"/,
    )
  })

  it("reads JSX in a .tsx file and a type assertion in a .ts one", () => {
    expect(
      importsIn(
        `import { Outlet } from "@tanstack/react-router"\nexport const A = () => <Outlet />`,
        "/app/src/a.tsx",
      ).map((f) => f.source),
    ).toEqual(["@tanstack/react-router"])
    expect(
      importsIn(
        `import a from "ink"\nconst b = <string>a`,
        "/app/src/a.ts",
      ),
    ).toHaveLength(1)
  })
})

describe("declaredBy", () => {
  it("reads every dependency field of the app's package.json", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "adaptv-declared-"))
    writeFileSync(
      path.join(dir, "package.json"),
      JSON.stringify({
        dependencies: { react: "19" },
        devDependencies: { "@tanstack/react-router": "1" },
        peerDependencies: { ink: "6" },
        optionalDependencies: { sharp: "0" },
      }),
    )
    expect([...declaredBy(dir)].sort()).toEqual([
      "@tanstack/react-router",
      "ink",
      "react",
      "sharp",
    ])
  })

  it("is empty when there is no package.json", () => {
    expect(declaredBy(path.join(tmpdir(), "adaptv-no-such-app"))).toEqual(
      new Set(),
    )
  })
})

describe("the refusal", () => {
  it("says the file and the fix on a first line that does not name the package", () => {
    const [first, ...rest] = describeEngineImport(
      "@tanstack/react-router",
      "src/routes/a.tsx",
    ).split("\n")
    //the CLI shows the first line, and would drop it if it named the engine
    expect(first).toMatch(/^src\/routes\/a\.tsx imports a package/)
    expect(first).not.toMatch(/tanstack/i)
    expect(first).toContain("package.json")
    expect(first).toContain("adaptv")
    expect(rest.join("\n")).toContain('"@tanstack/react-router"')
  })
})

describe("adaptvEngineImportsPlugin", () => {
  function app(declared: Record<string, string>) {
    const root = mkdtempSync(path.join(tmpdir(), "adaptv-app-"))
    writeFileSync(
      path.join(root, "package.json"),
      JSON.stringify({ dependencies: declared }),
    )
    const pkg = mkdtempSync(path.join(tmpdir(), "adaptv-pkg-"))
    writeFileSync(
      path.join(pkg, "package.json"),
      JSON.stringify({
        dependencies: { "@tanstack/react-router": "1", ink: "6" },
      }),
    )
    const plugin = adaptvEngineImportsPlugin(root, pkg)
    const hook = plugin.transform as (
      this: unknown,
      code: string,
      id: string,
    ) => unknown
    const run = (
      code: string,
      id = path.join(root, "src/routes/a.tsx"),
    ) => {
      let refused: { message: string; id: string; at: number } | undefined
      let result: unknown
      try {
        result = hook.call(
          {
            error: (e: { message: string; id: string }, at: number) => {
              refused = { ...e, at }
              throw new Error("refused")
            },
          },
          code,
          id,
        )
      } catch {}
      return { result, refused }
    }
    return { root, run }
  }

  const ROUTER = `import { Link } from "@tanstack/react-router"\n`

  it("refuses an import of a package the app does not list, at the specifier", () => {
    const { run, root } = app({ react: "19" })
    const id = path.join(root, "src/routes/a.tsx")
    const { refused } = run(
      `import { useState } from "react"\n${ROUTER}`,
      id,
    )
    expect(refused).toEqual({
      message: describeEngineImport(
        "@tanstack/react-router",
        "src/routes/a.tsx",
      ),
      id,
      at: `import { useState } from "react"\nimport { Link } from `.length,
    })
  })

  it("refuses a transitive engine package and a non-engine dependency alike", () => {
    const { run } = app({})
    expect(
      run(`import type { A } from "@tanstack/router-core"`).refused,
    ).toBeDefined()
    expect(run(`import { render } from "ink"`).refused).toBeDefined()
  })

  it("lets the app import a package it lists", () => {
    const { run } = app({ "@tanstack/react-router": "1.170.18" })
    expect(run(ROUTER)).toEqual({ result: null, refused: undefined })
  })

  it("leaves the server-only modules to the server ban", () => {
    const { run } = app({})
    expect(
      run(`import { createServerFn } from "@tanstack/react-start"\n`)
        .result,
    ).toBeNull()
  })

  it("checks only the app's own files, as written", () => {
    const { run, root } = app({})
    for (const id of [
      path.join(root, "node_modules/x/index.js"),
      path.join(root, "src/routes/a.tsx?tsr-split=component"),
      path.join(root, "src/styles.css"),
      path.join(tmpdir(), "elsewhere/adaptv/dist/router.mjs"),
    ])
      expect(run(ROUTER, id).result, id).toBeNull()
  })
})
