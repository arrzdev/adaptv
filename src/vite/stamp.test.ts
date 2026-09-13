// @vitest-environment node
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import ts from "typescript"
import { afterEach, describe, expect, it } from "vitest"
import type { AdaptvAppConfig } from "#adaptv/config/app-config"
import type { AdaptvContext } from "#adaptv/vite/adaptv-context.ts"
import { renderRootRouteModule } from "#adaptv/vite/root-route-module"
import { stampGeneratedFiles } from "#adaptv/vite/stamp.ts"

/**
 * Build a screen thunk WITHOUT writing a literal `import()` in this file.
 *
 * `extractThunkSpecifier` reads the specifier out of `thunk.toString()`, so the
 * text is all that matters — and a real dynamic import here would be statically
 * analysed by Vite and fail to resolve, since `@/…` is the *consumer's* alias and
 * does not exist inside adaptv.
 */
function screenThunk(specifier: string) {
  return new Function(
    `return import(${JSON.stringify(specifier)})`,
  ) as never
}

function config(extra: Partial<AdaptvAppConfig> = {}): AdaptvAppConfig {
  return {
    name: "Probe",
    description: "d",
    themeColor: { light: "#fff", dark: "#000" },
    styles: "./src/styles/main.css",
    router: {
      routesDirectory: "./src/routes",
      routerConfig: "./src/routes.config.ts",
    },
    ...extra,
  } as AdaptvAppConfig
}

describe("renderRootRouteModule — screen thunks become STATIC imports", () => {
  it("emits a static import for offlineComponent, never a dynamic one", () => {
    //THE constraint that makes the offline story work at all. If the offline UI
    //resolved to its own lazy chunk, then in the exact situation it exists for —
    //chunks unavailable — that chunk would be unavailable too, and the user would
    //get a blank screen instead of the offline screen.
    //→ docs/design/rendering.md §3.1.2 ("must be in the eager bundle, never lazily imported")
    const source = renderRootRouteModule(
      config({
        offlineComponent: screenThunk("@/components/offline"),
      }),
    )
    expect(source).toContain(
      'import OfflineComponent from "@/components/offline"',
    )
    expect(source).not.toContain('import("@/components/offline")')
  })

  it("wires the component into the root config", () => {
    const source = renderRootRouteModule(
      config({
        offlineComponent: screenThunk("@/components/offline"),
      }),
    )
    expect(source).toContain("offlineComponent: OfflineComponent")
  })

  it("omits the field entirely when the app does not override it", () => {
    //absent, not `undefined` — so adaptv's own default applies
    const source = renderRootRouteModule(config())
    expect(source).not.toContain("offlineComponent")
  })

  it("keeps the boot error screen OUT of the runtime root route", () => {
    //`bootErrorScreen` is consumed at BUILD time — prerendered into the emitted
    //document by `shell-emit` — because it exists for the case where the runtime
    //never starts. Shipping it in the bundle too would be dead weight in every
    //app, and would imply the runtime can render it. It cannot.
    const source = renderRootRouteModule(
      config({ bootErrorScreen: screenThunk("@/components/boot-error") }),
    )
    expect(source).not.toContain("bootErrorScreen")
    expect(source).not.toContain("boot-error")
  })

  it("says nothing about the service worker", () => {
    //The worker is not root-route configuration any more, and there is no
    //register mode to stamp. It is registered unconditionally on web and
    //standalone, skipped on native and in dev, and applied at the next cold
    //launch — all decisions the runtime owns. A field here could only ever
    //disagree with it. → docs/design/rendering.md §3.4
    const source = renderRootRouteModule(config())
    expect(source).not.toContain("serviceWorker")
    expect(source).not.toContain("register")
  })
})

describe("renderRootRouteModule — the ui app-feel block", () => {
  it("forwards `ui` to the root config so the init script can resolve it", () => {
    const source = renderRootRouteModule(
      config({ ui: { noSelect: "all", hideScrollbars: "off" } }),
    )
    expect(source).toContain(
      'ui: { "noSelect": "all", "hideScrollbars": "off" }',
    )
  })

  it("omits the block entirely when the app says nothing", () => {
    //absent, not `undefined` — the shell's own `"app"` defaults are the source of
    //truth for the default, and there must be exactly one of them
    expect(renderRootRouteModule(config())).not.toContain("ui:")
  })
})

