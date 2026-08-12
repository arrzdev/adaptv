import { describe, expect, it } from "vitest"
import type { AdaptvAppConfig } from "#adaptv/config/app-config"
import { renderRootRouteModule } from "#adaptv/vite/root-route-module"

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
    //→ RENDERING.md §3.1.2 ("must be in the eager bundle, never lazily imported")
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

  it("defaults service-worker registration to prompt, not autoUpdate", () => {
    //B3: autoUpdate applies skipWaiting + reload mid-session, dropping unsaved
    //state AND pruning the precache under open tabs — which is what makes the
    //next lazy import 404. The default is the whole decision.
    const source = renderRootRouteModule(config())
    expect(source).toContain('serviceWorker: { register: "prompt" }')
    expect(source).not.toContain("autoUpdate")
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
