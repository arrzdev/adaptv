import { describe, expect, it } from "vitest"
import type { AdaptvAppConfig } from "#adaptv/config/app-config"
import {
  resolveWebConfig,
  staticHostFiles,
} from "#adaptv/config/web-config"

function config(extra: Partial<AdaptvAppConfig> = {}): AdaptvAppConfig {
  return {
    name: "Probe",
    description: "d",
    themeColor: { light: "#fff" },
    styles: "./src/styles/main.css",
    router: {
      routesDirectory: "./routes",
      routerConfig: "./routes.config.ts",
    },
    ...extra,
  } as AdaptvAppConfig
}

describe("resolveWebConfig — render default", () => {
  it("defaults to SSR", () => {
    //DECISIONS §6.3, on the asymmetry: defaulting to SPA silently kills SEO and
    //is discovered late (usually by someone else, in a search ranking);
    //defaulting to SSR costs one config flip, immediately, by the person who
    //wanted SPA. Cheap-to-correct beats cheap-to-run.
    expect(resolveWebConfig(config()).render).toBe("ssr")
  })

  it("honours an explicit top-level render", () => {
    //`render`, not `web.render`. It sits at the top level because it is the one
    //decision that determines what a deploy even needs — a server for "ssr", any
    //bucket of files for "spa".
    expect(resolveWebConfig(config({ render: "spa" })).render).toBe("spa")
  })

  it("is the ONLY deploy-shaping key — a `web` block is not read", () => {
    //The regression this pins: `web.host` is gone (`DECISIONS.md §6.4`). It named
    //a deploy target adaptv had no behaviour behind — `"cloudflare"` and `"node"`
    //produced byte-identical output, and its one real value, `"static"`, was just
    //`render: "spa"` said twice. Anything left in a `web` block is now inert, so
    //a stale config cannot quietly flip the render mode back.
    const stale = config({ render: "ssr" }) as Record<string, unknown>
    stale.web = { host: "static" }
    expect(
      resolveWebConfig(stale as Parameters<typeof resolveWebConfig>[0])
        .render,
    ).toBe("ssr")
  })
})

describe("resolveWebConfig — the capacitor target is absolute (L12)", () => {
  it("forces SPA and disables the SW, whatever the config says", () => {
    //Not a default, an override. A Capacitor WebView loads on-device files: there
    //is no server to SSR, and a SW is impossible on iOS's custom-scheme origin,
    //pointless (the bundle is local) and actively breaks OTA.
    const resolved = resolveWebConfig(
      config({ render: "ssr" }),
      "capacitor",
    )
    expect(resolved.render).toBe("spa")
    expect(resolved.sw.enabled).toBe(false)
  })
})

describe("resolveWebConfig — the service worker is not a feature flag", () => {
  it("is on for every web build", () => {
    expect(resolveWebConfig(config()).sw.enabled).toBe(true)
  })

  it("stays on no matter what the app config contains", () => {
    //The regression this pins: `sw`, `web.sw.enabled`, `precacheDocuments` and
    //`register` were all removed on purpose. Precaching every route chunk is
    //what makes a web build navigate like the native one, so an app that could
    //switch it off would silently stop being the product. The ONLY thing that
    //turns the worker off is the capacitor target, asserted above.
    const withJunk = config() as Record<string, unknown>
    withJunk.sw = false
    withJunk.serviceWorker = false
    withJunk.web = { host: "node", sw: { enabled: false } }
    expect(
      resolveWebConfig(withJunk as Parameters<typeof resolveWebConfig>[0])
        .sw.enabled,
    ).toBe(true)
  })
})

describe("staticHostFiles — what a static host actually needs", () => {
  //DECISIONS B26: nothing emitted these, so a static deploy was not deployable as
  //designed even though it was documented. They now ride on `render: "spa"`
  //rather than on a nominated host (§6.4) — each is read by one platform and
  //ignored by the rest, so all four are correct wherever the bucket lands.
  const files = staticHostFiles("<!doctype html><html></html>")

  it("emits index.html, because Start only writes _shell.html", () => {
    //and Jekyll STRIPS `_`-prefixed files on GitHub Pages, while Cloudflare
    //Workers Assets looks for /index.html — so the shell is invisible to both
    expect(files["index.html"]).toBeTruthy()
  })

  it("emits 404.html so deep links work on a static host", () => {
    //a static host has no router: /settings is a 404 unless the shell is served
    //for it, and 404.html is the convention GitHub Pages and Netlify honour
    expect(files["404.html"]).toBe(files["index.html"])
  })

  it("emits .nojekyll, without which GitHub Pages eats the asset dir", () => {
    //Jekyll strips files and dirs beginning with `_`, which includes Vite's
    //own output in some configurations
    expect(files[".nojekyll"]).toBeDefined()
  })

  it("emits a SPA redirect rule for Netlify-style hosts", () => {
    expect(files._redirects).toContain("/*")
    expect(files._redirects).toContain("200")
  })
})