describe("adaptv generates no router entry at all", () => {
  //`.adaptv/router.gen.tsx` used to hold `getRouter`, and the justification was
  //"Start needs a module PATH exporting it". True — but the path does not have to
  //be in the consumer's tree. It is now a package module reached through the
  //`#adaptv-route-tree` alias, so `.adaptv/` holds exactly one file: TanStack's
  //generated route tree, which genuinely is derived from the app's route files.
  it("does not export a router-entry generator any more", async () => {
    const stamp = await import("#adaptv/vite/stamp")
    expect("renderRouterGen" in stamp).toBe(false)
  })
})

describe("renderRootRouteModule — the head's icon links are baked in", () => {
  it("emits the resolved links so `pwaHead` never has to invent any", () => {
    //`pwaHead` used to spread a hardcoded twenty-entry list under a hardcoded `/favicons`
    //base — files that need not exist, in a directory the app need not use. Deciding them
    //means reading the icon directory, and the shell has no filesystem, so the answer is
    //resolved at build time and travels through this module.
    const source = renderRootRouteModule(config(), undefined, [
      { rel: "icon", href: "/brand/favicon-32x32.png", sizes: "32x32" },
      { rel: "apple-touch-icon", href: "/brand/apple-touch-icon-180.png" },
    ])
    expect(source).toContain('"href": "/brand/favicon-32x32.png"')
    expect(source).toContain('"rel": "apple-touch-icon"')
  })

  it("emits no `links` field at all when there are no icons to link", () => {
    //An empty array would be a promise of a set that isn't there; the field is simply absent
    //and `pwaHead` falls back to its own (now icon-free) defaults.
    expect(renderRootRouteModule(config())).not.toContain("links:")
  })
})

describe("renderRootRouteModule — the update-required screen", () => {
  it("emits the threshold on its own, for an app that wants adaptv's screen", () => {
    //The common case by a distance: one number in the config, no component to
    //write. If the threshold only travelled alongside a component, that app
    //would set it and silently get nothing.
    const source = renderRootRouteModule(
      config({ updateRequiredAfterDays: 14 }),
    )
    expect(source).toContain("updateRequiredAfterDays: 14")
    expect(source).not.toContain("updateRequiredComponent")
  })

  it("keeps `0` — the strictest policy, not an absent one", () => {
    //🔴 A truthiness check here would drop exactly the setting that means
    //"block the moment the channel moves past this install", which is the one an
    //app whose server contract broke with the release would choose.
    expect(
      renderRootRouteModule(config({ updateRequiredAfterDays: 0 })),
    ).toContain("updateRequiredAfterDays: 0")
  })

  it("emits nothing at all when the app never asked to block", () => {
    //Absent, not `0`: the default is that adaptv never takes the screen from a
    //working app.
    expect(renderRootRouteModule(config())).not.toContain(
      "updateRequiredAfterDays",
    )
  })

  it("emits a static import for a custom screen", () => {
    const source = renderRootRouteModule(
      config({
        updateRequiredAfterDays: 7,
        updateRequiredScreen: screenThunk("@/components/update-required"),
      }),
    )
    expect(source).toContain(
      'import UpdateRequiredComponent from "@/components/update-required"',
    )
    expect(source).toContain(
      "updateRequiredComponent: UpdateRequiredComponent",
    )
  })
})

/*
 * The project wiring `stampGeneratedFiles` writes into files the CONSUMER owns.
 * → `docs/design/architecture.md` §3 (".adaptv/ relocation", "stamp.ts now
 * generates nothing at all")
 *
 * It runs on every config load, dev and build alike, so the contract has three
 * halves: the entries land where the tools that read them look; a second run
 * changes nothing, not even the mtime a watcher keys on; and a file it cannot
 * edit is left alone rather than failing the build.
 */
