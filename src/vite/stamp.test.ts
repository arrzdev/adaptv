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
