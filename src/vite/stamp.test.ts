import { describe, expect, it } from "vitest"
import type { NativAppConfig } from "#nativ/config/app-config"
import { renderRootRouteModule } from "#nativ/vite/root-route-module"

/**
 * Build a screen thunk WITHOUT writing a literal `import()` in this file.
 *
 * `extractThunkSpecifier` reads the specifier out of `thunk.toString()`, so the
 * text is all that matters — and a real dynamic import here would be statically
 * analysed by Vite and fail to resolve, since `@/…` is the *consumer's* alias and
 * does not exist inside nativ.
 */
function screenThunk(specifier: string) {
  return new Function(
    `return import(${JSON.stringify(specifier)})`,
  ) as never
}

function config(extra: Partial<NativAppConfig> = {}): NativAppConfig {
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
  } as NativAppConfig
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
    //absent, not `undefined` — so nativ's own default applies
    const source = renderRootRouteModule(config())
    expect(source).not.toContain("offlineComponent")
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

describe("nativ generates no router entry at all", () => {
  //`.nativ/router.gen.tsx` used to hold `getRouter`, and the justification was
  //"Start needs a module PATH exporting it". True — but the path does not have to
  //be in the consumer's tree. It is now a package module reached through the
  //`#nativ-route-tree` alias, so `.nativ/` holds exactly one file: TanStack's
  //generated route tree, which genuinely is derived from the app's route files.
  it("does not export a router-entry generator any more", async () => {
    const stamp = await import("#nativ/vite/stamp")
    expect("renderRouterGen" in stamp).toBe(false)
  })
})