describe("stampGeneratedFiles — the consumer's .gitignore and tsconfig", () => {
  const roots: string[] = []
  afterEach(() => {
    for (const dir of roots.splice(0))
      rmSync(dir, { recursive: true, force: true })
  })

  const ROUTE_GLOBALS =
    "node_modules/@arrzdev/adaptv/src/interface/route-globals.d.ts"
  const GENERATED_TS = ".adaptv/**/*.ts"
  const ROUTE_TREE_ALIAS = "#adaptv-route-tree"

  function app(files: Record<string, string> = {}): string {
    const appRoot = mkdtempSync(path.join(tmpdir(), "adaptv-stamp-"))
    roots.push(appRoot)
    for (const [rel, contents] of Object.entries(files)) {
      mkdirSync(path.dirname(path.join(appRoot, rel)), { recursive: true })
      writeFileSync(path.join(appRoot, rel), contents)
    }
    return appRoot
  }

  const loaded = (appRoot: string): AdaptvContext => ({
    appRoot,
    target: "web",
    loaded: { config: {} as AdaptvAppConfig, watchFiles: [] },
  })

  const read = (appRoot: string, rel: string) =>
    readFileSync(path.join(appRoot, rel), "utf8")

  /** The tsconfig as TypeScript itself reads it: comments, trailing commas and all. */
  function parseTsconfig(appRoot: string) {
    const parsed = ts.parseConfigFileTextToJson(
      "tsconfig.json",
      read(appRoot, "tsconfig.json"),
    )
    expect(parsed.error).toBeUndefined()
    return parsed.config as {
      include: string[]
      compilerOptions: { paths: Record<string, string[]> }
    }
  }

  /** Backdate a file, so a rewrite with identical bytes still shows up. */
  function backdate(appRoot: string, rel: string): number {
    const file = path.join(appRoot, rel)
    const past = new Date("2020-01-01T00:00:00Z")
    utimesSync(file, past, past)
    return statSync(file).mtimeMs
  }

  const VITE_TSCONFIG = `{
  // the app's own comment, which JSON.parse would reject
  "include": ["src", "vite.config.ts",],
  "compilerOptions": {
    "baseUrl": ".",
    "paths": {
      "@/*": ["./src/*"],
    },
  },
}
`

  it("touches nothing before the app config has loaded", () => {
    const appRoot = app({ "tsconfig.json": VITE_TSCONFIG })
    stampGeneratedFiles({ appRoot, target: "web", loaded: null })
    expect(() => read(appRoot, ".gitignore")).toThrow()
    expect(read(appRoot, "tsconfig.json")).toBe(VITE_TSCONFIG)
  })

  it("ignores everything adaptv generates, in an app with no .gitignore yet", () => {
    const appRoot = app()
    stampGeneratedFiles(loaded(appRoot))
    const lines = read(appRoot, ".gitignore").split("\n")
    expect(lines).toContain(".adaptv/")
    expect(lines).toContain("capacitor.config.json")
  })

  it("appends only what is missing, below the consumer's own lines", () => {
    const own = "node_modules\n.adaptv/\ndist"
    const appRoot = app({ ".gitignore": own })
    stampGeneratedFiles(loaded(appRoot))
    const next = read(appRoot, ".gitignore")
    expect(next.startsWith(`${own}\n`)).toBe(true)
    expect(next.match(/^\.adaptv\/$/gm)).toHaveLength(1)
    expect(next.split("\n")).toContain("capacitor.config.json")
  })

  it("wires the tsconfig the way TypeScript reads it, keeping every byte it had", () => {
    const appRoot = app({ "tsconfig.json": VITE_TSCONFIG })
    stampGeneratedFiles(loaded(appRoot))
    const config = parseTsconfig(appRoot)
    //a route file written before the generator adds its import must still
    //know `createFileRoute`, and the generated tree must be in the program
    expect(config.include).toEqual([
      ROUTE_GLOBALS,
      GENERATED_TS,
      "src",
      "vite.config.ts",
    ])
    //the route tree's TYPE must flow into `Register`; a bundler alias alone
    //builds fine and collapses typed routing to `any`
    expect(config.compilerOptions.paths).toEqual({
      [ROUTE_TREE_ALIAS]: ["./.adaptv/routeTree.gen.ts"],
      "@/*": ["./src/*"],
    })
    expect(read(appRoot, "tsconfig.json")).toContain(
      "// the app's own comment, which JSON.parse would reject",
    )
  })

  it("resolves the alias to the generated route tree from the app root", () => {
    const appRoot = app({ "tsconfig.json": VITE_TSCONFIG })
    stampGeneratedFiles(loaded(appRoot))
    const { options } = ts.parseJsonConfigFileContent(
      parseTsconfig(appRoot),
      ts.sys,
      appRoot,
    )
    const [target] = options.paths?.[ROUTE_TREE_ALIAS] ?? []
    expect(
      path.resolve(options.pathsBasePath as string, target as string),
    ).toBe(path.join(appRoot, ".adaptv", "routeTree.gen.ts"))
  })

  it("adds only the include entry that is missing, never a duplicate", () => {
    const appRoot = app({
      "tsconfig.json": `{\n  "include": ["${GENERATED_TS}", "src"],\n  "compilerOptions": { "paths": { "${ROUTE_TREE_ALIAS}": ["./.adaptv/routeTree.gen.ts"] } }\n}\n`,
    })
    stampGeneratedFiles(loaded(appRoot))
    const config = parseTsconfig(appRoot)
    expect(config.include).toEqual([ROUTE_GLOBALS, GENERATED_TS, "src"])
    expect(Object.keys(config.compilerOptions.paths)).toEqual([
      ROUTE_TREE_ALIAS,
    ])
  })

  it("wires an empty include list and an empty paths object into a config TypeScript accepts", () => {
    const appRoot = app({
      "tsconfig.json": `{ "include": [], "compilerOptions": { "paths": {} } }`,
    })
    stampGeneratedFiles(loaded(appRoot))
    const config = parseTsconfig(appRoot)
    expect(config.include).toEqual([ROUTE_GLOBALS, GENERATED_TS])
    expect(config.compilerOptions.paths[ROUTE_TREE_ALIAS]).toEqual([
      "./.adaptv/routeTree.gen.ts",
    ])
  })

  it("does not rewrite either file once it is wired, so watchers stay quiet", () => {
    //This runs on every config load. A rewrite with identical bytes still bumps
    //the mtime, and a tsconfig or .gitignore watcher cannot tell that from an edit.
    const appRoot = app({ "tsconfig.json": VITE_TSCONFIG })
    stampGeneratedFiles(loaded(appRoot))
    const tsconfig = read(appRoot, "tsconfig.json")
    const gitignore = read(appRoot, ".gitignore")
    const tsconfigMtime = backdate(appRoot, "tsconfig.json")
    const gitignoreMtime = backdate(appRoot, ".gitignore")

    stampGeneratedFiles(loaded(appRoot))

    expect(read(appRoot, "tsconfig.json")).toBe(tsconfig)
    expect(read(appRoot, ".gitignore")).toBe(gitignore)
    expect(statSync(path.join(appRoot, "tsconfig.json")).mtimeMs).toBe(
      tsconfigMtime,
    )
    expect(statSync(path.join(appRoot, ".gitignore")).mtimeMs).toBe(
      gitignoreMtime,
    )
  })

  it("never creates a tsconfig the app does not have", () => {
    const appRoot = app()
    stampGeneratedFiles(loaded(appRoot))
    expect(() => read(appRoot, "tsconfig.json")).toThrow()
  })

  it("leaves a tsconfig with nowhere to put an entry exactly as it was", () => {
    //Edited at string level so a file adaptv does not own is never reformatted;
    //with no `include` list or `paths` object to extend there is no edit to make
    const own = `{\n  "extends": "./tsconfig.base.json",\n  "compilerOptions": { "strict": true }\n}\n`
    const appRoot = app({ "tsconfig.json": own })
    stampGeneratedFiles(loaded(appRoot))
    expect(read(appRoot, "tsconfig.json")).toBe(own)
  })

  it("does not fail the build over a wiring file it cannot read", () => {
    //a read-only or odd working tree is not a reason to stop `vite build`; and
    //one unreadable file does not cost the other its wiring
    const appRoot = app({ "tsconfig.json": VITE_TSCONFIG })
    mkdirSync(path.join(appRoot, ".gitignore"))
    expect(() => stampGeneratedFiles(loaded(appRoot))).not.toThrow()
    expect(parseTsconfig(appRoot).include).toContain(GENERATED_TS)

    const other = app({ ".gitignore": "dist\n" })
    mkdirSync(path.join(other, "tsconfig.json"))
    expect(() => stampGeneratedFiles(loaded(other))).not.toThrow()
    expect(read(other, ".gitignore").split("\n")).toContain(".adaptv/")
  })
})
