import path from "node:path"
import { describe, expect, it } from "vitest"
import {
  ADAPTV_DIR,
  adaptvDirGitignoreEntry,
  adaptvDirTsconfigPaths,
  resolveGeneratedPaths,
} from "#adaptv/vite/adaptv-dir"

const APP = "/app"

describe("resolveGeneratedPaths — everything generated lives in one hidden dir", () => {
  //ARCHITECTURE §3.2. Today these land in the app's own src tree
  //(`src/router.gen.tsx`, `src/routing/layouts/__root.gen.tsx`), so the consumer
  //sees framework artifacts sitting next to their code and has to gitignore each
  //one. One hidden dir, treated like `dist/`.
  const paths = resolveGeneratedPaths(APP)

  it("puts the router entry in .adaptv/", () => {
    expect(paths.routerGen).toBe(
      path.join(APP, ADAPTV_DIR, "router.gen.tsx"),
    )
  })

  it("does NOT generate a root route at all — it is a package module", () => {
    //An audit showed `.adaptv/root.gen.tsx` was almost entirely framework code:
    //a createRootRoute call plus static imports of the app's screens. So it is
    //now a real module in the package, and its app-specific half arrives through
    //`virtual:adaptv/root-route`. Generating a per-app copy of framework code
    //means changing an opinion requires every consumer to rebuild.
    expect("rootGen" in paths).toBe(false)
  })

  it("puts TanStack's route tree in .adaptv/ too", () => {
    //the route tree is TanStack's artifact, not adaptv's, but it is still
    //generated — leaving it beside the routes is the most visible tell that
    //there is a code generator involved
    expect(paths.routeTree).toBe(
      path.join(APP, ADAPTV_DIR, "routeTree.gen.ts"),
    )
  })

  it("puts the Register augmentation in .adaptv/", () => {
    expect(paths.registerDts).toBe(
      path.join(APP, ADAPTV_DIR, "register.d.ts"),
    )
  })

  it("never escapes the app root", () => {
    for (const value of Object.values(paths)) {
      expect(value.startsWith(path.join(APP, ADAPTV_DIR))).toBe(true)
    }
  })
})

describe("the consumer wires nothing by hand", () => {
  it("supplies a tsconfig path mapping for the generated tree", () => {
    //without this the app's own tsconfig cannot resolve the hidden imports, and
    //the consumer would have to hand-edit tsconfig — exactly the per-project
    //babysitting adaptv exists to remove
    const paths = adaptvDirTsconfigPaths()
    expect(paths["#adaptv-gen/*"]).toEqual([`./${ADAPTV_DIR}/*`])
  })

  it("supplies the gitignore entry, since .adaptv/ is a build artifact", () => {
    expect(adaptvDirGitignoreEntry()).toContain(ADAPTV_DIR)
  })

  it("uses a dot-prefixed dir so editors and search collapse it by default", () => {
    expect(ADAPTV_DIR.startsWith(".")).toBe(true)
  })
})
